#!/bin/bash

# GoMeet DigitalOcean Secrets Setup Script
# Script untuk setup secrets DigitalOcean dengan aman

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

# Function to generate random string
generate_random_string() {
    local length=${1:-32}
    openssl rand -base64 $length | tr -d "=+/" | cut -c1-$length
}

# Function to encode base64
encode_base64() {
    echo -n "$1" | base64
}

# Function to prompt for input with default value
prompt_input() {
    local prompt="$1"
    local default_value="$2"
    local var_name="$3"
    
    if [[ -n "$default_value" ]]; then
        read -p "$prompt [$default_value]: " input_value
        input_value="${input_value:-$default_value}"
    else
        read -p "$prompt: " input_value
    fi
    
    if [[ -z "$input_value" ]]; then
        log_error "Input tidak boleh kosong"
        exit 1
    fi
    
    eval "$var_name='$input_value'"
}

# Function to prompt for password
prompt_password() {
    local prompt="$1"
    local var_name="$2"
    local confirm_var="$3"
    
    while true; do
        read -s -p "$prompt: " password1
        echo
        read -s -p "Konfirmasi $prompt: " password2
        echo
        
        if [[ "$password1" != "$password2" ]]; then
            log_error "Password tidak cocok, silakan coba lagi"
        elif [[ -z "$password1" ]]; then
            log_error "Password tidak boleh kosong"
        else
            break
        fi
    done
    
    eval "$var_name='$password1'"
    if [[ -n "$confirm_var" ]]; then
        eval "$confirm_var='$password2'"
    fi
}

create_gomeet_secrets() {
    log "Membuat secrets untuk aplikasi GoMeet..."
    
    # Generate or prompt for secrets
    log "Konfigurasi JWT secrets..."
    JWT_SECRET=$(generate_random_string 64)
    JWT_REFRESH_SECRET=$(generate_random_string 64)
    
    log "Konfigurasi database credentials..."
    prompt_password "Database password" DB_PASSWORD DB_PASSWORD_CONFIRM
    
    log "Konfigurasi Redis credentials..."
    prompt_password "Redis password" REDIS_PASSWORD REDIS_PASSWORD_CONFIRM
    
    log "Konfigurasi LiveKit secrets..."
    LIVEKIT_API_KEY=$(generate_random_string 32)
    LIVEKIT_API_SECRET=$(generate_random_string 64)
    
    log "Konfigurasi TURN server credentials..."
    TURN_SHARED_SECRET=$(generate_random_string 64)
    
    log "Konfigurasi DigitalOcean managed services..."
    prompt_input "DigitalOcean PostgreSQL Host" "your-postgres-cluster-do-user-xxxxx.db.ondigitalocean.com" DO_POSTGRES_HOST
    prompt_input "DigitalOcean PostgreSQL Port" "25060" DO_POSTGRES_PORT
    prompt_input "DigitalOcean PostgreSQL Database" "gomeet" DO_POSTGRES_DB
    prompt_input "DigitalOcean PostgreSQL User" "doadmin" DO_POSTGRES_USER
    
    prompt_input "DigitalOcean Redis Host" "your-redis-cluster-do-user-xxxxx.db.ondigitalocean.com" DO_REDIS_HOST
    prompt_input "DigitalOcean Redis Port" "25061" DO_REDIS_PORT
    
    log "Konfigurasi DigitalOcean API..."
    prompt_input "DigitalOcean API Token" "" DO_API_TOKEN
    prompt_input "DigitalOcean Region" "nyc1" DO_REGION
    
    log "Konfigurasi DigitalOcean Spaces..."
    prompt_input "Spaces Access Key" "" DO_SPACES_ACCESS_KEY
    prompt_input "Spaces Secret Key" "" DO_SPACES_SECRET_KEY
    prompt_input "Spaces Region" "nyc3" DO_SPACES_REGION
    prompt_input "Spaces Bucket" "gomeet-recordings" DO_SPACES_BUCKET
    
    log "Konfigurasi aplikasi..."
    prompt_input "Frontend URL" "https://gomeet.com" FRONTEND_URL
    prompt_input "API URL" "https://api.gomeet.com" API_URL
    
    # Create secrets YAML
    cat > "$SCRIPT_DIR/secrets-generated.yaml" << EOF
apiVersion: v1
kind: Secret
metadata:
  name: gomeet-secrets
  namespace: $NAMESPACE
  labels:
    app: gomeet
    environment: production
    provider: digitalocean
type: Opaque
data:
  # JWT Secrets
  JWT_SECRET: $(encode_base64 "$JWT_SECRET")
  JWT_REFRESH_SECRET: $(encode_base64 "$JWT_REFRESH_SECRET")
  
  # Database Credentials
  DB_PASSWORD: $(encode_base64 "$DB_PASSWORD")
  
  # Redis Credentials
  REDIS_PASSWORD: $(encode_base64 "$REDIS_PASSWORD")
  
  # LiveKit Secrets
  LIVEKIT_API_KEY: $(encode_base64 "$LIVEKIT_API_KEY")
  LIVEKIT_API_SECRET: $(encode_base64 "$LIVEKIT_API_SECRET")
  
  # TURN Server
  TURN_SHARED_SECRET: $(encode_base64 "$TURN_SHARED_SECRET")
  
  # DigitalOcean Managed Services
  DO_POSTGRES_HOST: $(encode_base64 "$DO_POSTGRES_HOST")
  DO_POSTGRES_PORT: $(encode_base64 "$DO_POSTGRES_PORT")
  DO_POSTGRES_DB: $(encode_base64 "$DO_POSTGRES_DB")
  DO_POSTGRES_USER: $(encode_base64 "$DO_POSTGRES_USER")
  
  DO_REDIS_HOST: $(encode_base64 "$DO_REDIS_HOST")
  DO_REDIS_PORT: $(encode_base64 "$DO_REDIS_PORT")
  
  # DigitalOcean API
  DO_API_TOKEN: $(encode_base64 "$DO_API_TOKEN")
  DO_REGION: $(encode_base64 "$DO_REGION")
  
  # DigitalOcean Spaces
  DO_SPACES_ACCESS_KEY: $(encode_base64 "$DO_SPACES_ACCESS_KEY")
  DO_SPACES_SECRET_KEY: $(encode_base64 "$DO_SPACES_SECRET_KEY")
  DO_SPACES_REGION: $(encode_base64 "$DO_SPACES_REGION")
  DO_SPACES_BUCKET: $(encode_base64 "$DO_SPACES_BUCKET")
  
  # Application URLs
  FRONTEND_URL: $(encode_base64 "$FRONTEND_URL")
  API_URL: $(encode_base64 "$API_URL")

---
apiVersion: v1
kind: Secret
metadata:
  name: digitalocean-credentials
  namespace: $NAMESPACE
  labels:
    app: gomeet
    environment: production
    provider: digitalocean
type: Opaque
data:
  # DigitalOcean Credentials
  DO_API_TOKEN: $(encode_base64 "$DO_API_TOKEN")
  DO_REGION: $(encode_base64 "$DO_REGION")
  
  # Spaces Credentials
  DO_SPACES_ACCESS_KEY: $(encode_base64 "$DO_SPACES_ACCESS_KEY")
  DO_SPACES_SECRET_KEY: $(encode_base64 "$DO_SPACES_SECRET_KEY")
  DO_SPACES_REGION: $(encode_base64 "$DO_SPACES_REGION")
  DO_SPACES_BUCKET: $(encode_base64 "$DO_SPACES_BUCKET")

---
apiVersion: v1
kind: Secret
metadata:
  name: database-credentials
  namespace: $NAMESPACE
  labels:
    app: gomeet
    environment: production
    provider: digitalocean
type: Opaque
data:
  # PostgreSQL Credentials
  POSTGRES_HOST: $(encode_base64 "$DO_POSTGRES_HOST")
  POSTGRES_PORT: $(encode_base64 "$DO_POSTGRES_PORT")
  POSTGRES_DB: $(encode_base64 "$DO_POSTGRES_DB")
  POSTGRES_USER: $(encode_base64 "$DO_POSTGRES_USER")
  POSTGRES_PASSWORD: $(encode_base64 "$DB_PASSWORD")
  
  # Redis Credentials
  REDIS_HOST: $(encode_base64 "$DO_REDIS_HOST")
  REDIS_PORT: $(encode_base64 "$DO_REDIS_PORT")
  REDIS_PASSWORD: $(encode_base64 "$REDIS_PASSWORD")

---
apiVersion: v1
kind: Secret
metadata:
  name: livekit-secrets
  namespace: $NAMESPACE
  labels:
    app: gomeet
    environment: production
    provider: digitalocean
type: Opaque
data:
  # LiveKit Credentials
  LIVEKIT_API_KEY: $(encode_base64 "$LIVEKIT_API_KEY")
  LIVEKIT_API_SECRET: $(encode_base64 "$LIVEKIT_API_SECRET")
  LIVEKIT_HTTP_PORT: $(encode_base64 "7880")
  LIVEKIT_RTC_PORT: $(encode_base64 "7881")
  LIVEKIT_RTC_PORT_UDP: $(encode_base64 "7882")

---
apiVersion: v1
kind: Secret
metadata:
  name: turn-secrets
  namespace: $NAMESPACE
  labels:
    app: gomeet
    environment: production
    provider: digitalocean
type: Opaque
data:
  # TURN Server Credentials
  TURN_SHARED_SECRET: $(encode_base64 "$TURN_SHARED_SECRET")
  TURN_PORT: $(encode_base64 "3478")
  TURN_ALT_PORT: $(encode_base64 "3479")
  TURN_TLS_PORT: $(encode_base64 "5349")
EOF

    log_success "Secrets file created: $SCRIPT_DIR/secrets-generated.yaml"
}

apply_secrets() {
    log "Menerapkan secrets ke Kubernetes..."
    
    # Create namespace if not exists
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
    
    # Apply secrets
    kubectl apply -f "$SCRIPT_DIR/secrets-generated.yaml"
    
    log_success "Secrets applied to Kubernetes"
}

validate_secrets() {
    log "Validasi secrets..."
    
    # Check if secrets exist
    if kubectl get secret gomeet-secrets -n "$NAMESPACE" &> /dev/null; then
        log_success "gomeet-secrets found"
    else
        log_error "gomeet-secrets not found"
        return 1
    fi
    
    if kubectl get secret digitalocean-credentials -n "$NAMESPACE" &> /dev/null; then
        log_success "digitalocean-credentials found"
    else
        log_error "digitalocean-credentials not found"
        return 1
    fi
    
    if kubectl get secret database-credentials -n "$NAMESPACE" &> /dev/null; then
        log_success "database-credentials found"
    else
        log_error "database-credentials not found"
        return 1
    fi
    
    if kubectl get secret livekit-secrets -n "$NAMESPACE" &> /dev/null; then
        log_success "livekit-secrets found"
    else
        log_error "livekit-secrets not found"
        return 1
    fi
    
    if kubectl get secret turn-secrets -n "$NAMESPACE" &> /dev/null; then
        log_success "turn-secrets found"
    else
        log_error "turn-secrets not found"
        return 1
    fi
    
    log_success "All secrets validated successfully"
}

show_secrets_info() {
    log "Secrets information:"
    echo ""
    echo "Generated secrets:"
    echo "- JWT_SECRET: $JWT_SECRET"
    echo "- JWT_REFRESH_SECRET: $JWT_REFRESH_SECRET"
    echo "- LIVEKIT_API_KEY: $LIVEKIT_API_KEY"
    echo "- LIVEKIT_API_SECRET: $LIVEKIT_API_SECRET"
    echo "- TURN_SHARED_SECRET: $TURN_SHARED_SECRET"
    echo ""
    echo "Database configuration:"
    echo "- PostgreSQL Host: $DO_POSTGRES_HOST"
    echo "- PostgreSQL Port: $DO_POSTGRES_PORT"
    echo "- PostgreSQL Database: $DO_POSTGRES_DB"
    echo "- PostgreSQL User: $DO_POSTGRES_USER"
    echo ""
    echo "Redis configuration:"
    echo "- Redis Host: $DO_REDIS_HOST"
    echo "- Redis Port: $DO_REDIS_PORT"
    echo ""
    echo "DigitalOcean configuration:"
    echo "- Region: $DO_REGION"
    echo "- Spaces Bucket: $DO_SPACES_BUCKET"
    echo "- Spaces Region: $DO_SPACES_REGION"
    echo ""
    echo "Application URLs:"
    echo "- Frontend URL: $FRONTEND_URL"
    echo "- API URL: $API_URL"
    echo ""
    echo "⚠️  Simpan informasi ini dengan aman!"
}

# Main execution
main() {
    log "Starting GoMeet DigitalOcean secrets setup..."
    
    # Check prerequisites
    if ! command -v kubectl &> /dev/null; then
        log_error "kubectl tidak terinstall"
        exit 1
    fi
    
    if ! command -v openssl &> /dev/null; then
        log_error "openssl tidak terinstall"
        exit 1
    fi
    
    # Create secrets
    create_gomeet_secrets
    
    # Apply secrets
    apply_secrets
    
    # Validate secrets
    validate_secrets
    
    # Show secrets info
    show_secrets_info
    
    log_success "GoMeet DigitalOcean secrets setup completed!"
    log "Secrets file saved to: $SCRIPT_DIR/secrets-generated.yaml"
    log "⚠️  Jangan bagikan file secrets ini kepada siapa pun!"
}

# Script usage
show_usage() {
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  -h, --help     Show this help message"
    echo "  -n, --namespace NAMESPACE  Override namespace (default: gomeet)"
    echo ""
    echo "Examples:"
    echo "  $0                    # Setup secrets with default namespace"
    echo "  $0 -n staging         # Setup secrets for staging namespace"
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_usage
            exit 0
            ;;
        -n|--namespace)
            NAMESPACE="$2"
            shift 2
            ;;
        *)
            log_error "Unknown option: $1"
            show_usage
            exit 1
            ;;
    esac
done

# Run main function
main "$@"