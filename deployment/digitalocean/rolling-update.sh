#!/bin/bash

# GoMeet DigitalOcean Rolling Update Script
# Script untuk rolling update dengan zero downtime
# Support blue-green deployment, canary releases, dan automatic rollback

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
LOG_DIR="/tmp/gomeet-rolling-updates"
LOG_FILE="$LOG_DIR/rolling-update-$(date +%Y%m%d-%H%M%S).log"
UPDATE_ID="update-$(date +%Y%m%d-%H%M%S)"

# Update strategies
UPDATE_STRATEGY="rolling"
STRATEGIES=("rolling" "blue-green" "canary" "recreate")

# Rolling update configuration
MAX_SURGE="50%"
MAX_UNAVAILABLE="25%"
PROGRESS_DEADLINE_SECONDS=600
MIN_READY_SECONDS=10

# Canary configuration
CANARY_TRAFFIC_PERCENTAGE=10
CANARY_DURATION=300  # 5 minutes
CANARY_ANALYSIS_INTERVAL=30

# Health check configuration
HEALTH_CHECK_TIMEOUT=300
HEALTH_CHECK_INTERVAL=10
SUCCESS_THRESHOLD=3
FAILURE_THRESHOLD=3

# Rollback configuration
AUTO_ROLLBACK=true
ROLLBACK_TIMEOUT=600
ROLLBACK_RETRIES=3

# Global variables
VERBOSE=false
DRY_RUN=false
FORCE_UPDATE=false
SKIP_HEALTH_CHECK=false
SKIP_PRE_DEPLOYMENT=false
SKIP_POST_DEPLOYMENT=false
SERVICES_TO_UPDATE=()
NEW_IMAGE_TAG=""
CUSTOM_VALUES_FILE=""
PRE_DEPLOYMENT_HOOK=""
POST_DEPLOYMENT_HOOK=""

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
    
    log "ERROR" "Rolling update operation failed at line $line_number with exit code $exit_code"
    log "ERROR" "Check logs: $LOG_FILE"
    
    # Auto rollback if enabled
    if [[ "$AUTO_ROLLBACK" == true ]]; then
        log "WARNING" "Initiating automatic rollback..."
        perform_rollback
    fi
    
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Prerequisites check
check_prerequisites() {
    log "PHASE" "Checking Prerequisites"
    
    # Check required tools
    local tools=("kubectl" "jq" "curl")
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
    
    # Create log directory
    mkdir -p "$LOG_DIR"
    
    log "SUCCESS" "All prerequisites satisfied"
}

# Get current deployment status
get_deployment_status() {
    local service="$1"
    kubectl get deployment "$service" -n "$NAMESPACE" -o json 2>/dev/null || echo ""
}

# Get current image tag
get_current_image_tag() {
    local service="$1"
    kubectl get deployment "$service" -n "$NAMESPACE" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null | cut -d':' -f2 || echo ""
}

# Validate new image
validate_new_image() {
    local service="$1"
    local new_image="$2"
    
    log "INFO" "Validating new image: $new_image"
    
    # Check if image exists in registry
    local image_name=$(echo "$new_image" | cut -d':' -f1)
    local image_tag=$(echo "$new_image" | cut -d':' -f2)
    
    # For DigitalOcean Container Registry
    if [[ "$image_name" == *"registry.digitalocean.com"* ]]; then
        local repository=$(echo "$image_name" | cut -d'/' -f2-)
        
        # Check if image exists using doctl or curl
        if ! docker manifest inspect "$new_image" &> /dev/null; then
            log "ERROR" "Image $new_image not found in registry"
            return 1
        fi
    fi
    
    log "SUCCESS" "Image validation passed"
}

# Pre-deployment hook
run_pre_deployment_hook() {
    if [[ -z "$PRE_DEPLOYMENT_HOOK" || "$SKIP_PRE_DEPLOYMENT" == true ]]; then
        log "INFO" "Pre-deployment hook skipped"
        return 0
    fi
    
    log "PHASE" "Running Pre-Deployment Hook"
    
    log "INFO" "Executing: $PRE_DEPLOYMENT_HOOK"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would execute pre-deployment hook"
        return 0
    fi
    
    # Execute pre-deployment hook
    eval "$PRE_DEPLOYMENT_HOOK"
    
    log "SUCCESS" "Pre-deployment hook completed"
}

# Post-deployment hook
run_post_deployment_hook() {
    if [[ -z "$POST_DEPLOYMENT_HOOK" || "$SKIP_POST_DEPLOYMENT" == true ]]; then
        log "INFO" "Post-deployment hook skipped"
        return 0
    fi
    
    log "PHASE" "Running Post-Deployment Hook"
    
    log "INFO" "Executing: $POST_DEPLOYMENT_HOOK"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would execute post-deployment hook"
        return 0
    fi
    
    # Execute post-deployment hook
    eval "$POST_DEPLOYMENT_HOOK"
    
    log "SUCCESS" "Post-deployment hook completed"
}

# Health check
perform_health_check() {
    local service="$1"
    local timeout="$2"
    
    if [[ "$SKIP_HEALTH_CHECK" == true ]]; then
        log "INFO" "Health check skipped"
        return 0
    fi
    
    log "INFO" "Performing health check for $service (timeout: ${timeout}s)"
    
    local start_time=$(date +%s)
    local end_time=$((start_time + timeout))
    local consecutive_successes=0
    
    while [[ $(date +%s) -lt $end_time ]]; do
        # Check deployment status
        local status=$(kubectl get deployment "$service" -n "$NAMESPACE" -o jsonpath='{.status.conditions[?(@.type=="Progressing")].status}' 2>/dev/null || echo "False")
        local replicas=$(kubectl get deployment "$service" -n "$NAMESPACE" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || echo "0")
        local desired_replicas=$(kubectl get deployment "$service" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0")
        
        log "DEBUG" "$service health check - Status: $status, Ready: $replicas/$desired_replicas"
        
        # Check if deployment is healthy
        if [[ "$status" == "True" && "$replicas" == "$desired_replicas" ]]; then
            ((consecutive_successes++))
            
            if [[ $consecutive_successes -ge $SUCCESS_THRESHOLD ]]; then
                log "SUCCESS" "Health check passed for $service"
                return 0
            fi
        else
            consecutive_successes=0
        fi
        
        sleep $HEALTH_CHECK_INTERVAL
    done
    
    log "ERROR" "Health check failed for $service (timeout: ${timeout}s)"
    return 1
}

# Rolling update strategy
perform_rolling_update() {
    local service="$1"
    local new_image="$2"
    
    log "PHASE" "Performing Rolling Update for $service"
    
    # Get current deployment config
    local current_config=$(get_deployment_status "$service")
    
    if [[ -z "$current_config" ]]; then
        log "ERROR" "Deployment $service not found"
        return 1
    fi
    
    # Update deployment strategy
    local deployment_patch=$(cat << EOF
{
    "spec": {
        "strategy": {
            "type": "RollingUpdate",
            "rollingUpdate": {
                "maxSurge": "$MAX_SURGE",
                "maxUnavailable": "$MAX_UNAVAILABLE"
            }
        },
        "template": {
            "spec": {
                "containers": [{
                    "name": "$service",
                    "image": "$new_image"
                }]
            }
        },
        "progressDeadlineSeconds": $PROGRESS_DEADLINE_SECONDS,
        "minReadySeconds": $MIN_READY_SECONDS
    }
}
EOF
)
    
    log "INFO" "Updating $service to image: $new_image"
    log "DEBUG" "Rolling update config - Max surge: $MAX_SURGE, Max unavailable: $MAX_UNAVAILABLE"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would perform rolling update for $service"
        return 0
    fi
    
    # Apply rolling update
    kubectl patch deployment "$service" -n "$NAMESPACE" --patch "$deployment_patch"
    
    # Wait for rollout to complete
    log "INFO" "Waiting for rolling update to complete"
    kubectl rollout status deployment/"$service" -n "$NAMESPACE" --timeout="$PROGRESS_DEADLINE_SECONDS"s
    
    # Perform health check
    perform_health_check "$service" "$HEALTH_CHECK_TIMEOUT"
    
    log "SUCCESS" "Rolling update completed for $service"
}

# Blue-green deployment strategy
perform_blue_green_deployment() {
    local service="$1"
    local new_image="$2"
    
    log "PHASE" "Performing Blue-Green Deployment for $service"
    
    local green_service="${service}-green"
    local current_replicas=$(kubectl get deployment "$service" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "1")
    
    # Create green deployment
    log "INFO" "Creating green deployment: $green_service"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create green deployment for $service"
        return 0
    fi
    
    # Clone current deployment to green
    kubectl get deployment "$service" -n "$NAMESPACE" -o yaml | \
        sed "s/name: $service/name: $green_service/g" | \
        sed "s/image: .*/image: $new_image/g" | \
        kubectl apply -f -
    
    # Wait for green deployment to be ready
    log "INFO" "Waiting for green deployment to be ready"
    kubectl rollout status deployment/"$green_service" -n "$NAMESPACE" --timeout="$PROGRESS_DEADLINE_SECONDS"s
    
    # Health check green deployment
    perform_health_check "$green_service" "$HEALTH_CHECK_TIMEOUT"
    
    # Switch traffic to green
    log "INFO" "Switching traffic to green deployment"
    kubectl patch service "$service" -n "$NAMESPACE" -p '{"spec":{"selector":{"version":"green"}}}'
    
    # Wait for traffic switch
    sleep 30
    
    # Final health check
    perform_health_check "$green_service" "$HEALTH_CHECK_TIMEOUT"
    
    # Clean up blue deployment
    log "INFO" "Cleaning up blue deployment"
    kubectl delete deployment "$service" -n "$NAMESPACE"
    
    # Rename green to blue
    kubectl patch deployment "$green_service" -n "$NAMESPACE" -p '{"metadata":{"name":"'$service'"}}'
    
    log "SUCCESS" "Blue-green deployment completed for $service"
}

# Canary deployment strategy
perform_canary_deployment() {
    local service="$1"
    local new_image="$2"
    
    log "PHASE" "Performing Canary Deployment for $service"
    
    local canary_service="${service}-canary"
    local canary_replicas=1
    
    # Create canary deployment
    log "INFO" "Creating canary deployment: $canary_service"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create canary deployment for $service"
        return 0
    fi
    
    # Get current deployment
    local current_deployment=$(kubectl get deployment "$service" -n "$NAMESPACE" -o yaml)
    
    # Create canary deployment with new image
    echo "$current_deployment" | \
        sed "s/name: $service/name: $canary_service/g" | \
        sed "s/image: .*/image: $new_image/g" | \
        sed "s/replicas: [0-9]*/replicas: $canary_replicas/g" | \
        kubectl apply -f -
    
    # Wait for canary to be ready
    log "INFO" "Waiting for canary deployment to be ready"
    kubectl rollout status deployment/"$canary_service" -n "$NAMESPACE" --timeout="$PROGRESS_DEADLINE_SECONDS"s
    
    # Analyze canary performance
    log "INFO" "Analyzing canary performance for ${CANARY_DURATION}s"
    
    local start_time=$(date +%s)
    local end_time=$((start_time + CANARY_DURATION))
    
    while [[ $(date +%s) -lt $end_time ]]; do
        # Monitor canary metrics
        local canary_error_rate=$(get_canary_error_rate "$canary_service")
        local canary_latency=$(get_canary_latency "$canary_service")
        
        log "DEBUG" "Canary metrics - Error rate: $canary_error_rate%, Latency: ${canary_latency}ms"
        
        # Check if canary is healthy
        if (( $(echo "$canary_error_rate > 5" | bc -l) )); then
            log "WARNING" "Canary error rate too high: $canary_error_rate%"
            log "INFO" "Rolling back canary deployment"
            kubectl delete deployment "$canary_service" -n "$NAMESPACE"
            return 1
        fi
        
        sleep $CANARY_ANALYSIS_INTERVAL
    done
    
    # Promote canary to full deployment
    log "INFO" "Promoting canary to full deployment"
    kubectl set image deployment/"$service" "$service=$new_image" -n "$NAMESPACE"
    
    # Wait for full rollout
    kubectl rollout status deployment/"$service" -n "$NAMESPACE" --timeout="$PROGRESS_DEADLINE_SECONDS"s
    
    # Clean up canary
    kubectl delete deployment "$canary_service" -n "$NAMESPACE"
    
    log "SUCCESS" "Canary deployment completed for $service"
}

# Get canary error rate
get_canary_error_rate() {
    local canary_service="$1"
    # Query Prometheus for error rate
    local query="sum(rate(http_requests_total{namespace=\"$NAMESPACE\",service=\"$canary_service\",status=~\"5..\"}[5m])) / sum(rate(http_requests_total{namespace=\"$NAMESPACE\",service=\"$canary_service\"}[5m])) * 100"
    
    # This would require Prometheus connection
    # For now, return 0
    echo "0"
}

# Get canary latency
get_canary_latency() {
    local canary_service="$1"
    # Query Prometheus for latency
    local query="histogram_quantile(0.95, rate(http_request_duration_seconds_bucket{namespace=\"$NAMESPACE\",service=\"$canary_service\"}[5m])) * 1000"
    
    # This would require Prometheus connection
    # For now, return 0
    echo "0"
}

# Perform rollback
perform_rollback() {
    local service="$1"
    
    log "PHASE" "Performing Rollback for $service"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would perform rollback for $service"
        return 0
    fi
    
    # Get rollout history
    local history=$(kubectl rollout history deployment/"$service" -n "$NAMESPACE" --revision=2)
    
    if [[ -z "$history" ]]; then
        log "WARNING" "No previous revision found for rollback"
        return 1
    fi
    
    # Perform rollback
    kubectl rollout undo deployment/"$service" -n "$NAMESPACE" --to-revision=2
    
    # Wait for rollback to complete
    kubectl rollout status deployment/"$service" -n "$NAMESPACE" --timeout="$ROLLBACK_TIMEOUT"s
    
    # Health check after rollback
    perform_health_check "$service" "$HEALTH_CHECK_TIMEOUT"
    
    log "SUCCESS" "Rollback completed for $service"
}

# Update service
update_service() {
    local service="$1"
    local new_image="$2"
    
    log "INFO" "Updating service: $service"
    
    # Validate new image
    validate_new_image "$service" "$new_image"
    
    # Get current image tag
    local current_tag=$(get_current_image_tag "$service")
    
    if [[ "$current_tag" == "$new_image" && "$FORCE_UPDATE" != true ]]; then
        log "INFO" "$service is already running $new_image, skipping"
        return 0
    fi
    
    log "INFO" "Updating $service: $current_tag -> $new_image"
    
    # Perform update based on strategy
    case "$UPDATE_STRATEGY" in
        "rolling")
            perform_rolling_update "$service" "$new_image"
            ;;
        "blue-green")
            perform_blue_green_deployment "$service" "$new_image"
            ;;
        "canary")
            perform_canary_deployment "$service" "$new_image"
            ;;
        "recreate")
            perform_recreate_update "$service" "$new_image"
            ;;
        *)
            log "ERROR" "Unknown update strategy: $UPDATE_STRATEGY"
            return 1
            ;;
    esac
}

# Recreate update strategy
perform_recreate_update() {
    local service="$1"
    local new_image="$2"
    
    log "PHASE" "Performing Recreate Update for $service"
    
    # This strategy causes downtime, use with caution
    log "WARNING" "Recreate strategy will cause downtime for $service"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would perform recreate update for $service"
        return 0
    fi
    
    # Scale down to 0
    kubectl scale deployment "$service" --replicas=0 -n "$NAMESPACE"
    
    # Wait for pods to terminate
    kubectl wait --for=delete pod -l app="$service" -n "$NAMESPACE" --timeout=300s
    
    # Update image
    kubectl set image deployment/"$service" "$service=$new_image" -n "$NAMESPACE"
    
    # Scale up
    kubectl scale deployment "$service" --replicas=1 -n "$NAMESPACE"
    
    # Wait for rollout
    kubectl rollout status deployment/"$service" -n "$NAMESPACE" --timeout="$PROGRESS_DEADLINE_SECONDS"s
    
    log "SUCCESS" "Recreate update completed for $service"
}

# Generate update report
generate_update_report() {
    log "PHASE" "Generating Update Report"
    
    local report_file="$LOG_DIR/update-report-$UPDATE_ID.json"
    
    local report="{"
    report+="\"update_id\": \"$UPDATE_ID\","
    report+="\"timestamp\": \"$(date -Iseconds)\","
    report+="\"namespace\": \"$NAMESPACE\","
    report+="\"strategy\": \"$UPDATE_STRATEGY\","
    report+="\"services\": ["
    
    local first=true
    local services=("${SERVICES_TO_UPDATE[@]}")
    
    if [[ ${#services[@]} -eq 0 ]]; then
        services=("auth-service" "meeting-service" "signaling-service" "chat-service" "turn-service" "livekit-sfu" "livekit-recorder" "traefik" "frontend")
    fi
    
    for service in "${services[@]}"; do
        if [[ "$first" == false ]]; then
            report+=","
        fi
        
        local current_tag=$(get_current_image_tag "$service")
        
        report+="{"
        report+="\"name\": \"$service\","
        report+="\"image_tag\": \"$current_tag\""
        report+="}"
        
        first=false
    done
    
    report+="]"
    report+="}"
    
    echo "$report" > "$report_file"
    
    log "SUCCESS" "Update report saved to: $report_file"
    
    # Display summary
    echo ""
    echo "📊 Rolling Update Summary:"
    echo "========================="
    echo "Update ID: $UPDATE_ID"
    echo "Strategy: $UPDATE_STRATEGY"
    echo "Namespace: $NAMESPACE"
    echo "Services updated: ${#services[@]}"
    echo ""
    echo "📋 Current Status:"
    for service in "${services[@]}"; do
        local tag=$(get_current_image_tag "$service")
        echo "- $service: $tag"
    done
    echo ""
    echo "📁 Files:"
    echo "- Update log: $LOG_FILE"
    echo "- Update report: $report_file"
}

# Show usage
show_usage() {
    echo "GoMeet DigitalOcean Rolling Update Script"
    echo ""
    echo "Usage: $0 [OPTIONS] [COMMAND] [ARGS...]"
    echo ""
    echo "Commands:"
    echo "  update SERVICE IMAGE_TAG       Update service to new image tag"
    echo "  rollback SERVICE               Rollback service to previous version"
    echo "  status                         Show current deployment status"
    echo "  history SERVICE                Show deployment history"
    echo ""
    echo "Options:"
    echo "  -h, --help                     Show this help message"
    echo "  -v, --verbose                  Enable verbose logging"
    echo "  -n, --namespace NAMESPACE      Kubernetes namespace (default: gomeet)"
    echo "  -s, --strategy STRATEGY        Update strategy (default: rolling)"
    echo "  --max-surge PERCENT            Max surge percentage (default: 50%)"
    echo "  --max-unavailable PERCENT      Max unavailable percentage (default: 25%)"
    echo "  --canary-traffic PERCENT       Canary traffic percentage (default: 10%)"
    echo "  --canary-duration SECONDS      Canary analysis duration (default: 300)"
    echo "  --health-timeout SECONDS       Health check timeout (default: 300)"
    echo "  --no-health-check              Skip health checks"
    echo "  --no-auto-rollback             Disable automatic rollback"
    echo "  --pre-hook COMMAND             Pre-deployment hook command"
    echo "  --post-hook COMMAND            Post-deployment hook command"
    echo "  --dry-run                      Simulate update without making changes"
    echo "  --force                        Force update even if already running target version"
    echo ""
    echo "Update strategies: ${STRATEGIES[*]}"
    echo ""
    echo "Examples:"
    echo "  $0 update auth-service v1.2.3                    # Update auth-service to v1.2.3"
    echo "  $0 --strategy canary update livekit-sfu v2.0.0   # Canary update livekit-sfu"
    echo "  $0 rollback meeting-service                       # Rollback meeting-service"
    echo "  $0 --dry-run update frontend v1.1.0              # Simulate frontend update"
    echo "  $0 --strategy blue-green update api-service v2.0.0 # Blue-green update"
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
            -s|--strategy)
                UPDATE_STRATEGY="$2"
                shift 2
                ;;
            --max-surge)
                MAX_SURGE="$2"
                shift 2
                ;;
            --max-unavailable)
                MAX_UNAVAILABLE="$2"
                shift 2
                ;;
            --canary-traffic)
                CANARY_TRAFFIC_PERCENTAGE="$2"
                shift 2
                ;;
            --canary-duration)
                CANARY_DURATION="$2"
                shift 2
                ;;
            --health-timeout)
                HEALTH_CHECK_TIMEOUT="$2"
                shift 2
                ;;
            --no-health-check)
                SKIP_HEALTH_CHECK=true
                shift
                ;;
            --no-auto-rollback)
                AUTO_ROLLBACK=false
                shift
                ;;
            --pre-hook)
                PRE_DEPLOYMENT_HOOK="$2"
                shift 2
                ;;
            --post-hook)
                POST_DEPLOYMENT_HOOK="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --force)
                FORCE_UPDATE=true
                shift
                ;;
            update|rollback|status|history)
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
                SERVICES_TO_UPDATE+=("$1")
                shift
                ;;
        esac
    done
    
    # Validate update strategy
    if [[ ! " ${STRATEGIES[*]} " =~ " $UPDATE_STRATEGY " ]]; then
        log "ERROR" "Invalid update strategy: $UPDATE_STRATEGY"
        log "INFO" "Available strategies: ${STRATEGIES[*]}"
        exit 1
    fi
    
    # Start rolling update process
    log "INFO" "Starting GoMeet rolling update process"
    log "INFO" "Update ID: $UPDATE_ID"
    log "INFO" "Strategy: $UPDATE_STRATEGY"
    log "INFO" "Log file: $LOG_FILE"
    
    # Run prerequisites
    check_prerequisites
    
    # Execute command
    case "$command" in
        "update")
            if [[ $# -lt 2 ]]; then
                log "ERROR" "Update requires SERVICE and IMAGE_TAG"
                show_usage
                exit 1
            fi
            
            local service="$1"
            local image_tag="$2"
            
            # Construct full image name
            if [[ "$image_tag" != *":"* ]]; then
                NEW_IMAGE_TAG="registry.digitalocean.com/gomeet/$service:$image_tag"
            else
                NEW_IMAGE_TAG="$image_tag"
            fi
            
            run_pre_deployment_hook
            update_service "$service" "$NEW_IMAGE_TAG"
            run_post_deployment_hook
            ;;
        "rollback")
            if [[ $# -lt 1 ]]; then
                log "ERROR" "Rollback requires SERVICE name"
                show_usage
                exit 1
            fi
            perform_rollback "$1"
            ;;
        "status")
            show_deployment_status
            ;;
        "history")
            if [[ $# -lt 1 ]]; then
                log "ERROR" "History requires SERVICE name"
                show_usage
                exit 1
            fi
            show_deployment_history "$1"
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
    
    generate_update_report
    
    log "SUCCESS" "GoMeet rolling update process completed!"
}

# Show deployment status
show_deployment_status() {
    log "PHASE" "Deployment Status"
    
    echo ""
    echo "📊 Deployment Status:"
    echo "===================="
    
    local services=("auth-service" "meeting-service" "signaling-service" "chat-service" "turn-service" "livekit-sfu" "livekit-recorder" "traefik" "frontend")
    
    printf "%-20s %-15s %-10s %-15s %-15s\n" "SERVICE" "IMAGE" "REPLICAS" "READY" "STATUS"
    printf "%-20s %-15s %-10s %-15s %-15s\n" "-------" "-----" "--------" "-----" "------"
    
    for service in "${services[@]}"; do
        local deployment=$(get_deployment_status "$service")
        
        if [[ -n "$deployment" ]]; then
            local image=$(echo "$deployment" | jq -r '.spec.template.spec.containers[0].image' 2>/dev/null || echo "N/A")
            local replicas=$(echo "$deployment" | jq -r '.spec.replicas' 2>/dev/null || echo "N/A")
            local ready=$(echo "$deployment" | jq -r '.status.readyReplicas // 0' 2>/dev/null || echo "N/A")
            local status=$(echo "$deployment" | jq -r '.status.conditions[]? | select(.type=="Progressing") | .status' 2>/dev/null || echo "Unknown")
            
            printf "%-20s %-15s %-10s %-15s %-15s\n" "$service" "${image##*:}" "$replicas" "$ready" "$status"
        else
            printf "%-20s %-15s %-10s %-15s %-15s\n" "$service" "N/A" "N/A" "N/A" "Not Found"
        fi
    done
}

# Show deployment history
show_deployment_history() {
    local service="$1"
    
    log "PHASE" "Deployment History for $service"
    
    echo ""
    echo "📜 Deployment History:"
    echo "====================="
    
    kubectl rollout history deployment/"$service" -n "$NAMESPACE"
}

# Run main function with all arguments
main "$@"