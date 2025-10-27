#!/bin/bash

# GoMeet DigitalOcean Infrastructure Setup Script
# Script untuk provisioning DigitalOcean infrastructure resources
# Target: 500 partisipan per meeting, 50,000 concurrent participants

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
LOG_DIR="/tmp/gomeet-infrastructure"
LOG_FILE="$LOG_DIR/setup-$(date +%Y%m%d-%H%M%S).log"
INFRASTRUCTURE_ID="infra-$(date +%Y%m%d-%H%M%S)"

# DigitalOcean configuration
REGION="nyc1"
CLUSTER_NAME="gomeet-cluster"
CLUSTER_VERSION="latest"
NODE_SIZE="c-4" # 8GB RAM
NODE_COUNT=3
HA_CLUSTER=false
AUTO_UPGRADE=true
AUTO_SCALE=true
MIN_NODES=2
MAX_NODES=8

# Managed services configuration
POSTGRES_PLAN="prod-16vcpu-64gb" # 16 vCPU, 64GB RAM
POSTGRES_NODES=3
POSTGRES_VERSION="15"
REDIS_PLAN="prod-8vcpu-32gb" # 8 vCPU, 32GB RAM
REDIS_NODES=3
REDIS_VERSION="7"

# Load Balancer configuration
LB_NAME="gomeet-lb"
LB_ALGORITHM="least_connections"
LB_FORWARDING_RULES=()
LB_HEALTH_CHECKS=()

# Spaces configuration
SPACES_NAME="gomeet-storage"
SPACES_REGION="nyc3"

# VPC configuration
VPC_NAME="gomeet-vpc"
VPC_RANGE="10.240.0.0/16"

# Firewall configuration
FIREWALL_NAME="gomeet-firewall"

# Global variables
VERBOSE=false
DRY_RUN=false
SKIP_EXISTING=false
FORCE_CREATE=false
CREATE_VPC=true
CREATE_CLUSTER=true
CREATE_DATABASES=true
CREATE_REDIS=true
CREATE_LOAD_BALANCER=true
CREATE_SPACES=true
CREATE_FIREWALL=true

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
    
    log "ERROR" "Infrastructure setup failed at line $line_number with exit code $exit_code"
    log "ERROR" "Check logs: $LOG_FILE"
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Prerequisites check
check_prerequisites() {
    log "PHASE" "Checking Prerequisites"
    
    # Check required tools
    local tools=("doctl" "jq" "curl")
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
    
    # Check DigitalOcean authentication
    if ! doctl account get &> /dev/null; then
        log "ERROR" "Cannot authenticate with DigitalOcean"
        log "INFO" "Please run: doctl auth init"
        exit 1
    fi
    
    # Create log directory
    mkdir -p "$LOG_DIR"
    
    log "SUCCESS" "All prerequisites satisfied"
}

# Create VPC
create_vpc() {
    log "PHASE" "Creating VPC"
    
    if [[ "$CREATE_VPC" != true ]]; then
        log "INFO" "Skipping VPC creation"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create VPC: $VPC_NAME"
        return 0
    fi
    
    # Check if VPC already exists
    local vpc_id=$(doctl vpcs list --format ID,Name --no-header | grep "$VPC_NAME" | awk '{print $1}' || echo "")
    
    if [[ -n "$vpc_id" ]]; then
        if [[ "$SKIP_EXISTING" == true ]]; then
            log "INFO" "VPC $VPC_NAME already exists, skipping"
            return 0
        elif [[ "$FORCE_CREATE" != true ]]; then
            log "WARNING" "VPC $VPC_NAME already exists. Use --force to recreate"
            return 0
        else
            log "INFO" "Deleting existing VPC: $VPC_NAME"
            doctl vpcs delete "$vpc_id" -f || true
        fi
    fi
    
    log "INFO" "Creating VPC: $VPC_NAME"
    vpc_id=$(doctl vpcs create "$VPC_NAME" \
        --region "$REGION" \
        --ip-range "$VPC_RANGE" \
        --format ID \
        --no-header \
        --wait)
    
    log "SUCCESS" "VPC created with ID: $vpc_id"
    echo "$vpc_id" > "$LOG_DIR/vpc-id.txt"
}

# Create Kubernetes cluster
create_kubernetes_cluster() {
    log "PHASE" "Creating Kubernetes Cluster"
    
    if [[ "$CREATE_CLUSTER" != true ]]; then
        log "INFO" "Skipping cluster creation"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create Kubernetes cluster: $CLUSTER_NAME"
        return 0
    fi
    
    # Check if cluster already exists
    local cluster_exists=$(doctl kubernetes clusters list --format Name --no-header | grep "^$CLUSTER_NAME$" || echo "")
    
    if [[ -n "$cluster_exists" ]]; then
        if [[ "$SKIP_EXISTING" == true ]]; then
            log "INFO" "Cluster $CLUSTER_NAME already exists, skipping"
            return 0
        elif [[ "$FORCE_CREATE" != true ]]; then
            log "WARNING" "Cluster $CLUSTER_NAME already exists. Use --force to recreate"
            return 0
        else
            log "INFO" "Deleting existing cluster: $CLUSTER_NAME"
            doctl kubernetes cluster delete "$CLUSTER_NAME" -f || true
        fi
    fi
    
    # Get VPC ID
    local vpc_id=""
    if [[ -f "$LOG_DIR/vpc-id.txt" ]]; then
        vpc_id=$(cat "$LOG_DIR/vpc-id.txt")
    fi
    
    log "INFO" "Creating Kubernetes cluster: $CLUSTER_NAME"
    
    local cluster_args=(
        "$CLUSTER_NAME"
        "--region" "$REGION"
        "--version" "$CLUSTER_VERSION"
        "--node-pool" "name=worker-pool;size=$NODE_SIZE;count=$NODE_COUNT;auto-scale=$AUTO_SCALE;min-nodes=$MIN_NODES;max-nodes=$MAX_NODES"
    )
    
    if [[ -n "$vpc_id" ]]; then
        cluster_args+=("--vpc-uuid" "$vpc_id")
    fi
    
    if [[ "$HA_CLUSTER" == true ]]; then
        cluster_args+=("--ha")
    fi
    
    if [[ "$AUTO_UPGRADE" == true ]]; then
        cluster_args+=("--auto-upgrade")
    fi
    
    # Create cluster
    doctl kubernetes clusters create "${cluster_args[@]}" --wait
    
    # Get cluster credentials
    log "INFO" "Getting cluster credentials"
    doctl kubernetes cluster kubeconfig save "$CLUSTER_NAME"
    
    # Update kubectl context
    kubectl config use-context "do-$REGION-$CLUSTER_NAME"
    
    log "SUCCESS" "Kubernetes cluster created and configured"
}

# Create PostgreSQL database
create_postgres_database() {
    log "PHASE" "Creating PostgreSQL Database"
    
    if [[ "$CREATE_DATABASES" != true ]]; then
        log "INFO" "Skipping PostgreSQL creation"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create PostgreSQL cluster"
        return 0
    fi
    
    local db_name="gomeet-postgres-$INFRASTRUCTURE_ID"
    
    # Check if PostgreSQL cluster already exists
    local existing_db=$(doctl databases list --format Name,Engine --no-header | grep "$db_name" | grep "pg" || echo "")
    
    if [[ -n "$existing_db" ]]; then
        if [[ "$SKIP_EXISTING" == true ]]; then
            log "INFO" "PostgreSQL cluster already exists, skipping"
            return 0
        elif [[ "$FORCE_CREATE" != true ]]; then
            log "WARNING" "PostgreSQL cluster already exists. Use --force to recreate"
            return 0
        else
            log "INFO" "Deleting existing PostgreSQL cluster"
            doctl databases delete "$db_name" -f || true
        fi
    fi
    
    log "INFO" "Creating PostgreSQL cluster: $db_name"
    
    # Get VPC ID
    local vpc_id=""
    if [[ -f "$LOG_DIR/vpc-id.txt" ]]; then
        vpc_id=$(cat "$LOG_DIR/vpc-id.txt")
    fi
    
    local db_args=(
        "$db_name"
        "--engine" "pg"
        "--version" "$POSTGRES_VERSION"
        "--num-nodes" "$POSTGRES_NODES"
        "--region" "$REGION"
        "--size" "$POSTGRES_PLAN"
    )
    
    if [[ -n "$vpc_id" ]]; then
        db_args+=("--vpc-uuid" "$vpc_id")
    fi
    
    # Create database cluster
    local db_id=$(doctl databases create "${db_args[@]}" \
        --format ID \
        --no-header \
        --wait)
    
    # Create database and user
    log "INFO" "Configuring PostgreSQL database"
    
    # Wait for database to be ready
    for i in {1..30}; do
        local status=$(doctl databases get "$db_id" --format Status --no-header)
        if [[ "$status" == "online" ]]; then
            break
        fi
        sleep 10
        show_progress $i 30 "Waiting for PostgreSQL to be ready"
    done
    
    # Get connection details
    local connection_info=$(doctl databases connection "$db_id" --format URI --no-header)
    
    log "SUCCESS" "PostgreSQL cluster created: $db_id"
    echo "$db_id" > "$LOG_DIR/postgres-id.txt"
    echo "$connection_info" > "$LOG_DIR/postgres-connection.txt"
}

# Create Redis cluster
create_redis_cluster() {
    log "PHASE" "Creating Redis Cluster"
    
    if [[ "$CREATE_REDIS" != true ]]; then
        log "INFO" "Skipping Redis creation"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create Redis cluster"
        return 0
    fi
    
    local redis_name="gomeet-redis-$INFRASTRUCTURE_ID"
    
    # Check if Redis cluster already exists
    local existing_redis=$(doctl databases list --format Name,Engine --no-header | grep "$redis_name" | grep "redis" || echo "")
    
    if [[ -n "$existing_redis" ]]; then
        if [[ "$SKIP_EXISTING" == true ]]; then
            log "INFO" "Redis cluster already exists, skipping"
            return 0
        elif [[ "$FORCE_CREATE" != true ]]; then
            log "WARNING" "Redis cluster already exists. Use --force to recreate"
            return 0
        else
            log "INFO" "Deleting existing Redis cluster"
            doctl databases delete "$redis_name" -f || true
        fi
    fi
    
    log "INFO" "Creating Redis cluster: $redis_name"
    
    # Get VPC ID
    local vpc_id=""
    if [[ -f "$LOG_DIR/vpc-id.txt" ]]; then
        vpc_id=$(cat "$LOG_DIR/vpc-id.txt")
    fi
    
    local redis_args=(
        "$redis_name"
        "--engine" "redis"
        "--version" "$REDIS_VERSION"
        "--num-nodes" "$REDIS_NODES"
        "--region" "$REGION"
        "--size" "$REDIS_PLAN"
    )
    
    if [[ -n "$vpc_id" ]]; then
        redis_args+=("--vpc-uuid" "$vpc_id")
    fi
    
    # Create Redis cluster
    local redis_id=$(doctl databases create "${redis_args[@]}" \
        --format ID \
        --no-header \
        --wait)
    
    # Wait for Redis to be ready
    for i in {1..30}; do
        local status=$(doctl databases get "$redis_id" --format Status --no-header)
        if [[ "$status" == "online" ]]; then
            break
        fi
        sleep 10
        show_progress $i 30 "Waiting for Redis to be ready"
    done
    
    # Get connection details
    local connection_info=$(doctl databases connection "$redis_id" --format URI --no-header)
    
    log "SUCCESS" "Redis cluster created: $redis_id"
    echo "$redis_id" > "$LOG_DIR/redis-id.txt"
    echo "$connection_info" > "$LOG_DIR/redis-connection.txt"
}

# Create Load Balancer
create_load_balancer() {
    log "PHASE" "Creating Load Balancer"
    
    if [[ "$CREATE_LOAD_BALANCER" != true ]]; then
        log "INFO" "Skipping Load Balancer creation"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create Load Balancer: $LB_NAME"
        return 0
    fi
    
    # Check if Load Balancer already exists
    local existing_lb=$(doctl compute load-balancer list --format Name --no-header | grep "$LB_NAME" || echo "")
    
    if [[ -n "$existing_lb" ]]; then
        if [[ "$SKIP_EXISTING" == true ]]; then
            log "INFO" "Load Balancer already exists, skipping"
            return 0
        elif [[ "$FORCE_CREATE" != true ]]; then
            log "WARNING" "Load Balancer already exists. Use --force to recreate"
            return 0
        else
            log "INFO" "Deleting existing Load Balancer"
            doctl compute load-balancer delete "$LB_NAME" -f || true
        fi
    fi
    
    log "INFO" "Creating Load Balancer: $LB_NAME"
    
    # Get Kubernetes cluster info
    local cluster_id=$(doctl kubernetes clusters list --format ID,Name --no-header | grep "$CLUSTER_NAME" | awk '{print $1}')
    
    # Create Load Balancer
    local lb_id=$(doctl compute load-balancer create "$LB_NAME" \
        --region "$REGION" \
        --algorithm "$LB_ALGORITHM" \
        --forwarding-rules "entry_protocol:tcp,entry_port:443,target_protocol:tcp,target_port:443" \
        --forwarding-rules "entry_protocol:tcp,entry_port:80,target_protocol:tcp,target_port:80" \
        --health-check "protocol:tcp,port:80,path:/,check_interval_seconds:10,response_timeout_seconds:5,healthy_threshold:5,unhealthy_threshold:3" \
        --sticky-sessions "type:cookies" \
        --redirect-http-to-https \
        --enable-proxy-protocol \
        --format ID \
        --no-header)
    
    log "SUCCESS" "Load Balancer created: $lb_id"
    echo "$lb_id" > "$LOG_DIR/lb-id.txt"
}

# Create Spaces bucket
create_spaces_bucket() {
    log "PHASE" "Creating Spaces Bucket"
    
    if [[ "$CREATE_SPACES" != true ]]; then
        log "INFO" "Skipping Spaces creation"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create Spaces bucket: $SPACES_NAME"
        return 0
    fi
    
    # Check if bucket already exists
    local existing_bucket=$(doctl storage bucket list --format Name --no-header | grep "$SPACES_NAME" || echo "")
    
    if [[ -n "$existing_bucket" ]]; then
        if [[ "$SKIP_EXISTING" == true ]]; then
            log "INFO" "Spaces bucket already exists, skipping"
            return 0
        elif [[ "$FORCE_CREATE" != true ]]; then
            log "WARNING" "Spaces bucket already exists. Use --force to recreate"
            return 0
        else
            log "INFO" "Deleting existing Spaces bucket"
            doctl storage bucket delete "$SPACES_NAME" --force || true
        fi
    fi
    
    log "INFO" "Creating Spaces bucket: $SPACES_NAME"
    
    # Create bucket
    doctl storage bucket create "$SPACES_NAME" --region "$SPACES_REGION"
    
    # Create Spaces access key if needed
    local access_keys=$(doctl storage key list --format AccessKey --no-header || echo "")
    if [[ -z "$access_keys" ]]; then
        log "INFO" "Creating Spaces access key"
        doctl storage key create gomeet-infrastructure --region "$SPACES_REGION"
    fi
    
    log "SUCCESS" "Spaces bucket created: $SPACES_NAME"
}

# Create firewall rules
create_firewall() {
    log "PHASE" "Creating Firewall Rules"
    
    if [[ "$CREATE_FIREWALL" != true ]]; then
        log "INFO" "Skipping firewall creation"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create firewall: $FIREWALL_NAME"
        return 0
    fi
    
    # Check if firewall already exists
    local existing_fw=$(doctl compute firewall list --format Name --no-header | grep "$FIREWALL_NAME" || echo "")
    
    if [[ -n "$existing_fw" ]]; then
        if [[ "$SKIP_EXISTING" == true ]]; then
            log "INFO" "Firewall already exists, skipping"
            return 0
        elif [[ "$FORCE_CREATE" != true ]]; then
            log "WARNING" "Firewall already exists. Use --force to recreate"
            return 0
        else
            log "INFO" "Deleting existing firewall"
            doctl compute firewall delete "$FIREWALL_NAME" -f || true
        fi
    fi
    
    log "INFO" "Creating firewall: $FIREWALL_NAME"
    
    # Get cluster ID for firewall rules
    local cluster_id=$(doctl kubernetes clusters list --format ID,Name --no-header | grep "$CLUSTER_NAME" | awk '{print $1}')
    local droplet_ids=$(doctl kubernetes clusters list --format ID,DropletIDs --no-header | grep "$cluster_id" | awk -F',' '{print $2}' | tr ';' ',' | sed 's/,$//')
    
    # Create firewall with rules
    local fw_id=$(doctl compute firewall create "$FIREWALL_NAME" \
        --inbound-rules "protocol:tcp,ports:22,address:0.0.0.0/0" \
        --inbound-rules "protocol:tcp,ports:80,address:0.0.0.0/0" \
        --inbound-rules "protocol:tcp,ports:443,address:0.0.0.0/0" \
        --inbound-rules "protocol:udp,ports:3478,address:0.0.0.0/0" \
        --inbound-rules "protocol:tcp,ports:3478,address:0.0.0.0/0" \
        --inbound-rules "protocol:udp,ports:10000-11000,address:0.0.0.0/0" \
        --outbound-rules "protocol:tcp,ports:all,address:0.0.0.0/0" \
        --outbound-rules "protocol:udp,ports:all,address:0.0.0.0/0" \
        --droplet-ids "$droplet_ids" \
        --format ID \
        --no-header)
    
    log "SUCCESS" "Firewall created: $fw_id"
    echo "$fw_id" > "$LOG_DIR/firewall-id.txt"
}

# Generate infrastructure summary
generate_summary() {
    log "PHASE" "Generating Infrastructure Summary"
    
    local summary_file="$LOG_DIR/infrastructure-summary-$INFRASTRUCTURE_ID.json"
    
    local summary="{"
    summary+="\"infrastructure_id\": \"$INFRASTRUCTURE_ID\","
    summary+="\"created_at\": \"$(date -Iseconds)\","
    summary+="\"region\": \"$REGION\","
    summary+="\"cluster_name\": \"$CLUSTER_NAME\","
    
    # Add VPC info
    if [[ -f "$LOG_DIR/vpc-id.txt" ]]; then
        summary+="\"vpc_id\": \"$(cat "$LOG_DIR/vpc-id.txt")\","
    fi
    
    # Add database info
    if [[ -f "$LOG_DIR/postgres-id.txt" ]]; then
        summary+="\"postgres_id\": \"$(cat "$LOG_DIR/postgres-id.txt")\","
    fi
    
    if [[ -f "$LOG_DIR/redis-id.txt" ]]; then
        summary+="\"redis_id\": \"$(cat "$LOG_DIR/redis-id.txt")\","
    fi
    
    # Add load balancer info
    if [[ -f "$LOG_DIR/lb-id.txt" ]]; then
        summary+="\"load_balancer_id\": \"$(cat "$LOG_DIR/lb-id.txt")\","
    fi
    
    # Add firewall info
    if [[ -f "$LOG_DIR/firewall-id.txt" ]]; then
        summary+="\"firewall_id\": \"$(cat "$LOG_DIR/firewall-id.txt")\","
    fi
    
    summary+="\"spaces_bucket\": \"$SPACES_NAME\","
    summary+="\"namespace\": \"$NAMESPACE\""
    summary+="}"
    
    echo "$summary" > "$summary_file"
    
    log "SUCCESS" "Infrastructure summary saved to: $summary_file"
    
    # Display summary
    echo ""
    echo "🏗️  DigitalOcean Infrastructure Summary:"
    echo "======================================"
    echo "Infrastructure ID: $INFRASTRUCTURE_ID"
    echo "Region: $REGION"
    echo "Cluster: $CLUSTER_NAME"
    echo "Namespace: $NAMESPACE"
    
    if [[ -f "$LOG_DIR/vpc-id.txt" ]]; then
        echo "VPC ID: $(cat "$LOG_DIR/vpc-id.txt")"
    fi
    
    if [[ -f "$LOG_DIR/postgres-id.txt" ]]; then
        echo "PostgreSQL ID: $(cat "$LOG_DIR/postgres-id.txt")"
    fi
    
    if [[ -f "$LOG_DIR/redis-id.txt" ]]; then
        echo "Redis ID: $(cat "$LOG_DIR/redis-id.txt")"
    fi
    
    if [[ -f "$LOG_DIR/lb-id.txt" ]]; then
        echo "Load Balancer ID: $(cat "$LOG_DIR/lb-id.txt")"
    fi
    
    if [[ -f "$LOG_DIR/firewall-id.txt" ]]; then
        echo "Firewall ID: $(cat "$LOG_DIR/firewall-id.txt")"
    fi
    
    echo "Spaces Bucket: $SPACES_NAME"
    echo ""
    echo "📁 Important Files:"
    echo "- Summary: $summary_file"
    echo "- Log: $LOG_FILE"
    
    if [[ -f "$LOG_DIR/postgres-connection.txt" ]]; then
        echo "- PostgreSQL Connection: $LOG_DIR/postgres-connection.txt"
    fi
    
    if [[ -f "$LOG_DIR/redis-connection.txt" ]]; then
        echo "- Redis Connection: $LOG_DIR/redis-connection.txt"
    fi
}

# Show usage
show_usage() {
    echo "GoMeet DigitalOcean Infrastructure Setup Script"
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help                    Show this help message"
    echo "  -v, --verbose                 Enable verbose logging"
    echo "  -r, --region REGION           DigitalOcean region (default: nyc1)"
    echo "  -c, --cluster CLUSTER         Kubernetes cluster name (default: gomeet-cluster)"
    echo "  -n, --namespace NAMESPACE     Kubernetes namespace (default: gomeet)"
    echo "  --dry-run                     Simulate creation without making changes"
    echo "  --skip-existing               Skip resources that already exist"
    echo "  --force                       Recreate existing resources"
    echo "  --no-vpc                      Skip VPC creation"
    echo "  --no-cluster                  Skip Kubernetes cluster creation"
    echo "  --no-databases                Skip database creation"
    echo "  --no-redis                    Skip Redis creation"
    echo "  --no-load-balancer            Skip Load Balancer creation"
    echo "  --no-spaces                   Skip Spaces creation"
    echo "  --no-firewall                 Skip firewall creation"
    echo ""
    echo "Examples:"
    echo "  $0                           # Create all infrastructure"
    echo "  $0 --dry-run                 # Simulate infrastructure creation"
    echo "  $0 --skip-existing            # Skip existing resources"
    echo "  $0 --force --region sfo2      # Recreate all resources in SFO2"
    echo "  $0 --no-cluster --no-databases # Create only VPC and networking"
}

# Main execution function
main() {
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
            -r|--region)
                REGION="$2"
                shift 2
                ;;
            -c|--cluster)
                CLUSTER_NAME="$2"
                shift 2
                ;;
            -n|--namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --skip-existing)
                SKIP_EXISTING=true
                shift
                ;;
            --force)
                FORCE_CREATE=true
                shift
                ;;
            --no-vpc)
                CREATE_VPC=false
                shift
                ;;
            --no-cluster)
                CREATE_CLUSTER=false
                shift
                ;;
            --no-databases)
                CREATE_DATABASES=false
                shift
                ;;
            --no-redis)
                CREATE_REDIS=false
                shift
                ;;
            --no-load-balancer)
                CREATE_LOAD_BALANCER=false
                shift
                ;;
            --no-spaces)
                CREATE_SPACES=false
                shift
                ;;
            --no-firewall)
                CREATE_FIREWALL=false
                shift
                ;;
            *)
                log "ERROR" "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Start infrastructure setup
    log "INFO" "Starting GoMeet DigitalOcean infrastructure setup"
    log "INFO" "Infrastructure ID: $INFRASTRUCTURE_ID"
    log "INFO" "Log file: $LOG_FILE"
    
    # Run setup phases
    check_prerequisites
    create_vpc
    create_kubernetes_cluster
    create_postgres_database
    create_redis_cluster
    create_load_balancer
    create_spaces_bucket
    create_firewall
    generate_summary
    
    log "SUCCESS" "GoMeet DigitalOcean infrastructure setup completed!"
    log "INFO" "Total setup time: $(($(date +%s) - $(stat -c %Y "$LOG_FILE"))) seconds"
}

# Run main function with all arguments
main "$@"