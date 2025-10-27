#!/bin/bash

# GoMeet DigitalOcean Backup and Recovery Script
# Script untuk backup dan recovery database, konfigurasi, dan data penting
# Support automated backups, scheduled backups, dan disaster recovery

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="gomeet"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="/tmp/gomeet-backups"
LOG_DIR="/tmp/gomeet-backups/logs"
BACKUP_ID="backup-$(date +%Y%m%d-%H%M%S)"
RETENTION_DAYS=30
RETENTION_COUNT=50

# Backup targets
BACKUP_POSTGRES=true
BACKUP_REDIS=true
BACKUP_K8S_CONFIGS=true
BACKUP_SECRETS=false  # Set to true with caution
BACKUP_LOGS=true
BACKUP_METRICS=true

# DigitalOcean Spaces configuration
SPACES_REGION=${SPACES_REGION:-"nyc3"}
SPACES_BUCKET=${SPACES_BUCKET:-"gomeet-backups"}
SPACES_ENDPOINT=${SPACES_ENDPOINT:-"https://$SPACES_REGION.digitaloceanspaces.com"}

# Database configurations
POSTGRES_HOST=${POSTGRES_HOST:-"postgres-primary"}
POSTGRES_PORT=${POSTGRES_PORT:-"5432"}
POSTGRES_DB=${POSTGRES_DB:-"gomeet"}
REDIS_HOST=${REDIS_HOST:-"redis-primary"}
REDIS_PORT=${REDIS_PORT:-"6379"}

# Global variables
VERBOSE=false
DRY_RUN=false
ENCRYPT_BACKUP=true
COMPRESSION_LEVEL=6
PARALLEL_JOBS=4
SKIP_VERIFY=false
FORCE_BACKUP=false
RECOVERY_MODE=false

# Functions
log() {
    local level="$1"
    shift
    local message="$*"
    local timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    
    case "$level" in
        "INFO")  echo -e "${BLUE}[$timestamp] INFO:${NC}  $message" | tee -a "$LOG_FILE" ;;
        "SUCCESS") echo -e "${GREEN}[$timestamp] SUCCESS:${NC} $message" | tee -a "$LOG_FILE" ;;
        "WARNING") echo -e "${YELLOW}[$timestamp] WARNING:${NC} $message" | tee -a "$LOG_FILE" ;;
        "ERROR") echo -e "${RED}[$timestamp] ERROR:${NC}  $message" | tee -a "$LOG_FILE" ;;
        "DEBUG") [[ "$VERBOSE" == true ]] && echo -e "${PURPLE}[$timestamp] DEBUG:${NC} $message" | tee -a "$LOG_FILE" ;;
        "PHASE") echo -e "\n${CYAN}========== PHASE: $message ==========${NC}" | tee -a "$LOG_FILE" ;;
    esac
}

# Progress indicator
show_progress() {
    local current="$1"
    local total="$2"
    local desc="$3"
    local percent=$((current * 100 / total))
    local filled=$((percent / 2))
    local empty=$((50 - filled))
    
    printf "\r${BLUE}[%3d%%]${NC} [" "$percent"
    printf "%*s" "$filled" | tr ' ' '='
    printf "%*s" "$empty" | tr ' ' '-'
    printf "] $desc"
    
    if [[ "$current" == "$total" ]]; then
        echo ""
    fi
}

# Error handling
handle_error() {
    local exit_code=$?
    local line_number=$1
    
    log "ERROR" "Backup/restore operation failed at line $line_number with exit code $exit_code"
    log "ERROR" "Check logs: $LOG_FILE"
    
    # Cleanup on error
    cleanup_on_error
    
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Cleanup function
cleanup_on_error() {
    log "WARNING" "Performing cleanup after error..."
    
    # Remove temporary files
    if [[ -n "$TEMP_DIR" && -d "$TEMP_DIR" ]]; then
        rm -rf "$TEMP_DIR"
        log "INFO" "Cleaned up temporary directory: $TEMP_DIR"
    fi
}

# Prerequisites check
check_prerequisites() {
    log "PHASE" "Checking Prerequisites"
    
    # Check required tools
    local tools=("kubectl" "jq" "curl" "aws" "pg_dump" "redis-cli" "gzip" "gpg")
    local missing_tools=()
    
    for tool in "${tools[@]}"; do
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log "ERROR" "Missing required tools: ${missing_tools[*]}"
        exit 1
    fi
    
    # Check kubernetes connection
    if ! kubectl cluster-info &> /dev/null; then
        log "ERROR" "Cannot connect to Kubernetes cluster"
        exit 1
    fi
    
    # Check namespace
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log "ERROR" "Namespace $NAMESPACE does not exist"
        exit 1
    fi
    
    # Check AWS credentials for Spaces
    if ! aws sts get-caller-identity &> /dev/null; then
        log "ERROR" "AWS credentials not configured for DigitalOcean Spaces"
        exit 1
    fi
    
    # Create directories
    mkdir -p "$BACKUP_DIR" "$LOG_DIR"
    
    log "SUCCESS" "All prerequisites satisfied"
}

# Setup backup environment
setup_backup_environment() {
    log "PHASE" "Setting Up Backup Environment"
    
    # Create backup directory
    TEMP_DIR="$BACKUP_DIR/$BACKUP_ID"
    mkdir -p "$TEMP_DIR"
    
    # Create subdirectories
    mkdir -p "$TEMP_DIR/postgres" "$TEMP_DIR/redis" "$TEMP_DIR/k8s" "$TEMP_DIR/logs" "$TEMP_DIR/metrics"
    
    # Set log file
    LOG_FILE="$LOG_DIR/$BACKUP_ID.log"
    
    # Initialize backup metadata
    local metadata_file="$TEMP_DIR/metadata.json"
    
    cat > "$metadata_file" << EOF
{
    "backup_id": "$BACKUP_ID",
    "timestamp": "$(date -Iseconds)",
    "namespace": "$NAMESPACE",
    "cluster": "$(kubectl config current-context)",
    "version": "1.0.0",
    "targets": {
        "postgres": $BACKUP_POSTGRES,
        "redis": $BACKUP_REDIS,
        "k8s_configs": $BACKUP_K8S_CONFIGS,
        "secrets": $BACKUP_SECRETS,
        "logs": $BACKUP_LOGS,
        "metrics": $BACKUP_METRICS
    },
    "encryption": $ENCRYPT_BACKUP,
    "compression_level": $COMPRESSION_LEVEL
}
EOF
    
    log "SUCCESS" "Backup environment setup completed"
}

# Backup PostgreSQL database
backup_postgres() {
    if [[ "$BACKUP_POSTGRES" != true ]]; then
        log "INFO" "PostgreSQL backup skipped"
        return 0
    fi
    
    log "PHASE" "Backing Up PostgreSQL"
    
    # Get PostgreSQL credentials
    local postgres_user=$(kubectl get secret postgres-secret -n "$NAMESPACE" -o jsonpath='{.data.username}' | base64 -d)
    local postgres_password=$(kubectl get secret postgres-secret -n "$NAMESPACE" -o jsonpath='{.data.password}' | base64 -d)
    
    if [[ -z "$postgres_user" || -z "$postgres_password" ]]; then
        log "ERROR" "Could not retrieve PostgreSQL credentials"
        return 1
    fi
    
    # Create backup file
    local backup_file="$TEMP_DIR/postgres/gomeet-$(date +%Y%m%d-%H%M%S).sql"
    
    log "INFO" "Creating PostgreSQL backup: $backup_file"
    
    # Port forward to PostgreSQL
    local pf_pid=""
    kubectl port-forward -n "$NAMESPACE" svc/postgres-primary 5432:5432 &
    pf_pid=$!
    
    # Wait for port forward to be ready
    sleep 5
    
    # Create backup
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create PostgreSQL backup"
    else
        PGPASSWORD="$postgres_password" pg_dump \
            -h localhost \
            -p "$POSTGRES_PORT" \
            -U "$postgres_user" \
            -d "$POSTGRES_DB" \
            --verbose \
            --clean \
            --if-exists \
            --create \
            --format=custom \
            --compress="$COMPRESSION_LEVEL" \
            --file="$backup_file"
        
        # Verify backup
        if [[ "$SKIP_VERIFY" != true ]]; then
            log "INFO" "Verifying PostgreSQL backup"
            PGPASSWORD="$postgres_password" pg_restore \
                -h localhost \
                -p "$POSTGRES_PORT" \
                -U "$postgres_user" \
                --list "$backup_file" > /dev/null
        fi
    fi
    
    # Clean up port forward
    kill $pf_pid 2>/dev/null || true
    
    log "SUCCESS" "PostgreSQL backup completed"
}

# Backup Redis database
backup_redis() {
    if [[ "$BACKUP_REDIS" != true ]]; then
        log "INFO" "Redis backup skipped"
        return 0
    fi
    
    log "PHASE" "Backing Up Redis"
    
    # Create backup file
    local backup_file="$TEMP_DIR/redis/gomeet-redis-$(date +%Y%m%d-%H%M%S).rdb"
    
    log "INFO" "Creating Redis backup: $backup_file"
    
    # Port forward to Redis
    local pf_pid=""
    kubectl port-forward -n "$NAMESPACE" svc/redis-primary 6379:6379 &
    pf_pid=$!
    
    # Wait for port forward to be ready
    sleep 5
    
    # Create backup
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create Redis backup"
    else
        # Trigger Redis BGSAVE
        redis-cli -h localhost -p "$REDIS_PORT" BGSAVE
        
        # Wait for backup to complete
        local save_complete=false
        local timeout=300  # 5 minutes
        local elapsed=0
        
        while [[ $save_complete == false && $elapsed -lt $timeout ]]; do
            local lastsave=$(redis-cli -h localhost -p "$REDIS_PORT" LASTSAVE)
            local current_time=$(date +%s)
            local time_diff=$((current_time - lastsave))
            
            if [[ $time_diff -lt 10 ]]; then
                save_complete=true
            else
                sleep 5
                elapsed=$((elapsed + 5))
            fi
        done
        
        if [[ $save_complete == false ]]; then
            log "WARNING" "Redis backup timeout, proceeding anyway"
        fi
        
        # Copy RDB file from Redis pod
        local redis_pod=$(kubectl get pods -n "$NAMESPACE" -l app=redis-primary -o jsonpath='{.items[0].metadata.name}')
        kubectl cp "$NAMESPACE/$redis_pod:/data/dump.rdb" "$backup_file"
    fi
    
    # Clean up port forward
    kill $pf_pid 2>/dev/null || true
    
    log "SUCCESS" "Redis backup completed"
}

# Backup Kubernetes configurations
backup_k8s_configs() {
    if [[ "$BACKUP_K8S_CONFIGS" != true ]]; then
        log "INFO" "Kubernetes configs backup skipped"
        return 0
    fi
    
    log "PHASE" "Backing Up Kubernetes Configurations"
    
    local k8s_dir="$TEMP_DIR/k8s"
    
    # Backup all resources in namespace
    local resources=("deployments" "services" "configmaps" "secrets" "ingresses" "hpa" "pvc" "statefulsets" "daemonsets" "networkpolicies")
    
    for resource in "${resources[@]}"; do
        log "INFO" "Backing up $resource"
        
        if [[ "$DRY_RUN" == true ]]; then
            log "INFO" "[DRY RUN] Would backup $resource"
            continue
        fi
        
        # Get all resources of this type
        kubectl get "$resource" -n "$NAMESPACE" -o json > "$k8s_dir/${resource}.json" 2>/dev/null || true
        
        # Export each resource individually
        local resource_names=$(kubectl get "$resource" -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
        
        for name in $resource_names; do
            kubectl get "$resource" "$name" -n "$NAMESPACE" -o yaml > "$k8s_dir/${resource}-${name}.yaml" 2>/dev/null || true
        done
    done
    
    # Backup CRDs
    log "INFO" "Backing up CRDs"
    kubectl get crds -o json > "$k8s_dir/crds.json" 2>/dev/null || true
    
    # Backup namespace
    kubectl get namespace "$NAMESPACE" -o yaml > "$k8s_dir/namespace.yaml" 2>/dev/null || true
    
    log "SUCCESS" "Kubernetes configurations backup completed"
}

# Backup secrets (with caution)
backup_secrets() {
    if [[ "$BACKUP_SECRETS" != true ]]; then
        log "INFO" "Secrets backup skipped"
        return 0
    fi
    
    log "PHASE" "Backing Up Secrets"
    log "WARNING" "Backing up sensitive data - ensure proper encryption"
    
    local secrets_dir="$TEMP_DIR/secrets"
    mkdir -p "$secrets_dir"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would backup secrets"
        return 0
    fi
    
    # Export secrets
    local secret_names=$(kubectl get secrets -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    for secret in $secret_names; do
        # Skip service account tokens
        if [[ "$secret" =~ .*token.* ]]; then
            continue
        fi
        
        kubectl get secret "$secret" -n "$NAMESPACE" -o yaml > "$secrets_dir/${secret}.yaml"
    done
    
    log "SUCCESS" "Secrets backup completed"
}

# Backup logs
backup_logs() {
    if [[ "$BACKUP_LOGS" != true ]]; then
        log "INFO" "Logs backup skipped"
        return 0
    fi
    
    log "PHASE" "Backing Up Logs"
    
    local logs_dir="$TEMP_DIR/logs"
    
    # Get logs from all pods
    local pod_names=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    local total_pods=$(echo $pod_names | wc -w)
    local current=0
    
    for pod in $pod_names; do
        ((current++))
        show_progress $current $total_pods "Backing up logs from $pod"
        
        if [[ "$DRY_RUN" == true ]]; then
            continue
        fi
        
        # Get logs from all containers
        local container_names=$(kubectl get pod "$pod" -n "$NAMESPACE" -o jsonpath='{.spec.containers[*].name}' 2>/dev/null || echo "")
        
        for container in $container_names; do
            kubectl logs "$pod" -n "$NAMESPACE" -c "$container" --since=24h > "$logs_dir/${pod}-${container}.log" 2>/dev/null || true
        done
    done
    
    log "SUCCESS" "Logs backup completed"
}

# Backup metrics
backup_metrics() {
    if [[ "$BACKUP_METRICS" != true ]]; then
        log "INFO" "Metrics backup skipped"
        return 0
    fi
    
    log "PHASE" "Backing Up Metrics"
    
    local metrics_dir="$TEMP_DIR/metrics"
    
    # Port forward to Prometheus
    local pf_pid=""
    kubectl port-forward -n "$NAMESPACE" svc/prometheus 9090:9090 &
    pf_pid=$!
    
    # Wait for port forward to be ready
    sleep 5
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would backup metrics"
    else
        # Export metrics data
        curl -s "http://localhost:9090/api/v1/admin/tsdb/snapshot" -X POST > "$metrics_dir/snapshot-response.json"
        
        # Get snapshot path
        local snapshot_path=$(jq -r '.data.name // ""' "$metrics_dir/snapshot-response.json")
        
        if [[ -n "$snapshot_path" ]]; then
            # Copy snapshot files
            local prometheus_pod=$(kubectl get pods -n "$NAMESPACE" -l app=prometheus -o jsonpath='{.items[0].metadata.name}')
            kubectl cp "$NAMESPACE/$prometheus_pod:$snapshot_path" "$metrics_dir/metrics-snapshot" 2>/dev/null || true
        fi
    fi
    
    # Clean up port forward
    kill $pf_pid 2>/dev/null || true
    
    log "SUCCESS" "Metrics backup completed"
}

# Compress backup
compress_backup() {
    log "PHASE" "Compressing Backup"
    
    local archive_file="$BACKUP_DIR/$BACKUP_ID.tar.gz"
    
    log "INFO" "Creating compressed archive: $archive_file"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create compressed archive"
        return 0
    fi
    
    # Create tar.gz archive
    tar -czf "$archive_file" -C "$BACKUP_DIR" "$BACKUP_ID"
    
    # Verify archive
    if [[ "$SKIP_VERIFY" != true ]]; then
        log "INFO" "Verifying compressed archive"
        tar -tzf "$archive_file" > /dev/null
    fi
    
    # Get archive size
    local archive_size=$(du -h "$archive_file" | cut -f1)
    log "SUCCESS" "Backup compressed: $archive_size"
    
    # Remove temporary directory
    rm -rf "$TEMP_DIR"
}

# Encrypt backup
encrypt_backup() {
    if [[ "$ENCRYPT_BACKUP" != true ]]; then
        log "INFO" "Backup encryption skipped"
        return 0
    fi
    
    log "PHASE" "Encrypting Backup"
    
    local archive_file="$BACKUP_DIR/$BACKUP_ID.tar.gz"
    local encrypted_file="$archive_file.gpg"
    
    # Get encryption key
    local encryption_key=${BACKUP_ENCRYPTION_KEY:-""}
    
    if [[ -z "$encryption_key" ]]; then
        log "ERROR" "BACKUP_ENCRYPTION_KEY not set"
        return 1
    fi
    
    log "INFO" "Encrypting backup archive"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would encrypt backup"
        return 0
    fi
    
    # Encrypt with GPG
    echo "$encryption_key" | gpg --batch --yes --passphrase-fd 0 --symmetric --cipher-algo AES256 --compress-algo 1 --s2k-mode 3 --s2k-digest-algo SHA512 --s2k-count 65536 --output "$encrypted_file" "$archive_file"
    
    # Remove unencrypted archive
    rm -f "$archive_file"
    
    log "SUCCESS" "Backup encrypted"
}

# Upload to DigitalOcean Spaces
upload_to_spaces() {
    log "PHASE" "Uploading to DigitalOcean Spaces"
    
    local archive_file="$BACKUP_DIR/$BACKUP_ID.tar.gz"
    [[ "$ENCRYPT_BACKUP" == true ]] && archive_file="$archive_file.gpg"
    
    local s3_key="backups/$(date +%Y/%m/%d)/$(basename "$archive_file")"
    
    log "INFO" "Uploading to Spaces: $SPACES_BUCKET/$s3_key"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would upload to Spaces"
        return 0
    fi
    
    # Upload to Spaces
    aws s3 cp "$archive_file" "s3://$SPACES_BUCKET/$s3_key" \
        --endpoint-url "$SPACES_ENDPOINT" \
        --storage-class STANDARD_IA
    
    # Verify upload
    aws s3api head-object --bucket "$SPACES_BUCKET" --key "$s3_key" --endpoint-url "$SPACES_ENDPOINT"
    
    log "SUCCESS" "Backup uploaded to Spaces"
}

# Cleanup old backups
cleanup_old_backups() {
    log "PHASE" "Cleaning Up Old Backups"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would clean up old backups"
        return 0
    fi
    
    # Cleanup local backups
    log "INFO" "Cleaning up local backups older than $RETENTION_DAYS days"
    find "$BACKUP_DIR" -name "backup-*.tar.gz*" -type f -mtime +$RETENTION_DAYS -delete 2>/dev/null || true
    find "$BACKUP_DIR" -name "backup-*" -type d -mtime +$RETENTION_DAYS -exec rm -rf {} + 2>/dev/null || true
    
    # Cleanup Spaces backups
    log "INFO" "Cleaning up Spaces backups older than $RETENTION_DAYS days"
    local cutoff_date=$(date -d "$RETENTION_DAYS days ago" --iso-8601)
    
    aws s3api list-objects-v2 \
        --bucket "$SPACES_BUCKET" \
        --prefix "backups/" \
        --endpoint-url "$SPACES_ENDPOINT" \
        --query "Contents[?LastModified<'$cutoff_date'].Key" \
        --output text | while read -r key; do
        if [[ -n "$key" && "$key" != "None" ]]; then
            aws s3 rm "s3://$SPACES_BUCKET/$key" --endpoint-url "$SPACES_ENDPOINT"
        fi
    done
    
    log "SUCCESS" "Old backups cleaned up"
}

# Restore PostgreSQL
restore_postgres() {
    local backup_file="$1"
    
    log "PHASE" "Restoring PostgreSQL"
    
    # Get PostgreSQL credentials
    local postgres_user=$(kubectl get secret postgres-secret -n "$NAMESPACE" -o jsonpath='{.data.username}' | base64 -d)
    local postgres_password=$(kubectl get secret postgres-secret -n "$NAMESPACE" -o jsonpath='{.data.password}' | base64 -d)
    
    # Extract backup if needed
    local extracted_backup="$TEMP_DIR/postgres_restore.sql"
    
    if [[ "$backup_file" == *.gz ]]; then
        gunzip -c "$backup_file" > "$extracted_backup"
        backup_file="$extracted_backup"
    fi
    
    # Port forward to PostgreSQL
    local pf_pid=""
    kubectl port-forward -n "$NAMESPACE" svc/postgres-primary 5432:5432 &
    pf_pid=$!
    
    # Wait for port forward to be ready
    sleep 5
    
    # Restore database
    PGPASSWORD="$postgres_password" pg_restore \
        -h localhost \
        -p "$POSTGRES_PORT" \
        -U "$postgres_user" \
        -d "$POSTGRES_DB" \
        --verbose \
        --clean \
        --if-exists \
        "$backup_file"
    
    # Clean up port forward
    kill $pf_pid 2>/dev/null || true
    
    log "SUCCESS" "PostgreSQL restored"
}

# Restore Redis
restore_redis() {
    local backup_file="$1"
    
    log "PHASE" "Restoring Redis"
    
    # Get Redis pod
    local redis_pod=$(kubectl get pods -n "$NAMESPACE" -l app=redis-primary -o jsonpath='{.items[0].metadata.name}')
    
    # Copy backup to Redis pod
    kubectl cp "$backup_file" "$NAMESPACE/$redis_pod:/data/dump.rdb"
    
    # Restart Redis
    kubectl delete pod "$redis_pod" -n "$NAMESPACE"
    
    # Wait for Redis to be ready
    kubectl wait --for=condition=ready pod -l app=redis-primary -n "$NAMESPACE" --timeout=300s
    
    log "SUCCESS" "Redis restored"
}

# Restore Kubernetes configurations
restore_k8s_configs() {
    local backup_dir="$1"
    
    log "PHASE" "Restoring Kubernetes Configurations"
    
    # Restore namespace
    if [[ -f "$backup_dir/namespace.yaml" ]]; then
        kubectl apply -f "$backup_dir/namespace.yaml"
    fi
    
    # Restore resources
    local resources=("configmaps" "services" "deployments" "statefulsets" "ingresses" "hpa" "pvc")
    
    for resource in "${resources[@]}"; do
        if [[ -f "$backup_dir/${resource}.json" ]]; then
            log "INFO" "Restoring $resource"
            jq -r '.items[] | @base64' "$backup_dir/${resource}.json" | while read -r item; do
                echo "$item" | base64 -d | kubectl apply -n "$NAMESPACE" -f -
            done
        fi
        
        # Restore individual YAML files
        for yaml_file in "$backup_dir"/${resource}-*.yaml; do
            if [[ -f "$yaml_file" ]]; then
                kubectl apply -n "$NAMESPACE" -f "$yaml_file"
            fi
        done
    done
    
    log "SUCCESS" "Kubernetes configurations restored"
}

# List available backups
list_backups() {
    log "PHASE" "Listing Available Backups"
    
    echo ""
    echo "📦 Available Backups:"
    echo "====================="
    
    # List local backups
    echo ""
    echo "🏠 Local Backups:"
    if [[ -d "$BACKUP_DIR" ]]; then
        find "$BACKUP_DIR" -name "backup-*.tar.gz*" -type f -exec ls -lh {} \; | while read -r line; do
            echo "  $line"
        done
    else
        echo "  No local backups found"
    fi
    
    # List Spaces backups
    echo ""
    echo "☁️  Spaces Backups:"
    aws s3api list-objects-v2 \
        --bucket "$SPACES_BUCKET" \
        --prefix "backups/" \
        --endpoint-url "$SPACES_ENDPOINT" \
        --query "Contents[].{Key:Key,Size:Size,LastModified:LastModified}" \
        --output table | while read -r line; do
        echo "  $line"
    done
}

# Download backup from Spaces
download_backup() {
    local backup_key="$1"
    local local_file="$2"
    
    log "PHASE" "Downloading Backup from Spaces"
    
    log "INFO" "Downloading: $backup_key"
    
    aws s3 cp "s3://$SPACES_BUCKET/$backup_key" "$local_file" \
        --endpoint-url "$SPACES_ENDPOINT"
    
    log "SUCCESS" "Backup downloaded to: $local_file"
}

# Show usage
show_usage() {
    echo "GoMeet DigitalOcean Backup and Recovery Script"
    echo ""
    echo "Usage: $0 [OPTIONS] [COMMAND] [ARGS...]"
    echo ""
    echo "Commands:"
    echo "  backup                       Create a new backup"
    echo "  restore BACKUP_FILE          Restore from backup file"
    echo "  restore-spaces BACKUP_KEY    Restore from Spaces backup"
    echo "  list                         List available backups"
    echo "  download BACKUP_KEY FILE     Download backup from Spaces"
    echo "  cleanup                      Clean up old backups"
    echo ""
    echo "Options:"
    echo "  -h, --help                   Show this help message"
    echo "  -v, --verbose                Enable verbose logging"
    echo "  -n, --namespace NAMESPACE    Kubernetes namespace (default: gomeet)"
    echo "  -b, --bucket BUCKET          Spaces bucket name (default: gomeet-backups)"
    echo "  -r, --region REGION          Spaces region (default: nyc3)"
    echo "  --no-encrypt                 Disable backup encryption"
    echo "  --no-compression             Disable compression"
    echo "  --no-verify                  Skip backup verification"
    echo "  --dry-run                    Simulate backup without making changes"
    echo "  --force                      Force backup even if recent backup exists"
    echo "  --skip-postgres              Skip PostgreSQL backup"
    echo "  --skip-redis                 Skip Redis backup"
    echo "  --skip-k8s                   Skip Kubernetes configs backup"
    echo "  --skip-secrets               Skip secrets backup"
    echo "  --skip-logs                  Skip logs backup"
    echo "  --skip-metrics               Skip metrics backup"
    echo "  --retention-days DAYS        Backup retention period (default: 30)"
    echo ""
    echo "Environment Variables:"
    echo "  BACKUP_ENCRYPTION_KEY        Encryption key for backup files"
    echo "  SPACES_ACCESS_KEY_ID         DigitalOcean Spaces access key"
    echo "  SPACES_SECRET_ACCESS_KEY     DigitalOcean Spaces secret key"
    echo "  POSTGRES_HOST                PostgreSQL host (default: postgres-primary)"
    echo "  POSTGRES_PORT                PostgreSQL port (default: 5432)"
    echo "  POSTGRES_DB                  PostgreSQL database (default: gomeet)"
    echo "  REDIS_HOST                   Redis host (default: redis-primary)"
    echo "  REDIS_PORT                   Redis port (default: 6379)"
    echo ""
    echo "Examples:"
    echo "  $0 backup                                    # Create full backup"
    echo "  $0 --dry-run backup                         # Simulate backup"
    echo "  $0 restore backup-20231025-120000.tar.gz    # Restore from local backup"
    echo "  $0 restore-spaces backups/2023/10/25/backup-20231025-120000.tar.gz # Restore from Spaces"
    echo "  $0 list                                      # List available backups"
}

# Main execution function
main() {
    local command=""
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_usage
                exit 0
                ;;
            -v|--verbose)
                VERBOSE=true
                shift
                ;;
            -n|--namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            -b|--bucket)
                SPACES_BUCKET="$2"
                shift 2
                ;;
            -r|--region)
                SPACES_REGION="$2"
                SPACES_ENDPOINT="https://$SPACES_REGION.digitaloceanspaces.com"
                shift 2
                ;;
            --no-encrypt)
                ENCRYPT_BACKUP=false
                shift
                ;;
            --no-compression)
                COMPRESSION_LEVEL=0
                shift
                ;;
            --no-verify)
                SKIP_VERIFY=true
                shift
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --force)
                FORCE_BACKUP=true
                shift
                ;;
            --skip-postgres)
                BACKUP_POSTGRES=false
                shift
                ;;
            --skip-redis)
                BACKUP_REDIS=false
                shift
                ;;
            --skip-k8s)
                BACKUP_K8S_CONFIGS=false
                shift
                ;;
            --skip-secrets)
                BACKUP_SECRETS=false
                shift
                ;;
            --skip-logs)
                BACKUP_LOGS=false
                shift
                ;;
            --skip-metrics)
                BACKUP_METRICS=false
                shift
                ;;
            --retention-days)
                RETENTION_DAYS="$2"
                shift 2
                ;;
            backup|restore|restore-spaces|list|download|cleanup)
                command="$1"
                shift
                break
                ;;
            -*)
                log "ERROR" "Unknown option: $1"
                show_usage
                exit 1
                ;;
            *)
                # Assume it's an argument for the command
                break
                ;;
        esac
    done
    
    # Start backup/restore process
    log "INFO" "Starting GoMeet backup/restore process"
    log "INFO" "Backup ID: $BACKUP_ID"
    log "INFO" "Log file: $LOG_FILE"
    
    # Execute command
    case "$command" in
        "backup")
            check_prerequisites
            setup_backup_environment
            backup_postgres
            backup_redis
            backup_k8s_configs
            backup_secrets
            backup_logs
            backup_metrics
            compress_backup
            encrypt_backup
            upload_to_spaces
            cleanup_old_backups
            ;;
        "restore")
            if [[ $# -lt 1 ]]; then
                log "ERROR" "Restore requires backup file path"
                show_usage
                exit 1
            fi
            RECOVERY_MODE=true
            check_prerequisites
            setup_backup_environment
            
            local backup_file="$1"
            
            # Extract backup if needed
            if [[ "$backup_file" == *.tar.gz || "$backup_file" == *.tgz ]]; then
                tar -xzf "$backup_file" -C "$TEMP_DIR"
                backup_file="$TEMP_DIR/$(basename "$backup_file" .tar.gz)"
            fi
            
            # Restore components
            restore_postgres "$backup_file/postgres"/*.sql
            restore_redis "$backup_file/redis"/*.rdb
            restore_k8s_configs "$backup_file/k8s"
            ;;
        "restore-spaces")
            if [[ $# -lt 1 ]]; then
                log "ERROR" "Restore from Spaces requires backup key"
                show_usage
                exit 1
            fi
            RECOVERY_MODE=true
            check_prerequisites
            setup_backup_environment
            
            local backup_key="$1"
            local local_file="$TEMP_DIR/downloaded_backup.tar.gz"
            
            download_backup "$backup_key" "$local_file"
            
            # Extract and restore
            tar -xzf "$local_file" -C "$TEMP_DIR"
            local extracted_dir="$TEMP_DIR/$(basename "$local_file" .tar.gz)"
            
            restore_postgres "$extracted_dir/postgres"/*.sql
            restore_redis "$extracted_dir/redis"/*.rdb
            restore_k8s_configs "$extracted_dir/k8s"
            ;;
        "list")
            check_prerequisites
            list_backups
            ;;
        "download")
            if [[ $# -lt 2 ]]; then
                log "ERROR" "Download requires backup key and local file path"
                show_usage
                exit 1
            fi
            check_prerequisites
            download_backup "$1" "$2"
            ;;
        "cleanup")
            check_prerequisites
            cleanup_old_backups
            ;;
        "")
            log "ERROR" "No command specified"
            show_usage
            exit 1
            ;;
        *)
            log "ERROR" "Unknown command: $command"
            show_usage
            exit 1
            ;;
    esac
    
    log "SUCCESS" "GoMeet backup/restore process completed!"
    
    if [[ "$RECOVERY_MODE" == true ]]; then
        log "INFO" "Recovery completed. Please verify all services are running correctly."
        log "INFO" "Check service status: kubectl get pods -n $NAMESPACE"
    else
        log "INFO" "Backup completed. Backup ID: $BACKUP_ID"
    fi
}

# Run main function with all arguments
main "$@"