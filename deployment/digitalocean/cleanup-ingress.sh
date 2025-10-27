#!/bin/bash

# =============================================================================
# GoMeet Ingress Cleanup Script
# DigitalOcean Kubernetes Cluster
# =============================================================================

set -euo pipefail

# Configuration
NAMESPACE="gomeet"
BACKUP_DIR="./backups/ingress-cleanup-$(date +%Y%m%d-%H%M%S)"
LOG_FILE="./cleanup-ingress-$(date +%Y%m%d-%H%M%S).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Ingress files to remove (conflicting ones)
CONFLICTING_INGRESSES=(
    "ingress-fixed.yaml"
    "ingress-letsencrypt.yaml" 
    "ingress-temp-ssl.yaml"
    "acme-challenge-ingress.yaml"
    "acme-challenge-ingress-fixed.yaml"
)

# Ingress files to keep (clean configuration)
KEEP_INGRESSES=(
    "ingress-domain.yaml"
    "traefik-gateway.yaml"
    "middleware.yaml"
    "tls-options.yaml"
)

# Domains to test
DOMAINS=(
    "meet.filosofine.com"
    "api-meet.filosofine.com"
    "livekit.filosofine.com"
)

# =============================================================================
# Utility Functions
# =============================================================================

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

log_success() {
    echo -e "${GREEN}[$(date '+%Y-%m-%d %H:%M:%S')] SUCCESS:${NC} $1" | tee -a "$LOG_FILE"
}

log_warning() {
    echo -e "${YELLOW}[$(date '+%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
    echo -e "${RED}[$(date '+%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" | tee -a "$LOG_FILE"
}

# =============================================================================
# Validation Functions
# =============================================================================

check_prerequisites() {
    log "Memeriksa prerequisites..."
    
    # Check kubectl
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl tidak ditemukan. Silakan install kubectl terlebih dahulu."
        exit 1
    fi
    
    # Check cluster connectivity
    if ! kubectl cluster-info &> /dev/null; then
        log_error "Tidak dapat terhubung ke cluster Kubernetes."
        exit 1
    fi
    
    # Check namespace exists
    if ! kubectl get namespace "$NAMESPACE" &> /dev/null; then
        log_error "Namespace '$NAMESPACE' tidak ditemukan."
        exit 1
    fi
    
    log_success "Semua prerequisites terpenuhi."
}

validate_current_state() {
    log "Memvalidasi state ingress saat ini..."
    
    # Get current ingress list
    local current_ingresses
    current_ingresses=$(kubectl get ingress -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -z "$current_ingresses" ]]; then
        log_warning "Tidak ada ingress yang ditemukan di namespace '$NAMESPACE'."
        return 0
    fi
    
    log "Ingress saat ini di namespace '$NAMESPACE':"
    for ingress in $current_ingresses; do
        echo "  - $ingress"
    done
    
    # Check for conflicting hosts
    log "Memeriksa konflik host..."
    local hosts
    hosts=$(kubectl get ingress -n "$NAMESPACE" -o jsonpath='{range .items[*]}{.spec.rules[*].host}{"\n"}{end}' 2>/dev/null | sort | uniq -d || echo "")
    
    if [[ -n "$hosts" ]]; then
        log_warning "Host duplikat terdeteksi:"
        for host in $hosts; do
            echo "  - $host"
        done
    else
        log_success "Tidak ada host duplikat yang terdeteksi."
    fi
    
    # Check certificate status
    log "Memeriksa status certificate..."
    local certificates
    certificates=$(kubectl get certificate -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -n "$certificates" ]]; then
        log "Certificate saat ini:"
        for cert in $certificates; do
            local status
            status=$(kubectl get certificate "$cert" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
            echo "  - $cert: $status"
        done
    fi
}

test_connectivity() {
    log "Menguji konektivitas domain saat ini..."
    
    for domain in "${DOMAINS[@]}"; do
        log "Menguji $domain..."
        
        # Test HTTPS connection
        if curl -k -s -I --max-time 10 "https://$domain" &> /dev/null; then
            log_success "✓ $domain - HTTPS accessible"
        else
            log_warning "✗ $domain - HTTPS tidak accessible atau timeout"
        fi
        
        # Check SSL certificate
        if echo | openssl s_client -connect "$domain:443" -servername "$domain" 2>/dev/null | openssl x509 -noout -dates &> /dev/null; then
            log_success "✓ $domain - SSL certificate valid"
        else
            log_warning "✗ $domain - SSL certificate issue detected"
        fi
    done
}

# =============================================================================
# Backup Functions
# =============================================================================

create_backup() {
    log "Membuat backup konfigurasi..."
    
    # Create backup directory
    mkdir -p "$BACKUP_DIR"
    
    # Backup all ingress
    log "Membackup ingress resources..."
    kubectl get ingress -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/ingress-backup.yaml" 2>/dev/null || {
        log_warning "Gagal membackup ingress resources."
    }
    
    # Backup middleware
    log "Membackup middleware..."
    kubectl get middleware -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/middleware-backup.yaml" 2>/dev/null || {
        log_warning "Gagal membackup middleware."
    }
    
    # Backup TLS options
    log "Membackup TLS options..."
    kubectl get tlsoption -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/tlsoption-backup.yaml" 2>/dev/null || {
        log_warning "Gagal membackup TLS options."
    }
    
    # Backup certificates
    log "Membackup certificates..."
    kubectl get certificate -n "$NAMESPACE" -o yaml > "$BACKUP_DIR/certificate-backup.yaml" 2>/dev/null || {
        log_warning "Gagal membackup certificates."
    }
    
    # Backup current files
    log "Membackup file konfigurasi lokal..."
    mkdir -p "$BACKUP_DIR/local-files"
    for file in "${CONFLICTING_INGRESSES[@]}" "${KEEP_INGRESSES[@]}"; do
        if [[ -f "$file" ]]; then
            cp "$file" "$BACKUP_DIR/local-files/"
        fi
    done
    
    log_success "Backup selesai disimpan di: $BACKUP_DIR"
}

# =============================================================================
# Cleanup Functions
# =============================================================================

remove_conflicting_ingresses() {
    log "Menghapus ingress yang konflik..."
    
    local removed_count=0
    
    for ingress_file in "${CONFLICTING_INGRESSES[@]}"; do
        if [[ -f "$ingress_file" ]]; then
            log "Memproses file: $ingress_file"
            
            # Extract ingress names from file
            local ingress_names
            ingress_names=$(yq eval '.metadata.name' "$ingress_file" 2>/dev/null || grep -o 'name: [^[:space:]]*' "$ingress_file" | cut -d' ' -f2 || "")
            
            if [[ -n "$ingress_names" ]]; then
                for ingress_name in $ingress_names; do
                    if [[ "$ingress_name" != "null" && -n "$ingress_name" ]]; then
                        log "Menghapus ingress: $ingress_name"
                        if kubectl delete ingress "$ingress_name" -n "$NAMESPACE" --ignore-not-found=true; then
                            log_success "✓ Ingress $ingress_name berhasil dihapus"
                            ((removed_count++))
                        else
                            log_error "✗ Gagal menghapus ingress $ingress_name"
                        fi
                    fi
                done
            fi
        fi
    done
    
    log_success "Total $removed_count ingress berhasil dihapus."
}

apply_clean_configuration() {
    log "Menerapkan konfigurasi yang bersih..."
    
    local applied_count=0
    
    for config_file in "${KEEP_INGRESSES[@]}"; do
        if [[ -f "$config_file" ]]; then
            log "Menerapkan: $config_file"
            
            if kubectl apply -f "$config_file" --namespace="$NAMESPACE"; then
                log_success "✓ $config_file berhasil diterapkan"
                ((applied_count++))
            else
                log_error "✗ Gagal menerapkan $config_file"
                return 1
            fi
        else
            log_warning "File $config_file tidak ditemukan, melewati..."
        fi
    done
    
    log_success "Total $applied_count konfigurasi berhasil diterapkan."
}

# =============================================================================
# Validation Functions
# =============================================================================

validate_cleanup() {
    log "Memvalidasi hasil cleanup..."
    
    # Wait for resources to be ready
    log "Menunggu resources siap..."
    sleep 10
    
    # Check ingress status
    log "Memeriksa status ingress setelah cleanup..."
    local current_ingresses
    current_ingresses=$(kubectl get ingress -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -n "$current_ingresses" ]]; then
        log "Ingress yang aktif setelah cleanup:"
        for ingress in $current_ingresses; do
            local address
            address=$(kubectl get ingress "$ingress" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "Pending")
            echo "  - $ingress (Address: $address)"
        done
    fi
    
    # Test connectivity again
    log "Menguji konektivitas setelah cleanup..."
    test_connectivity
    
    # Check certificate status
    log "Memeriksa status certificate setelah cleanup..."
    local certificates
    certificates=$(kubectl get certificate -n "$NAMESPACE" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -n "$certificates" ]]; then
        local ready_count=0
        for cert in $certificates; do
            local status
            status=$(kubectl get certificate "$cert" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || echo "Unknown")
            if [[ "$status" == "True" ]]; then
                log_success "✓ Certificate $cert: Ready"
                ((ready_count++))
            else
                log_warning "✗ Certificate $cert: $status"
            fi
        done
        
        if [[ $ready_count -eq $(echo "$certificates" | wc -w) ]]; then
            log_success "Semua certificate dalam status ready."
        fi
    fi
}

# =============================================================================
# Rollback Functions
# =============================================================================

rollback_changes() {
    log_warning "Melakukan rollback perubahan..."
    
    if [[ ! -d "$BACKUP_DIR" ]]; then
        log_error "Backup directory tidak ditemukan: $BACKUP_DIR"
        return 1
    fi
    
    # Restore ingress
    if [[ -f "$BACKUP_DIR/ingress-backup.yaml" ]]; then
        log "Merestore ingress dari backup..."
        kubectl apply -f "$BACKUP_DIR/ingress-backup.yaml" --namespace="$NAMESPACE"
    fi
    
    # Restore middleware
    if [[ -f "$BACKUP_DIR/middleware-backup.yaml" ]]; then
        log "Merestore middleware dari backup..."
        kubectl apply -f "$BACKUP_DIR/middleware-backup.yaml" --namespace="$NAMESPACE"
    fi
    
    # Restore TLS options
    if [[ -f "$BACKUP_DIR/tlsoption-backup.yaml" ]]; then
        log "Merestore TLS options dari backup..."
        kubectl apply -f "$BACKUP_DIR/tlsoption-backup.yaml" --namespace="$NAMESPACE"
    fi
    
    log_success "Rollback selesai."
}

# =============================================================================
# Main Execution
# =============================================================================

show_help() {
    cat << EOF
GoMeet Ingress Cleanup Script

Penggunaan:
    $0 [OPTIONS]

Options:
    -h, --help          Menampilkan help ini
    -d, --dry-run       Menjalankan dalam mode dry-run (hanya validasi)
    -r, --rollback      Melakukan rollback dari backup terakhir
    -b, --backup-only   Hanya membuat backup, tidak melakukan cleanup
    -f, --force         Melakukan cleanup tanpa konfirmasi

Examples:
    $0                  # Jalankan cleanup dengan konfirmasi
    $0 --dry-run        # Validasi saja, tidak menghapus apa-apa
    $0 --rollback       # Rollback dari backup
    $0 --backup-only    # Hanya backup
    $0 --force          # Force cleanup tanpa konfirmasi

EOF
}

main() {
    local dry_run=false
    local rollback=false
    local backup_only=false
    local force=false
    
    # Parse arguments
    while [[ $# -gt 0 ]]; do
        case $1 in
            -h|--help)
                show_help
                exit 0
                ;;
            -d|--dry-run)
                dry_run=true
                shift
                ;;
            -r|--rollback)
                rollback=true
                shift
                ;;
            -b|--backup-only)
                backup_only=true
                shift
                ;;
            -f|--force)
                force=true
                shift
                ;;
            *)
                log_error "Argument tidak dikenal: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    log "GoMeet Ingress Cleanup Script dimulai"
    log "Mode: $(if [[ "$dry_run" == true ]]; then echo "DRY RUN"; else echo "EXECUTION"; fi)"
    
    # Check prerequisites
    check_prerequisites
    
    # Rollback mode
    if [[ "$rollback" == true ]]; then
        rollback_changes
        exit 0
    fi
    
    # Create backup
    create_backup
    
    if [[ "$backup_only" == true ]]; then
        log_success "Backup selesai. Keluar dari script."
        exit 0
    fi
    
    # Validate current state
    validate_current_state
    test_connectivity
    
    # Confirmation prompt
    if [[ "$force" != true && "$dry_run" != true ]]; then
        echo
        log_warning "Script akan menghapus ingress yang konflik dan menerapkan konfigurasi bersih."
        echo "Backup telah dibuat di: $BACKUP_DIR"
        echo
        read -p "Apakah Anda ingin melanjutkan? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            log "Dibatalkan oleh user."
            exit 0
        fi
    fi
    
    if [[ "$dry_run" == true ]]; then
        log "DRY RUN MODE - Tidak melakukan perubahan aktual."
        log "Ingress yang akan dihapus:"
        for file in "${CONFLICTING_INGRESSES[@]}"; do
            if [[ -f "$file" ]]; then
                echo "  - $file"
            fi
        done
        log "Konfigurasi yang akan diterapkan:"
        for file in "${KEEP_INGRESSES[@]}"; do
            if [[ -f "$file" ]]; then
                echo "  - $file"
            fi
        done
        exit 0
    fi
    
    # Execute cleanup
    log "Memulai proses cleanup..."
    
    remove_conflicting_ingresses
    apply_clean_configuration
    validate_cleanup
    
    log_success "Ingress cleanup selesai成功!"
    log "Backup tersimpan di: $BACKUP_DIR"
    log "Log tersimpan di: $LOG_FILE"
    
    echo
    log "Untuk rollback jika terjadi masalah, jalankan:"
    echo "  $0 --rollback"
    echo
}

# Install yq if not present (for YAML parsing)
if ! command -v yq &> /dev/null; then
    log_warning "yq tidak ditemukan, menggunakan fallback method untuk parsing YAML."
fi

# Run main function with all arguments
main "$@"