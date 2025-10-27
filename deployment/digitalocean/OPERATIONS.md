# GoMeet DigitalOcean Operations Runbook

## Table of Contents

1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Deployment Scripts](#deployment-scripts)
4. [Operational Procedures](#operational-procedures)
5. [Troubleshooting](#troubleshooting)
6. [Emergency Procedures](#emergency-procedures)
7. [Performance Tuning](#performance-tuning)
8. [Security Best Practices](#security-best-practices)
9. [Cost Optimization](#cost-optimization)
10. [Monitoring and Alerting](#monitoring-and-alerting)

## Overview

GoMeet is a high-performance video conferencing platform deployed on DigitalOcean Kubernetes Engine (DOK). This runbook provides comprehensive operational procedures for managing, monitoring, and troubleshooting the GoMeet infrastructure.

### Architecture Components

- **Kubernetes Cluster**: DigitalOcean Kubernetes Engine with 6 nodes (c-32: 32 vCPU, 64GB RAM)
- **Managed PostgreSQL**: 16 vCPU, 64GB RAM, 3-node HA cluster
- **Managed Redis**: 8 vCPU, 32GB RAM, 3-node HA cluster
- **Load Balancer**: DigitalOcean Load Balancer with least connections algorithm
- **Container Registry**: DigitalOcean Container Registry for Docker images
- **Services**: Auth, Meeting, Signaling, Chat, TURN, LiveKit SFU/Recorder, Frontend, Traefik, Monitoring

### Target Capacity

- **500 participants per meeting**
- **50,000 concurrent participants**
- **Estimated monthly cost**: $27,048

## Prerequisites

### Required Tools

```bash
# Core tools
kubectl >= 1.28
docker >= 20.10
doctl >= 1.100
jq >= 1.6
curl >= 7.80
bc >= 1.07

# Optional but recommended
helm >= 3.12
kubectx + kubens
stern (for log tailing)
k9s (for cluster management)
```

### Environment Setup

```bash
# Set up DigitalOcean credentials
export DIGITALOCEAN_TOKEN="your-do-token"

# Configure kubectl
doctl kubernetes cluster kubeconfig save gomeet-cluster

# Verify connection
kubectl cluster-info
kubectl get nodes
```

### Required Secrets

Set up the following secrets in your environment or GitHub Actions:

- `DIGITALOCEAN_TOKEN`: DigitalOcean API token
- `DIGITALOCEAN_ACCESS_TOKEN`: Container registry access token
- `KUBE_CONFIG_STAGING`: Kubernetes config for staging
- `KUBE_CONFIG_PRODUCTION`: Kubernetes config for production
- `BACKUP_ENCRYPTION_KEY`: Encryption key for backups
- `BUDGET_ALERT_EMAIL`: Email for budget alerts
- `SLACK_WEBHOOK_URL`: Slack webhook for notifications

## Deployment Scripts

### Master Deployment Script

**Location**: `deployment/digitalocean/master-deploy.sh`

**Purpose**: Orchestrates complete deployment process with 12 phases

**Usage**:

```bash
# Full deployment
./deployment/digitalocean/master-deploy.sh

# Specific environment
./deployment/digitalocean/master-deploy.sh --environment production

# Dry run
./deployment/digitalocean/master-deploy.sh --dry-run

# Verbose output
./deployment/digitalocean/master-deploy.sh --verbose
```

**Phases**:

1. Prerequisites validation
2. Infrastructure setup
3. Secrets configuration
4. Docker image building
5. Database initialization
6. Services deployment
7. Gateway configuration
8. Monitoring setup
9. Auto-scaling configuration
10. Health validation
11. Post-deployment verification
12. Cleanup

### Infrastructure Setup Script

**Location**: `deployment/digitalocean/setup-infrastructure.sh`

**Purpose**: Provisions DigitalOcean resources

**Usage**:

```bash
# Setup all infrastructure
./deployment/digitalocean/setup-infrastructure.sh

# Specific components
./deployment/digitalocean/setup-infrastructure.sh --skip-database
./deployment/digitalocean/setup-infrastructure.sh --skip-redis
```

**Resources Created**:

- VPC (10.244.0.0/16)
- Kubernetes cluster (6 nodes, auto-scale 3-20)
- Managed PostgreSQL cluster
- Managed Redis cluster
- Load balancer
- Spaces bucket
- Firewall rules

### Docker Build Script

**Location**: `deployment/digitalocean/build-images.sh`

**Purpose**: Builds and pushes Docker images

**Usage**:

```bash
# Build all images
./deployment/digitalocean/build-images.sh

# Specific services
./deployment/digitalocean/build-images.sh --services auth-service,meeting-service

# Custom tag
./deployment/digitalocean/build-images.sh --tag v1.2.3

# Parallel builds
./deployment/digitalocean/build-images.sh --parallel 8
```

**Features**:

- Multi-architecture builds (linux/amd64, linux/arm64)
- Parallel builds with BuildKit
- Image optimization and caching
- Security scanning integration

### Auto-Scaling Script

**Location**: `deployment/digitalocean/scale-services.sh`

**Purpose**: Manages automatic scaling based on load

**Usage**:

```bash
# Auto scaling
./deployment/digitalocean/scale-services.sh auto

# Manual scaling
./deployment/digitalocean/scale-services.sh manual auth-service 20

# Create HPA
./deployment/digitalocean/scale-services.sh create-hpa livekit-sfu

# Enable cluster autoscaler
./deployment/digitalocean/scale-services.sh enable-cluster-autoscaler
```

**Scaling Modes**:

- **Auto**: Based on CPU, memory, and custom metrics
- **Manual**: Specific replica count
- **Scheduled**: Time-based scaling
- **Event-based**: Triggered by events

### Backup and Recovery Script

**Location**: `deployment/digitalocean/backup-restore.sh`

**Purpose**: Manages backups and disaster recovery

**Usage**:

```bash
# Create backup
./deployment/digitalocean/backup-restore.sh backup

# List backups
./deployment/digitalocean/backup-restore.sh list

# Restore from backup
./deployment/digitalocean/backup-restore.sh restore backup-20231025-120000.tar.gz

# Restore from Spaces
./deployment/digitalocean/backup-restore.sh restore-spaces backups/2023/10/25/backup-20231025-120000.tar.gz

# Cleanup old backups
./deployment/digitalocean/backup-restore.sh cleanup
```

**Backup Components**:

- PostgreSQL databases
- Redis data
- Kubernetes configurations
- Application logs
- Metrics data
- Encrypted storage

### Rolling Update Script

**Location**: `deployment/digitalocean/rolling-update.sh`

**Purpose**: Performs zero-dime updates

**Usage**:

```bash
# Rolling update
./deployment/digitalocean/rolling-update.sh update auth-service v1.2.3

# Blue-green deployment
./deployment/digitalocean/rolling-update.sh --strategy blue-green update api-service v2.0.0

# Canary deployment
./deployment/digitalocean/rolling-update.sh --strategy canary update livekit-sfu v2.1.0

# Rollback
./deployment/digitalocean/rolling-update.sh rollback meeting-service

# Check status
./deployment/digitalocean/rolling-update.sh status
```

**Update Strategies**:

- **Rolling**: Gradual replacement with max surge/unavailable
- **Blue-Green**: Full deployment with traffic switch
- **Canary**: Small percentage deployment with analysis
- **Recreate**: Stop all then start (causes downtime)

### Health Check Script

**Location**: `deployment/digitalocean/health-check.sh`

**Purpose**: Comprehensive health monitoring

**Usage**:

```bash
# Full health check
./deployment/digitalocean/health-check.sh check

# Services only
./deployment/digitalocean/health-check.sh services

# Continuous monitoring
./deployment/digitalocean/health-check.sh --continuous 60 check

# JSON output
./deployment/digitalocean/health-check.sh --format json check

# Slack alerts
./deployment/digitalocean/health-check.sh --slack-webhook https://hooks.slack.com/... check
```

**Health Checks**:

- Service health and readiness
- Database connectivity
- Load balancer status
- Certificate validity
- Resource usage
- Performance metrics
- Security configuration
- Network connectivity

### Cost Monitoring Script

**Location**: `deployment/digitalocean/cost-monitor.sh`

**Purpose**: Tracks and optimizes costs

**Usage**:

```bash
# Cost monitoring
./deployment/digitalocean/cost-monitor.sh monitor

# Cost report
./deployment/digitalocean/cost-monitor.sh --format json report

# Budget alerts
./deployment/digitalocean/cost-monitor.sh --email admin@example.com alert

# Efficiency analysis
./deployment/digitalocean/cost-monitor.sh efficiency
```

**Cost Tracking**:

- Kubernetes nodes
- Managed databases
- Load balancers
- Storage and network
- Container registry
- Resource efficiency

## Operational Procedures

### Daily Operations

#### Morning Health Check

```bash
# 1. Check overall system health
./deployment/digitalocean/health-check.sh check

# 2. Review resource usage
kubectl top nodes
kubectl top pods -n gomeet

# 3. Check recent deployments
kubectl rollout history deployment/auth-service -n gomeet

# 4. Review logs for errors
kubectl logs -n gomeet -l app=auth-service --since=6h | grep ERROR

# 5. Check cost status
./deployment/digitalocean/cost-monitor.sh alert
```

#### Backup Verification

```bash
# 1. Verify last night's backup
./deployment/digitalocean/backup-restore.sh list | grep "$(date -d '1 day ago' +%Y%m%d)"

# 2. Test backup integrity
./deployment/digitalocean/backup-restore.sh --dry-run restore backup-$(date -d '1 day ago' +%Y%m%d)-*.tar.gz
```

### Weekly Operations

#### Security Updates

```bash
# 1. Check for security vulnerabilities
kubectl get pods -n gomeet -o json | jq '.items[].spec.containers[].image' | sort | uniq

# 2. Update base images
./deployment/digitalocean/build-images.sh --update-base-images

# 3. Scan images for vulnerabilities
docker scan registry.digitalocean.com/gomeet/auth-service:latest

# 4. Apply security patches
./deployment/digitalocean/rolling-update.sh --strategy rolling update auth-service latest
```

#### Performance Review

```bash
# 1. Analyze resource efficiency
./deployment/digitalocean/cost-monitor.sh efficiency

# 2. Review scaling events
kubectl get hpa -n gomeet
kubectl describe hpa auth-service-hpa -n gomeet

# 3. Check performance metrics
./deployment/digitalocean/health-check.sh performance

# 4. Optimize resource allocation
./deployment/digitalocean/scale-services.sh auto --optimize
```

### Monthly Operations

#### Capacity Planning

```bash
# 1. Review usage trends
./deployment/digitalocean/cost-monitor.sh --historical-days 30 report

# 2. Analyze peak loads
kubectl top nodes --sort-by=cpu --no-headers | head -5

# 3. Plan capacity expansion
./deployment/digitalocean/setup-infrastructure.sh --plan-expansion

# 4. Update budgets and alerts
./deployment/digitalocean/cost-monitor.sh --budget 35000 monitor
```

#### Disaster Recovery Test

```bash
# 1. Create test environment
kubectl create namespace gomeet-dr-test

# 2. Restore latest backup to test
./deployment/digitalocean/backup-restore.sh --namespace gomeet-dr-test restore-spaces $(aws s3 ls s3://gomeet-backups/backups/ --recursive | sort | tail -n 1 | awk '{print $4}')

# 3. Verify application functionality
./deployment/digitalocean/health-check.sh --namespace gomeet-dr-test check

# 4. Clean up test environment
kubectl delete namespace gomeet-dr-test
```

## Troubleshooting

### Common Issues

#### Service Not Starting

**Symptoms**: Pods in CrashLoopBackOff or Pending state

**Diagnosis**:

```bash
# Check pod status
kubectl get pods -n gomeet
kubectl describe pod <pod-name> -n gomeet

# Check logs
kubectl logs <pod-name> -n gomeet --previous

# Check events
kubectl get events -n gomeet --sort-by='.lastTimestamp'
```

**Common Causes**:

- Resource constraints
- Image pull errors
- Configuration issues
- Database connectivity

**Solutions**:

```bash
# Resource constraints
kubectl patch deployment auth-service -n gomeet -p '{"spec":{"template":{"spec":{"containers":[{"name":"auth-service","resources":{"limits":{"cpu":"1000m","memory":"2Gi"}}}]}}}}'

# Image pull errors
kubectl delete pod <pod-name> -n gomeet --force
docker pull registry.digitalocean.com/gomeet/auth-service:latest

# Configuration issues
kubectl get configmap auth-config -n gomeet -o yaml
kubectl edit configmap auth-config -n gomeet
```

#### High CPU/Memory Usage

**Symptoms**: Nodes or pods with high resource utilization

**Diagnosis**:

```bash
# Check node usage
kubectl top nodes
kubectl describe node <node-name>

# Check pod usage
kubectl top pods -n gomeet --sort-by=cpu
kubectl top pods -n gomeet --sort-by=memory

# Resource quotas
kubectl describe quota -n gomeet
```

**Solutions**:

```bash
# Scale up services
./deployment/digitalocean/scale-services.sh manual auth-service 20

# Add nodes to cluster
doctl kubernetes cluster node-pool add gomeet-cluster --name=additional-pool --count=3 --size=c-32

# Optimize resource requests
kubectl patch deployment auth-service -n gomeet -p '{"spec":{"template":{"spec":{"containers":[{"name":"auth-service","resources":{"requests":{"cpu":"500m","memory":"1Gi"}}}]}}}}'
```

#### Database Connectivity Issues

**Symptoms**: Application unable to connect to PostgreSQL or Redis

**Diagnosis**:

```bash
# Check database status
kubectl get pods -n gomeet -l app=postgres-primary
kubectl logs postgres-primary-0 -n gomeet

# Test connectivity
kubectl exec -it auth-service-xxx -n gomeet -- nc -zv postgres-primary 5432

# Check secrets
kubectl get secret postgres-secret -n gomeet -o yaml
```

**Solutions**:

```bash
# Restart database
kubectl delete pod postgres-primary-0 -n gomeet

# Update connection string
kubectl edit configmap auth-config -n gomeet

# Rotate credentials
kubectl delete secret postgres-secret -n gomeet
./deployment/digitalocean/setup-secrets.sh --database
```

#### Load Balancer Issues

**Symptoms**: External traffic not reaching services

**Diagnosis**:

```bash
# Check load balancer status
kubectl get svc -n gomeet --field-selector spec.type=LoadBalancer
kubectl describe svc traefik -n gomeet

# Check ingress
kubectl get ingress -n gomeet
kubectl describe ingress gomeet-ingress -n gomeet

# Test external connectivity
curl -I https://app.gomeet.app
```

**Solutions**:

```bash
# Recreate load balancer
kubectl delete svc traefik -n gomeet
kubectl apply -f deployment/digitalocean/traefik-gateway.yaml

# Update DNS
doctl compute domain records create gomeet.app --record-type A --record-name @ --record-data $(kubectl get svc traefik -n gomeet -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Check firewall
doctl compute firewall list
doctl compute firewall add-rules <firewall-id> --inbound-rules "protocol:tcp,ports:443,address:0.0.0.0/0"
```

### Debugging Techniques

#### Port Forwarding

```bash
# Forward service to localhost
kubectl port-forward svc/auth-service 8080:8080 -n gomeet

# Forward database
kubectl port-forward postgres-primary-0 5432:5432 -n gomeet

# Forward Redis
kubectl port-forward redis-primary-0 6379:6379 -n gomeet
```

#### Debug Pods

```bash
# Create debug pod
kubectl run debug-pod --image=busybox --rm -it --restart=Never -- /bin/sh

# Debug existing pod
kubectl debug auth-service-xxx -n gomeet --image=busybox --copy-to=debug-auth --share-processes -- /bin/sh

# Check network connectivity
kubectl exec -it auth-service-xxx -n gomeet -- nslookup postgres-primary.gomeet.svc.cluster.local
```

#### Log Analysis

```bash
# Stream logs from multiple pods
stern -n gomeet auth-service

# Search logs for errors
kubectl logs -n gomeet -l app=auth-service --since=1h | grep ERROR

# Export logs
kubectl logs -n gomeet -l app=auth-service --since=24h > auth-service-logs.txt
```

## Emergency Procedures

### Service Outage Response

#### Immediate Response (0-15 minutes)

1. **Assess Impact**

```bash
./deployment/digitalocean/health-check.sh --format json check
```

2. **Identify Affected Services**

```bash
kubectl get pods -n gomeet --field-selector=status.phase!=Running
kubectl get events -n gomeet --sort-by='.lastTimestamp' | tail -20
```

3. **Check Load Balancer**

```bash
kubectl get svc -n gomeet --field-selector spec.type=LoadBalancer
curl -I https://app.gomeet.app
```

4. **Notify Team**

```bash
curl -X POST -H 'Content-type: application/json' \
  --data '{"text":"🚨 GoMeet service outage detected!\nTime: '$(date)'\nCheck: https://github.com/your-org/gomeet/actions"}' \
  $SLACK_WEBHOOK_URL
```

#### Investigation (15-60 minutes)

1. **Root Cause Analysis**

```bash
# Check recent changes
kubectl rollout history deployment/auth-service -n gomeet
kubectl get events -n gomeet --since=1h

# Resource analysis
kubectl top nodes
kubectl top pods -n gomeet --sort-by=cpu

# Database status
kubectl exec postgres-primary-0 -n gomeet -- pg_isready
```

2. **Implement Quick Fix**

```bash
# Restart problematic services
kubectl rollout restart deployment/auth-service -n gomeet

# Scale up if needed
kubectl scale deployment auth-service --replicas=20 -n gomeet

# Rollback if needed
./deployment/digitalocean/rolling-update.sh rollback auth-service
```

#### Recovery (60+ minutes)

1. **Full System Recovery**

```bash
# Restore from backup if needed
./deployment/digitalocean/backup-restore.sh restore-spaces $(aws s3 ls s3://gomeet-backups/backups/ --recursive | sort | tail -n 5 | head -n 1 | awk '{print $4}')

# Verify all services
./deployment/digitalocean/health-check.sh --continuous 300 check
```

2. **Post-Incident Review**

```bash
# Generate incident report
./deployment/digitalocean/health-check.sh --format json check > incident-report-$(date +%Y%m%d).json

# Review monitoring data
kubectl get events -n gomeet --since=6h > incident-events.log
```

### Database Emergency Procedures

#### PostgreSQL Recovery

```bash
# 1. Check cluster status
kubectl get postgrescluster -n gomeet
kubectl describe postgrescluster gomeet-db -n gomeet

# 2. Failover to standby
kubectl patch postgrescluster gomeet-db -n gomeet -p '{"spec":{"standby":{"enabled":false}}}'

# 3. Restore from backup
./deployment/digitalocean/backup-restore.sh --namespace gomeet restore postgres-backup-20231025.sql

# 4. Verify data integrity
kubectl exec postgres-primary-0 -n gomeet -- psql -U postgres -d gomeet -c "SELECT count(*) FROM users;"
```

#### Redis Recovery

```bash
# 1. Check Redis cluster
kubectl get redis -n gomeet
kubectl describe redis gomeet-redis -n gomeet

# 2. Restart Redis
kubectl delete pod redis-primary-0 -n gomeet
kubectl delete pod redis-replica-0 -n gomeet
kubectl delete pod redis-replica-1 -n gomeet

# 3. Restore from backup
kubectl cp redis-backup.rdb redis-primary-0:/data/dump.rdb -n gomeet
kubectl delete pod redis-primary-0 -n gomeet
```

### Security Incident Response

#### Immediate Containment

```bash
# 1. Isolate affected services
kubectl networkpolicy deny-all --namespace=gomeet
kubectl apply -f - <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: emergency-lockdown
  namespace: gomeet
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
EOF

# 2. Rotate secrets
kubectl delete secret postgres-secret -n gomeet
kubectl delete secret redis-secret -n gomeet
./deployment/digitalocean/setup-secrets.sh

# 3. Enable audit logging
kubectl create configmap audit-config --from-file=audit-policy.yaml -n gomeet
```

#### Investigation and Recovery

```bash
# 1. Collect forensic data
kubectl get pods -n gomeet -o yaml > pod-inventory-$(date +%Y%m%d).json
kubectl get events -n gomeet --sort-by='.lastTimestamp' > events-$(date +%Y%m%d).log

# 2. Analyze access logs
kubectl logs -n gomeet -l app=traefik --since=24h | grep "401\|403\|429"

# 3. Restore normal operations
kubectl delete networkpolicy emergency-lockdown -n gomeet
./deployment/digitalocean/rolling-update.sh update auth-service latest
```

## Performance Tuning

### Kubernetes Optimization

#### Node Configuration

```yaml
# Example node tuning
apiVersion: v1
kind: Node
metadata:
  name: optimized-node
  labels:
    node-type: high-performance
spec:
  kubelet:
    maxPods: 200
    podPidsLimit: 2048
    containerLogMaxSize: 100Mi
    containerLogMaxFiles: 10
    evictionHard:
      imagefs.available: 10%
      memory.available: 500Mi
      nodefs.available: 10%
```

#### Resource Allocation

```bash
# Optimize resource requests/limits
kubectl patch deployment auth-service -n gomeet -p '{
  "spec": {
    "template": {
      "spec": {
        "containers": [{
          "name": "auth-service",
          "resources": {
            "requests": {"cpu": "500m", "memory": "1Gi"},
            "limits": {"cpu": "2000m", "memory": "4Gi"}
          }
        }]
      }
    }
  }
}'
```

#### Network Optimization

```yaml
# Network policy optimization
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: optimized-network
  namespace: gomeet
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: gomeet
      ports:
        - protocol: TCP
          port: 8080
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: gomeet
        - namespaceSelector:
            matchLabels:
              name: kube-system
```

### Application Optimization

#### Database Performance

```sql
-- PostgreSQL optimization
ALTER SYSTEM SET shared_buffers = '8GB';
ALTER SYSTEM SET effective_cache_size = '24GB';
ALTER SYSTEM SET work_mem = '256MB';
ALTER SYSTEM SET maintenance_work_mem = '1GB';
SELECT pg_reload_conf();

-- Create indexes for performance
CREATE INDEX CONCURRENTLY idx_meetings_created_at ON meetings(created_at);
CREATE INDEX CONCURRENTLY idx_participants_meeting_id ON participants(meeting_id);
```

#### Redis Optimization

```bash
# Redis configuration optimization
kubectl exec redis-primary-0 -n gomeet -- redis-cli CONFIG SET maxmemory-policy allkeys-lru
kubectl exec redis-primary-0 -n gomeet -- redis-cli CONFIG SET save "900 1 300 10 60 10000"
kubectl exec redis-primary-0 -n gomeet -- redis-cli CONFIG SET tcp-keepalive 300
```

#### LiveKit Performance

```yaml
# LiveKit SFU optimization
apiVersion: v1
kind: ConfigMap
metadata:
  name: livekit-config
  namespace: gomeet
data:
  config.yaml: |
    redis:
      address: redis-primary.gomeet.svc.cluster.local:6379
    room:
      empty_timeout: 300s
      max_participants: 500
    turn:
      udp_port_range: "10000-20000"
      tcp_port_range: "10000-20000"
    webhook:
      url: http://signaling-service.gomeet.svc.cluster.local:8080/webhook
```

### Monitoring Optimization

#### Prometheus Configuration

```yaml
# Prometheus optimization
apiVersion: v1
kind: ConfigMap
metadata:
  name: prometheus-config
  namespace: gomeet
data:
  prometheus.yml: |
    global:
      scrape_interval: 15s
      evaluation_interval: 15s
    rule_files:
      - "/etc/prometheus/rules/*.yml"
    scrape_configs:
      - job_name: 'kubernetes-pods'
        kubernetes_sd_configs:
        - role: pod
          namespaces:
            names:
            - gomeet
        relabel_configs:
        - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
          action: keep
          regex: true
        - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
          action: replace
          target_label: __metrics_path__
          regex: (.+)
```

#### Grafana Dashboards

```json
{
  "dashboard": {
    "title": "GoMeet Performance",
    "panels": [
      {
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(http_requests_total{namespace=\"gomeet\"}[5m])) by (service)",
            "legendFormat": "{{service}}"
          }
        ]
      },
      {
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{namespace=\"gomeet\"}[5m])) by (le, service))",
            "legendFormat": "{{service}} P95"
          }
        ]
      }
    ]
  }
}
```

## Security Best Practices

### Network Security

```yaml
# Firewall rules
apiVersion: v1
kind: NetworkPolicy
metadata:
  name: gomeet-security
  namespace: gomeet
spec:
  podSelector: {}
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - namespaceSelector:
            matchLabels:
              name: gomeet
      ports:
        - protocol: TCP
          port: 8080
        - protocol: TCP
          port: 8443
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: gomeet
    - to: []
      ports:
        - protocol: TCP
          port: 53
        - protocol: UDP
          port: 53
        - protocol: TCP
          port: 443
```

### Secrets Management

```bash
# Encrypt secrets at rest
kubectl create secret generic app-secrets \
  --from-literal=jwt-key=$(openssl rand -base64 32) \
  --from-literal=turn-secret=$(openssl rand -base64 32) \
  --namespace=gomeet \
  --dry-run=client -o yaml | \
  kubectl apply -f -

# Rotate secrets regularly
./deployment/digitalocean/setup-secrets.sh --rotate
```

### Pod Security

```yaml
# Security context for pods
apiVersion: v1
kind: Pod
metadata:
  name: secure-pod
spec:
  securityContext:
    runAsNonRoot: true
    runAsUser: 1000
    runAsGroup: 1000
    fsGroup: 1000
  containers:
    - name: app
      image: registry.digitalocean.com/gomeet/auth-service:latest
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        capabilities:
          drop:
            - ALL
        volumeMounts:
          - name: tmp
            mountPath: /tmp
  volumes:
    - name: tmp
      emptyDir: {}
```

### RBAC Configuration

```yaml
# Role-based access control
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  namespace: gomeet
  name: gomeet-operator
rules:
  - apiGroups: [""]
    resources: ["pods", "services", "configmaps", "secrets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["apps"]
    resources: ["deployments", "replicasets"]
    verbs: ["get", "list", "watch", "update", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  namespace: gomeet
  name: gomeet-operator-binding
subjects:
  - kind: ServiceAccount
    name: gomeet-operator
    namespace: gomeet
roleRef:
  kind: Role
  name: gomeet-operator
  apiGroup: rbac.authorization.k8s.io
```

## Cost Optimization

### Resource Optimization

```bash
# Right-size nodes
kubectl get nodes --no-headers | awk '{print $1, $3, $5, $6}'

# Identify underutilized pods
kubectl top pods -n gomeet --sort-by=cpu | head -10
kubectl top pods -n gomeet --sort-by=memory | head -10

# Optimize resource requests
./deployment/digitalocean/scale-services.sh auto --optimize
```

### Auto-scaling Configuration

```yaml
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: auth-service-hpa
  namespace: gomeet
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: auth-service
  minReplicas: 8
  maxReplicas: 20
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
    - type: Resource
      resource:
        name: memory
        target:
          type: Utilization
          averageUtilization: 80
```

### Cluster Autoscaler

```yaml
# Cluster autoscaler configuration
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cluster-autoscaler
  namespace: kube-system
spec:
  template:
    spec:
      containers:
        - image: k8s.gcr.io/autoscaling/cluster-autoscaler:v1.21.0
          name: cluster-autoscaler
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
```

### Storage Optimization

```bash
# Clean up unused PVCs
kubectl get pvc -n gomeet -o json | jq '.items[] | select(.status.phase == "Bound" and .spec.volumeName == null) | .metadata.name' | xargs -r kubectl delete pvc -n gomeet

# Optimize storage classes
kubectl get storageclass
kubectl annotate storageclass do-block-storage storageclass.kubernetes.io/is-default-class="false"
```

## Monitoring and Alerting

### Prometheus Metrics

```yaml
# Custom metrics configuration
apiVersion: v1
kind: ConfigMap
metadata:
  name: custom-metrics
  namespace: gomeet
data:
  metrics.yml: |
    - pattern: 'gomeet_http_requests_total{service=".*",method=".*",status=".*"}'
      name: 'http_requests_total'
      labels:
        service: '$1'
        method: '$2'
        status: '$3'
    - pattern: 'gomeet_websocket_connections_total{service=".*"}'
      name: 'websocket_connections_total'
      labels:
        service: '$1'
```

### Alerting Rules

```yaml
# Prometheus alerting rules
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: gomeet-alerts
  namespace: gomeet
spec:
  groups:
    - name: gomeet.rules
      rules:
        - alert: HighErrorRate
          expr: sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) * 100 > 5
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High error rate detected"
            description: "Error rate is {{ $value }}% for the last 5 minutes"

        - alert: HighResponseTime
          expr: histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, service)) > 1
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High response time detected"
            description: "95th percentile response time is {{ $value }}s"

        - alert: DatabaseDown
          expr: up{job="postgres"} == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "Database is down"
            description: "PostgreSQL database has been down for more than 1 minute"
```

### Grafana Dashboards

```json
{
  "dashboard": {
    "title": "GoMeet System Overview",
    "panels": [
      {
        "title": "Active Meetings",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(gomeet_active_meetings_total)",
            "legendFormat": "Active Meetings"
          }
        ]
      },
      {
        "title": "Total Participants",
        "type": "stat",
        "targets": [
          {
            "expr": "sum(gomeet_participants_total)",
            "legendFormat": "Total Participants"
          }
        ]
      },
      {
        "title": "Resource Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "sum(rate(container_cpu_usage_seconds_total{namespace=\"gomeet\"}[5m])) by (pod)",
            "legendFormat": "CPU - {{pod}}"
          },
          {
            "expr": "sum(container_memory_working_set_bytes{namespace=\"gomeet\"}) by (pod) / 1024 / 1024",
            "legendFormat": "Memory - {{pod}}"
          }
        ]
      }
    ]
  }
}
```

### Log Aggregation

```yaml
# Fluentd configuration for log aggregation
apiVersion: v1
kind: ConfigMap
metadata:
  name: fluentd-config
  namespace: gomeet
data:
  fluent.conf: |
    <source>
      @type tail
      path /var/log/containers/*.log
      pos_file /var/log/fluentd-containers.log.pos
      tag kubernetes.*
      format json
      time_key time
      time_format %Y-%m-%dT%H:%M:%S.%NZ
    </source>

    <filter kubernetes.**>
      @type kubernetes_metadata
    </filter>

    <match kubernetes.**>
      @type elasticsearch
      host elasticsearch.gomeet.svc.cluster.local
      port 9200
      index_name gomeet-logs
      type_name _doc
    </match>
```

---

## Quick Reference Commands

### Essential Commands

```bash
# Health check
./deployment/digitalocean/health-check.sh check

# Deploy new version
./deployment/digitalocean/rolling-update.sh update auth-service v1.2.3

# Scale services
./deployment/digitalocean/scale-services.sh manual livekit-sfu 50

# Backup
./deployment/digitalocean/backup-restore.sh backup

# Cost monitoring
./deployment/digitalocean/cost-monitor.sh monitor

# View logs
kubectl logs -f -n gomeet -l app=auth-service

# Port forward
kubectl port-forward svc/auth-service 8080:8080 -n gomeet

# Exec into pod
kubectl exec -it auth-service-xxx -n gomeet -- /bin/bash
```

### Emergency Commands

```bash
# Immediate rollback
./deployment/digitalocean/rolling-update.sh rollback auth-service

# Emergency scale up
kubectl scale deployment auth-service --replicas=50 -n gomeet

# Restart all services
kubectl rollout restart deployment/auth-service -n gomeet
kubectl rollout restart deployment/meeting-service -n gomeet
kubectl rollout restart deployment/signaling-service -n gomeet

# Force delete pod
kubectl delete pod auth-service-xxx -n gomeet --force --grace-period=0

# Restore from backup
./deployment/digitalocean/backup-restore.sh restore-spaces latest-backup.tar.gz
```

This operations runbook provides comprehensive guidance for managing the GoMeet DigitalOcean deployment. Regular updates and reviews should be performed to ensure procedures remain current and effective.
