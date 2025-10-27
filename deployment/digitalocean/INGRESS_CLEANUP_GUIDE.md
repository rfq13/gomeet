# Ingress Cleanup Guide - GoMeet DigitalOcean

## Ringkasan Masalah

### Konflik Ingress yang Terdeteksi

Berdasarkan analisis mendalam terhadap konfigurasi ingress di cluster Kubernetes DigitalOcean, ditemukan beberapa masalah kritis:

1. **Host Duplication**: Beberapa file ingress mengkonfigurasi host yang sama (`meet.filosofine.com`, `api-meet.filosofine.com`, `livekit.filosofine.com`) tanpa koordinasi yang proper
2. **Certificate Conflicts**: Multiple certificate resolver dan TLS configuration yang bertentangan
3. **Middleware Inconsistency**: Penggunaan middleware yang tidak konsisten across different ingress files
4. **Resource Duplication**: Beberapa ingress mengatur route yang sama ke service yang berbeda

### File Ingress yang Bermasalah

| File                          | Masalah Utama                               | Status         |
| ----------------------------- | ------------------------------------------- | -------------- |
| `ingress-fixed.yaml`          | Host duplication dengan ingress-domain.yaml | ❌ Hapus       |
| `ingress-letsencrypt.yaml`    | Host duplication, TLS conflict              | ❌ Hapus       |
| `ingress-temp-ssl.yaml`       | Temporary configuration, tidak needed       | ❌ Hapus       |
| `acme-challenge-ingress.yaml` | Redundan dengan cert-manager                | ❌ Hapus       |
| `ingress-domain.yaml`         | Konfigurasi lengkap dan proper              | ✅ Pertahankan |
| `traefik-gateway.yaml`        | Gateway configuration                       | ✅ Pertahankan |
| `middleware.yaml`             | Middleware definitions                      | ✅ Pertahankan |
| `tls-options.yaml`            | TLS configuration                           | ✅ Pertahankan |

## Root Cause Analysis

### 1. Host Duplication

**Problem**: Multiple ingress resources mendefinisikan host yang sama:

- `meet.filosofine.com` ditemukan di 3+ file ingress berbeda
- `api-meet.filosofine.com` ditemukan di 3+ file ingress berbeda
- `livekit.filosofine.com` ditemukan di 2+ file ingress berbeda

**Impact**: Traefik akan mengalami confusion dalam routing, menyebabkan:

- Request tidak ter-route dengan benar
- SSL certificate conflicts
- Inconsistent middleware application

### 2. Certificate Conflicts

**Problem**: Berbagai konfigurasi TLS dan certificate resolver:

- Beberapa ingress menggunakan `letsencrypt` certresolver
- Beberapa menggunakan TLS manual configuration
- Inconsistent TLS options application

**Impact**:

- Certificate renewal failures
- SSL handshake errors
- Mixed content warnings

### 3. Middleware Inconsistency

**Problem**: Middleware yang didefinisikan di multiple places dengan konfigurasi berbeda:

- Security headers berbeda antar file
- Rate limiting configuration tidak konsisten
- CORS settings berbeda untuk domain yang sama

**Impact**:

- Inconsistent security policies
- Performance degradation
- Debugging difficulties

## Solusi yang Direkomendasikan

### 1. Single Source of Truth

Gunakan `ingress-domain.yaml` sebagai konfigurasi utama karena:

- Memiliki struktur yang paling lengkap dan proper
- Sudah mengimplementasikan best practices
- Memisahkan frontend, backend API, dan WebSocket routes
- Menggunakan middleware yang konsisten dan well-structured

### 2. Consolidate Middleware

Centralize semua middleware definition dalam `middleware.yaml` dan `ingress-domain.yaml`:

- Hapus middleware duplikat
- Standardize naming convention
- Apply consistent security policies

### 3. Standardize TLS Configuration

Gunakan `tls-options.yaml` untuk semua ingress:

- Single TLS options configuration
- Consistent cipher suites
- Modern TLS version requirements

### 4. Implement Proper Resource Management

- Hapus semua ingress yang redundant
- Backup configuration sebelum cleanup
- Validate changes sebelum apply

## Step-by-Step Cleanup Instructions

### Phase 1: Preparation

1. **Backup Current Configuration**

   ```bash
   kubectl get ingress -n gomeet -o yaml > backup-ingress-$(date +%Y%m%d-%H%M%S).yaml
   kubectl get middleware -n gomeet -o yaml > backup-middleware-$(date +%Y%m%d-%H%M%S).yaml
   ```

2. **Identify Active Ingress**

   ```bash
   kubectl get ingress -n gomeet
   kubectl describe ingress -n gomeet
   ```

3. **Check Certificate Status**
   ```bash
   kubectl get certificate -n gomeet
   kubectl describe certificate -n gomeet
   ```

### Phase 2: Validation

1. **Test Current Setup**

   ```bash
   curl -I https://meet.filosofine.com
   curl -I https://api-meet.filosofine.com
   curl -I https://livekit.filosofine.com
   ```

2. **Check Traefik Dashboard**
   ```bash
   kubectl port-forward -n gomeet $(kubectl get pods -n gomeet -l app=traefik -o jsonpath='{.items[0].metadata.name}') 8080:8080
   # Access http://localhost:8080/dashboard/
   ```

### Phase 3: Cleanup Execution

1. **Remove Conflicting Ingress**

   ```bash
   kubectl delete ingress ingress-fixed -n gomeet
   kubectl delete ingress ingress-letsencrypt -n gomeet
   kubectl delete ingress ingress-temp-ssl -n gomeet
   kubectl delete ingress acme-challenge-ingress -n gomeet
   ```

2. **Apply Clean Configuration**

   ```bash
   kubectl apply -f ingress-domain.yaml
   kubectl apply -f middleware.yaml
   kubectl apply -f tls-options.yaml
   ```

3. **Verify Certificate Renewal**
   ```bash
   kubectl get certificate -n gomeet -w
   ```

### Phase 4: Post-Cleanup Validation

1. **Test All Endpoints**

   ```bash
   # Frontend
   curl -I https://meet.filosofine.com

   # API endpoints
   curl -I https://api-meet.filosofine.com/health
   curl -I https://api-meet.filosofine.com/api/v1

   # WebSocket
   curl -I -H "Connection: Upgrade" -H "Upgrade: websocket" https://api-meet.filosofine.com/api/v1/ws

   # LiveKit
   curl -I https://livekit.filosofine.com
   ```

2. **Check SSL Certificates**

   ```bash
   openssl s_client -connect meet.filosofine.com:443 -servername meet.filosofine.com
   openssl s_client -connect api-meet.filosofine.com:443 -servername api-meet.filosofine.com
   ```

3. **Monitor Traefik Logs**
   ```bash
   kubectl logs -n gomeet -l app=traefik -f
   ```

## Automated Cleanup Script

Gunakan script `cleanup-ingress.sh` untuk proses otomatis:

- Backup otomatis semua konfigurasi
- Validasi sebelum penghapusan
- Cleanup yang aman dengan rollback capability
- Comprehensive testing setelah cleanup

## Recovery Procedures

### Jika Terjadi Masalah Setelah Cleanup

1. **Immediate Rollback**

   ```bash
   kubectl apply -f backup-ingress-<timestamp>.yaml
   kubectl apply -f backup-middleware-<timestamp>.yaml
   ```

2. **Check Service Status**

   ```bash
   kubectl get pods -n gomeet
   kubectl get services -n gomeet
   ```

3. **Restart Traefik jika Perlu**
   ```bash
   kubectl rollout restart deployment/traefik -n gomeet
   ```

## Best Practices untuk Mencegah Masalah di Masa Depan

1. **Single Ingress per Domain**: Gunakan satu ingress resource untuk setiap domain utama
2. **Consistent Naming**: Gunakan naming convention yang konsisten untuk middleware dan resources
3. **Version Control**: Simpan semua perubahan dalam version control system
4. **Testing**: Selalu test di staging environment sebelum apply ke production
5. **Documentation**: Dokumentasikan semua perubahan dan alasan di baliknya
6. **Monitoring**: Implement proper monitoring dan alerting untuk ingress issues

## Monitoring dan Maintenance

### Regular Checks

1. **Daily**: Certificate expiration check
2. **Weekly**: Ingress configuration validation
3. **Monthly**: Security policy review

### Alerting Setup

Monitor untuk:

- Certificate renewal failures
- Ingress route conflicts
- High error rates
- SSL handshake failures

## Conclusion

Cleanup ingress configuration sangat penting untuk:

- Meningkatkan reliability
- Mengurangi complexity
- Memperbaiki security posture
- Mempermudah maintenance dan debugging

Dengan mengikuti guide ini, sistem akan memiliki konfigurasi ingress yang clean, maintainable, dan secure.
