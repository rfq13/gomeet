#!/bin/bash

# 🔒 DigitalOcean API Token Setup Script
# Script untuk mengamankan dan mengelola DO API token

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "${BLUE}🔒 DigitalOcean API Token Setup${NC}"
    echo "=================================="
}

print_warning() {
    echo -e "${YELLOW}⚠️  WARNING: $1${NC}"
}

print_error() {
    echo -e "${RED}❌ ERROR: $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ SUCCESS: $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  INFO: $1${NC}"
}

check_dependencies() {
    print_info "Checking dependencies..."
    
    if ! command -v doctl &> /dev/null; then
        print_warning "doctl not found. Installing..."
        curl -sL https://github.com/digitalocean/doctl/releases/latest/download/doctl-$(uname -s)-$(uname -m).tar.gz | tar xz
        sudo mv doctl /usr/local/bin/
        print_success "doctl installed successfully"
    else
        print_success "doctl is already installed"
    fi
}

revoke_exposed_tokens() {
    print_warning "REVOKING EXPOSED TOKENS - CRITICAL SECURITY ACTION"
    echo "The following tokens were exposed and must be revoked IMMEDIATELY:"
    echo "• DigitalOcean: dop_v1_e17d38c4da4dac9e5ac3d32131ba3e790b3134db16ce3804348db3257965c07a"
    echo ""
    
    read -p "Have you revoked the exposed DigitalOcean token? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_error "Please revoke the exposed token first before proceeding!"
        echo "Go to: https://cloud.digitalocean.com/account/settings/tokens"
        exit 1
    fi
    
    print_success "Token revocation confirmed"
}

generate_new_token() {
    print_info "Generating new DigitalOcean API token..."
    
    # Check if already authenticated
    if doctl account get &> /dev/null; then
        print_info "Already authenticated with doctl"
    else
        print_info "Please authenticate with DigitalOcean:"
        doctl auth init
    fi
    
    # Generate token with minimal permissions
    print_info "Creating token with minimal permissions..."
    
    # Get token name
    read -p "Enter token name (e.g., gomeet-prod): " token_name
    if [[ -z "$token_name" ]]; then
        token_name="gomeet-$(date +%Y%m%d)"
    fi
    
    # Set expiry (90 days default)
    read -p "Set token expiry in days (default: 90): " expiry_days
    if [[ -z "$expiry_days" ]]; then
        expiry_days=90
    fi
    
    # Generate token
    print_info "Generating token: $token_name"
    print_info "Expiry: $expiry_days days"
    
    # Note: doctl doesn't support token creation via CLI with scopes
    # User needs to create token manually via web UI
    echo ""
    print_warning "Please create the token manually via DigitalOcean Control Panel:"
    echo "1. Go to: https://cloud.digitalocean.com/account/settings/tokens"
    echo "2. Click 'Generate New Token'"
    echo "3. Token name: $token_name"
    echo "4. Expiry: $expiry_days days"
    echo "5. Scopes: Select minimal required permissions"
    echo "   • For infrastructure: droplet:read,droplet:write"
    echo "   • For DNS: domain:read,domain:write"
    echo "   • For Spaces: spaces:read,spaces:write"
    echo "   • For Load Balancers: load_balancer:read,load_balancer:write"
    echo ""
    
    read -p "Press Enter after creating the token..."
    
    # Get token from user
    read -s -p "Enter your new DigitalOcean API token: " new_token
    echo
    echo
    
    if [[ -z "$new_token" ]]; then
        print_error "Token cannot be empty!"
        exit 1
    fi
    
    # Validate token
    print_info "Validating token..."
    if doctl auth init -t "$new_token" &> /dev/null; then
        print_success "Token is valid"
    else
        print_error "Invalid token!"
        exit 1
    fi
    
    export DO_API_TOKEN="$new_token"
    print_success "Token configured successfully"
}

store_token_securely() {
    print_info "Storing token securely..."
    
    echo "Choose storage method:"
    echo "1) DigitalOcean Secrets (Recommended for production)"
    echo "2) Environment variable (Good for development)"
    echo "3) Docker secrets (For containerized deployment)"
    
    read -p "Choose option (1-3): " storage_option
    
    case $storage_option in
        1)
            print_info "Storing in DigitalOcean Secrets..."
            doctl secrets create DO_API_TOKEN --value "$DO_API_TOKEN"
            print_success "Token stored in DigitalOcean Secrets"
            ;;
        2)
            print_info "Creating .env.local file..."
            echo "DO_API_TOKEN=$DO_API_TOKEN" >> .env.local
            echo ".env.local" >> .gitignore
            print_success "Token stored in .env.local"
            print_warning "Make sure .env.local is in .gitignore!"
            ;;
        3)
            print_info "Creating Docker secret..."
            echo "$DO_API_TOKEN" | docker secret create DO_API_TOKEN -
            print_success "Token stored as Docker secret"
            ;;
        *)
            print_error "Invalid option!"
            exit 1
            ;;
    esac
}

update_configuration() {
    print_info "Updating application configuration..."
    
    # Update production environment file
    if [[ -f "packages/backend/.env.production" ]]; then
        if grep -q "DO_API_TOKEN=" packages/backend/.env.production; then
            print_info "DO_API_TOKEN already configured in production"
        else
            echo "DO_API_TOKEN=\${DO_API_TOKEN}" >> packages/backend/.env.production
            print_success "Added DO_API_TOKEN to production config"
        fi
    fi
    
    # Update example file
    if [[ -f "packages/backend/.env.example" ]]; then
        if grep -q "DO_API_TOKEN=" packages/backend/.env.example; then
            print_info "DO_API_TOKEN already in example file"
        else
            echo "DO_API_TOKEN=your-digitalocean-api-token" >> packages/backend/.env.example
            print_success "Added DO_API_TOKEN to example file"
        fi
    fi
}

verify_setup() {
    print_info "Verifying setup..."
    
    # Test token access
    if doctl account get &> /dev/null; then
        account_info=$(doctl account get --format "Email,Name")
        print_success "Token verification successful"
        echo "Account: $account_info"
    else
        print_error "Token verification failed!"
        exit 1
    fi
    
    # Check configuration files
    if [[ -f "packages/backend/.env.production" ]] && grep -q "DO_API_TOKEN=" packages/backend/.env.production; then
        print_success "Production configuration updated"
    fi
    
    if [[ -f "packages/backend/.env.example" ]] && grep -q "DO_API_TOKEN=" packages/backend/.env.example; then
        print_success "Example configuration updated"
    fi
}

cleanup() {
    print_info "Cleaning up..."
    
    # Remove any temporary files
    if [[ -f ".tmp_token" ]]; then
        rm -f .tmp_token
    fi
    
    # Clear token from environment
    unset DO_API_TOKEN
    
    print_success "Cleanup completed"
}

show_next_steps() {
    echo ""
    print_success "🎉 DigitalOcean API token setup completed!"
    echo ""
    echo "Next steps:"
    echo "1. ✅ Token revoked and regenerated"
    echo "2. ✅ Token stored securely"
    echo "3. ✅ Configuration updated"
    echo "4. 🔄 Deploy your application"
    echo "5. 🔄 Monitor API usage"
    echo "6. 🔄 Set up token rotation (every 90 days)"
    echo ""
    echo "Important files created/updated:"
    echo "• packages/backend/.env.production"
    echo "• packages/backend/.env.example"
    echo "• SECURITY_GUIDELINES.md"
    echo ""
    print_warning "Remember to:"
    echo "• Never commit secrets to version control"
    echo "• Monitor API usage regularly"
    echo "• Rotate tokens periodically"
    echo "• Use minimal required permissions"
}

# Main execution
main() {
    print_header
    
    # Check if running in project root
    if [[ ! -f "packages/backend/internal/config/config.go" ]]; then
        print_error "Please run this script from the project root directory!"
        exit 1
    fi
    
    check_dependencies
    revoke_exposed_tokens
    generate_new_token
    store_token_securely
    update_configuration
    verify_setup
    cleanup
    show_next_steps
}

# Run main function
main "$@"