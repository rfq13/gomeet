# GoMeet DigitalOcean Deployment Configuration

Konfigurasi deployment GoMeet untuk DigitalOcean Kubernetes Engine (DOK) yang dioptimasi untuk 500 partisipan per meeting dan 50,000 concurrent participants.

## 📋 Daftar File Konfigurasi

### Core Infrastructure

- [`namespace.yaml`](namespace.yaml) - Namespace configuration dengan labels DigitalOcean
- [`configmaps.yaml`](configmaps.yaml) - Configuration maps untuk aplikasi dan services
- [`secrets.yaml`](secrets.yaml) - Template secrets (tanpa nilai sensitif)

### Database & Cache

- [`postgres-config.yaml`](postgres-config.yaml) - Konfigurasi managed PostgreSQL DigitalOcean
- [`redis-config.yaml`](redis-config.yaml) - Konfigurasi managed Redis DigitalOcean

### Application Services

- [`api-services.yaml`](api-services.yaml) - Deployment untuk semua API services
- [`livekit-sfu.yaml`](livekit-sfu.yaml) - LiveKit SFU dengan DigitalOcean integration
- [`traefik-gateway.yaml`](traefik-gateway.yaml) - Traefik gateway dengan DO Load Balancer

### Monitoring & Scaling

- [`monitoring.yaml`](monitoring.yaml) - Prometheus dan Grafana configuration
- [`hpa.yaml`](hpa.yaml) - Horizontal Pod Autoscaler untuk semua services

### Networking & Security

- [`ingress.yaml`](ingress.yaml) - External load balancer dan routing
- [`network-policies.yaml`](network-policies.yaml) - Network policies untuk keamanan

## 🏗️ Arsitektur DigitalOcean

### Managed Services

- **DigitalOcean PostgreSQL** - Cluster dengan high availability
- **DigitalOcean Redis** - Cluster dengan automatic failover
- **DigitalOcean Load Balancer** - External traffic distribution
- **DigitalOcean Container Registry** - Image storage dan distribution
- **DigitalOcean Spaces** - Object storage untuk recordings

### Compute Resources

- **DOK Cluster** - 3+ node clusters dengan auto-scaling
- **Droplet Types** - Optimized untuk workload spesifik
- **Storage Classes** - `do-block-storage` dan `do-block-storage-optimized`

## 🚀 Quick Start

### Prerequisites

1. DigitalOcean API token dengan required permissions
2. DOK cluster sudah ter-setup
3. Managed PostgreSQL dan Redis sudah terprovision
4. Domain names sudah dikonfigurasi

### Setup Secrets

```bash
# Create secrets dari template
kubectl apply -f secrets.yaml

# Update nilai secrets
kubectl edit secret gomeet-secrets -n gomeet
kubectl edit secret digitalocean-credentials -n gomeet
```

### Deployment Sequence

```bash
# 1. Namespace dan基础 konfigurasi
kubectl apply -f namespace.yaml
kubectl apply -f configmaps.yaml

# 2. Database dan monitoring exporters
kubectl apply -f postgres-config.yaml
kubectl apply -f redis-config.yaml

# 3. Application services
kubectl apply -f api-services.yaml
kubectl apply -f livekit-sfu.yaml

# 4. Gateway dan ingress
kubectl apply -f traefik-gateway.yaml
kubectl apply -f ingress.yaml

# 5. Monitoring dan scaling
kubectl apply -f monitoring.yaml
kubectl apply -f hpa.yaml

# 6. Network policies
kubectl apply -f network-policies.yaml
```

## 🔧 Konfigurasi DigitalOcean

### Environment Variables

Template secrets menyediakan placeholder untuk:

- `DO_POSTGRES_HOST` - Managed PostgreSQL endpoint
- `DO_REDIS_HOST` - Managed Redis endpoint
- `DO_LB_ID` - Load Balancer ID
- `DO_REGION` - DigitalOcean region (nyc1)
- `DO_SPACES_*` - Spaces configuration

### Load Balancer Configuration

- **Algorithm**: Least Connections
- **Sticky Sessions**: Cookie-based
- **Health Checks**: HTTP path `/health`
- **Proxy Protocol**: Enabled
- **SSL Termination**: Managed certificates

### Storage Classes

- `do-block-storage` - Standard SSD storage
- `do-block-storage-optimized` - High-performance storage

## 📊 Resource Allocation

### API Services

| Service           | Replicas | CPU Request | Memory Request | Max Replicas |
| ----------------- | -------- | ----------- | -------------- | ------------ |
| Auth Service      | 8        | 4000m       | 8Gi            | 20           |
| Meeting Service   | 12       | 4000m       | 8Gi            | 30           |
| Signaling Service | 25       | 6000m       | 12Gi           | 60           |
| Chat Service      | 10       | 3000m       | 6Gi            | 25           |
| TURN Service      | 8        | 2000m       | 4Gi            | 20           |

### LiveKit SFU

| Component | Replicas | CPU Request | Memory Request | Max Replicas |
| --------- | -------- | ----------- | -------------- | ------------ |
| SFU       | 25       | 16000m      | 64Gi           | 100          |
| Recorder  | 3        | 4000m       | 8Gi            | 10           |

### Gateway & Monitoring

| Service    | Replicas | CPU Request | Memory Request |
| ---------- | -------- | ----------- | -------------- |
| Traefik    | 6        | 4000m       | 8Gi            |
| Prometheus | 2        | 8000m       | 16Gi           |
| Grafana    | 3        | 2000m       | 4Gi            |

## 🔒 Security Configuration

### Network Policies

- **Default Deny**: All traffic blocked by default
- **Namespace Isolation**: Only allow same-namespace traffic
- **External Access**: Controlled via specific policies
- **Service-to-Service**: Least privilege access

### Secrets Management

- **No Hardcoded Values**: All sensitive data in secrets
- **Base64 Encoding**: Standard Kubernetes secret format
- **Environment Injection**: Runtime secret mounting
- **Rotation Support**: Easy secret rotation

## 📈 Monitoring & Observability

### Metrics Collection

- **Application Metrics**: Custom business metrics
- **Infrastructure Metrics**: CPU, memory, network
- **DigitalOcean Metrics**: DO-specific metrics
- **WebRTC Metrics**: SFU performance metrics

### Alerting Rules

- **Critical Alerts**: Service downtime, high error rates
- **Warning Alerts**: Performance degradation
- **Capacity Alerts**: Resource utilization thresholds
- **Business Alerts**: Meeting participant limits

### Dashboards

- **System Overview**: Cluster health and performance
- **Application Metrics**: Service-specific metrics
- **WebRTC Analytics**: Video quality and performance
- **Infrastructure**: DigitalOcean resource usage

## 🔄 Auto-Scaling Configuration

### HPA Metrics

- **CPU/Memory**: Standard resource utilization
- **Custom Metrics**: Business-specific scaling
- **WebRTC Metrics**: Participant-based scaling
- **Rate-based Scaling**: Request rate scaling

### Scaling Behavior

- **Scale Up**: Fast response to traffic spikes
- **Scale Down**: Gradual resource release
- **Stabilization**: Prevent flapping
- **Limits**: Maximum and minimum boundaries

## 🌐 Domain Configuration

### Required Domains

- `gomeet.com` - Main application
- `api.gomeet.com` - API endpoints
- `livekit.gomeet.com` - WebRTC signaling
- `traefik.gomeet.com` - Gateway dashboard
- `grafana.gomeet.com` - Monitoring dashboard
- `prometheus.gomeet.com` - Metrics endpoint

### SSL Certificates

- **Let's Encrypt**: Automatic certificate management
- **Wildcard Support**: Single certificate for subdomains
- **Auto-renewal**: Automated certificate rotation

## 🛠️ Troubleshooting

### Common Issues

1. **Load Balancer Health Checks**

   ```bash
   kubectl get svc traefik -n gomeet
   kubectl describe svc traefik -n gomeet
   ```

2. **Database Connectivity**

   ```bash
   kubectl logs -f deployment/pgbouncer-do -n gomeet
   kubectl exec -it deployment/pgbouncer-do -n gomeet -- psql
   ```

3. **Service Discovery**
   ```bash
   kubectl get svc -n gomeet
   kubectl describe svc auth-service -n gomeet
   ```

### Debug Commands

```bash
# Check pod status
kubectl get pods -n gomeet -o wide

# Check HPA status
kubectl get hpa -n gomeet

# Check network policies
kubectl get networkpolicies -n gomeet

# Check ingress status
kubectl get ingress -n gomeet

# Check logs
kubectl logs -f deployment/auth-service -n gomeet
```

## 📋 Deployment Checklist

### Pre-Deployment

- [ ] DigitalOcean API token configured
- [ ] DOK cluster ready
- [ ] Managed services provisioned
- [ ] DNS records configured
- [ ] Secrets populated
- [ ] Container registry access

### Post-Deployment

- [ ] All pods running
- [ ] Load balancer healthy
- [ ] SSL certificates valid
- [ ] Monitoring operational
- [ ] Auto-scaling functional
- [ ] Network policies enforced

### Validation

- [ ] API endpoints accessible
- [ ] WebSocket connections working
- [ ] WebRTC signaling functional
- [ ] Metrics collection active
- [ ] Alert rules triggered

## 🔄 Rollback Procedures

### Quick Rollback

```bash
# Rollback to previous revision
kubectl rollout undo deployment/auth-service -n gomeet

# Check rollout status
kubectl rollout status deployment/auth-service -n gomeet
```

### Full Rollback

```bash
# Delete all resources
kubectl delete -f .

# Restore from backup
kubectl apply -f backup/
```

## 📞 Support

### DigitalOcean Resources

- [DOK Documentation](https://docs.digitalocean.com/products/kubernetes/)
- [Managed PostgreSQL](https://docs.digitalocean.com/products/databases/postgresql/)
- [Managed Redis](https://docs.digitalocean.com/products/databases/redis/)
- [Load Balancer](https://docs.digitalocean.com/products/load-balancer/)

### GoMeet Resources

- Architecture Documentation: `docs/INFRASTRUCTURE_DESIGN_500_PARTICIPANTS.md`
- Cost Analysis: `docs/COST_ESTIMATION_500_PARTICIPANTS.md`
- Disaster Recovery: `docs/DISASTER_RECOVERY_PROCEDURES.md`

---

**Note**: Konfigurasi ini production-ready dan telah dioptimasi untuk workload GoMeet dengan 500 partisipan per meeting. Pastikan semua secrets diisi dengan nilai yang benar sebelum deployment.
