#!/bin/bash

# GoMeet DigitalOcean Auto-Scaling Script
# Script untuk auto-scaling services berdasarkan load dan metrics
# Support manual scaling, scheduled scaling, dan event-based scaling

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
LOG_DIR="/tmp/gomeet-scaling"
LOG_FILE="$LOG_DIR/scale-$(date +%Y%m%d-%H%M%S).log"
SCALING_ID="scale-$(date +%Y%m%d-%H%M%S)"

# Default scaling configurations
declare -A SCALING_CONFIGS=(
    ["auth-service"]="min=8,max=20,cpu=70,memory=80,requests=100"
    ["meeting-service"]="min=12,max=30,cpu=70,memory=80,meetings=50"
    ["signaling-service"]="min=25,max=60,cpu=70,memory=80,connections=5000,webrtc=2000"
    ["chat-service"]="min=10,max=25,cpu=70,memory=80,messages=200"
    ["turn-service"]="min=8,max=20,cpu=70,memory=80,sessions=1000"
    ["livekit-sfu"]="min=15,max=100,cpu=70,memory=80,participants=400,bandwidth=1000"
    ["livekit-recorder"]="min=3,max=10,cpu=70,memory=80,recordings=50"
    ["traefik"]="min=6,max=15,cpu=70,memory=80,requests=10000,latency=100"
    ["frontend"]="min=6,max=20,cpu=70,memory=80,requests=500"
    ["pgbouncer"]="min=6,max=15,cpu=70,memory=80,connections=3000"
    ["prometheus"]="min=2,max=4,cpu=70,memory=80,samples=1000000"
    ["grafana"]="min=3,max=6,cpu=70,memory=80,requests=100"
)

# Scaling modes
SCALING_MODE="auto"
MODES=("manual" "auto" "scheduled" "event-based")

# Thresholds
CPU_SCALE_UP_THRESHOLD=80
CPU_SCALE_DOWN_THRESHOLD=30
MEMORY_SCALE_UP_THRESHOLD=85
MEMORY_SCALE_DOWN_THRESHOLD=40
CUSTOM_METRICS_SCALE_UP_THRESHOLD=90
CUSTOM_METRICS_SCALE_DOWN_THRESHOLD=20

# Timing
SCALE_UP_COOLDOWN=300  # 5 minutes
SCALE_DOWN_COOLDOWN=600  # 10 minutes
CHECK_INTERVAL=60
MAX_SCALE_UP_PERCENT=100  # Double the replicas
MAX_SCALE_DOWN_PERCENT=50  # Half the replicas

# Global variables
VERBOSE=false
DRY_RUN=false
FORCE_SCALE=false
SERVICES_TO_SCALE=()
CUSTOM_CONFIG_FILE=""
PROMETHEUS_URL="http://prometheus:9090"
KEDA_ENABLED=false
CLUSTER_AUTOSCALER_ENABLED=false

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
    
    log "ERROR" "Scaling operation failed at line $line_number with exit code $exit_code"
    log "ERROR" "Check logs: $LOG_FILE"
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

# Load custom configuration
load_custom_config() {
    if [[ -n "$CUSTOM_CONFIG_FILE" && -f "$CUSTOM_CONFIG_FILE" ]]; then
        log "INFO" "Loading custom configuration from $CUSTOM_CONFIG_FILE"
        
        # Source the custom config file
        source "$CUSTOM_CONFIG_FILE"
        
        log "SUCCESS" "Custom configuration loaded"
    fi
}

# Get current replica count
get_current_replicas() {
    local service="$1"
    kubectl get deployment "$service" -n "$NAMESPACE" -o jsonpath='{.spec.replicas}' 2>/dev/null || echo "0"
}

# Get HPA status
get_hpa_status() {
    local service="$1"
    kubectl get hpa "${service}-hpa" -n "$NAMESPACE" -o json 2>/dev/null || echo ""
}

# Get current metrics from Prometheus
get_prometheus_metrics() {
    local query="$1"
    local endpoint="$PROMETHEUS_URL/api/v1/query"
    
    local result=$(curl -s -G "$endpoint" \
        --data-urlencode "query=$query" \
        -H "Accept: application/json" 2>/dev/null || echo "")
    
    echo "$result" | jq -r '.data.result[0].value[1] // "0"' 2>/dev/null || echo "0"
}

# Get CPU usage percentage
get_cpu_usage() {
    local service="$1"
    local query="avg(rate(container_cpu_usage_seconds_total{namespace=\"$NAMESPACE\",pod=~\"$service-.*\"}[5m])) * 100"
    get_prometheus_metrics "$query"
}

# Get memory usage percentage
get_memory_usage() {
    local service="$1"
    local query="avg(container_memory_working_set_bytes{namespace=\"$NAMESPACE\",pod=~\"$service-.*\"}) / avg(container_spec_memory_limit_bytes{namespace=\"$NAMESPACE\",pod=~\"$service-.*\"}) * 100"
    get_prometheus_metrics "$query"
}

# Get custom metrics
get_custom_metric() {
    local service="$1"
    local metric="$2"
    
    case "$metric" in
        "requests")
            local query="sum(rate(http_requests_total{namespace=\"$NAMESPACE\",service=\"$service\"}[5m]))"
            ;;
        "connections")
            local query="sum(gomeet_websocket_connections_total{namespace=\"$NAMESPACE\",service=\"$service\"})"
            ;;
        "participants")
            local query="sum(livekit_participants_total{namespace=\"$NAMESPACE\",service=\"$service\"})"
            ;;
        "bandwidth")
            local query="sum(rate(livekit_bandwidth_bytes_per_second{namespace=\"$NAMESPACE\",service=\"$service\"}[5m]))"
            ;;
        "messages")
            local query="sum(rate(gomeet_chat_messages_rate{namespace=\"$NAMESPACE\",service=\"$service\"}[5m]))"
            ;;
        "sessions")
            local query="sum(gomeet_turn_sessions_total{namespace=\"$NAMESPACE\",service=\"$service\"})"
            ;;
        "meetings")
            local query="sum(gomeet_active_meetings_total{namespace=\"$NAMESPACE\",service=\"$service\"})"
            ;;
        "recordings")
            local query="sum(gomeet_active_recordings_total{namespace=\"$NAMESPACE\",service=\"$service\"})"
            ;;
        "latency")
            local query="histogram_quantile(0.95, rate(traefik_service_requests_duration_seconds_bucket{namespace=\"$NAMESPACE\",service=\"$service\"}[5m])) * 1000"
            ;;
        "samples")
            local query="sum(rate(prometheus_tsdb_head_samples_appended_total{namespace=\"$NAMESPACE\",service=\"$service\"}[5m]))"
            ;;
        *)
            echo "0"
            return
            ;;
    esac
    
    get_prometheus_metrics "$query"
}

# Parse scaling configuration
parse_scaling_config() {
    local service="$1"
    local config="${SCALING_CONFIGS[$service]}"
    
    if [[ -z "$config" ]]; then
        log "WARNING" "No scaling configuration found for $service"
        return 1
    fi
    
    # Parse config into variables
    IFS=',' read -ra CONFIG_PARTS <<< "$config"
    for part in "${CONFIG_PARTS[@]}"; do
        IFS='=' read -ra KEY_VALUE <<< "$part"
        case "${KEY_VALUE[0]}" in
            "min") MIN_REPLICAS="${KEY_VALUE[1]}" ;;
            "max") MAX_REPLICAS="${KEY_VALUE[1]}" ;;
            "cpu") CPU_THRESHOLD="${KEY_VALUE[1]}" ;;
            "memory") MEMORY_THRESHOLD="${KEY_VALUE[1]}" ;;
            "requests") REQUESTS_THRESHOLD="${KEY_VALUE[1]}" ;;
            "connections") CONNECTIONS_THRESHOLD="${KEY_VALUE[1]}" ;;
            "participants") PARTICIPANTS_THRESHOLD="${KEY_VALUE[1]}" ;;
            "bandwidth") BANDWIDTH_THRESHOLD="${KEY_VALUE[1]}" ;;
            "messages") MESSAGES_THRESHOLD="${KEY_VALUE[1]}" ;;
            "sessions") SESSIONS_THRESHOLD="${KEY_VALUE[1]}" ;;
            "meetings") MEETINGS_THRESHOLD="${KEY_VALUE[1]}" ;;
            "recordings") RECORDINGS_THRESHOLD="${KEY_VALUE[1]}" ;;
            "latency") LATENCY_THRESHOLD="${KEY_VALUE[1]}" ;;
            "samples") SAMPLES_THRESHOLD="${KEY_VALUE[1]}" ;;
        esac
    done
}

# Determine scaling action
determine_scaling_action() {
    local service="$1"
    local current_replicas="$2"
    
    parse_scaling_config "$service"
    
    # Get current metrics
    local cpu_usage=$(get_cpu_usage "$service")
    local memory_usage=$(get_memory_usage "$service")
    
    log "DEBUG" "$service metrics - CPU: ${cpu_usage}%, Memory: ${memory_usage}%"
    
    local should_scale_up=false
    local should_scale_down=false
    local reason=""
    
    # Check CPU threshold
    if (( $(echo "$cpu_usage > ${CPU_THRESHOLD:-$CPU_SCALE_UP_THRESHOLD}" | bc -l) )); then
        should_scale_up=true
        reason="CPU usage high (${cpu_usage}% > ${CPU_THRESHOLD:-$CPU_SCALE_UP_THRESHOLD}%)"
    elif (( $(echo "$cpu_usage < ${CPU_SCALE_DOWN_THRESHOLD}" | bc -l) )); then
        should_scale_down=true
        reason="CPU usage low (${cpu_usage}% < $CPU_SCALE_DOWN_THRESHOLD%)"
    fi
    
    # Check memory threshold
    if (( $(echo "$memory_usage > ${MEMORY_THRESHOLD:-$MEMORY_SCALE_UP_THRESHOLD}" | bc -l) )); then
        should_scale_up=true
        reason="Memory usage high (${memory_usage}% > ${MEMORY_THRESHOLD:-$MEMORY_SCALE_UP_THRESHOLD}%)"
    elif [[ "$should_scale_up" == false ]] && (( $(echo "$memory_usage < ${MEMORY_SCALE_DOWN_THRESHOLD}" | bc -l) )); then
        should_scale_down=true
        reason="Memory usage low (${memory_usage}% < $MEMORY_SCALE_DOWN_THRESHOLD%)"
    fi
    
    # Check custom metrics
    local custom_metrics=("requests" "connections" "participants" "bandwidth" "messages" "sessions" "meetings" "recordings" "latency" "samples")
    
    for metric in "${custom_metrics[@]}"; do
        local threshold_var="${metric^^}_THRESHOLD"
        local threshold_value="${!threshold_var:-}"
        
        if [[ -n "$threshold_value" ]]; then
            local metric_value=$(get_custom_metric "$service" "$metric")
            log "DEBUG" "$service $metric: $metric_value (threshold: $threshold_value)"
            
            if (( $(echo "$metric_value > $threshold_value" | bc -l) )); then
                should_scale_up=true
                reason="$metric high ($metric_value > $threshold_value)"
            fi
        fi
    done
    
    # Determine target replicas
    local target_replicas="$current_replicas"
    
    if [[ "$should_scale_up" == true ]]; then
        local max_increase=$((current_replicas * MAX_SCALE_UP_PERCENT / 100))
        target_replicas=$((current_replicas + max_increase))
        
        # Ensure we don't exceed max replicas
        if [[ $target_replicas -gt ${MAX_REPLICAS:-20} ]]; then
            target_replicas=${MAX_REPLICAS:-20}
        fi
        
        log "INFO" "$service should scale up: $reason"
    elif [[ "$should_scale_down" == true ]] && [[ $current_replicas -gt ${MIN_REPLICAS:-1} ]]; then
        local max_decrease=$((current_replicas * MAX_SCALE_DOWN_PERCENT / 100))
        target_replicas=$((current_replicas - max_decrease))
        
        # Ensure we don't go below min replicas
        if [[ $target_replicas -lt ${MIN_REPLICAS:-1} ]]; then
            target_replicas=${MIN_REPLICAS:-1}
        fi
        
        log "INFO" "$service should scale down: $reason"
    fi
    
    echo "$target_replicas"
}

# Scale deployment
scale_deployment() {
    local service="$1"
    local target_replicas="$2"
    local current_replicas="$3"
    
    if [[ "$target_replicas" == "$current_replicas" ]]; then
        log "INFO" "$service: No scaling needed (current: $current_replicas, target: $target_replicas)"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would scale $service from $current_replicas to $target_replicas replicas"
        return 0
    fi
    
    log "INFO" "Scaling $service from $current_replicas to $target_replicas replicas"
    
    # Scale deployment
    kubectl scale deployment "$service" --replicas="$target_replicas" -n "$NAMESPACE"
    
    # Wait for scaling to complete
    log "INFO" "Waiting for $service scaling to complete"
    kubectl rollout status deployment/"$service" -n "$NAMESPACE" --timeout=300s
    
    log "SUCCESS" "$service scaled to $target_replicas replicas"
}

# Manual scaling
manual_scale() {
    log "PHASE" "Manual Scaling"
    
    local service="$1"
    local target_replicas="$2"
    
    if [[ -z "$service" || -z "$target_replicas" ]]; then
        log "ERROR" "Service name and target replicas required for manual scaling"
        return 1
    fi
    
    local current_replicas=$(get_current_replicas "$service")
    
    log "INFO" "Manual scaling: $service ($current_replicas -> $target_replicas)"
    
    scale_deployment "$service" "$target_replicas" "$current_replicas"
}

# Auto scaling
auto_scale() {
    log "PHASE" "Auto Scaling"
    
    local services=("${SERVICES_TO_SCALE[@]}")
    
    if [[ ${#services[@]} -eq 0 ]]; then
        services=("${!SCALING_CONFIGS[@]}")
    fi
    
    local total=${#services[@]}
    local current=0
    
    for service in "${services[@]}"; do
        ((current++))
        show_progress $current $total "Evaluating $service"
        
        # Check if deployment exists
        if ! kubectl get deployment "$service" -n "$NAMESPACE" &> /dev/null; then
            log "WARNING" "Deployment $service not found, skipping"
            continue
        fi
        
        local current_replicas=$(get_current_replicas "$service")
        
        if [[ "$current_replicas" == "0" ]]; then
            log "WARNING" "$service has 0 replicas, skipping"
            continue
        fi
        
        # Determine scaling action
        local target_replicas=$(determine_scaling_action "$service" "$current_replicas")
        
        # Apply scaling
        scale_deployment "$service" "$target_replicas" "$current_replicas"
    done
}

# Scheduled scaling
scheduled_scale() {
    log "PHASE" "Scheduled Scaling"
    
    local schedule_file="$SCRIPT_DIR/scaling-schedule.json"
    
    if [[ ! -f "$schedule_file" ]]; then
        log "WARNING" "Schedule file not found: $schedule_file"
        return 0
    fi
    
    local current_hour=$(date +%H)
    local current_day=$(date +%u)  # 1-7 (Monday-Sunday)
    
    log "INFO" "Current time: $(date), hour: $current_hour, day: $current_day"
    
    # Read schedule
    local schedules=$(jq -r ".schedules[]? | select(.day == $current_day or .day == \"*\") | select(.hour == $current_hour)" "$schedule_file")
    
    if [[ -z "$schedules" ]]; then
        log "INFO" "No scheduled scaling for current time"
        return 0
    fi
    
    echo "$schedules" | while read -r schedule; do
        local service=$(echo "$schedule" | jq -r '.service')
        local replicas=$(echo "$schedule" | jq -r '.replicas')
        
        log "INFO" "Scheduled scaling: $service -> $replicas replicas"
        
        local current_replicas=$(get_current_replicas "$service")
        scale_deployment "$service" "$replicas" "$current_replicas"
    done
}

# Event-based scaling
event_based_scale() {
    log "PHASE" "Event-Based Scaling"
    
    # Check for custom events that trigger scaling
    local events_file="$SCRIPT_DIR/scaling-events.json"
    
    if [[ ! -f "$events_file" ]]; then
        log "WARNING" "Events file not found: $events_file"
        return 0
    fi
    
    # Monitor for specific events
    local high_load_events=$(jq -r '.events[]? | select(.type == "high_load")' "$events_file")
    local maintenance_events=$(jq -r '.events[]? | select(.type == "maintenance")' "$events_file")
    
    # Process high load events
    if [[ -n "$high_load_events" ]]; then
        echo "$high_load_events" | while read -r event; do
            local service=$(echo "$event" | jq -r '.service')
            local multiplier=$(echo "$event" | jq -r '.multiplier // 2')
            
            local current_replicas=$(get_current_replicas "$service")
            local target_replicas=$((current_replicas * multiplier))
            
            log "INFO" "Event-based scaling: $service (high load) -> $target_replicas replicas"
            scale_deployment "$service" "$target_replicas" "$current_replicas"
        done
    fi
    
    # Process maintenance events
    if [[ -n "$maintenance_events" ]]; then
        echo "$maintenance_events" | while read -r event; do
            local service=$(echo "$event" | jq -r '.service')
            local target_replicas=$(echo "$event" | jq -r '.replicas')
            
            local current_replicas=$(get_current_replicas "$service")
            
            log "INFO" "Event-based scaling: $service (maintenance) -> $target_replicas replicas"
            scale_deployment "$service" "$target_replicas" "$current_replicas"
        done
    fi
}

# Create/update HPA
create_hpa() {
    log "PHASE" "Creating/Updating HPA"
    
    local service="$1"
    parse_scaling_config "$service"
    
    local hpa_name="${service}-hpa"
    local hpa_file="/tmp/${hpa_name}.yaml"
    
    cat > "$hpa_file" << EOF
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: $hpa_name
  namespace: $NAMESPACE
  labels:
    app: $service
    component: hpa
    provider: digitalocean
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: $service
  minReplicas: ${MIN_REPLICAS:-1}
  maxReplicas: ${MAX_REPLICAS:-10}
  metrics:
EOF

    # Add resource metrics
    echo "  - type: Resource" >> "$hpa_file"
    echo "    resource:" >> "$hpa_file"
    echo "      name: cpu" >> "$hpa_file"
    echo "      target:" >> "$hpa_file"
    echo "        type: Utilization" >> "$hpa_file"
    echo "        averageUtilization: ${CPU_THRESHOLD:-70}" >> "$hpa_file"
    
    echo "  - type: Resource" >> "$hpa_file"
    echo "    resource:" >> "$hpa_file"
    echo "      name: memory" >> "$hpa_file"
    echo "      target:" >> "$hpa_file"
    echo "        type: Utilization" >> "$hpa_file"
    echo "        averageUtilization: ${MEMORY_THRESHOLD:-80}" >> "$hpa_file"
    
    # Add custom metrics if available
    local custom_metrics=("requests" "connections" "participants" "bandwidth" "messages" "sessions" "meetings" "recordings" "latency" "samples")
    
    for metric in "${custom_metrics[@]}"; do
        local threshold_var="${metric^^}_THRESHOLD"
        local threshold_value="${!threshold_var:-}"
        
        if [[ -n "$threshold_value" ]]; then
            echo "  - type: Pods" >> "$hpa_file"
            echo "    pods:" >> "$hpa_file"
            echo "      metric:" >> "$hpa_file"
            echo "        name: ${metric}_per_second" >> "$hpa_file"
            echo "      target:" >> "$hpa_file"
            echo "        type: AverageValue" >> "$hpa_file"
            echo "        averageValue: \"$threshold_value\"" >> "$hpa_file"
        fi
    done
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would create/update HPA for $service"
        cat "$hpa_file"
        return 0
    fi
    
    # Apply HPA
    kubectl apply -f "$hpa_file"
    
    log "SUCCESS" "HPA created/updated for $service"
    rm -f "$hpa_file"
}

# Enable cluster autoscaler
enable_cluster_autoscaler() {
    log "PHASE" "Enabling Cluster Autoscaler"
    
    if [[ "$CLUSTER_AUTOSCALER_ENABLED" != true ]]; then
        log "INFO" "Cluster autoscaler disabled"
        return 0
    fi
    
    if [[ "$DRY_RUN" == true ]]; then
        log "INFO" "[DRY RUN] Would enable cluster autoscaler"
        return 0
    fi
    
    # Check if cluster autoscaler is already deployed
    if kubectl get deployment cluster-autoscaler -n kube-system &> /dev/null; then
        log "INFO" "Cluster autoscaler already exists"
        return 0
    fi
    
    # Deploy cluster autoscaler
    local ca_yaml="/tmp/cluster-autoscaler.yaml"
    
    cat > "$ca_yaml" << 'EOF'
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
  labels:
    app: cluster-autoscaler
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cluster-autoscaler
  template:
    metadata:
      labels:
        app: cluster-autoscaler
    spec:
      containers:
      - image: k8s.gcr.io/autoscaling/cluster-autoscaler:v1.21.0
        name: cluster-autoscaler
        resources:
          limits:
            cpu: 100m
            memory: 300Mi
          requests:
            cpu: 100m
            memory: 300Mi
        command:
        - ./cluster-autoscaler
        - --v=4
        - --stderrthreshold=info
        - --cloud-provider=external
        - --skip-nodes-with-local-storage=false
        - --expander=least-waste
        - --node-group-auto-discovery=asg:tag=k8s.io/cluster-autoscaler/enabled,k8s.io/cluster-autoscaler/gomeet
        - --balance-similar-node-groups
        - --skip-nodes-with-system-pods=false
EOF

    kubectl apply -f "$ca_yaml"
    
    log "SUCCESS" "Cluster autoscaler enabled"
    rm -f "$ca_yaml"
}

# Generate scaling report
generate_scaling_report() {
    log "PHASE" "Generating Scaling Report"
    
    local report_file="$LOG_DIR/scaling-report-$SCALING_ID.json"
    
    local report="{"
    report+="\"scaling_id\": \"$SCALING_ID\","
    report+="\"timestamp\": \"$(date -Iseconds)\","
    report+="\"namespace\": \"$NAMESPACE\","
    report+="\"mode\": \"$SCALING_MODE\","
    report+="\"services\": ["
    
    local first=true
    local services=("${SERVICES_TO_SCALE[@]}")
    
    if [[ ${#services[@]} -eq 0 ]]; then
        services=("${!SCALING_CONFIGS[@]}")
    fi
    
    for service in "${services[@]}"; do
        if [[ "$first" == false ]]; then
            report+=","
        fi
        
        local current_replicas=$(get_current_replicas "$service")
        local cpu_usage=$(get_cpu_usage "$service")
        local memory_usage=$(get_memory_usage "$service")
        
        report+="{"
        report+="\"name\": \"$service\","
        report+="\"replicas\": $current_replicas,"
        report+="\"cpu_usage\": $cpu_usage,"
        report+="\"memory_usage\": $memory_usage"
        report+="}"
        
        first=false
    done
    
    report+="]"
    report+="}"
    
    echo "$report" > "$report_file"
    
    log "SUCCESS" "Scaling report saved to: $report_file"
    
    # Display summary
    echo ""
    echo "📊 Auto-Scaling Summary:"
    echo "======================="
    echo "Scaling ID: $SCALING_ID"
    echo "Mode: $SCALING_MODE"
    echo "Namespace: $NAMESPACE"
    echo "Services evaluated: ${#services[@]}"
    echo ""
    echo "📋 Current Status:"
    for service in "${services[@]}"; do
        local replicas=$(get_current_replicas "$service")
        echo "- $service: $replicas replicas"
    done
    echo ""
    echo "📁 Files:"
    echo "- Scaling log: $LOG_FILE"
    echo "- Scaling report: $report_file"
}

# Show usage
show_usage() {
    echo "GoMeet DigitalOcean Auto-Scaling Script"
    echo ""
    echo "Usage: $0 [OPTIONS] [COMMAND] [ARGS...]"
    echo ""
    echo "Commands:"
    echo "  auto                         Run automatic scaling evaluation"
    echo "  manual SERVICE REPLICAS       Manual scaling to specific replica count"
    echo "  scheduled                    Run scheduled scaling"
    echo "  event-based                  Run event-based scaling"
    echo "  create-hpa SERVICE           Create/update HPA for service"
    echo "  enable-cluster-autoscaler    Enable cluster autoscaler"
    echo "  status                       Show current scaling status"
    echo ""
    echo "Options:"
    echo "  -h, --help                   Show this help message"
    echo "  -v, --verbose                Enable verbose logging"
    echo "  -n, --namespace NAMESPACE    Kubernetes namespace (default: gomeet)"
    echo "  -m, --mode MODE              Scaling mode (default: auto)"
    echo "  -p, --prometheus URL         Prometheus URL (default: http://prometheus:9090)"
    echo "  -c, --config FILE            Custom configuration file"
    echo "  --dry-run                    Simulate scaling without making changes"
    echo "  --force                      Force scaling even if not needed"
    echo "  --enable-cluster-autoscaler  Enable cluster autoscaler"
    echo "  --enable-keda                Enable KEDA for event-based scaling"
    echo ""
    echo "Scaling modes: ${MODES[*]}"
    echo ""
    echo "Examples:"
    echo "  $0 auto                                    # Run auto scaling"
    echo "  $0 manual auth-service 10                 # Scale auth-service to 10 replicas"
    echo "  $0 --mode scheduled scheduled              # Run scheduled scaling"
    echo "  $0 create-hpa livekit-sfu                 # Create HPA for livekit-sfu"
    echo "  $0 --dry-run auto                         # Simulate auto scaling"
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
            -m|--mode)
                SCALING_MODE="$2"
                shift 2
                ;;
            -p|--prometheus)
                PROMETHEUS_URL="$2"
                shift 2
                ;;
            -c|--config)
                CUSTOM_CONFIG_FILE="$2"
                shift 2
                ;;
            --dry-run)
                DRY_RUN=true
                shift
                ;;
            --force)
                FORCE_SCALE=true
                shift
                ;;
            --enable-cluster-autoscaler)
                CLUSTER_AUTOSCALER_ENABLED=true
                shift
                ;;
            --enable-keda)
                KEDA_ENABLED=true
                shift
                ;;
            auto|manual|scheduled|event-based|create-hpa|enable-cluster-autoscaler|status)
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
                SERVICES_TO_SCALE+=("$1")
                shift
                ;;
        esac
    done
    
    # Validate scaling mode
    if [[ ! " ${MODES[*]} " =~ " $SCALING_MODE " ]]; then
        log "ERROR" "Invalid scaling mode: $SCALING_MODE"
        log "INFO" "Available modes: ${MODES[*]}"
        exit 1
    fi
    
    # Start scaling process
    log "INFO" "Starting GoMeet auto-scaling process"
    log "INFO" "Scaling ID: $SCALING_ID"
    log "INFO" "Mode: $SCALING_MODE"
    log "INFO" "Log file: $LOG_FILE"
    
    # Run prerequisites
    check_prerequisites
    load_custom_config
    
    # Execute command
    case "$command" in
        "auto")
            auto_scale
            ;;
        "manual")
            if [[ $# -lt 2 ]]; then
                log "ERROR" "Manual scaling requires SERVICE and REPLICAS"
                show_usage
                exit 1
            fi
            manual_scale "$1" "$2"
            shift 2
            ;;
        "scheduled")
            scheduled_scale
            ;;
        "event-based")
            event_based_scale
            ;;
        "create-hpa")
            if [[ $# -lt 1 ]]; then
                log "ERROR" "HPA creation requires SERVICE name"
                show_usage
                exit 1
            fi
            create_hpa "$1"
            shift
            ;;
        "enable-cluster-autoscaler")
            enable_cluster_autoscaler
            ;;
        "status")
            generate_scaling_report
            ;;
        "")
            # Default to auto scaling
            auto_scale
            ;;
        *)
            log "ERROR" "Unknown command: $command"
            show_usage
            exit 1
            ;;
    esac
    
    generate_scaling_report
    
    log "SUCCESS" "GoMeet auto-scaling process completed!"
    log "INFO" "Total scaling time: $(($(date +%s) - $(stat -c %Y "$LOG_FILE"))) seconds"
}

# Run main function with all arguments
main "$@"