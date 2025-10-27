#!/bin/bash

# GoMeet DigitalOcean Cleanup Script
# Script untuk cleanup dan uninstall GoMeet dari DigitalOcean Kubernetes Engine

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
NAMESPACE="gomeet"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="/tmp/gomeet-backup-$(date +%Y%m%d-%H%M%S)"

# Functions
log() {
    echo -e "${BLUE}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

log_error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1"
}

# Function to confirm action
confirm_action() {
    local message="$1"
    local default="${2:-n}"
    
    if [[ "$default" == "y" ]]; then
        read -p "$message [Y/n]: " response
        response="${response:-y}"
    else
        read -p "$message [y/N]: " response
        response="${response:-n}"
    fi
    
    case "$response" in
        [yY]|[yY][eE][sS])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Function to backup resources
backup_resources() {
    log "Membuat backup resources..."
    
    mkdir -p "$BACKUP_DIR"
    
    # Backup all resources
    log "Backup semua resources dari namespace $NAMESPACE..."
    kubectl get all -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/all-resources.yaml"
    
    # Backup specific resources
    log "Backup configmaps dan secrets..."
    kubectl get configmaps -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/configmaps.yaml"
    kubectl get secrets -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/secrets.yaml"
    
    # Backup ingress and network policies
    log "Backup ingress dan network policies..."
    kubectl get ingress -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/ingress.yaml"
    kubectl get networkpolicies -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/networkpolicies.yaml"
    
    # Backup HPA
    log "Backup HPA..."
    kubectl get hpa -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/hpa.yaml"
    
    # Backup PV and PVC
    log "Backup persistent volumes..."
    kubectl get pv,pvc -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/storage.yaml"
    
    log_success "Backup selesai disimpan di: $BACKUP_DIR"
}

# Function to cleanup application services
cleanup_application_services() {
    log "Membersihkan application services..."
    
    # Delete deployments
    log "Menghapus deployments..."
    kubectl delete deployment -n "$NAMESPACE" \
        auth-service \
        meeting-service \
        signaling-service \
        chat-service \
        turn-service \
        livekit-sfu \
        livekit-recorder \
        --ignore-not-found=true
    
    # Delete services
    log "Menghapus services..."
    kubectl delete service -n "$NAMESPACE" \
        auth-service \
        meeting-service \
        signaling-service \
        chat-service \
        turn-service \
        livekit-sfu \
        livekit-recorder \
        --ignore-not-found=true
    
    log_success "Application services dibersihkan"
}

# Function to cleanup gateway and ingress
cleanup_gateway_ingress() {
    log "Membersihkan gateway dan ingress..."
    
    # Delete Traefik
    log "Menghapus Traefik..."
    kubectl delete deployment -n "$NAMESPACE" traefik --ignore-not-found=true
    kubectl delete service -n "$NAMESPACE" traefik --ignore-not-found=true
    
    # Delete ingress and ingressroutes
    log "Menghapus ingress dan ingressroutes..."
    kubectl delete ingress -n "$NAMESPACE" --all --ignore-not-found=true
    kubectl delete ingressroute -n "$NAMESPACE" --all --ignore-not-found=true
    
    # Delete middlewares
    log "Menghapus middlewares..."
    kubectl delete middleware -n "$NAMESPACE" --all --ignore-not-found=true
    
    log_success "Gateway dan ingress dibersihkan"
}

# Function to cleanup monitoring
cleanup_monitoring() {
    log "Membersihkan monitoring stack..."
    
    # Delete monitoring deployments
    log "Menghapus monitoring deployments..."
    kubectl delete deployment -n "$NAMESPACE" \
        prometheus \
        grafana \
        alertmanager \
        postgres-exporter \
        redis-exporter \
        node-exporter \
        --ignore-not-found=true
    
    # Delete monitoring services
    log "Menghapus monitoring services..."
    kubectl delete service -n "$NAMESPACE" \
        prometheus \
        grafana \
        alertmanager \
        postgres-exporter \
        redis-exporter \
        node-exporter \
        --ignore-not-found=true
    
    # Delete configmaps
    log "Menghapus monitoring configmaps..."
    kubectl delete configmap -n "$NAMESPACE" \
        prometheus-config \
        grafana-config \
        alertmanager-config \
        --ignore-not-found=true
    
    log_success "Monitoring stack dibersihkan"
}

# Function to cleanup database components
cleanup_database_components() {
    log "Membersihkan database components..."
    
    # Delete database exporters and tools
    log "Menghapus database exporters dan tools..."
    kubectl delete deployment -n "$NAMESPACE" \
        pgbouncer-do \
        redis-commander \
        postgres-exporter \
        redis-exporter \
        --ignore-not-found=true
    
    # Delete services
    log "Menghapus database services..."
    kubectl delete service -n "$NAMESPACE" \
        pgbouncer-do \
        redis-commander \
        postgres-exporter \
        redis-exporter \
        --ignore-not-found=true
    
    log_success "Database components dibersihkan"
}

# Function to cleanup HPA and scaling
cleanup_scaling() {
    log "Membersihkan auto-scaling components..."
    
    # Delete HPA
    log "Menghapus Horizontal Pod Autoscalers..."
    kubectl delete hpa -n "$NAMESPACE" --all --ignore-not-found=true
    
    log_success "Auto-scaling components dibersihkan"
}

# Function to cleanup network policies
cleanup_network_policies() {
    log "Membersihkan network policies..."
    
    # Delete network policies
    log "Menghapus network policies..."
    kubectl delete networkpolicy -n "$NAMESPACE" --all --ignore-not-found=true
    
    log_success "Network policies dibersihkan"
}

# Function to cleanup configmaps and secrets
cleanup_configmaps_secrets() {
    log "Membersihkan configmaps dan secrets..."
    
    # Delete configmaps
    log "Menghapus configmaps..."
    kubectl delete configmap -n "$NAMESPACE" --all --ignore-not-found=true
    
    # Delete secrets
    log "Menghapus secrets..."
    kubectl delete secret -n "$NAMESPACE" --all --ignore-not-found=true
    
    log_success "Configmaps dan secrets dibersihkan"
}

# Function to cleanup persistent storage
cleanup_storage() {
    log "Membersihkan persistent storage..."
    
    # Delete PVCs
    log "Menghapus Persistent Volume Claims..."
    kubectl delete pvc -n "$NAMESPACE" --all --ignore-not-found=true
    
    # Ask for PV cleanup
    if confirm_action "Hapus juga Persistent Volumes (berpotensi data loss)?"; then
        log "Menghapus Persistent Volumes..."
        kubectl delete pv -l app=gomeet --ignore-not-found=true
    fi
    
    log_success "Persistent storage dibersihkan"
}

# Function to cleanup namespace
cleanup_namespace() {
    log "Membersihkan namespace..."
    
    # Delete namespace
    log "Menghapus namespace $NAMESPACE..."
    kubectl delete namespace "$NAMESPACE" --ignore-not-found=true
    
    log_success "Namespace dibersihkan"
}

# Function to cleanup DigitalOcean resources
cleanup_digitalocean_resources() {
    log "Membersihkan DigitalOcean resources..."
    
    if confirm_action "Hapus DigitalOcean Load Balancer?"; then
        # Get load balancer IDs
        LB_IDS=$(doctl compute load-balancer list --format ID --no-header 2>/dev/null || echo "")
        
        if [[ -n "$LB_IDS" ]]; then
            log "Menghapus Load Balancers..."
            echo "$LB_IDS" | xargs -I {} doctl compute load-balancer delete {} -f
            log_success "Load Balancers dihapus"
        else
            log "Tidak ada Load Balancer yang ditemukan"
        fi
    fi
    
    if confirm_action "Hapus DigitalOcean Volumes?"; then
        # Get volume IDs
        VOLUME_IDS=$(doctl compute volume list --format ID --no-header 2>/dev/null || echo "")
        
        if [[ -n "$VOLUME_IDS" ]]; then
            log "Menghapus Volumes..."
            echo "$VOLUME_IDS" | xargs -I {} doctl compute volume delete {} -f
            log_success "Volumes dihapus"
        else
            log "Tidak ada Volume yang ditemukan"
        fi
    fi
    
    if confirm_action "Hapus DigitalOcean Container Registry images?"; then
        # Get repositories
        REPO_NAMES=$(doctl registry repository list --format Name --no-header 2>/dev/null || echo "")
        
        if [[ -n "$REPO_NAMES" ]]; then
            log "Menghapus Container Registry repositories..."
            echo "$REPO_NAMES" | xargs -I {} doctl registry repository delete {} -f
            log_success "Container Registry repositories dihapus"
        else
            log "Tidak ada Container Registry repository yang ditemukan"
        fi
    fi
    
    log_success "DigitalOcean resources dibersihkan"
}

# Function to force cleanup
force_cleanup() {
    log "Force cleanup semua resources..."
    
    # Force delete namespace
    log "Force delete namespace $NAMESPACE..."
    kubectl patch namespace "$NAMESPACE" -p '{"metadata":{"finalizers":[]}}' --type=merge || true
    kubectl delete namespace "$NAMESPACE" --force --grace-period=0 --ignore-not-found=true
    
    # Wait for namespace deletion
    log "Menunggu penghapusan namespace..."
    for i in {1..60}; do
        if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
            log_success "Namespace berhasil dihapus"
            break
        fi
        log "Menunggu... (attempt $i/60)"
        sleep 5
    done
    
    log_success "Force cleanup selesai"
}

# Function to check cleanup status
check_cleanup_status() {
    log "Memeriksa status cleanup..."
    
    # Check namespace
    if kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_warning "Namespace $NAMESPACE masih ada"
        kubectl get all -n "$NAMESPACE"
    else
        log_success "Namespace $NAMESPACE sudah dihapus"
    fi
    
    # Check DigitalOcean resources
    log "Memeriksa DigitalOcean resources..."
    
    # Check load balancers
    LB_COUNT=$(doctl compute load-balancer list --format ID --no-header 2>/dev/null | wc -l || echo "0")
    if [[ "$LB_COUNT" -gt 0 ]]; then
        log_warning "Masih ada $LB_COUNT Load Balancer"
        doctl compute load-balancer list
    else
        log_success "Tidak ada Load Balancer yang tersisa"
    fi
    
    # Check volumes
    VOLUME_COUNT=$(doctl compute volume list --format ID --no-header 2>/dev/null | wc -l || echo "0")
    if [[ "$VOLUME_COUNT" -gt 0 ]]; then
        log_warning "Masih ada $VOLUME_COUNT Volume"
        doctl compute volume list
    else
        log_success "Tidak ada Volume yang tersisa"
    fi
    
    log_success "Status cleanup check selesai"
}

# Function to show help
show_help() {
    echo "GoMeet DigitalOcean Cleanup Script"
    echo ""
    echo "Usage: $0 [COMMAND] [OPTIONS]"
    echo ""
    echo "Commands:"
    echo "  backup              Backup semua resources sebelum cleanup"
    echo "  app                 Hanya cleanup application services"
    echo "  gateway             Hanya cleanup gateway dan ingress"
    echo "  monitoring          Hanya cleanup monitoring stack"
    echo "  database            Hanya cleanup database components"
    echo "  scaling             Hanya cleanup auto-scaling"
    echo "  network             Hanya cleanup network policies"
    echo "  config              Hanya cleanup configmaps dan secrets"
    echo "  storage             Hanya cleanup persistent storage"
    echo "  namespace           Hanya cleanup namespace"
    echo "  digitalocean        Hanya cleanup DigitalOcean resources"
    echo "  soft                Soft cleanup (tanpa storage dan DO resources)"
    echo "  full                Full cleanup (semua resources)"
    echo "  force               Force cleanup (emergency)"
    echo "  status              Periksa status cleanup"
    echo ""
    echo "Options:"
    echo "  -n, --namespace NAMESPACE  Override namespace (default: gomeet)"
    echo "  -b, --backup               Backup sebelum cleanup"
    echo "  -y, --yes                  Skip confirmation prompts"
    echo "  -h, --help                 Show this help message"
    echo ""
    echo "Examples:"
    echo "  $0 backup                  # Backup semua resources"
    echo "  $0 soft                    # Soft cleanup"
    echo "  $0 full                    # Full cleanup dengan konfirmasi"
    echo "  $0 force                   # Force cleanup tanpa konfirmasi"
}

# Main execution
main() {
    local command="$1"
    local do_backup=false
    local skip_confirm=false
    
    # Parse command line arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -n|--namespace)
                NAMESPACE="$2"
                shift 2
                ;;
            -b|--backup)
                do_backup=true
                shift
                ;;
            -y|--yes)
                skip_confirm=true
                shift
                ;;
            *)
                shift
                ;;
        esac
    done
    
    # Check prerequisites
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl tidak terinstall"
        exit 1
    fi
    
    if ! command -v doctl &> /dev/null; then
        log_warning "doctl tidak terinstall, DigitalOcean cleanup akan dilewati"
    fi
    
    # Backup if requested
    if [[ "$do_backup" == true ]]; then
        backup_resources
    fi
    
    # Execute command
    case "$command" in
        "backup")
            backup_resources
            ;;
        "app")
            cleanup_application_services
            ;;
        "gateway")
            cleanup_gateway_ingress
            ;;
        "monitoring")
            cleanup_monitoring
            ;;
        "database")
            cleanup_database_components
            ;;
        "scaling")
            cleanup_scaling
            ;;
        "network")
            cleanup_network_policies
            ;;
        "config")
            cleanup_configmaps_secrets
            ;;
        "storage")
            cleanup_storage
            ;;
        "namespace")
            cleanup_namespace
            ;;
        "digitalocean")
            cleanup_digitalocean_resources
            ;;
        "soft")
            if [[ "$skip_confirm" == false ]] && ! confirm_action "Lakukan soft cleanup?"; then
                log "Cleanup dibatalkan"
                exit 0
            fi
            cleanup_application_services
            cleanup_gateway_ingress
            cleanup_monitoring
            cleanup_database_components
            cleanup_scaling
            cleanup_network_policies
            cleanup_configmaps_secrets
            log_success "Soft cleanup selesai"
            ;;
        "full")
            if [[ "$skip_confirm" == false ]] && ! confirm_action "Lakukan full cleanup? Ini akan menghapus SEMUA data!"; then
                log "Cleanup dibatalkan"
                exit 0
            fi
            cleanup_application_services
            cleanup_gateway_ingress
            cleanup_monitoring
            cleanup_database_components
            cleanup_scaling
            cleanup_network_policies
            cleanup_configmaps_secrets
            cleanup_storage
            cleanup_namespace
            cleanup_digitalocean_resources
            log_success "Full cleanup selesai"
            ;;
        "force")
            force_cleanup
            ;;
        "status")
            check_cleanup_status
            ;;
        *)
            show_help
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"