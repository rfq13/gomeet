#!/bin/bash

# GoMeet DigitalOcean Cost Monitoring Script
# Script untuk monitoring, tracking, dan optimasi biaya DigitalOcean
# Support real-time cost analysis, budget alerts, dan cost optimization recommendations

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
LOG_DIR="/tmp/gomeet-cost-monitoring"
LOG_FILE="$LOG_DIR/cost-monitor-$(date +%Y%m%d-%H%M%S).log"
MONITOR_ID="cost-$(date +%Y%m%d-%H%M%S)"

# DigitalOcean pricing (per hour, in USD)
declare -A DO_PRICING=(
    # Kubernetes nodes
    ["c-2"]="0.074"      # 2 vCPU, 4GB RAM
    ["c-4"]="0.148"      # 4 vCPU, 8GB RAM
    ["c-8"]="0.296"      # 8 vCPU, 16GB RAM
    ["c-16"]="0.593"     # 16 vCPU, 32GB RAM
    ["c-32"]="1.186"     # 32 vCPU, 64GB RAM
    
    # Managed databases
    ["pg-s-2vcpu-4gb"]="0.105"    # PostgreSQL Basic
    ["pg-s-4vcpu-8gb"]="0.210"    # PostgreSQL Basic
    ["pg-s-8vcpu-16gb"]="0.420"   # PostgreSQL Basic
    ["pg-s-16vcpu-32gb"]="0.840"  # PostgreSQL Basic
    ["pg-g-2vcpu-8gb"]="0.210"    # PostgreSQL General Purpose
    ["pg-g-4vcpu-16gb"]="0.420"   # PostgreSQL General Purpose
    ["pg-g-8vcpu-32gb"]="0.840"   # PostgreSQL General Purpose
    ["pg-g-16vcpu-64gb"]="1.680"  # PostgreSQL General Purpose
    
    # Managed Redis
    ["redis-s-1vcpu-1gb"]="0.035"  # Redis Basic
    ["redis-s-2vcpu-2gb"]="0.070"  # Redis Basic
    ["redis-s-4vcpu-4gb"]="0.140"  # Redis Basic
    ["redis-g-1vcpu-2gb"]="0.070"  # Redis General Purpose
    ["redis-g-2vcpu-4gb"]="0.140"  # Redis General Purpose
    ["redis-g-4vcpu-8gb"]="0.280"  # Redis General Purpose
    
    # Load Balancer
    ["load-balancer"]="0.012"      # Per hour
    
    # Spaces (per GB)
    ["storage"]="0.015"            # Per GB per month
    ["egress"]="0.01"              # Per GB
    
    # Container Registry
    ["registry-storage"]="0.015"   # Per GB per month
    ["registry-egress"]="0.01"     # Per GB
)

# Budget thresholds
MONTHLY_BUDGET=30000  # $30,000 per month
DAILY_BUDGET=$((MONTHLY_BUDGET / 30))
WARNING_THRESHOLD=80
CRITICAL_THRESHOLD=95

# Cost tracking
TRACK_RESOURCES=true
TRACK_USAGE=true
TRACK_EFFICIENCY=true
GENERATE_RECOMMENDATIONS=true

# Global variables
VERBOSE=false
OUTPUT_FORMAT="table"  # table, json, csv
DO_TOKEN=""
DO_API_URL="https://api.digitalocean.com/v2"
BUDGET_ALERT_EMAIL=""
SLACK_WEBHOOK_URL=""
HISTORICAL_DAYS=30
EFFICIENCY_THRESHOLD=70

# Cost data storage
declare -A RESOURCE_COSTS
declare -A USAGE_METRICS
TOTAL_HOURLY_COST=0
TOTAL_MONTHLY_COST=0

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
    
    log "ERROR" "Cost monitoring operation failed at line $line_number with exit code $exit_code"
    log "ERROR" "Check logs: $LOG_FILE"
    
    exit $exit_code
}

trap 'handle_error $LINENO' ERR

# Prerequisites check
check_prerequisites() {
    log "PHASE" "Checking Prerequisites"
    
    # Check required tools
    local tools=("kubectl" "jq" "curl" "bc")
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
    
    # Check DigitalOcean token
    if [[ -z "$DO_TOKEN" ]]; then
        DO_TOKEN=${DIGITALOCEAN_TOKEN:-""}
    fi
    
    if [[ -z "$DO_TOKEN" ]]; then
        log "WARNING" "DigitalOcean token not set, using estimated pricing"
    fi
    
    # Create log directory
    mkdir -p "$LOG_DIR"
    
    log "SUCCESS" "All prerequisites satisfied"
}

# Initialize cost tracking
initialize_cost_tracking() {
    log "PHASE" "Initializing Cost Tracking"
    
    # Reset cost counters
    TOTAL_HOURLY_COST=0
    TOTAL_MONTHLY_COST=0
    
    # Initialize resource costs
    RESOURCE_COSTS["kubernetes-nodes"]=0
    RESOURCE_COSTS["managed-databases"]=0
    RESOURCE_COSTS["managed-redis"]=0
    RESOURCE_COSTS["load-balancers"]=0
    RESOURCE_COSTS["storage"]=0
    RESOURCE_COSTS["network-egress"]=0
    RESOURCE_COSTS["container-registry"]=0
    
    log "SUCCESS" "Cost tracking initialized"
}

# Get Kubernetes nodes cost
get_kubernetes_nodes_cost() {
    log "DEBUG" "Calculating Kubernetes nodes cost"
    
    local nodes_cost=0
    local node_count=0
    
    # Get nodes in the cluster
    kubectl get nodes --no-headers | while read -r node_name status roles age version; do
        # Get node instance type
        local instance_type=$(kubectl get node "$node_name" -o jsonpath='{.metadata.labels.beta\.kubernetes\.io/instance-type}' 2>/dev/null || echo "unknown")
        
        # Extract size from instance type (e.g., "c-32" from "c-32-64gb")
        local size=$(echo "$instance_type" | grep -o 'c-[0-9]*' || echo "c-2")
        
        # Get hourly price
        local hourly_price=${DO_PRICING[$size]:-${DO_PRICING["c-2"]}}
        
        # Add to total
        nodes_cost=$(echo "$nodes_cost + $hourly_price" | bc)
        ((node_count++))
        
        log "DEBUG" "Node $node_name ($instance_type): \$$hourly_price/hour"
    done
    
    # Calculate monthly cost (730 hours per month)
    local monthly_cost=$(echo "$nodes_cost * 730" | bc)
    
    RESOURCE_COSTS["kubernetes-nodes"]=$monthly_cost
    TOTAL_HOURLY_COST=$(echo "$TOTAL_HOURLY_COST + $nodes_cost" | bc)
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $monthly_cost" | bc)
    
    log "INFO" "Kubernetes nodes: $node_count nodes, \$$nodes_cost/hour, \$$monthly_cost/month"
}

# Get managed databases cost
get_managed_databases_cost() {
    log "DEBUG" "Calculating managed databases cost"
    
    local db_cost=0
    
    # Check if we have managed databases
    if kubectl get service postgres-primary -n "$NAMESPACE" &> /dev/null; then
        # Assume PostgreSQL cluster configuration
        # For GoMeet: 16 vCPU, 64GB RAM, 3 nodes (HA)
        local db_size="pg-g-16vcpu-64gb"
        local hourly_price=${DO_PRICING[$db_size]:-1.680}
        local node_count=3
        
        local total_hourly=$(echo "$hourly_price * $node_count" | bc)
        local monthly_cost=$(echo "$total_hourly * 730" | bc)
        
        db_cost=$monthly_cost
        
        log "INFO" "PostgreSQL cluster: $node_count x $db_size, \$$total_hourly/hour, \$$monthly_cost/month"
    fi
    
    RESOURCE_COSTS["managed-databases"]=$db_cost
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $db_cost" | bc)
}

# Get managed Redis cost
get_managed_redis_cost() {
    log "DEBUG" "Calculating managed Redis cost"
    
    local redis_cost=0
    
    # Check if we have managed Redis
    if kubectl get service redis-primary -n "$NAMESPACE" &> /dev/null; then
        # Assume Redis cluster configuration
        # For GoMeet: 8 vCPU, 32GB RAM, 3 nodes (HA)
        local redis_size="redis-g-4vcpu-8gb"
        local hourly_price=${DO_PRICING[$redis_size]:-0.280}
        local node_count=3
        
        local total_hourly=$(echo "$hourly_price * $node_count" | bc)
        local monthly_cost=$(echo "$total_hourly * 730" | bc)
        
        redis_cost=$monthly_cost
        
        log "INFO" "Redis cluster: $node_count x $redis_size, \$$total_hourly/hour, \$$monthly_cost/month"
    fi
    
    RESOURCE_COSTS["managed-redis"]=$redis_cost
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $redis_cost" | bc)
}

# Get load balancers cost
get_load_balancers_cost() {
    log "DEBUG" "Calculating load balancers cost"
    
    local lb_cost=0
    local lb_count=0
    
    # Get LoadBalancer services
    kubectl get services -n "$NAMESPACE" --field-selector spec.type=LoadBalancer --no-headers | while read -r name type cluster_ip external_ip ports age; do
        local hourly_price=${DO_PRICING["load-balancer"]}
        local monthly_cost=$(echo "$hourly_price * 730" | bc)
        
        lb_cost=$(echo "$lb_cost + $monthly_cost" | bc)
        ((lb_count++))
        
        log "DEBUG" "LoadBalancer $name: \$$hourly_price/hour, \$$monthly_cost/month"
    done
    
    RESOURCE_COSTS["load-balancers"]=$lb_cost
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $lb_cost" | bc)
    
    log "INFO" "Load balancers: $lb_count balancers, \$$lb_cost/month"
}

# Get storage cost
get_storage_cost() {
    log "DEBUG" "Calculating storage cost"
    
    local storage_cost=0
    
    # Get PVC storage
    kubectl get pvc -n "$NAMESPACE" --no-headers | while read -r name status volume capacity access_modes storage_class age; do
        # Extract size in GB
        local size_gb=$(echo "$capacity" | sed 's/Gi//')
        local monthly_cost=$(echo "$size_gb * ${DO_PRICING["storage"]}" | bc)
        
        storage_cost=$(echo "$storage_cost + $monthly_cost" | bc)
        
        log "DEBUG" "PVC $name: ${size_gb}GB, \$$monthly_cost/month"
    done
    
    # Estimate Spaces storage (backups, logs, etc.)
    local estimated_spaces_gb=500  # Estimated
    local spaces_cost=$(echo "$estimated_spaces_gb * ${DO_PRICING["storage"]}" | bc)
    
    storage_cost=$(echo "$storage_cost + $spaces_cost" | bc)
    
    RESOURCE_COSTS["storage"]=$storage_cost
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $storage_cost" | bc)
    
    log "INFO" "Storage: PVC + ${estimated_spaces_gb}GB Spaces, \$$storage_cost/month"
}

# Get network egress cost
get_network_egress_cost() {
    log "DEBUG" "Calculating network egress cost"
    
    # Estimate network egress based on usage
    # For 500 participants: ~1TB/day for video streaming
    local daily_egress_tb=1
    local monthly_egress_tb=$((daily_egress_tb * 30))
    local monthly_egress_gb=$((monthly_egress_tb * 1024))
    
    local egress_cost=$(echo "$monthly_egress_gb * ${DO_PRICING["egress"]}" | bc)
    
    RESOURCE_COSTS["network-egress"]=$egress_cost
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $egress_cost" | bc)
    
    log "INFO" "Network egress: ${monthly_egress_tb}TB/month, \$$egress_cost/month"
}

# Get container registry cost
get_container_registry_cost() {
    log "DEBUG" "Calculating container registry cost"
    
    # Estimate container registry storage
    local estimated_registry_gb=50  # Estimated
    local registry_storage_cost=$(echo "$estimated_registry_gb * ${DO_PRICING["registry-storage"]}" | bc)
    
    # Estimate registry egress
    local estimated_registry_egress_gb=100  # Estimated
    local registry_egress_cost=$(echo "$estimated_registry_egress_gb * ${DO_PRICING["registry-egress"]}" | bc)
    
    local total_registry_cost=$(echo "$registry_storage_cost + $registry_egress_cost" | bc)
    
    RESOURCE_COSTS["container-registry"]=$total_registry_cost
    TOTAL_MONTHLY_COST=$(echo "$TOTAL_MONTHLY_COST + $total_registry_cost" | bc)
    
    log "INFO" "Container registry: ${estimated_registry_gb}GB storage + ${estimated_registry_egress_gb}GB egress, \$$total_registry_cost/month"
}

# Calculate resource efficiency
calculate_resource_efficiency() {
    log "PHASE" "Calculating Resource Efficiency"
    
    # Calculate CPU efficiency
    local total_cpu_allocated=0
    local total_cpu_requested=0
    local total_cpu_used=0
    
    kubectl top nodes --no-headers | while read -r node_name cpu_cores cpu_percent memory_bytes memory_percent; do
        local cpu_cores_num=$(echo "$cpu_cores" | sed 's/m//')
        total_cpu_allocated=$(echo "$total_cpu_allocated + $cpu_cores_num" | bc)
        
        local cpu_used=$(echo "$cpu_cores_num * $cpu_percent / 100" | bc)
        total_cpu_used=$(echo "$total_cpu_used + $cpu_used" | bc)
    done
    
    kubectl top pods -n "$NAMESPACE" --no-headers | while read -r pod_name cpu_cores memory_bytes; do
        local cpu_requested=$(kubectl get pod "$pod_name" -n "$NAMESPACE" -o jsonpath='{.spec.containers[0].resources.requests.cpu}' 2>/dev/null || echo "0")
        if [[ "$cpu_requested" =~ m$ ]]; then
            cpu_requested=$(echo "$cpu_requested" | sed 's/m//')
            cpu_requested=$(echo "$cpu_requested / 1000" | bc)
        fi
        total_cpu_requested=$(echo "$total_cpu_requested + $cpu_requested" | bc)
    done
    
    local cpu_efficiency=0
    if [[ $(echo "$total_cpu_allocated > 0" | bc) -eq 1 ]]; then
        cpu_efficiency=$(echo "scale=2; $total_cpu_used / $total_cpu_allocated * 100" | bc)
    fi
    
    # Calculate memory efficiency
    local total_memory_allocated=0
    local total_memory_requested=0
    local total_memory_used=0
    
    kubectl top nodes --no-headers | while read -r node_name cpu_cores cpu_percent memory_bytes memory_percent; do
        total_memory_allocated=$(echo "$total_memory_allocated + $memory_bytes" | bc)
        
        local memory_used=$(echo "$memory_bytes * $memory_percent / 100" | bc)
        total_memory_used=$(echo "$total_memory_used + $memory_used" | bc)
    done
    
    kubectl top pods -n "$NAMESPACE" --no-headers | while read -r pod_name cpu_cores memory_bytes; do
        local memory_requested=$(kubectl get pod "$pod_name" -n "$NAMESPACE" -o jsonpath='{.spec.containers[0].resources.requests.memory}' 2>/dev/null || echo "0")
        if [[ "$memory_requested" =~ Gi$ ]]; then
            memory_requested=$(echo "$memory_requested" | sed 's/Gi//')
            memory_requested=$(echo "$memory_requested * 1024 * 1024 * 1024" | bc)
        elif [[ "$memory_requested" =~ Mi$ ]]; then
            memory_requested=$(echo "$memory_requested" | sed 's/Mi//')
            memory_requested=$(echo "$memory_requested * 1024 * 1024" | bc)
        fi
        total_memory_requested=$(echo "$total_memory_requested + $memory_requested" | bc)
    done
    
    local memory_efficiency=0
    if [[ $(echo "$total_memory_allocated > 0" | bc) -eq 1 ]]; then
        memory_efficiency=$(echo "scale=2; $total_memory_used / $total_memory_allocated * 100" | bc)
    fi
    
    USAGE_METRICS["cpu-efficiency"]=$cpu_efficiency
    USAGE_METRICS["memory-efficiency"]=$memory_efficiency
    
    log "INFO" "Resource efficiency - CPU: ${cpu_efficiency}%, Memory: ${memory_efficiency}%"
}

# Generate cost optimization recommendations
generate_recommendations() {
    log "PHASE" "Generating Cost Optimization Recommendations"
    
    local recommendations=()
    
    # Check resource efficiency
    local cpu_eff=${USAGE_METRICS["cpu-efficiency"]}
    local mem_eff=${USAGE_METRICS["memory-efficiency"]}
    
    if (( $(echo "$cpu_eff < $EFFICIENCY_THRESHOLD" | bc -l) )); then
        recommendations+=("CPU efficiency is ${cpu_efficiency}%. Consider right-sizing nodes or enabling cluster autoscaler.")
    fi
    
    if (( $(echo "$mem_eff < $EFFICIENCY_THRESHOLD" | bc -l) )); then
        recommendations+=("Memory efficiency is ${memory_efficiency}%. Consider right-sizing nodes or optimizing memory usage.")
    fi
    
    # Check budget status
    local budget_usage=$(echo "scale=2; $TOTAL_MONTHLY_COST / $MONTHLY_BUDGET * 100" | bc)
    
    if (( $(echo "$budget_usage > $CRITICAL_THRESHOLD" | bc -l) )); then
        recommendations+=("CRITICAL: Monthly cost is \$$TOTAL_MONTHLY_COST (${budget_usage}% of budget). Immediate optimization required.")
    elif (( $(echo "$budget_usage > $WARNING_THRESHOLD" | bc -l) )); then
        recommendations+=("WARNING: Monthly cost is \$$TOTAL_MONTHLY_COST (${budget_usage}% of budget). Consider optimization.")
    fi
    
    # Check for underutilized resources
    local underutilized_pods=$(kubectl get pods -n "$NAMESPACE" -o json | jq '.items[] | select(.spec.containers[].resources.requests.cpu == "100m" and .spec.containers[].resources.requests.memory == "128Mi") | .metadata.name' | wc -l)
    
    if [[ $underutilized_pods -gt 0 ]]; then
        recommendations+=("Found $underutilized_pods pods with minimal resource requests. Review and optimize resource allocation.")
    fi
    
    # Check for unused resources
    local unused_pvcs=$(kubectl get pvc -n "$NAMESPACE" -o json | jq '.items[] | select(.status.phase == "Bound" and .spec.volumeName == null) | .metadata.name' | wc -l)
    
    if [[ $unused_pvcs -gt 0 ]]; then
        recommendations+=("Found $unused_pvcs unused PVCs. Clean up to reduce storage costs.")
    fi
    
    # Save recommendations
    local recommendations_file="$LOG_DIR/recommendations-$MONITOR_ID.txt"
    
    {
        echo "GoMeet Cost Optimization Recommendations"
        echo "======================================="
        echo "Generated: $(date)"
        echo "Current Monthly Cost: \$$TOTAL_MONTHLY_COST"
        echo "Budget Usage: $(echo "scale=2; $TOTAL_MONTHLY_COST / $MONTHLY_BUDGET * 100" | bc)%"
        echo ""
        
        if [[ ${#recommendations[@]} -eq 0 ]]; then
            echo "✅ No immediate optimization recommendations."
        else
            for i in "${!recommendations[@]}"; do
                echo "$((i+1)). ${recommendations[i]}"
            done
        fi
        
        echo ""
        echo "Potential Savings Opportunities:"
        echo "- Enable cluster autoscaler to scale down during low usage"
        echo "- Use spot instances for non-critical workloads"
        echo "- Optimize container images to reduce registry storage"
        echo "- Implement resource quotas to prevent over-provisioning"
        echo "- Review and remove unused services and deployments"
        
    } > "$recommendations_file"
    
    log "SUCCESS" "Recommendations saved to: $recommendations_file"
    
    # Display summary
    echo ""
    echo "💡 Cost Optimization Summary:"
    echo "============================="
    echo "Current Monthly Cost: \$$TOTAL_MONTHLY_COST"
    echo "Budget Usage: $(echo "scale=2; $TOTAL_MONTHLY_COST / $MONTHLY_BUDGET * 100" | bc)%"
    echo "CPU Efficiency: ${cpu_efficiency}%"
    echo "Memory Efficiency: ${memory_efficiency}%"
    echo "Recommendations: ${#recommendations[@]}"
    
    if [[ ${#recommendations[@]} -gt 0 ]]; then
        echo ""
        echo "Top Recommendations:"
        for i in "${!recommendations[@]}"; do
            if [[ $i -lt 3 ]]; then
                echo "$((i+1)). ${recommendations[i]}"
            fi
        done
    fi
}

# Send budget alert
send_budget_alert() {
    local budget_usage=$(echo "scale=2; $TOTAL_MONTHLY_COST / $MONTHLY_BUDGET * 100" | bc)
    
    if (( $(echo "$budget_usage < $WARNING_THRESHOLD" | bc -l) )); then
        return 0  # No alert needed
    fi
    
    local alert_level="WARNING"
    if (( $(echo "$budget_usage >= $CRITICAL_THRESHOLD" | bc -l) )); then
        alert_level="CRITICAL"
    fi
    
    local alert_message="GoMeet Budget Alert - $alert_level\n\n"
    alert_message+="Current Monthly Cost: \$$TOTAL_MONTHLY_COST\n"
    alert_message+="Budget Usage: ${budget_usage}%\n"
    alert_message+="Monthly Budget: \$$MONTHLY_BUDGET\n"
    alert_message+="Generated: $(date)\n\n"
    alert_message+="Recommendations:\n"
    
    # Add top recommendations
    local recommendations_file="$LOG_DIR/recommendations-$MONITOR_ID.txt"
    if [[ -f "$recommendations_file" ]]; then
        head -10 "$recommendations_file" | tail -n +8 >> "$alert_message"
    fi
    
    # Send email alert
    if [[ -n "$BUDGET_ALERT_EMAIL" ]]; then
        echo -e "$alert_message" | mail -s "GoMeet Budget Alert - $alert_level" "$BUDGET_ALERT_EMAIL" 2>/dev/null || true
        log "INFO" "Budget alert sent to $BUDGET_ALERT_EMAIL"
    fi
    
    # Send Slack alert
    if [[ -n "$SLACK_WEBHOOK_URL" ]]; then
        local slack_color="warning"
        [[ "$alert_level" == "CRITICAL" ]] && slack_color="danger"
        
        local slack_payload=$(cat << EOF
{
    "text": "GoMeet Budget Alert - $alert_level",
    "attachments": [
        {
            "color": "$slack_color",
            "fields": [
                {
                    "title": "Current Monthly Cost",
                    "value": "\$$TOTAL_MONTHLY_COST",
                    "short": true
                },
                {
                    "title": "Budget Usage",
                    "value": "${budget_usage}%",
                    "short": true
                },
                {
                    "title": "Monthly Budget",
                    "value": "\$$MONTHLY_BUDGET",
                    "short": true
                },
                {
                    "title": "Alert Level",
                    "value": "$alert_level",
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
        log "INFO" "Budget alert sent to Slack"
    fi
}

# Generate cost report
generate_cost_report() {
    log "PHASE" "Generating Cost Report"
    
    local report_file="$LOG_DIR/cost-report-$MONITOR_ID.json"
    
    local report="{"
    report+="\"monitor_id\": \"$MONITOR_ID\","
    report+="\"timestamp\": \"$(date -Iseconds)\","
    report+="\"namespace\": \"$NAMESPACE\","
    report+="\"currency\": \"USD\","
    report+="\"period\": \"monthly\","
    report+="\"budget\": {"
    report+="\"monthly\": $MONTHLY_BUDGET,"
    report+="\"daily\": $DAILY_BUDGET,"
    report+="\"usage_percentage\": $(echo "scale=2; $TOTAL_MONTHLY_COST / $MONTHLY_BUDGET * 100" | bc)"
    report+="},"
    report+="\"costs\": {"
    
    local first=true
    for resource in "${!RESOURCE_COSTS[@]}"; do
        if [[ "$first" == false ]]; then
            report+=","
        fi
        report+="\"$resource\": ${RESOURCE_COSTS[$resource]}"
        first=false
    done
    
    report+="},"
    report+="\"total_monthly_cost\": $TOTAL_MONTHLY_COST,"
    report+="\"total_hourly_cost\": $TOTAL_HOURLY_COST,"
    report+="\"efficiency\": {"
    report+="\"cpu_percentage\": ${USAGE_METRICS["cpu-efficiency"]},"
    report+="\"memory_percentage\": ${USAGE_METRICS["memory-efficiency"]}"
    report+="}"
    report+="}"
    
    echo "$report" > "$report_file"
    
    log "SUCCESS" "Cost report saved to: $report_file"
    
    # Display summary
    display_cost_summary
}

# Display cost summary
display_cost_summary() {
    echo ""
    echo "💰 GoMeet Cost Monitoring Summary"
    echo "================================="
    echo "Monitor ID: $MONITOR_ID"
    echo "Timestamp: $(date)"
    echo "Currency: USD"
    echo ""
    
    case "$OUTPUT_FORMAT" in
        "table")
            printf "%-25s %-15s %-10s\n" "RESOURCE" "MONTHLY COST" "PERCENTAGE"
            printf "%-25s %-15s %-10s\n" "--------" "------------" "----------"
            
            local total_percentage=0
            for resource in "${!RESOURCE_COSTS[@]}"; do
                local cost=${RESOURCE_COSTS[$resource]}
                local percentage=0
                if [[ $(echo "$TOTAL_MONTHLY_COST > 0" | bc) -eq 1 ]]; then
                    percentage=$(echo "scale=2; $cost / $TOTAL_MONTHLY_COST * 100" | bc)
                fi
                
                printf "%-25s \$%-14.2f %9.2f%%\n" "$resource" "$cost" "$percentage"
                total_percentage=$(echo "$total_percentage + $percentage" | bc)
            done
            
            printf "%-25s %-15s %-10s\n" "" "" ""
            printf "%-25s \$%-14.2f %9.2f%%\n" "TOTAL" "$TOTAL_MONTHLY_COST" "$total_percentage"
            
            echo ""
            printf "%-25s %-15s\n" "BUDGET INFORMATION" ""
            printf "%-25s \$%-14.2f\n" "Monthly Budget" "$MONTHLY_BUDGET"
            printf "%-25s \$%-14.2f\n" "Daily Budget" "$DAILY_BUDGET"
            printf "%-25s %9.2f%%\n" "Budget Usage" "$(echo "scale=2; $TOTAL_MONTHLY_COST / $MONTHLY_BUDGET * 100" | bc)"
            
            echo ""
            printf "%-25s %-15s\n" "EFFICIENCY METRICS" ""
            printf "%-25s %9.2f%%\n" "CPU Efficiency" "${USAGE_METRICS["cpu-efficiency"]}"
            printf "%-25s %9.2f%%\n" "Memory Efficiency" "${USAGE_METRICS["memory-efficiency"]}"
            ;;
        "json")
            echo "$report" | jq .
            ;;
        "csv")
            echo "Resource,Monthly Cost,Percentage"
            for resource in "${!RESOURCE_COSTS[@]}"; do
                local cost=${RESOURCE_COSTS[$resource]}
                local percentage=0
                if [[ $(echo "$TOTAL_MONTHLY_COST > 0" | bc) -eq 1 ]]; then
                    percentage=$(echo "scale=2; $cost / $TOTAL_MONTHLY_COST * 100" | bc)
                fi
                echo "$resource,\$$cost,$percentage%"
            done
            echo "TOTAL,\$$TOTAL_MONTHLY_COST,100%"
            ;;
    esac
    
    echo ""
    echo "📁 Files:"
    echo "- Cost monitoring log: $LOG_FILE"
    echo "- Cost report: $report_file"
    echo "- Recommendations: $LOG_DIR/recommendations-$MONITOR_ID.txt"
}

# Show usage
show_usage() {
    echo "GoMeet DigitalOcean Cost Monitoring Script"
    echo ""
    echo "Usage: $0 [OPTIONS] [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  monitor                        Run comprehensive cost monitoring"
    echo "  report                         Generate cost report only"
    echo "  recommendations                Generate optimization recommendations only"
    echo "  alert                          Check and send budget alerts"
    echo "  efficiency                     Calculate resource efficiency only"
    echo ""
    echo "Options:"
    echo "  -h, --help                     Show this help message"
    echo "  -v, --verbose                  Enable verbose logging"
    echo "  -n, --namespace NAMESPACE      Kubernetes namespace (default: gomeet)"
    echo "  -f, --format FORMAT            Output format (table, json, csv) (default: table)"
    echo "  -t, --token TOKEN              DigitalOcean API token"
    echo "  --budget BUDGET                Monthly budget in USD (default: 30000)"
    echo "  --warning-threshold PERCENT    Budget warning threshold (default: 80)"
    echo "  --critical-threshold PERCENT   Budget critical threshold (default: 95)"
    echo "  --email EMAIL                  Email address for budget alerts"
    echo "  --slack-webhook URL            Slack webhook for budget alerts"
    echo "  --historical-days DAYS         Historical data days (default: 30)"
    echo "  --efficiency-threshold PERCENT  Resource efficiency threshold (default: 70)"
    echo ""
    echo "Environment Variables:"
    echo "  DIGITALOCEAN_TOKEN             DigitalOcean API token"
    echo "  BUDGET_ALERT_EMAIL             Email address for budget alerts"
    echo "  SLACK_WEBHOOK_URL              Slack webhook URL"
    echo ""
    echo "Examples:"
    echo "  $0 monitor                                    # Run comprehensive cost monitoring"
    echo "  $0 --format json monitor                     # Output in JSON format"
    echo "  $0 --budget 25000 monitor                    # Set custom budget"
    echo "  $0 --email admin@example.com monitor        # Send email alerts"
    echo "  $0 --slack-webhook https://hooks.slack.com/... monitor # Send Slack alerts"
}

# Main execution function
main() {
    local command="monitor"
    
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
            -t|--token)
                DO_TOKEN="$2"
                shift 2
                ;;
            --budget)
                MONTHLY_BUDGET="$2"
                DAILY_BUDGET=$((MONTHLY_BUDGET / 30))
                shift 2
                ;;
            --warning-threshold)
                WARNING_THRESHOLD="$2"
                shift 2
                ;;
            --critical-threshold)
                CRITICAL_THRESHOLD="$2"
                shift 2
                ;;
            --email)
                BUDGET_ALERT_EMAIL="$2"
                shift 2
                ;;
            --slack-webhook)
                SLACK_WEBHOOK_URL="$2"
                shift 2
                ;;
            --historical-days)
                HISTORICAL_DAYS="$2"
                shift 2
                ;;
            --efficiency-threshold)
                EFFICIENCY_THRESHOLD="$2"
                shift 2
                ;;
            monitor|report|recommendations|alert|efficiency)
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
                # Unknown argument
                shift
                ;;
        esac
    done
    
    # Validate output format
    if [[ ! "table json csv" =~ "$OUTPUT_FORMAT" ]]; then
        log "ERROR" "Invalid output format: $OUTPUT_FORMAT"
        exit 1
    fi
    
    # Start cost monitoring process
    log "INFO" "Starting GoMeet cost monitoring process"
    log "INFO" "Monitor ID: $MONITOR_ID"
    log "INFO" "Log file: $LOG_FILE"
    
    # Run prerequisites
    check_prerequisites
    initialize_cost_tracking
    
    # Execute command
    case "$command" in
        "monitor")
            if [[ "$TRACK_RESOURCES" == true ]]; then
                get_kubernetes_nodes_cost
                get_managed_databases_cost
                get_managed_redis_cost
                get_load_balancers_cost
                get_storage_cost
                get_network_egress_cost
                get_container_registry_cost
            fi
            
            if [[ "$TRACK_EFFICIENCY" == true ]]; then
                calculate_resource_efficiency
            fi
            
            if [[ "$GENERATE_RECOMMENDATIONS" == true ]]; then
                generate_recommendations
            fi
            
            generate_cost_report
            send_budget_alert
            ;;
        "report")
            if [[ "$TRACK_RESOURCES" == true ]]; then
                get_kubernetes_nodes_cost
                get_managed_databases_cost
                get_managed_redis_cost
                get_load_balancers_cost
                get_storage_cost
                get_network_egress_cost
                get_container_registry_cost
            fi
            
            generate_cost_report
            ;;
        "recommendations")
            if [[ "$TRACK_EFFICIENCY" == true ]]; then
                calculate_resource_efficiency
            fi
            
            generate_recommendations
            ;;
        "alert")
            if [[ "$TRACK_RESOURCES" == true ]]; then
                get_kubernetes_nodes_cost
                get_managed_databases_cost
                get_managed_redis_cost
                get_load_balancers_cost
                get_storage_cost
                get_network_egress_cost
                get_container_registry_cost
            fi
            
            send_budget_alert
            ;;
        "efficiency")
            calculate_resource_efficiency
            echo "CPU Efficiency: ${USAGE_METRICS["cpu-efficiency"]}%"
            echo "Memory Efficiency: ${USAGE_METRICS["memory-efficiency"]}%"
            ;;
        *)
            log "ERROR" "Unknown command: $command"
            exit 1
            ;;
    esac
    
    log "SUCCESS" "GoMeet cost monitoring process completed!"
}

# Run main function with all arguments
main "$@"