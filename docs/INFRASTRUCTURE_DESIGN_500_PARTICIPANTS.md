# GoMeet Infrastructure Design: 500 Participants per Meeting

## Executive Summary

> **📋 Navigation**: [← Back to Documentation Index](./README.md) | [Executive Summary](./EXECUTIVE_SUMMARY.md) | [Cost Details](./COST_ESTIMATION_500_PARTICIPANTS.md) | [Tasks](./task.md)

Dokumen ini merancang ulang infrastruktur GoMeet untuk mendukung **500 peserta per meeting** dengan total **50,000 concurrent participants** across 100 meetings simultaneously. Desain ini meningkatkan kapasitas 25x dari arsitektur existing yang hanya mendukung 20 peserta per meeting.

## Current Architecture Analysis

### Bottleneck Identifikasi

1. **P2P Mesh Topology Limitation**

   - Saat ini menggunakan P2P mesh yang menyebabkan O(n²) connections
   - Untuk 500 peserta = 124,750 connections (tidak scalable)
   - CPU usage meningkat eksponensial setiap tambahan peserta

2. **Monolithic Backend**

   - Single instance backend handling semua operasi
   - WebSocket hub dalam memory yang tidak terdistribusi
   - Database connection pooling terbatas

3. **Single Point of Failures**

   - Single Redis instance
   - Single PostgreSQL database
   - No horizontal scaling capability

4. **Resource Under-provisioning**
   - Current setup hanya untuk 20 peserta/meeting
   - Memory allocation tidak cukup untuk 500 concurrent connections
   - Bandwidth tidak dihitung untuk video streaming skala besar

## Target Architecture Overview

### Design Principles

1. **Microservices Architecture**
2. **Horizontal Scaling**
3. **High Availability**
4. **Cost Optimization**
5. **Security First**

### Core Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Load Balancer │    │   API Gateway   │    │   WebSocket LB  │
│   (Traefik)     │    │   (Traefik)     │    │   (Traefik)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
    ┌─────────────────────────────┼─────────────────────────────┐
    │                             │                             │
┌───▼────┐    ┌─────────────┐ ┌───▼────┐    ┌─────────────┐ ┌───▼────┐
│ API    │    │ LiveKit SFU │ │ Sign-  │    │ PostgreSQL  │ │ Redis  │
│ Services│    │ Cluster     │ │ aling  │    │ Cluster     │ │ Cluster│
│ (5x)   │    │ (10 nodes)  │ │ Service│    │ (3 nodes)   │ │ (6 nodes)│
└────────┘    └─────────────┘ └────────┘    └─────────────┘ └────────┘
    │              │             │              │              │
    └──────────────┼─────────────┼──────────────┼──────────────┘
                   │             │              │
         ┌─────────▼─────────────▼──────────────▼─────────┐
         │              Storage Layer                     │
         │  ┌─────────────┐ ┌─────────────┐ ┌───────────┐ │
         │  │   MinIO     │ │   Backups   │ │   CDN     │ │
         │  │  Cluster    │ │   Storage   │ │ (Cloudflare)│ │
         │  └─────────────┘ └─────────────┘ └───────────┘ │
         └─────────────────────────────────────────────────┘
```

## Resource Sizing Calculations

### 1. LiveKit SFU Cluster Requirements

**Per Node Specifications:**

- **CPU**: 16 vCPU (Intel Xeon atau AMD EPYC)
- **Memory**: 64GB RAM
- **Network**: 10Gbps dedicated
- **Storage**: 100GB NVMe SSD

**Capacity per Node:**

- Video streams: 50 participants @ 1080p (2Mbps each)
- Audio streams: 100 participants @ 64kbps each
- Total bandwidth: ~105Mbps per node
- CPU utilization: ~70% at 50 video streams

**Total SFU Nodes Required:**

```
500 participants / 50 participants per node = 10 nodes
+ 2 nodes for redundancy = 12 nodes total
```

**Auto-scaling Policy:**

- Scale up: CPU > 70% for 5 minutes
- Scale down: CPU < 30% for 10 minutes
- Minimum: 8 nodes, Maximum: 20 nodes

### 2. API Services Scaling

**Per Instance Specifications:**

- **CPU**: 4 vCPU
- **Memory**: 8GB RAM
- **Network**: 1Gbps
- **Connections**: 2,000 concurrent WebSocket connections

**Total API Instances:**

```
50,000 concurrent connections / 2,000 per instance = 25 instances
+ 5 instances for redundancy = 30 instances total
```

**Service Breakdown:**

- Authentication Service: 4 instances
- Meeting Management: 6 instances
- Signaling Service: 12 instances
- Chat Service: 4 instances
- TURN Management: 4 instances

### 3. PostgreSQL Cluster Design

**Primary Database Specifications:**

- **CPU**: 8 vCPU
- **Memory**: 32GB RAM
- **Storage**: 1TB NVMe SSD (IOPS: 10,000)
- **Connections**: 500 max connections

**Read Replicas:**

- 2 read replicas dengan spesifikasi sama
- Connection pooling via PgBouncer

**Sharding Strategy:**

```
Shard 1: Meetings 1-33 (Singapore region)
Shard 2: Meetings 34-66 (Singapore region)
Shard 3: Meetings 67-100 (Jakarta region for latency)
```

**Database Optimization:**

```sql
-- Partitioning by meeting_id
CREATE TABLE participants (
    id UUID PRIMARY KEY,
    meeting_id UUID NOT NULL,
    user_id UUID,
    created_at TIMESTAMP
) PARTITION BY HASH (meeting_id);

-- Create 8 partitions
CREATE TABLE participants_0 PARTITION OF participants FOR VALUES WITH (MODULUS 8, REMAINDER 0);
-- ... continue for partitions 1-7
```

### 4. Redis Cluster Architecture

**Cluster Configuration:**

- **Master Nodes**: 3 nodes
- **Replica Nodes**: 3 nodes (1 per master)
- **Total Nodes**: 6 nodes

**Per Node Specifications:**

- **CPU**: 4 vCPU
- **Memory**: 16GB RAM
- **Network**: 1Gbps
- **Storage**: 200GB SSD

**Memory Usage Calculation:**

```
Session data per participant: ~2KB
50,000 participants × 2KB = 100MB
Chat messages buffer: ~500MB
WebRTC signaling cache: ~200MB
Room state data: ~300MB
Total RAM needed: ~1.1GB per node
16GB RAM provides ample headroom
```

**Redis Data Structure:**

```
gomeet:sessions:{meeting_id}:{user_id} -> Hash (2KB)
gomeet:rooms:{meeting_id} -> Hash (5KB)
gomeet:chat:{meeting_id} -> List (max 1000 messages)
gomeet:signaling:{meeting_id} -> Stream (TTL 1 hour)
```

### 5. Network Infrastructure

**Bandwidth Requirements:**

**Per Meeting (500 participants):**

```
Video streams (assuming 50 active speakers @ 2Mbps):
50 × 2Mbps = 100Mbps upload to SFU
500 × 2Mbps = 1Gbps download from SFU

Audio streams (500 participants @ 64kbps):
500 × 64kbps = 32Mbps

Total per meeting: ~1.1Gbps
```

**Total Infrastructure (100 meetings):**

```
100 meetings × 1.1Gbps = 110Gbps
+ 30% overhead = 143Gbps total bandwidth
```

**Load Balancer Configuration:**

```yaml
# Traefik Configuration
entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https

  websecure:
    address: ":443"
    http:
      middlewares:
        - rate-limit@file
        - security-headers@file

  websocket:
    address: ":8080"
    http:
      middlewares:
        - websocket-headers@file

serversTransport:
  maxIdleConnsPerHost: 1000
  forwardingTimeouts:
    dialTimeout: 5s
    responseHeaderTimeout: 10s
```

### 6. Storage Strategy

**MinIO Cluster Configuration:**

- **Nodes**: 4 nodes (distributed across zones)
- **Per Node**: 2TB NVMe SSD
- **Total Storage**: 8TB (4TB usable with erasure coding)
- **Redundancy**: 50% (can lose 2 nodes)

**Recording Storage Calculation:**

```
Per meeting recording (1080p @ 2Mbps):
2Mbps × 3600 seconds = 9GB per hour
500 participants × 9GB = 4.5TB per meeting hour

Assuming average 2 hours per meeting:
100 meetings × 2 hours × 4.5TB = 900TB per day

With compression and optimization:
900TB × 0.3 = 270TB actual storage per day

Retention policy:
- Hot storage (30 days): 270TB × 30 = 8.1PB
- Cold storage (1 year): Move to S3 Glacier
```

**Storage Optimization:**

```yaml
# MinIO Configuration for Video Recording
apiVersion: v1
kind: ConfigMap
metadata:
  name: minio-config
data:
  config.yaml: |
    server:
      address: ":9000"
    storage:
      class: "standard"
      quota:
        size: "8TB"
    erasure:
      parity: 2  # EC:4+2 configuration
    compression:
      enabled: true
      algorithms:
        - "lz4"
    lifecycle:
      expiration:
        days: 30
      transition:
        days: 7
        storage_class: "GLACIER"
```

## Auto-Scaling Policies

### 1. LiveKit SFU Cluster

```yaml
# Horizontal Pod Autoscaler
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: livekit-sfu-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: livekit-sfu
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
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
        - type: Percent
          value: 100
          periodSeconds: 15
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
        - type: Percent
          value: 10
          periodSeconds: 60
```

### 2. API Services Auto-Scaling

```yaml
# API Gateway HPA
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: api-gateway-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: api-gateway
  minReplicas: 10
  maxReplicas: 50
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 60
    - type: Pods
      pods:
        metric:
          name: websocket_connections
        target:
          type: AverageValue
          averageValue: "1500"
```

### 3. Database Connection Pooling

```yaml
# PgBouncer Configuration
pgbouncer:
  admin_users: postgres
  stats_users: stats, postgres
  listen_port: 6432
  listen_addr: 0.0.0.0
  auth_type: md5
  auth_file: /etc/pgbouncer/userlist.txt
  logfile: /var/log/pgbouncer/pgbouncer.log
  pidfile: /var/run/pgbouncer/pgbouncer.pid
  admin_users: postgres
  stats_users: stats, postgres

  # Pool settings
  pool_mode: transaction
  max_client_conn: 2000
  default_pool_size: 100
  min_pool_size: 20
  reserve_pool_size: 10
  reserve_pool_timeout: 5
  max_db_connections: 500
  max_user_connections: 100

  # Timeouts
  server_reset_query: DISCARD ALL
  server_check_delay: 30
  server_check_query: select 1
  server_lifetime: 3600
  server_idle_timeout: 600
```

## Monitoring & Observability

### 1. Prometheus Configuration

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  - "alert_rules.yml"

scrape_configs:
  - job_name: "livekit-sfu"
    static_configs:
      - targets: ["livekit-sfu-0:7880", "livekit-sfu-1:7880", "..."]
    metrics_path: /metrics
    scrape_interval: 5s

  - job_name: "api-services"
    kubernetes_sd_configs:
      - role: pod
        namespaces:
          names:
            - gomeet
    relabel_configs:
      - source_labels: [__meta_kubernetes_pod_label_app]
        action: keep
        regex: api-.*

  - job_name: "postgresql"
    static_configs:
      - targets: ["postgres-exporter:9187"]

  - job_name: "redis-cluster"
    static_configs:
      - targets: ["redis-exporter:9121"]
```

### 2. Critical Alerts

```yaml
groups:
  - name: gomeet-critical
    rules:
      - alert: HighWebSocketConnections
        expr: sum(websocket_connections_active) > 45000
        for: 2m
        labels:
          severity: critical
        annotations:
          summary: "WebSocket connections approaching limit"
          description: "Active connections: {{ $value }}/50000"

      - alert: SFUCPUHigh
        expr: avg(rate(sfu_cpu_usage_percent[5m])) > 80
        for: 3m
        labels:
          severity: warning
        annotations:
          summary: "SFU cluster CPU usage high"
          description: "Average CPU: {{ $value }}%"

      - alert: DatabaseConnectionsHigh
        expr: pg_stat_database_numbackends > 400
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Database connections high"
          description: "Active connections: {{ $value }}"

      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes * 100 > 85
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Redis memory usage high"
          description: "Memory usage: {{ $value }}%"
```

### 3. Grafana Dashboards

**Key Metrics to Monitor:**

- WebSocket connection count per meeting
- SFU bandwidth utilization
- Database query performance
- Redis memory usage
- API response times
- Error rates
- Participant quality metrics

## Security Implementation

### 1. Network Security

```yaml
# Firewall Rules
apiVersion: v1
kind: NetworkPolicy
metadata:
  name: gomeet-network-policy
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
          port: 8080 # API
        - protocol: TCP
          port: 7880 # LiveKit
        - protocol: TCP
          port: 6379 # Redis
        - protocol: TCP
          port: 5432 # PostgreSQL
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: gomeet
```

### 2. Secrets Management

```yaml
# External Secrets Operator
apiVersion: external-secrets.io/v1beta1
kind: SecretStore
metadata:
  name: gomeet-secrets
spec:
  provider:
    aws:
      service: SecretsManager
      region: "ap-southeast-1"
      auth:
        jwt:
          serviceAccountRef:
            name: gomeet-secrets-sa
```

## Cost Estimation (DigitalOcean Singapore)

### Monthly Infrastructure Costs

| Component          | Instance Type    | Quantity | Cost/Unit | Total/Month |
| ------------------ | ---------------- | -------- | --------- | ----------- |
| LiveKit SFU        | 16GB RAM, 8 vCPU | 12       | $167      | $2,004      |
| API Services       | 8GB RAM, 4 vCPU  | 30       | $84       | $2,520      |
| PostgreSQL         | 32GB RAM, 8 vCPU | 3        | $267      | $801        |
| Redis Cluster      | 16GB RAM, 4 vCPU | 6        | $134      | $804        |
| Load Balancer      | DigitalOcean LB  | 3        | $20       | $60         |
| Storage (MinIO)    | 2TB NVMe SSD     | 4        | $200      | $800        |
| Monitoring         | 8GB RAM, 4 vCPU  | 2        | $84       | $168        |
| **Subtotal**       |                  |          |           | **$7,157**  |
| **Overhead (30%)** |                  |          |           | **$2,147**  |
| **Total**          |                  |          |           | **$9,304**  |

### Cost Optimization Strategies

1. **Reserved Instances**: 30% discount untuk 1-year commitment
2. **Spot Instances**: 60-90% discount untuk non-critical services
3. **Auto-scaling**: Scale down during off-peak hours
4. **Storage Optimization**: Compression dan tiered storage

**Optimized Monthly Cost**: ~$6,500 dengan reserved instances dan auto-scaling

## Disaster Recovery Plan

### 1. Backup Strategy

```yaml
# Database Backup Schedule
backups:
  postgresql:
    full_backup:
      schedule: "0 2 * * *" # Daily at 2 AM
      retention: 30 days
      storage: "s3://gomeet-backups/postgresql/"
    incremental_backup:
      schedule: "0 */6 * * *" # Every 6 hours
      retention: 7 days

  redis:
    rdb_backup:
      schedule: "0 */1 * * *" # Hourly
      retention: 24 hours
    aof_backup:
      schedule: "0 3 * * *" # Daily at 3 AM
      retention: 30 days

  recordings:
    hot_storage:
      retention: 30 days
    cold_storage:
      transition: 7 days
      retention: 365 days
```

### 2. High Availability

```yaml
# Multi-Zone Deployment
availability_zones:
  - singapore-1
  - singapore-2
  - jakarta-1 # For latency optimization

failover:
  database:
    primary: singapore-1
    replicas: [singapore-2, jakarta-1]
    failover_time: <30 seconds

  redis:
    masters: [singapore-1, singapore-2, jakarta-1]
    automatic_failover: true
    failover_time: <10 seconds

  livekit:
    nodes: distributed across all zones
    load_balancing: consistent hash
    failover_time: <5 seconds
```

### 3. Recovery Procedures

**Database Recovery:**

```bash
# Point-in-time recovery
pg_basebackup -h replica-server -D /backup/base -U replication -v -P -W
pg_ctl start -D /backup/base
```

**Redis Recovery:**

```bash
# Restore from RDB
redis-server --appendonly no --dbfilename backup.rdb
redis-cli BGREWRITEAOF
```

## Implementation Timeline

### Phase 1: Foundation (Week 1-2)

- [ ] Deploy Kubernetes cluster
- [ ] Setup monitoring stack
- [ ] Configure networking and security
- [ ] Database cluster setup

### Phase 2: Core Services (Week 3-4)

- [ ] Deploy API services with auto-scaling
- [ ] Setup Redis cluster
- [ ] Configure PgBouncer
- [ ] Implement secrets management

### Phase 3: Media Layer (Week 5-6)

- [ ] Deploy LiveKit SFU cluster
- [ ] Configure TURN servers
- [ ] Setup MinIO storage
- [ ] Implement CDN integration

### Phase 4: Optimization (Week 7-8)

- [ ] Performance tuning
- [ ] Load testing
- [ ] Security hardening
- [ ] Documentation completion

## Testing Strategy

### 1. Load Testing

```bash
# WebSocket Connection Test
k6 run --vus 50000 --duration 10m websocket-test.js

# SFU Performance Test
k6 run --vus 500 --duration 30m sfu-load-test.js

# Database Performance Test
k6 run --vus 1000 --duration 15m api-load-test.js
```

### 2. Performance Benchmarks

**Target Metrics:**

- WebSocket connection success rate: >99.5%
- API response time (p95): <200ms
- Video latency: <150ms
- Database query time (p95): <100ms
- Redis operations: <5ms

### 3. Failover Testing

```bash
# Simulate node failure
kubectl delete pod livekit-sfu-0 -n gomeet

# Verify automatic failover
kubectl get pods -n gomeet -l app=livekit-sfu

# Check service continuity
curl -f https://api.gomeet.com/health
```

## Conclusion

Desain infrastruktur ini mendukung target **500 peserta per meeting** dengan:

1. **Scalability**: Horizontal scaling untuk semua komponen
2. **High Availability**: Multi-zone deployment dengan automatic failover
3. **Performance**: Optimized untuk low-latency video streaming
4. **Cost Efficiency**: Optimized resource utilization dengan auto-scaling
5. **Security**: Defense-in-depth approach dengan encryption dan access control

Dengan implementasi yang tepat, infrastruktur ini dapat handle **50,000 concurrent participants** dengan biaya bulanan sekitar **$6,500** setelah optimasi.

---

**📚 Related Documentation**:

- [Executive Summary](./EXECUTIVE_SUMMARY.md) - Business case and financial projections
- [Cost Estimation](./COST_ESTIMATION_500_PARTICIPANTS.md) - Detailed cost analysis
- [Task Management](./task.md) - Implementation timeline
- [Disaster Recovery](./DISASTER_RECOVERY_PROCEDURES.md) - Backup and recovery procedures
- [Documentation Index](./README.md) - Complete documentation overview
