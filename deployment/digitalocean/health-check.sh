#!/bin/bash

# GoMeet DigitalOcean Health Check Script
# Script untuk comprehensive health monitoring dan troubleshooting
# Support service health checks, dependency checks, dan performance monitoring

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
LOG_DIR="/tmp/gomeet-health-checks"
LOG_FILE="$LOG_DIR/health-check-$(date +%Y%m%d-%H%M%S).log"
CHECK_ID="health-$(date +%Y%m%d-%H%M%S)"

# Health check configuration
CHECK_SERVICES=true
CHECK_DATABASES=true
CHECK_REDIS=true
CHECK_LOAD_BALANCER=true
CHECK_INGRESS=true
CHECK_CERTIFICATES=true
CHECK_RESOURCES=true
CHECK_PERFORMANCE=true
CHECK_SECURITY=true
CHECK_CONNECTIVITY=true

# Thresholds
CPU_WARNING_THRESHOLD=70
CPU_CRITICAL_THRESHOLD=90
MEMORY_WARNING_THRESHOLD=80
MEMORY_CRITICAL_THRESHOLD=95
DISK_WARNING_THRESHOLD=80
DISK_CRITICAL_THRESHOLD=90
LATENCY_WARNING_THRESHOLD=500  # ms
LATENCY_CRITICAL_THRESHOLD=1000  # ms
ERROR_RATE_WARNING_THRESHOLD=5  # %
ERROR_RATE_CRITICAL_THRESHOLD=10  # %

# Timeout configurations
CONNECTIVITY_TIMEOUT=10
HTTP_TIMEOUT=30
DB_TIMEOUT=10
REDIS_TIMEOUT=5

# Global variables
VERBOSE=false
OUTPUT_FORMAT="table"  # table, json, yaml
SERVICES_TO_CHECK=()
SKIP_DEPENDENCIES=false
PERFORMANCE_MODE=false
CONTINUOUS_MODE=false
CONTINUOUS_INTERVAL=60
ALERT_WEBHOOK_URL=""
SLACK_WEBHOOK_URL=""
DRY_RUN=false

# Health status
declare -A HEALTH_STATUS
OVERALL_HEALTH="healthy"

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
        "CRITICAL") echo -e "${RED}[$timestamp] CRITICAL:${NC} $message" | tee -a "$LOG_FILE" ;;
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
    
    log "ERROR" "Health check operation failed at line $line_number with exit code $exit_code"
    log "ERROR" "Check logs: $LOG_FILE"
    
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Prerequisites check
check_prerequisites() {
    log "PHASE" "Checking Prerequisites"
    
    # Check required tools
    local tools=("kubectl" "jq" "curl" "nslookup" "dig")
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

# Initialize health status
initialize_health_status() {
    local services=("${SERVICES_TO_CHECK[@]}")
    
    if [[ ${#services[@]} -eq 0 ]]; then
        services=("auth-service" "meeting-service" "signaling-service" "chat-service" "turn-service" "livekit-sfu" "livekit-recorder" "traefik" "frontend" "pgbouncer" "prometheus" "grafana")
    fi
    
    for service in "${services[@]}"; do
        HEALTH_STATUS["$service"]="unknown"
    done
    
    # Add system components
    HEALTH_STATUS["postgresql"]="unknown"
    HEALTH_STATUS["redis"]="unknown"
    HEALTH_STATUS["load-balancer"]="unknown"
    HEALTH_STATUS["ingress"]="unknown"
    HEALTH_STATUS["certificates"]="unknown"
    HEALTH_STATUS["resources"]="unknown"
}

# Check service health
check_service_health() {
    local service="$1"
    
    log "DEBUG" "Checking health for service: $service"
    
    # Check if deployment exists
    if ! kubectl get deployment "$service" -n "$NAMESPACE" &> /dev/null; then
        log "WARNING" "Deployment $service not found"
        HEALTH_STATUS["$service"]="not_found"
        return 1
    fi
    
    # Get deployment status
    local deployment_status=$(kubectl get deployment "$service" -n "$NAMESPACE" -o json)
    
    # Check replicas
    local desired_replicas=$(echo "$deployment_status" | jq -r '.spec.replicas // 0')
    local ready_replicas=$(echo "$deployment_status" | jq -r '.status.readyReplicas // 0')
    local available_replicas=$(echo "$deployment_status" | jq -r '.status.availableReplicas // 0')
    
    log "DEBUG" "$service replicas - Desired: $desired_replicas, Ready: $ready_replicas, Available: $available_replicas"
    
    if [[ "$desired_replicas" -eq 0 ]]; then
        log "WARNING" "$service has 0 desired replicas"
        HEALTH_STATUS["$service"]="warning"
        return 1
    fi
    
    if [[ "$ready_replicas" -ne "$desired_replicas" ]]; then
        log "WARNING" "$service has insufficient ready replicas ($ready_replicas/$desired_replicas)"
        HEALTH_STATUS["$service"]="unhealthy"
        return 1
    fi
    
    # Check deployment conditions
    local progressing_status=$(echo "$deployment_status" | jq -r '.status.conditions[]? | select(.type=="Progressing") | .status // "False"')
    local available_status=$(echo "$deployment_status" | jq -r '.status.conditions[]? | select(.type=="Available") | .status // "False"')
    
    if [[ "$progressing_status" != "True" || "$available_status" != "True" ]]; then
        log "WARNING" "$service deployment conditions not met"
        HEALTH_STATUS["$service"]="unhealthy"
        return 1
    fi
    
    # Check pod health
    local unhealthy_pods=$(kubectl get pods -n "$NAMESPACE" -l app="$service" --field-selector=status.phase!=Running --no-headers | wc -l)
    
    if [[ "$unhealthy_pods" -gt 0 ]]; then
        log "WARNING" "$service has $unhealthy_pods unhealthy pods"
        HEALTH_STATUS["$service"]="unhealthy"
        return 1
    fi
    
    # Check container health
    local restarting_containers=$(kubectl get pods -n "$NAMESPACE" -l app="$service" -o jsonpath='{.items[*].status.containerStatuses[*].restartCount}' | tr ' ' '\n' | awk '{sum+=$1} END {print sum}')
    
    if [[ "$restarting_containers" -gt 5 ]]; then
        log "WARNING" "$service containers are restarting frequently (total restarts: $restarting_containers)"
        HEALTH_STATUS["$service"]="unhealthy"
        return 1
    fi
    
    # HTTP health check if service has HTTP endpoint
    check_service_http_health "$service"
    
    HEALTH_STATUS["$service"]="healthy"
    log "DEBUG" "$service is healthy"
    return 0
}

# Check service HTTP health
check_service_http_health() {
    local service="$1"
    
    # Get service URL
    local service_url=$(get_service_url "$service")
    
    if [[ -z "$service_url" ]]; then
        log "DEBUG" "$service has no HTTP endpoint to check"
        return 0
    fi
    
    log "DEBUG" "Checking HTTP health for $service at $service_url"
    
    # Check HTTP response
    local http_status=$(curl -s -o /dev/null -w "%{http_code}" --max-time "$HTTP_TIMEOUT" "$service_url/health" 2>/dev/null || echo "000")
    local response_time=$(curl -s -o /dev/null -w "%{time_total}" --max-time "$HTTP_TIMEOUT" "$service_url/health" 2>/dev/null || echo "0")
    
    log "DEBUG" "$service HTTP check - Status: $http_status, Response time: ${response_time}s"
    
    if [[ "$http_status" != "200" ]]; then
        log "WARNING" "$service HTTP health check failed (status: $http_status)"
        return 1
    fi
    
    local response_time_ms=$(echo "$response_time * 1000" | bc)
    
    if (( $(echo "$response_time_ms > $LATENCY_CRITICAL_THRESHOLD" | bc -l) )); then
        log "CRITICAL" "$service response time too high: ${response_time_ms}ms"
        HEALTH_STATUS["$service"]="critical"
        return 1
    elif (( $(echo "$response_time_ms > $LATENCY_WARNING_THRESHOLD" | bc -l) )); then
        log "WARNING" "$service response time high: ${response_time_ms}ms"
        HEALTH_STATUS["$service"]="warning"
        return 1
    fi
    
    return 0
}

# Get service URL
get_service_url() {
    local service="$1"
    
    # Check if service has external URL
    local service_type=$(kubectl get service "$service" -n "$NAMESPACE" -o jsonpath='{.spec.type}' 2>/dev/null || echo "")
    
    if [[ "$service_type" == "LoadBalancer" ]]; then
        local lb_ip=$(kubectl get service "$service" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        if [[ -n "$lb_ip" ]]; then
            echo "http://$lb_ip"
            return 0
        fi
    fi
    
    # Check ingress
    local ingress_host=$(kubectl get ingress -n "$NAMESPACE" -l app="$service" -o jsonpath='{.items[0].spec.rules[0].host}' 2>/dev/null || echo "")
    if [[ -n "$ingress_host" ]]; then
        echo "https://$ingress_host"
        return 0
    fi
    
    # Cluster IP service
    local cluster_ip=$(kubectl get service "$service" -n "$NAMESPACE" -o jsonpath='{.spec.clusterIP}' 2>/dev/null || echo "")
    local service_port=$(kubectl get service "$service" -n "$NAMESPACE" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || echo "")
    
    if [[ -n "$cluster_ip" && -n "$service_port" ]]; then
        echo "http://$cluster_ip:$service_port"
        return 0
    fi
    
    return 1
}

# Check database health
check_database_health() {
    log "DEBUG" "Checking PostgreSQL database health"
    
    # Get PostgreSQL pod
    local postgres_pod=$(kubectl get pods -n "$NAMESPACE" -l app=postgres-primary -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -z "$postgres_pod" ]]; then
        log "ERROR" "PostgreSQL primary pod not found"
        HEALTH_STATUS["postgresql"]="critical"
        return 1
    fi
    
    # Port forward to PostgreSQL
    local pf_pid=""
    kubectl port-forward -n "$NAMESPACE" "$postgres_pod" 5432:5432 &
    pf_pid=$!
    
    # Wait for port forward
    sleep 5
    
    # Check database connection
    local db_status="unknown"
    
    if kubectl exec -n "$NAMESPACE" "$postgres_pod" -- psql -U postgres -d gomeet -c "SELECT 1;" &> /dev/null; then
        db_status="healthy"
        log "DEBUG" "PostgreSQL connection successful"
        
        # Check database size
        local db_size=$(kubectl exec -n "$NAMESPACE" "$postgres_pod" -- psql -U postgres -d gomeet -c "SELECT pg_size_pretty(pg_database_size('gomeet'));" -t | tr -d ' ')
        log "DEBUG" "PostgreSQL database size: $db_size"
        
        # Check active connections
        local active_connections=$(kubectl exec -n "$NAMESPACE" "$postgres_pod" -- psql -U postgres -d gomeet -c "SELECT count(*) FROM pg_stat_activity WHERE state = 'active';" -t | tr -d ' ')
        log "DEBUG" "PostgreSQL active connections: $active_connections"
        
    else
        db_status="unhealthy"
        log "ERROR" "PostgreSQL connection failed"
    fi
    
    # Clean up port forward
    kill $pf_pid 2>/dev/null || true
    
    HEALTH_STATUS["postgresql"]="$db_status"
}

# Check Redis health
check_redis_health() {
    log "DEBUG" "Checking Redis health"
    
    # Get Redis pod
    local redis_pod=$(kubectl get pods -n "$NAMESPACE" -l app=redis-primary -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -z "$redis_pod" ]]; then
        log "ERROR" "Redis primary pod not found"
        HEALTH_STATUS["redis"]="critical"
        return 1
    fi
    
    # Check Redis connection
    local redis_status="unknown"
    
    if kubectl exec -n "$NAMESPACE" "$redis_pod" -- redis-cli ping 2>/dev/null | grep -q "PONG"; then
        redis_status="healthy"
        log "DEBUG" "Redis connection successful"
        
        # Check Redis info
        local redis_info=$(kubectl exec -n "$NAMESPACE" "$redis_pod" -- redis-cli info server 2>/dev/null || echo "")
        local redis_version=$(echo "$redis_info" | grep "redis_version:" | cut -d':' -f2 | tr -d '\r')
        local redis_memory=$(kubectl exec -n "$NAMESPACE" "$redis_pod" -- redis-cli info memory 2>/dev/null | grep "used_memory_human:" | cut -d':' -f2 | tr -d '\r')
        local redis_clients=$(kubectl exec -n "$NAMESPACE" "$redis_pod" -- redis-cli info clients 2>/dev/null | grep "connected_clients:" | cut -d':' -f2 | tr -d '\r')
        
        log "DEBUG" "Redis version: $redis_version, Memory: $redis_memory, Clients: $redis_clients"
        
    else
        redis_status="unhealthy"
        log "ERROR" "Redis connection failed"
    fi
    
    HEALTH_STATUS["redis"]="$redis_status"
}

# Check load balancer health
check_load_balancer_health() {
    log "DEBUG" "Checking load balancer health"
    
    # Get external services
    local lb_services=$(kubectl get services -n "$NAMESPACE" --field-selector spec.type=LoadBalancer -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -z "$lb_services" ]]; then
        log "INFO" "No LoadBalancer services found"
        HEALTH_STATUS["load-balancer"]="healthy"
        return 0
    fi
    
    local lb_status="healthy"
    
    for service in $lb_services; do
        local lb_ip=$(kubectl get service "$service" -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")
        
        if [[ -z "$lb_ip" ]]; then
            log "WARNING" "LoadBalancer $service has no external IP"
            lb_status="warning"
            continue
        fi
        
        # Test connectivity to load balancer
        if ! timeout "$CONNECTIVITY_TIMEOUT" bash -c "</dev/tcp/$lb_ip/80" 2>/dev/null; then
            log "WARNING" "Cannot connect to LoadBalancer $service at $lb_ip:80"
            lb_status="unhealthy"
        fi
        
        log "DEBUG" "LoadBalancer $service reachable at $lb_ip"
    done
    
    HEALTH_STATUS["load-balancer"]="$lb_status"
}

# Check ingress health
check_ingress_health() {
    log "DEBUG" "Checking ingress health"
    
    # Check ingress controller
    local ingress_pod=$(kubectl get pods -n "$NAMESPACE" -l app.kubernetes.io/name=traefik -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -z "$ingress_pod" ]]; then
        log "WARNING" "Ingress controller pod not found"
        HEALTH_STATUS["ingress"]="warning"
        return 1
    fi
    
    # Check ingress resources
    local ingress_count=$(kubectl get ingress -n "$NAMESPACE" --no-headers | wc -l)
    log "DEBUG" "Found $ingress_count ingress resources"
    
    if [[ "$ingress_count" -eq 0 ]]; then
        log "INFO" "No ingress resources found"
        HEALTH_STATUS["ingress"]="healthy"
        return 0
    fi
    
    # Check each ingress
    local ingress_status="healthy"
    
    kubectl get ingress -n "$NAMESPACE" -o json | jq -r '.items[] | "\(.metadata.name):\(.status.loadBalancer.ingress[0].ip // "N/A")"' | while IFS=: read -r ingress_name ingress_ip; do
        if [[ "$ingress_ip" == "N/A" ]]; then
            log "WARNING" "Ingress $ingress_name has no external IP"
            ingress_status="warning"
            continue
        fi
        
        log "DEBUG" "Ingress $ingress_name reachable at $ingress_ip"
    done
    
    HEALTH_STATUS["ingress"]="$ingress_status"
}

# Check certificate health
check_certificate_health() {
    log "DEBUG" "Checking certificate health"
    
    # Get TLS secrets
    local tls_secrets=$(kubectl get secrets -n "$NAMESPACE" --field-selector type=kubernetes.io/tls -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -z "$tls_secrets" ]]; then
        log "INFO" "No TLS certificates found"
        HEALTH_STATUS["certificates"]="healthy"
        return 0
    fi
    
    local cert_status="healthy"
    
    for secret in $tls_secrets; do
        # Get certificate expiration
        local cert_data=$(kubectl get secret "$secret" -n "$NAMESPACE" -o jsonpath='{.data.tls\.crt}' | base64 -d)
        local expiration_date=$(echo "$cert_data" | openssl x509 -noout -enddate | cut -d'=' -f2)
        local expiration_epoch=$(date -d "$expiration_date" +%s)
        local current_epoch=$(date +%s)
        local days_until_expiry=$(( (expiration_epoch - current_epoch) / 86400 ))
        
        log "DEBUG" "Certificate $secret expires in $days_until_expiry days"
        
        if [[ $days_until_expiry -lt 7 ]]; then
            log "CRITICAL" "Certificate $secret expires in $days_until_expiry days"
            cert_status="critical"
        elif [[ $days_until_expiry -lt 30 ]]; then
            log "WARNING" "Certificate $secret expires in $days_until_expiry days"
            cert_status="warning"
        fi
    done
    
    HEALTH_STATUS["certificates"]="$cert_status"
}

# Check resource usage
check_resource_usage() {
    log "DEBUG" "Checking resource usage"
    
    local resource_status="healthy"
    
    # Check node resources
    kubectl top nodes --no-headers | while read -r node_name cpu_cores cpu_percent memory_bytes memory_percent; do
        local cpu_num=$(echo "$cpu_percent" | sed 's/%//')
        local mem_num=$(echo "$memory_percent" | sed 's/%//')
        
        log "DEBUG" "Node $node_name - CPU: $cpu_num%, Memory: $mem_num%"
        
        if [[ $cpu_num -gt $CPU_CRITICAL_THRESHOLD ]]; then
            log "CRITICAL" "Node $node_name CPU usage critical: $cpu_num%"
            resource_status="critical"
        elif [[ $cpu_num -gt $CPU_WARNING_THRESHOLD ]]; then
            log "WARNING" "Node $node_name CPU usage high: $cpu_num%"
            resource_status="warning"
        fi
        
        if [[ $mem_num -gt $MEMORY_CRITICAL_THRESHOLD ]]; then
            log "CRITICAL" "Node $node_name memory usage critical: $mem_num%"
            resource_status="critical"
        elif [[ $mem_num -gt $MEMORY_WARNING_THRESHOLD ]]; then
            log "WARNING" "Node $node_name memory usage high: $mem_num%"
            resource_status="warning"
        fi
    done
    
    # Check pod resources
    kubectl top pods -n "$NAMESPACE" --no-headers | while read -r pod_name cpu_cores memory_bytes; do
        # Convert to MB for easier reading
        local memory_mb=$((memory_bytes / 1024 / 1024))
        log "DEBUG" "Pod $pod_name - CPU: $cpu_cores, Memory: ${memory_mb}MB"
    done
    
    # Check persistent volumes
    kubectl get pvc -n "$NAMESPACE" -o json | jq -r '.items[] | "\(.metadata.name):\(.status.capacity.storage // "N/A"):\(.status.conditions[]?.status // "Bound")"' | while IFS=: read -r pvc_name capacity status; do
        log "DEBUG" "PVC $pvc_name - Capacity: $capacity, Status: $status"
        
        if [[ "$status" != "Bound" ]]; then
            log "WARNING" "PVC $pvc_name not bound"
            resource_status="warning"
        fi
    done
    
    HEALTH_STATUS["resources"]="$resource_status"
}

# Check performance metrics
check_performance_metrics() {
    log "DEBUG" "Checking performance metrics"
    
    # Check response times from Prometheus if available
    local prometheus_url="http://prometheus:9090"
    
    if curl -s --max-time 5 "$prometheus_url/-/healthy" &> /dev/null; then
        # Get average response times
        local avg_latency=$(curl -s -G "$prometheus_url/api/v1/query" --data-urlencode 'query=histogram_quantile(0.95, sum(rate(traefik_service_request_duration_seconds_bucket[5m])) by (le))' | jq -r '.data.result[0].value[1] // "0"')
        local error_rate=$(curl -s -G "$prometheus_url/api/v1/query" --data-urlencode 'query=sum(rate(traefik_service_requests_total{code=~"5.."}[5m])) / sum(rate(traefik_service_requests_total[5m])) * 100' | jq -r '.data.result[0].value[1] // "0"')
        
        local latency_ms=$(echo "$avg_latency * 1000" | bc)
        
        log "DEBUG" "Performance - Latency: ${latency_ms}ms, Error rate: ${error_rate}%"
        
        if (( $(echo "$latency_ms > $LATENCY_CRITICAL_THRESHOLD" | bc -l) )); then
            log "CRITICAL" "Response time critical: ${latency_ms}ms"
            HEALTH_STATUS["performance"]="critical"
        elif (( $(echo "$latency_ms > $LATENCY_WARNING_THRESHOLD" | bc -l) )); then
            log "WARNING" "Response time high: ${latency_ms}ms"
            HEALTH_STATUS["performance"]="warning"
        fi
        
        if (( $(echo "$error_rate > $ERROR_RATE_CRITICAL_THRESHOLD" | bc -l) )); then
            log "CRITICAL" "Error rate critical: ${error_rate}%"
            HEALTH_STATUS["performance"]="critical"
        elif (( $(echo "$error_rate > $ERROR_RATE_WARNING_THRESHOLD" | bc -l) )); then
            log "WARNING" "Error rate high: ${error_rate}%"
            HEALTH_STATUS["performance"]="warning"
        fi
    else
        log "DEBUG" "Prometheus not available for performance metrics"
        HEALTH_STATUS["performance"]="healthy"
    fi
}

# Check security
check_security() {
    log "DEBUG" "Checking security configuration"
    
    local security_status="healthy"
    
    # Check for exposed services
    local exposed_services=$(kubectl get services -n "$NAMESPACE" --field-selector spec.type=LoadBalancer -o jsonpath='{.items[*].metadata.name}' 2>/dev/null || echo "")
    
    if [[ -n "$exposed_services" ]]; then
        log "INFO" "Found exposed services: $exposed_services"
        
        for service in $exposed_services; do
            # Check if service has proper annotations
            local annotations=$(kubectl get service "$service" -n "$NAMESPACE" -o jsonpath='{.metadata.annotations}' 2>/dev/null || echo "{}")
            
            if ! echo "$annotations" | grep -q "cloud.google.com/neg"; then
                log "WARNING" "Service $service may not have proper security annotations"
                security_status="warning"
            fi
        done
    fi
    
    # Check network policies
    local network_policies=$(kubectl get networkpolicies -n "$NAMESPACE" --no-headers | wc -l)
    
    if [[ $network_policies -eq 0 ]]; then
        log "WARNING" "No network policies found - traffic not restricted"
        security_status="warning"
    else
        log "DEBUG" "Found $network_policies network policies"
    fi
    
    # Check pod security contexts
    local pods_without_context=$(kubectl get pods -n "$NAMESPACE" -o json | jq '.items[] | select(.spec.securityContext == null) | .metadata.name' | wc -l)
    
    if [[ $pods_without_context -gt 0 ]]; then
        log "WARNING" "$pods_without_context pods without security context"
        security_status="warning"
    fi
    
    HEALTH_STATUS["security"]="$security_status"
}

# Check connectivity
check_connectivity() {
    log "DEBUG" "Checking connectivity between services"
    
    local connectivity_status="healthy"
    
    # Test DNS resolution
    if ! nslookup kubernetes.default.svc.cluster.local &> /dev/null; then
        log "ERROR" "DNS resolution failed"
        connectivity_status="critical"
    fi
    
    # Test inter-service connectivity
    local services=("auth-service" "meeting-service" "signaling-service" "chat-service")
    
    for service in "${services[@]}"; do
        local service_fqdn="$service.$NAMESPACE.svc.cluster.local"
        
        if ! nslookup "$service_fqdn" &> /dev/null; then
            log "ERROR" "Cannot resolve $service_fqdn"
            connectivity_status="critical"
            continue
        fi
        
        log "DEBUG" "DNS resolution successful for $service_fqdn"
    done
    
    # Test external connectivity
    if ! curl -s --max-time "$CONNECTIVITY_TIMEOUT" https://www.google.com > /dev/null; then
        log "WARNING" "External connectivity test failed"
        connectivity_status="warning"
    fi
    
    HEALTH_STATUS["connectivity"]="$connectivity_status"
}

# Calculate overall health
calculate_overall_health() {
    local critical_count=0
    local unhealthy_count=0
    local warning_count=0
    
    for status in "${HEALTH_STATUS[@]}"; do
        case "$status" in
            "critical") ((critical_count++)) ;;
            "unhealthy") ((unhealthy_count++)) ;;
            "warning") ((warning_count++)) ;;
        esac
    done
    
    if [[ $critical_count -gt 0 ]]; then
        OVERALL_HEALTH="critical"
    elif [[ $unhealthy_count -gt 0 ]]; then
        OVERALL_HEALTH="unhealthy"
    elif [[ $warning_count -gt 0 ]]; then
        OVERALL_HEALTH="warning"
    else
        OVERALL_HEALTH="healthy"
    fi
    
    log "INFO" "Overall health: $OVERALL_HEALTH (Critical: $critical_count, Unhealthy: $unhealthy_count, Warning: $warning_count)"
}

# Send alert
send_alert() {
    if [[ -z "$ALERT_WEBHOOK_URL" && -z "$SLACK_WEBHOOK_URL" ]]; then
        return 0
    fi
    
    local alert_message="GoMeet Health Check Alert\nOverall Status: $OVERALL_HEALTH\nTimestamp: $(date)\n\n"
    
    for component in "${!HEALTH_STATUS[@]}"; do
        alert_message+="$component: ${HEALTH_STATUS[$component]}\n"
    done
    
    # Send to Slack
    if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
        local slack_payload=$(cat << EOF
{
    "text": "GoMeet Health Check Alert",
    "attachments": [
        {
            "color": "$([ "$OVERALL_HEALTH" = "healthy" ] && echo "good" || [ "$OVERALL_HEALTH" = "warning" ] && echo "warning" || echo "danger")",
            "fields": [
                {
                    "title": "Overall Status",
                    "value": "$OVERALL_HEALTH",
                    "short": true
                },
                {
                    "title": "Timestamp",
                    "value": "$(date)",
                    "short": true
                }
            ],
            "text": "$(echo -e "$alert_message")"
        }
    ]
}
EOF
)
        
        curl -X POST -H 'Content-type: application/json' --data "$slack_payload" "$SLACK_WEBHOOK_URL" &> /dev/null || true
    fi
    
    # Send to custom webhook
    if [[ -n "$ALERT_WEBHOOK_URL" ]]; then
        curl -X POST -H 'Content-type: application/json' --data "{\"message\": \"$alert_message\"}" "$ALERT_WEBHOOK_URL" &> /dev/null || true
    fi
}

# Generate health report
generate_health_report() {
    log "PHASE" "Generating Health Report"
    
    local report_file="$LOG_DIR/health-report-$CHECK_ID.json"
    
    local report="{"
    report+="\"check_id\": \"$CHECK_ID\","
    report+="\"timestamp\": \"$(date -Iseconds)\","
    report+="\"namespace\": \"$NAMESPACE\","
    report+="\"overall_health\": \"$OVERALL_HEALTH\","
    report+="\"components\": {"
    
    local first=true
    for component in "${!HEALTH_STATUS[@]}"; do
        if [[ "$first" == false ]]; then
            report+=","
        fi
        report+="\"$component\": \"${HEALTH_STATUS[$component]}\""
        first=false
    done
    
    report+="}"
    report+="}"
    
    echo "$report" > "$report_file"
    
    log "SUCCESS" "Health report saved to: $report_file"
    
    # Display summary
    display_health_summary
}

# Display health summary
display_health_summary() {
    echo ""
    echo "🏥 GoMeet Health Check Summary"
    echo "=============================="
    echo "Check ID: $CHECK_ID"
    echo "Overall Health: $OVERALL_HEALTH"
    echo "Timestamp: $(date)"
    echo ""
    
    case "$OUTPUT_FORMAT" in
        "table")
            printf "%-25s %-15s\n" "COMPONENT" "STATUS"
            printf "%-25s %-15s\n" "---------" "------"
            
            for component in "${!HEALTH_STATUS[@]}"; do
                local status="${HEALTH_STATUS[$component]}"
                local color=""
                
                case "$status" in
                    "healthy") color="$GREEN" ;;
                    "warning") color="$YELLOW" ;;
                    "unhealthy") color="$RED" ;;
                    "critical") color="$RED" ;;
                    *) color="$NC" ;;
                esac
                
                printf "%-25s ${color}%-15s${NC}\n" "$component" "$status"
            done
            ;;
        "json")
            echo "$report" | jq .
            ;;
        "yaml")
            echo "$report" | yq eval -P -
            ;;
    esac
    
    echo ""
    echo "📁 Files:"
    echo "- Health check log: $LOG_FILE"
    echo "- Health report: $report_file"
}

# Show usage
show_usage() {
    echo "GoMeet DigitalOcean Health Check Script"
    echo ""
    echo "Usage: $0 [OPTIONS] [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  check                          Run comprehensive health check"
    echo "  services                       Check service health only"
    echo "  databases                      Check database health only"
    echo "  resources                      Check resource usage only"
    echo "  performance                    Check performance metrics only"
    echo "  security                       Check security configuration only"
    echo "  continuous                     Run continuous monitoring"
    echo ""
    echo "Options:"
    echo "  -h, --help                     Show this help message"
    echo "  -v, --verbose                  Enable verbose logging"
    echo "  -n, --namespace NAMESPACE      Kubernetes namespace (default: gomeet)"
    echo "  -f, --format FORMAT            Output format (table, json, yaml) (default: table)"
    echo "  -s, --services SERVICES        Comma-separated list of services to check"
    echo "  --skip-dependencies            Skip dependency checks"
    echo "  --performance                  Enable performance mode"
    echo "  --continuous INTERVAL          Run continuous monitoring (interval in seconds)"
    echo "  --alert-webhook URL            Send alerts to webhook URL"
    echo "  --slack-webhook URL            Send alerts to Slack webhook"
    echo "  --dry-run                      Show what would be checked without executing"
    echo "  --cpu-warning THRESHOLD        CPU warning threshold (default: 70)"
    echo "  --cpu-critical THRESHOLD       CPU critical threshold (default: 90)"
    echo "  --memory-warning THRESHOLD     Memory warning threshold (default: 80)"
    echo "  --memory-critical THRESHOLD    Memory critical threshold (default: 95)"
    echo "  --latency-warning THRESHOLD    Latency warning threshold in ms (default: 500)"
    echo "  --latency-critical THRESHOLD   Latency critical threshold in ms (default: 1000)"
    echo ""
    echo "Examples:"
    echo "  $0 check                                    # Run comprehensive health check"
    echo "  $0 --format json check                     # Output health check in JSON format"
    echo "  $0 --services auth-service,meeting-service check # Check specific services"
    echo "  $0 --continuous 60 check                   # Run continuous monitoring every 60s"
    echo "  $0 --slack-webhook https://hooks.slack.com/... check # Send alerts to Slack"
    echo "  $0 --dry-run check                         # Show what would be checked"
}

# Main execution function
main() {
    local command="check"
    
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
            -f|--format)
                OUTPUT_FORMAT="$2"
                shift 2
                ;;
            -s|--services)
                IFS=',' read -ra SERVICES_TO_CHECK <<< "$2"
                shift 2
                ;;
            --skip-dependencies)
                SKIP_DEPENDENCIES=true
                shift
                ;;
            --performance)
                PERFORMANCE_MODE=true
                shift
                ;;
            --continuous)
                CONTINUOUS_MODE=true
                CONTINUOUS_INTERVAL="$2"
                shift 2
                ;;
            --alert-webhook)
                ALERT_WEBHOOK_URL="$2"
                shift 2
                ;;
            --slack-webhook)
                SLACK_WEBHOOK_URL="$2"
                shift 2
                ;;
            --cpu-warning)
                CPU_WARNING_THRESHOLD="$2"
                shift 2
                ;;
            --cpu-critical)
                CPU_CRITICAL_THRESHOLD="$2"
                shift 2
                ;;
            --memory-warning)
                MEMORY_WARNING_THRESHOLD="$2"
                shift 2
                ;;
            --memory-critical)
                MEMORY_CRITICAL_THRESHOLD="$2"
                shift 2
                ;;
            --latency-warning)
                LATENCY_WARNING_THRESHOLD="$2"
                shift 2
                ;;
            --latency-critical)
                LATENCY_CRITICAL_THRESHOLD="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            check|services|databases|resources|performance|security|continuous)
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
                SERVICES_TO_CHECK+=("$1")
                shift
                ;;
        esac
    done
    
    # Validate output format
    if [[ ! "table json yaml" =~ "$OUTPUT_FORMAT" ]]; then
        log "ERROR" "Invalid output format: $OUTPUT_FORMAT"
        exit 1
    fi
    
    # Start health check process
    log "INFO" "Starting GoMeet health check process"
    log "INFO" "Check ID: $CHECK_ID"
    log "INFO" "Log file: $LOG_FILE"
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "DRY RUN MODE: No actual checks will be performed"
        log "INFO" "This will show what would be checked without executing"
    fi
    
    # Run prerequisites (skip in dry run mode)
    if [[ "$DRY_RUN" != true ]]; then
        check_prerequisites
    fi
    initialize_health_status
    
    # Continuous mode loop
    if [[ "$CONTINUOUS_MODE" == true ]]; then
        log "INFO" "Starting continuous monitoring (interval: ${CONTINUOUS_INTERVAL}s)"
        
        while true; do
            run_health_checks "$command"
            generate_health_report
            send_alert
            
            log "INFO" "Waiting ${CONTINUOUS_INTERVAL}s for next check..."
            sleep "$CONTINUOUS_INTERVAL"
        done
    else
        # Single run
        run_health_checks "$command"
        generate_health_report
        send_alert
    fi
    
    log "SUCCESS" "GoMeet health check process completed!"
}

# Run health checks based on command
run_health_checks() {
    local command="$1"
    
    case "$command" in
        "check")
            if [[ "$CHECK_SERVICES" == true ]]; then
                log "PHASE" "Checking Services"
                local services=("${SERVICES_TO_CHECK[@]}")
                if [[ ${#services[@]} -eq 0 ]]; then
                    services=("auth-service" "meeting-service" "signaling-service" "chat-service" "turn-service" "livekit-sfu" "livekit-recorder" "traefik" "frontend" "pgbouncer" "prometheus" "grafana")
                fi
                
                local total=${#services[@]}
                local current=0
                
                if [[ "$DRY_RUN" == true ]]; then
                    log "INFO" "DRY RUN: Would check the following services:"
                    for service in "${services[@]}"; do
                        log "INFO" "  - $service"
                    done
                else
                    for service in "${services[@]}"; do
                        ((current++))
                        show_progress $current $total "Checking $service"
                        check_service_health "$service"
                    done
                fi
            fi
            
            if [[ "$SKIP_DEPENDENCIES" != true ]]; then
                if [[ "$DRY_RUN" == true ]]; then
                    log "INFO" "DRY RUN: Would check dependencies:"
                    [[ "$CHECK_DATABASES" == true ]] && log "INFO" "  - PostgreSQL database health"
                    [[ "$CHECK_REDIS" == true ]] && log "INFO" "  - Redis health"
                    [[ "$CHECK_LOAD_BALANCER" == true ]] && log "INFO" "  - Load balancer health"
                    [[ "$CHECK_INGRESS" == true ]] && log "INFO" "  - Ingress health"
                    [[ "$CHECK_CERTIFICATES" == true ]] && log "INFO" "  - Certificate health"
                else
                    [[ "$CHECK_DATABASES" == true ]] && check_database_health
                    [[ "$CHECK_REDIS" == true ]] && check_redis_health
                    [[ "$CHECK_LOAD_BALANCER" == true ]] && check_load_balancer_health
                    [[ "$CHECK_INGRESS" == true ]] && check_ingress_health
                    [[ "$CHECK_CERTIFICATES" == true ]] && check_certificate_health
                fi
            fi
            
            if [[ "$DRY_RUN" == true ]]; then
                log "INFO" "DRY RUN: Would check:"
                [[ "$CHECK_RESOURCES" == true ]] && log "INFO" "  - Resource usage"
                [[ "$CHECK_PERFORMANCE" == true ]] && log "INFO" "  - Performance metrics"
                [[ "$CHECK_SECURITY" == true ]] && log "INFO" "  - Security configuration"
                [[ "$CHECK_CONNECTIVITY" == true ]] && log "INFO" "  - Connectivity"
            else
                [[ "$CHECK_RESOURCES" == true ]] && check_resource_usage
                [[ "$CHECK_PERFORMANCE" == true ]] && check_performance_metrics
                [[ "$CHECK_SECURITY" == true ]] && check_security
                [[ "$CHECK_CONNECTIVITY" == true ]] && check_connectivity
            fi
            ;;
        "services")
            log "PHASE" "Checking Services Only"
            local services=("${SERVICES_TO_CHECK[@]}")
            if [[ ${#services[@]} -eq 0 ]]; then
                services=("auth-service" "meeting-service" "signaling-service" "chat-service" "turn-service" "livekit-sfu" "livekit-recorder" "traefik" "frontend")
            fi
            
            if [[ "$DRY_RUN" == true ]]; then
                log "INFO" "DRY RUN: Would check the following services:"
                for service in "${services[@]}"; do
                    log "INFO" "  - $service"
                done
            else
                for service in "${services[@]}"; do
                    check_service_health "$service"
                done
            fi
            ;;
        "databases")
            log "PHASE" "Checking Databases Only"
            if [[ "$DRY_RUN" == true ]]; then
                log "INFO" "DRY RUN: Would check:"
                log "INFO" "  - PostgreSQL database health"
                log "INFO" "  - Redis health"
            else
                check_database_health
                check_redis_health
            fi
            ;;
        "resources")
            log "PHASE" "Checking Resources Only"
            if [[ "$DRY_RUN" == true ]]; then
                log "INFO" "DRY RUN: Would check resource usage"
            else
                check_resource_usage
            fi
            ;;
        "performance")
            log "PHASE" "Checking Performance Only"
            if [[ "$DRY_RUN" == true ]]; then
                log "INFO" "DRY RUN: Would check performance metrics"
            else
                check_performance_metrics
            fi
            ;;
        "security")
            log "PHASE" "Checking Security Only"
            if [[ "$DRY_RUN" == true ]]; then
                log "INFO" "DRY RUN: Would check security configuration"
            else
                check_security
            fi
            ;;
        *)
            log "ERROR" "Unknown command: $command"
            exit 1
            ;;
    esac
    
    calculate_overall_health
}

# Run main function with all arguments
main "$@"