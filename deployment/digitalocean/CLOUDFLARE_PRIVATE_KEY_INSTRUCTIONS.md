# Cara Mendapatkan Cloudflare Origin Private Key

## Langkah-langkah untuk Mendapatkan Private Key

### 1. Login ke Cloudflare Dashboard

- Buka https://dash.cloudflare.com
- Login dengan akun Cloudflare Anda
- Pilih domain `filosofine.com`

### 2. Generate Origin Certificate

Jika Anda sudah generate certificate sebelumnya:

1. Go to **SSL/TLS** → **Origin Server** → **Origin Certificates**
2. Cek certificate yang sudah ada
3. Klik **"View Certificate"** atau **"Download"** untuk mendapatkan private key

Jika belum generate:

1. Go to **SSL/TLS** → **Origin Server** → **Origin Certificates**
2. Klik **"Create Certificate"**
3. Pilih opsi:
   - **Hostnames**: `*.filosofine.com`, `filosofine.com`
   - **Certificate Validity**: 15 years
   - **Key Type**: RSA (2048)
4. Klik **"Create"**
5. Cloudflare akan menampilkan:
   - **Origin Certificate** (sudah Anda berikan)
   - **Private Key** (yang Anda butuhkan)

### 3. Copy Private Key

- Private key akan ditampilkan dalam format seperti:

```
-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...
... (panjang sekali) ...
-----END PRIVATE KEY-----
```

### 4. Simpan Private Key

Setelah dapat private key:

1. Copy seluruh content termasuk `-----BEGIN PRIVATE KEY-----` dan `-----END PRIVATE KEY-----`
2. Simpan ke file `deployment/digitalocean/cloudflare-origin-key.pem`
3. Jangan bagikan private key ke siapapun!

### 5. Setup SSL Mode di Cloudflare

Setelah certificate siap:

1. Go to **SSL/TLS** → **Overview**
2. Pilih **"Full (strict)"**
3. Ini memastikan Cloudflare memvalidasi origin certificate

### 6. Verify Domain Configuration

Pastikan:

- DNS A record untuk `meet.filosofine.com` → `146.190.186.45`
- DNS A record untuk `api-meet.filosofine.com` → `146.190.186.45`
- DNS A record untuk `livekit.filosofine.com` → `146.190.186.45`

## Security Notes

⚠️ **IMPORTANT**: Private key adalah rahasia!

- Jangan commit ke Git
- Jangan bagikan ke public
- Simpan di secure location
- Gunakan Kubernetes secrets untuk menyimpan di cluster

## Next Steps

Setelah dapat private key:

1. Saya akan create Kubernetes secret
2. Update ingress configuration
3. Test HTTPS dengan trusted certificate
4. Final verification

## Alternative: Jika Tidak Bisa Akses Cloudflare

Jika tidak bisa akses Cloudflare dashboard:

- Saya bisa setup Let's Encrypt dengan cert-manager (lebih reliable)
- Atau gunakan commercial CA certificate
