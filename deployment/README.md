# GoMeet Infrastructure Deployment Guide

## Overview

Dokumen ini berisi panduan lengkap untuk deployment infrastruktur GoMeet yang dirancang untuk mendukung **500 participants per meeting** dengan total **50,000 concurrent participants**. Infrastruktur telah dioptimalkan untuk performance, reliability, dan scalability pada skala besar.

## 🚀 What's New (Updated for 500 Participants Scale)

### Enhanced Components

- **LiveKit SFU**: 25 nodes dengan auto-scaling (15-50 nodes)
- **PostgreSQL**: Enhanced dengan 4 sharding strategy dan optimized connection pooling
- **Redis**: 12 nodes (6 masters + 6 replicas) untuk 50,000 connections
- **API Services**: Significantly increased resource limits dan HPA configurations
- **Traefik Gateway**: Enhanced dengan circuit breakers dan high throughput optimization
- **Monitoring**: Comprehensive metrics untuk 500 participants scale

### Performance Improvements

- **Simulcast & Adaptive Bitrate** untuk video streaming
- **Connection Pooling** dengan PgBouncer (5000 max connections)
- **Horizontal Pod Autoscaling** dengan custom metrics
- **Circuit Breakers** untuk fault tolerance
- **Enhanced Health Checks** dan monitoring

## Prerequisites

### System Requirements

- **Kubernetes Cluster** v1.24+ dengan minimal 20 nodes
- **DigitalOcean Account** dengan akses ke Singapore region
- **kubectl** terinstall dan terkonfigurasi
- **doctl** (DigitalOcean CLI) terinstall
- **Domain names** untuk:
  - `api.gomeet.com`
  - `livekit.gomeet.com`
  - `grafana.gomeet.com`
  - `traefik.gomeet.com`
  - `alertmanager.gomeet.com`

### Resource Requirements

| Component          | vCPU    | Memory      | Storage  | Nodes  |
| ------------------ | ------- | ----------- | -------- | ------ |
| Kubernetes Masters | 8       | 32GB        | 200GB    | 3      |
| Kubernetes Workers | 16      | 64GB        | 1TB      | 20     |
| Load Balancer      | -       | -           | -        | 6      |
| **Total**          | **344** | **1,376GB** | **20TB** | **29** |

## Quick Start

### 1. Environment Setup

```bash
# Export DigitalOcean token
export DIGITALOCEAN_TOKEN="your-do-token"

# Clone repository
git clone <repository-url>
cd gomeet/deployment

# Make deploy script executable
chmod +x deploy.sh
```

### 2. Deploy Infrastructure

```bash
# Deploy complete infrastructure for 500 participants scale
./deploy.sh deploy

# Monitor deployment progress
watch kubectl get pods -n gomeet
```

### 3. Verify Deployment

```bash
# Run comprehensive health checks
./deploy.sh health-check

# Run performance validation
./deploy.sh performance-check

# Prepare load testing
./deploy.sh prepare-load-test

# Check service status
kubectl get services -n gomeet

# Access Grafana dashboard
kubectl port-forward -n gomeet svc/grafana 3000:3000
```

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │   API Gateway   │    │   WebSocket LB  │
│   (Traefik)     │    │   (Traefik)     │    │   (Traefik)     │
│   (6 nodes)     │    │   (6 nodes)     │    │   (6 nodes)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │                       │                       │
          └───────────────────────┼───────────────────────┘
                                  │
     ┌─────────────────────────────┼─────────────────────────────┐
     │                             │                             │
┌───▼────┐    ┌─────────────┐ ┌───▼────┐    ┌─────────────┐ ┌───▼────┐
│ API    │    │ LiveKit SFU │ │ Sign-  │    │ PostgreSQL  │ │ Redis  │
│ Services│    │ Cluster     │ │ aling  │    │ Cluster     │ │ Cluster│
│ (60x)  │    │ (25 nodes)  │ │ Service│    │ (4 shards)   │ │ (12 nodes)│
└────────┘    └─────────────┘ └────────┘    └─────────────┘ └────────┘
```

## Component Details

### 1. LiveKit SFU Cluster (Enhanced)

**Spesifikasi:**

- 25 nodes dengan auto-scaling (15-50 nodes)
- 16 vCPU, 64GB RAM per node (ditingkat dari 8 vCPU, 32GB)
- Dukungan 20 participants per node (500 total)
- Simulcast dengan 3 layers untuk adaptive bitrate
- WebRTC port range: 10000-20000
- Recording support dengan 5TB storage

**Scaling:**

- Scale up: CPU > 70% atau participants > 400 per node
- Scale down: CPU < 30% selama 5 menit
- Custom metric: `livekit_participants_total`

**Key Features:**

- Adaptive streaming dengan bandwidth optimization
- Circuit breakers untuk fault tolerance
- Enhanced error handling dan recovery

### 2. API Services (Enhanced)

**Service Breakdown:**

- **Auth Service**: 8 replicas (4000m CPU, 8GB RAM) - Auto-scale 8-20
- **Meeting Service**: 12 replicas (4000m CPU, 8GB RAM) - Auto-scale 12-30
- **Signaling Service**: 25 replicas (6000m CPU, 12GB RAM) - Auto-scale 25-60
- **Chat Service**: 10 replicas (3000m CPU, 6GB RAM) - Auto-scale 10-25
- **TURN Service**: 8 replicas (2000m CPU, 4GB RAM) - Auto-scale 8-20

**Enhanced Features:**

- Connection pooling dengan 500 max connections
- Circuit breakers untuk fault tolerance
- Enhanced rate limiting (1000 req/min)
- WebSocket compression
- Custom timeout configurations

### 3. Database Layer (Enhanced)

**PostgreSQL Cluster:**

- 1 primary + 3 replicas (ditingkat dari 2 replicas)
- 16 vCPU, 64GB RAM per node (ditingkat dari 8 vCPU, 32GB)
- 4 sharding strategy (ditingkat dari 3 shards)
- 16 partitions per shard untuk optimal distribution
- Enhanced connection pooling dengan PgBouncer (5000 max connections)
- Optimized query performance dengan parallel processing

**Redis Cluster:**

- 6 masters + 6 replicas (ditingkat dari 3+3)
- 8 vCPU, 32GB RAM per node (ditingkat dari 4 vCPU, 16GB)
- Support untuk 50,000 concurrent connections
- Multi-threading untuk high throughput
- Enhanced memory optimization dengan active defragmentation

### 4. API Gateway (Enhanced)

**Traefik Configuration:**

- 6 replicas dengan auto-scaling (6-15 nodes)
- 4 vCPU, 8GB RAM per replica (ditingkat dari 2 vCPU, 4GB)
- Circuit breakers untuk semua services
- Enhanced rate limiting (1000 req/min API, 2000 req/min WebSocket)
- WebSocket compression dan optimization
- Custom timeout configurations

**Load Balancing:**

- High availability dengan multiple instances
- Health checks dengan custom thresholds
- SSL termination dengan modern cipher suites

### 5. Monitoring Stack (Enhanced)

**Components:**

- **Prometheus**: 2 replicas (8 vCPU, 16GB RAM) - 500GB storage
- **Grafana**: 3 replicas (2 vCPU, 4GB RAM) - 50GB storage
- **AlertManager**: 2 replicas (1 vCPU, 2GB RAM) - 20GB storage

**Enhanced Metrics:**

- Custom alerts untuk 500 participants scale
- WebRTC performance metrics
- Database connection monitoring
- Redis memory usage tracking
- API latency monitoring

## Configuration Files

### Kubernetes Manifests

- [`namespace.yaml`](k8s/namespace.yaml) - Namespace configuration
- [`livekit-sfu.yaml`](k8s/livekit-sfu.yaml) - Enhanced LiveKit SFU cluster
- [`postgresql-cluster.yaml`](k8s/postgresql-cluster.yaml) - Enhanced PostgreSQL cluster
- [`redis-cluster.yaml`](k8s/redis-cluster.yaml) - Enhanced Redis cluster
- [`api-services.yaml`](k8s/api-services.yaml) - Enhanced API microservices
- [`traefik-gateway.yaml`](k8s/traefik-gateway.yaml) - Enhanced API Gateway
- [`monitoring-stack.yaml`](k8s/monitoring-stack.yaml) - Enhanced monitoring stack

### Documentation

- [`INFRASTRUCTURE_DESIGN_500_PARTICIPANTS.md`](../INFRASTRUCTURE_DESIGN_500_PARTICIPANTS.md) - Complete infrastructure design
- [`DISASTER_RECOVERY_PROCEDURES.md`](../DISASTER_RECOVERY_PROCEDURES.md) - Disaster recovery guide

## Deployment Steps

### Step 1: Prerequisites Check

```bash
# Verify kubectl connectivity
kubectl cluster-info

# Verify doctl authentication
doctl account get

# Check available resources (minimum 20 nodes recommended)
kubectl describe nodes

# Verify cluster resource availability
./deploy.sh deploy  # Will check prerequisites automatically
```

### Step 2: Namespace and Secrets

```bash
# Create namespace
kubectl apply -f k8s/namespace.yaml

# Create secrets (auto-generated passwords)
# Secrets include: DB passwords, API keys, JWT secrets, TURN credentials
```

### Step 3: Database Deployment

```bash
# Deploy PostgreSQL cluster with 4 shards
kubectl apply -f k8s/postgresql-cluster.yaml

# Wait for readiness (increased timeout for large scale)
kubectl wait --for=condition=ready pod -l app=postgres -n gomeet --timeout=600s

# Verify replication
kubectl exec postgres-primary-0 -n gomeet -- psql -U postgres -c "SELECT * FROM pg_stat_replication;"

# Check PgBouncer status
kubectl logs -n gomeet deployment/pgbouncer --tail=20
```

### Step 4: Redis Cluster

```bash
# Deploy Redis cluster (12 nodes)
kubectl apply -f k8s/redis-cluster.yaml

# Initialize cluster
kubectl wait --for=condition=complete job/redis-cluster-init -n gomeet --timeout=600s

# Verify cluster status
kubectl exec redis-master-0 -n gomeet -- redis-cli cluster info

# Check connection capacity
kubectl exec redis-master-0 -n gomeet -- redis-cli config get maxclients
```

### Step 5: Application Services

```bash
# Deploy LiveKit SFU (25 nodes)
kubectl apply -f k8s/livekit-sfu.yaml

# Deploy API services (60 total replicas)
kubectl apply -f k8s/api-services.yaml

# Deploy enhanced API Gateway (6 nodes)
kubectl apply -f k8s/traefik-gateway.yaml

# Verify HPA configurations
kubectl get hpa -n gomeet
```

### Step 6: Monitoring

```bash
# Deploy enhanced monitoring stack
kubectl apply -f k8s/monitoring-stack.yaml

# Access Grafana
kubectl port-forward -n gomeet svc/grafana 3000:3000

# Check Prometheus targets
kubectl port-forward -n gomeet svc/prometheus 9090:9090
```

## Post-Deployment Configuration

### 1. DNS Configuration

```bash
# Get Load Balancer IP
LB_IP=$(kubectl get service traefik -n gomeet -o jsonpath='{.status.loadBalancer.ingress[0].ip}')

# Configure DNS records
# A records:
# api.gomeet.com -> $LB_IP
# livekit.gomeet.com -> $LB_IP
# grafana.gomeet.com -> $LB_IP
# traefik.gomeet.com -> $LB_IP
# alertmanager.gomeet.com -> $LB_IP
```

### 2. SSL Certificates

```bash
# SSL certificates will be auto-generated by Traefik with modern cipher suites
# Monitor certificate status:
kubectl describe certificate -n gomeet

# Verify TLS configuration
kubectl get tlsstore -n gomeet
```

### 3. Monitoring Alerts

```bash
# Configure alert routing in AlertManager
# Update Slack webhook URLs in secrets
# Configure email notifications
# Test alert delivery
```

## Performance Testing

### Load Testing Preparation

```bash
# Prepare load testing configuration
./deploy.sh prepare-load-test

# This creates load-test-config.json with:
# - Target scale: 500 participants per meeting
# - 100 concurrent meetings
# - 50,000 total concurrent participants
```

### Load Testing Scripts

```bash
# WebSocket connection test (50,000 connections)
k6 run --vus 50000 --duration 10m tests/websocket-load-test.js

# API performance test (1000 concurrent users)
k6 run --vus 1000 --duration 15m tests/api-load-test.js

# SFU performance test (500 participants per room)
k6 run --vus 500 --duration 30m tests/sfu-load-test.js

# Comprehensive load test (all services)
k6 run --vus 1000 --duration 1h tests/comprehensive-load-test.js
```

### Expected Performance Metrics

| Metric                    | Target | Critical |
| ------------------------- | ------ | -------- |
| WebSocket connections     | 50,000 | 45,000   |
| API response time (p95)   | <200ms | >500ms   |
| Video latency             | <150ms | >300ms   |
| SFU bandwidth per room    | <3Gbps | >5Gbps   |
| Database query time (p95) | <100ms | >500ms   |
| Redis memory usage        | <85%   | >95%     |
| CPU utilization           | <70%   | >90%     |
| Memory utilization        | <80%   | >95%     |

## Monitoring and Troubleshooting

### Key Metrics to Monitor

1. **WebSocket Connections**: `websocket_connections_active`
2. **SFU Performance**: `livekit_participants_total`, `sfu_bandwidth_bytes_per_second`
3. **API Performance**: `http_request_duration_seconds`, `http_requests_total`
4. **Database**: `pg_stat_database_numbackends`, `pg_stat_statements_mean_time_seconds`
5. **Redis**: `redis_memory_used_bytes`, `redis_connected_clients`
6. **Circuit Breakers**: `circuit_breaker_state`, `circuit_breaker_failures_total`

### Enhanced Health Checks

```bash
# Run comprehensive health checks
./deploy.sh health-check

# Run performance validation
./deploy.sh performance-check

# Check auto-scaling status
kubectl get hpa -n gomeet -w

# Monitor resource utilization
kubectl top pods -n gomeet --sort-by=cpu
kubectl top nodes --sort-by=memory
```

### Common Issues and Solutions

#### High WebSocket Connection Failures

```bash
# Check signaling service resource usage
kubectl top pods -n gomeet -l app=signaling-service

# Verify Redis connectivity and capacity
kubectl exec redis-master-0 -n gomeet -- redis-cli info clients

# Check circuit breaker status
kubectl logs -n gomeet deployment/signaling-service | grep "circuit"

# Scale signaling service if needed
kubectl scale deployment signaling-service --replicas=30 -n gomeet
```

#### SFU Performance Issues

```bash
# Check SFU node resource usage
kubectl top pods -n gomeet -l app=livekit-sfu

# Verify simulcast configuration
kubectl exec livekit-sfu-0 -n gomeet -- curl localhost:7880/health

# Check bandwidth usage
kubectl exec livekit-sfu-0 -n gomeet -- cat /proc/net/dev

# Scale SFU cluster manually
kubectl scale deployment livekit-sfu --replicas=30 -n gomeet
```

#### Database Connection Issues

```bash
# Check PgBouncer status and connection pool
kubectl logs -n gomeet deployment/pgbouncer --tail=50

# Verify database connections (5000 max)
kubectl exec postgres-primary-0 -n gomeet -- psql -U postgres -c "SELECT count(*) FROM pg_stat_activity;"

# Check query performance
kubectl exec postgres-primary-0 -n gomeet -- psql -U postgres -c "SELECT query, mean_time FROM pg_stat_statements ORDER BY mean_time DESC LIMIT 10;"

# Restart PgBouncer if needed
kubectl rollout restart deployment/pgbouncer -n gomeet
```

## Scaling and Maintenance

### Enhanced Auto-Scaling Configuration

All components are configured with Horizontal Pod Autoscalers (HPA):

```bash
# Check HPA status with custom metrics
kubectl get hpa -n gomeet -o wide

# View auto-scaling events
kubectl describe hpa livekit-sfu-hpa -n gomeet

# Monitor scaling decisions
kubectl get events -n gomeet --field-selector involvedObject.name=livekit-sfu-hpa
```

### Rolling Updates with Enhanced Safety

```bash
# Update API services with zero downtime
kubectl set image deployment/auth-service auth-service=gomeet/auth-service:v2.0.0 -n gomeet

# Monitor rollout status with enhanced checks
kubectl rollout status deployment/auth-service -n gomeet --timeout=600s

# Verify health after rollout
./deploy.sh health-check

# Rollback if needed with enhanced safety
./deploy.sh rollback
```

### Enhanced Backup and Recovery

Refer to [`DISASTER_RECOVERY_PROCEDURES.md`](../DISASTER_RECOVERY_PROCEDURES.md) untuk complete backup dan recovery procedures dengan:

- Point-in-time recovery untuk PostgreSQL
- Redis persistence dengan AOF dan RDB
- Automated backup schedules
- Disaster recovery testing procedures

## Security Considerations

### Enhanced Network Security

- Network policies untuk restrict traffic
- TLS 1.3 encryption untuk semua communications
- Modern cipher suites configuration
- Secrets management dengan Kubernetes secrets
- Regular security updates
- WebRTC security dengan DTLS-SRTP

### Enhanced Access Control

- RBAC untuk Kubernetes access
- API authentication dengan JWT
- Enhanced rate limiting untuk API endpoints
- CORS configuration untuk frontend
- TURN server authentication
- Circuit breaker protection

## Cost Optimization

### Resource Optimization

1. **Reserved Instances**: 30% discount untuk 1-year commitment
2. **Spot Instances**: 60-90% discount untuk non-critical services
3. **Enhanced Auto-scaling**: Scale down selama off-peak hours
4. **Storage Optimization**: Compression dan tiered storage
5. **Right-sizing**: Optimal resource allocation based on usage

### Estimated Monthly Costs (Updated)

| Component     | Instances | Cost/Unit | Total/Month |
| ------------- | --------- | --------- | ----------- |
| LiveKit SFU   | 25        | $334      | $8,350      |
| API Services  | 60        | $168      | $10,080     |
| PostgreSQL    | 4         | $534      | $2,136      |
| Redis         | 12        | $268      | $3,216      |
| Load Balancer | 6         | $40       | $240        |
| Monitoring    | 7         | $168      | $1,176      |
| **Total**     |           |           | **$25,198** |

**Optimized cost dengan reserved instances**: ~$17,500/bulan

## Support and Maintenance

### Enhanced Daily Operations

- Monitor system health via enhanced Grafana dashboard
- Review alert notifications dengan custom thresholds
- Check backup completion dengan verification
- Monitor resource utilization dengan detailed metrics
- Check auto-scaling events dan performance

### Enhanced Weekly Tasks

- Review performance metrics dengan trend analysis
- Update security patches dengan automated scanning
- Test disaster recovery procedures dengan realistic scenarios
- Clean up unused resources dengan cost optimization
- Validate circuit breaker configurations

### Enhanced Monthly Tasks

- Capacity planning review dengan growth projections
- Cost optimization analysis dengan detailed breakdown
- Security audit dengan penetration testing
- Performance tuning dengan bottleneck analysis
- Review auto-scaling policies effectiveness

## Emergency Contacts

- **On-call DevOps**: +62-812-3456-7890
- **Engineering Manager**: +62-813-4567-8901
- **DigitalOcean Support**: support@digitalocean.com
- **Emergency Slack**: #gomeet-emergency

## Contributing

Untuk membuat perubahan pada infrastruktur:

1. Buat perubahan pada staging environment
2. Jalankan comprehensive testing dengan load tests
3. Update dokumentasi dengan changelog
4. Submit pull request untuk review
5. Deploy ke production setelah approval
6. Monitor post-deployment performance

---

**Note**: Infrastructure ini telah dioptimalkan untuk high availability dan dapat menangani 500 participants per meeting dengan total 50,000 concurrent connections. Enhanced monitoring, auto-scaling, dan circuit breakers 确保 optimal performance dan reliability pada skala besar. Regular monitoring dan maintenance sangat penting untuk menjaga performance dan reliability.
