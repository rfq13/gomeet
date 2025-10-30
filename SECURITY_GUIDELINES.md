# 🔒 Panduan Keamanan - GoMeet Project

## 🚨 KEJADIAN KEAMANAN KRITIS - TINDAKAN SEGERA DIPERLUKAN

### Secrets yang Telah Ter-Expose (SEGERA REVOKE):

1. **DigitalOcean API Token**: `dop_v1_e17d38c4da4dac9e5ac3d32131ba3e790b3134db16ce3804348db3257965c07a`
2. **OpenAI API Key**: `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`
3. **Database URL**: PostgreSQL credentials ter-expose
4. **Redis URL**: Redis credentials ter-expose
5. **LiveKit Credentials**: API key dan secret ter-expose

## 🛡️ Rekomendasi Keamanan Segera

### 1. REVOKE SEMUA TOKEN SEKARANG

- Login ke DigitalOcean Control Panel
- Revoke API token yang ter-expose
- Login ke OpenAI Dashboard
- Revoke API key yang ter-expose
- Reset database password
- Reset Redis password
- Regenerate LiveKit credentials

### 2. Generate API Token DigitalOcean Baru

```bash
# Melalui DigitalOcean CLI (doctl)
doctl auth init
doctl auth token

# Atau melalui Control Panel:
# 1. Go to API -> Tokens/Keys
# 2. Generate new token dengan minimal permissions
# 3. Pilih scope yang diperlukan saja
# 4. Set expiry yang wajar (recommended: 90 days)
```

### 3. Simpan Token di Secret Manager

#### Opsi 1: DigitalOcean Secrets (Recommended)

```bash
# Install doctl
curl -sL https://github.com/digitalocean/doctl/releases/latest/download/doctl-1.104.0-linux-amd64.tar.gz | tar xz
sudo mv doctl /usr/local/bin/

# Simpan secret
doctl secrets create DO_API_TOKEN --value "your-new-token-here"
```

#### Opsi 2: Environment Variables (Development)

```bash
# Set di shell
export DO_API_TOKEN="your-new-token-here"

# Atau di .env.local (HANYA untuk development)
echo "DO_API_TOKEN=your-new-token-here" >> .env.local
```

#### Opsi 3: Docker Secrets (Production)

```bash
# Create secret
echo "your-new-token-here" | docker secret create DO_API_TOKEN -
```

### 4. Update Konfigurasi Aplikasi

#### Backend Configuration

File: [`packages/backend/.env.production`](packages/backend/.env.production)

```env
# DigitalOcean Configuration
DO_API_TOKEN=${DO_API_TOKEN}
```

#### Environment Variables yang Diperlukan

```bash
# Required
DO_API_TOKEN=your-new-digitalocean-token

# Optional: untuk specific services
DO_SPACES_ACCESS_KEY=your-spaces-key
DO_SPACES_SECRET_KEY=your-spaces-secret
DO_REGION=sgp1  # Singapore region
```

## 🔍 Best Practices Keamanan

### 1. Prinsip Least Privilege

- Berikan minimal permissions yang diperlukan
- Gunakan scoped tokens untuk services spesifik
- Limit token lifetime

### 2. Environment Management

```bash
# Development (.env.local)
DO_API_TOKEN=dev-token-with-limited-scope

# Staging (.env.staging)
DO_API_TOKEN=staging-token

# Production (.env.production)
DO_API_TOKEN=${DO_API_TOKEN} # Dari secret manager
```

### 3. Git Security

```gitignore
# .gitignore
.env.local
.env.staging
.env.production
creds.txt
*.key
*.pem
secrets/
```

### 4. Monitoring & Rotation

- Set up monitoring untuk API usage
- Rotate tokens setiap 90 hari
- Implement rate limiting
- Monitor suspicious activity

## 🚀 Implementasi Token yang Aman

### DigitalOcean API Token Generation

```bash
# 1. Login ke DigitalOcean
doctl auth init

# 2. Generate token dengan scope minimal
doctl auth token --scopes "read:write"

# 3. Simpan ke secret manager
doctl secrets create DO_API_TOKEN --value "$(doctl auth token)"

# 4. Verify token
doctl account get
```

### Scope Recommendations

- **Infrastructure Management**: `droplet:read,droplet:write`
- **DNS Management**: `domain:read,domain:write`
- **Load Balancers**: `load_balancer:read,load_balancer:write`
- **Spaces (S3)**: `spaces:read,spaces:write`

## 📋 Security Checklist

- [ ] Revoke semua exposed secrets
- [ ] Generate new API tokens dengan minimal permissions
- [ ] Simpan tokens di secure secret manager
- [ ] Update konfigurasi untuk menggunakan `DO_API_TOKEN`
- [ ] Add `.env*` files ke `.gitignore`
- [ ] Implement token rotation policy
- [ ] Set up monitoring dan alerting
- [ ] Review access logs regularly
- [ ] Test security measures
- [ ] Document security procedures

## 🆘 Emergency Response

Jika Anda menemukan exposed secrets:

1. **IMMEDIATE**: Revoke semua tokens
2. **QUICK**: Generate new credentials
3. **SECURE**: Update konfigurasi
4. **MONITOR**: Watch untuk suspicious activity
5. **REVIEW**: Audit semua secrets
6. **DOCUMENT**: Update security procedures

## 📞 Kontak Keamanan

- Security Team: security@filosofine.com
- Emergency: +62-XXX-XXXX-XXXX

---

⚠️ **PERINGATAN**: Dokumen ini mengandung informasi sensitif. Jangan share atau commit ke version control!
