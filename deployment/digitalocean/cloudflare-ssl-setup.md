# Cloudflare SSL Setup untuk meet.filosofine.com & api-meet.filosofine.com

## Status Saat Ini

- Let's Encrypt sedang rate limited sampai 2025-10-27 00:58:42 UTC
- ACME challenge masih gagal (404) meskipun sudah diperbaiki
- Perlu solusi alternatif untuk SSL certificate

## Cloudflare Origin Certificate Setup

### 1. Generate Origin Certificate di Cloudflare Dashboard

1. Login ke Cloudflare Dashboard
2. Pilih domain filosofine.com
3. Go to SSL/TLS > Origin Server > Create Certificate
4. Pilih:
   - Hostnames: `meet.filosofine.com`, `api-meet.filosofine.com`
   - Certificate Validity: 15 years
   - Key Type: RSA (2048)
5. Copy Origin Certificate dan Private Key
6. Simpan sebagai Kubernetes secrets

### 2. Create Kubernetes Secrets

```bash
# Create secret untuk certificate
kubectl create secret tls cloudflare-origin-cert \
  --cert=origin_certificate.pem \
  --key=origin_private_key.pem \
  --namespace=gomeet
```

### 3. Update Ingress Configuration

- Hapus annotation `traefik.ingress.kubernetes.io/router.tls.certresolver: letsencrypt`
- Tambahkan `spec.tls` configuration yang menggunakan Cloudflare certificate

### 4. Cloudflare SSL Mode

- Set SSL/TLS mode ke "Full (strict)" di Cloudflare dashboard
- Ini memastikan end-to-end encryption dengan valid certificate

### 5. Benefits

- Tidak tergantung pada Let's Encrypt rate limits
- Certificate valid untuk 15 tahun
- Lebih reliable untuk production environment
- Support wildcard certificates jika dibutuhkan

### 6. Implementation Steps

1. Generate certificate di Cloudflare
2. Create Kubernetes secrets
3. Update ingress configuration
4. Test HTTPS access
5. Verify certificate chain

## Fallback Plan

Jika Cloudflare tidak bisa digunakan, alternatif lain:

- Self-signed certificate dengan trust chain setup
- Commercial CA certificate (DigiCert, etc.)
- ACME DNS challenge dengan Cloudflare API
