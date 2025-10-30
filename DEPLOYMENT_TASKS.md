# GoMeet Deployment Tasks

## Overview

Dokumen ini berisi daftar tugas lengkap untuk deployment aplikasi GoMeet ke DigitalOcean dengan target domain:

- **Frontend**: gomeet.filosofine.com
- **Backend API**: api-gomeet.filosofine.com
- **LiveKit**: livekit.filosofine.com

## Klasifikasi Tugas

### 🟦 BACKEND (BE) TASKS

#### 1. Persiapan Environment

- [x] Update Go module path dari `github.com/your-org/gomeet/packages/backend` ke `github.com/filosofine/gomeet-backend`
- [x] Buat file `.env.production` dengan konfigurasi production
- [x] Update CORS configuration untuk production domains
- [x] Generate JWT secret yang aman (256-bit)

#### 2. Fix Critical Issues

- [x] Implementasi LiveKit token generation yang lengkap di `packages/backend/internal/controllers/webrtc_controller.go:645`
- [x] Import JWT SDK: `github.com/golang-jwt/jwt/v5` (menggunakan JWT instead of LiveKit SDK untuk flexibility)
- [ ] Setup webhook endpoint untuk LiveKit events
- [ ] Update security headers middleware

#### 3. Database & Redis Setup

- [x] Konfigurasi PostgreSQL connection (Supabase) - support POSTGRE_URL
- [x] Konfigurasi Redis connection (Upstash) - support REDIS_URL
- [ ] Run database migrations
- [x] Setup database indexes untuk performa

#### 4. API Configuration

- [ ] Update API base URL di konfigurasi
- [ ] Setup rate limiting middleware
- [ ] Konfigurasi logging untuk production
- [ ] Setup health check endpoints

#### 5. Build & Deploy

- [ ] Build Docker image untuk production
- [ ] Push ke DigitalOcean App Platform
- [ ] Konfigurasi environment variables di App Platform
- [ ] Test API endpoints

#### 6. Security & Monitoring

- [x] Setup SSL certificate
- [ ] Konfigurasi firewall rules
- [ ] Setup monitoring dan alerting
- [ ] Implementasi backup strategy

---

### 🟩 FRONTEND (FE) TASKS

#### 1. Environment Configuration

- [x] Buat file `.env.production` dengan production URLs
- [ ] Update Vite configuration untuk production build
- [ ] Konfigurasi proper asset optimization

#### 2. Build Configuration

- [ ] Update build arguments di Dockerfile
- [ ] Konfigurasi proper caching headers
- [ ] Optimize bundle size
- [ ] Setup proper error boundaries

#### 3. API Integration

- [x] Update API client base URLs
- [x] Konfigurasi WebSocket connection untuk production
- [ ] Test LiveKit integration
- [ ] Setup proper error handling

#### 4. UI/UX Optimizations

- [ ] Konfigurasi proper meta tags untuk SEO
- [ ] Setup favicon dan manifest
- [ ] Test responsive design
- [ ] Optimize images dan assets

#### 5. Build & Deploy

- [ ] Build production bundle
- [ ] Deploy ke DigitalOcean App Platform
- [ ] Konfigurasi custom domain
- [ ] Test semua routes

#### 6. Performance & Security

- [ ] Setup CSP headers
- [ ] Konfigurasi service worker (jika needed)
- [ ] Test Core Web Vitals
- [ ] Setup proper 404 pages

---

### 🟪 LIVEKIT TASKS

#### 1. Server Setup

- [x] Create dedicated droplet untuk LiveKit
- [ ] Install LiveKit server binary
- [ ] Konfigurasi firewall untuk ports 7880, 7881, 7882
- [ ] Setup systemd service untuk auto-restart

#### 2. Configuration

- [ ] Buat `livekit.yaml` configuration file
- [ ] Konfigurasi Redis connection
- [ ] Setup API keys dan secrets
- [ ] Konfigurasi codec settings (H.264, VP8, Opus)

#### 3. Network Setup

- [ ] Konfigurasi static IP untuk droplet
- [ ] Setup proper routing untuk WebRTC traffic
- [ ] Konfigurasi STUN/TURN server
- [ ] Test connectivity dari berbagai network

#### 4. SSL & Security

- [x] Setup SSL certificate untuk WSS
- [ ] Konfigurasi proper security headers
- [ ] Setup rate limiting untuk API
- [ ] Monitor resource usage

#### 5. Integration Testing

- [ ] Test room creation dan deletion
- [ ] Test participant join/leave
- [ ] Test audio/video quality
- [ ] Test reconnection scenarios

#### 6. Monitoring & Scaling

- [ ] Setup monitoring untuk LiveKit metrics
- [ ] Konfigurasi log aggregation
- [ ] Test load capacity
- [ ] Setup scaling strategy

---

## 📋 DEPLOYMENT CHECKLIST

### Pre-Deployment

- [ ] Semua environment variables sudah dikonfigurasi
- [ ] Database migrations sudah di-test
- [ ] SSL certificates sudah siap
- [ ] Backup strategy sudah ditentukan
- [ ] Monitoring tools sudah di-setup
- [ ] Rollback plan sudah disiapkan

### Deployment Day

- [ ] Deploy backend terlebih dahulu
- [ ] Test API endpoints
- [ ] Deploy frontend
- [ ] Test frontend integration
- [ ] Deploy LiveKit server
- [ ] Test video conferencing functionality
- [ ] Update DNS records (manual)
- [ ] Test end-to-end functionality

### Post-Deployment

- [ ] Monitor error rates
- [ ] Test load balancing
- [ ] Verify SSL certificates
- [ ] Test backup/restore
- [ ] Update documentation
- [ ] Team training

---

## 🚨 CRITICAL ISSUES TO FIX

### Backend

1. ~~**LiveKit Token Generation** - Saat ini masih mock, perlu implementasi lengkap~~ ✅ **FIXED** - Implementasi JWT-based token generation
2. ~~**Go Module Path** - Update dari placeholder ke actual repository~~ ✅ **FIXED** - Updated ke `github.com/filosofine/gomeet-backend`
3. ~~**CORS Configuration** - Update untuk production domains~~ ✅ **FIXED** - Added production domains
4. **Security Headers** - Tambahkan production security headers

### Frontend

1. ~~**Environment Variables** - Pastikan semua production URLs benar~~ ✅ **FIXED** - `.env.production` created
2. **Bundle Optimization** - Optimize untuk production deployment
3. **Error Handling** - Setup proper error boundaries
4. **Performance** - Test dan optimasi Core Web Vitals

### LiveKit

1. **Server Configuration** - Setup proper production config
2. **Network Optimization** - Konfigurasi untuk berbagai network conditions
3. **Monitoring** - Setup comprehensive monitoring
4. **Scaling** - Prepare scaling strategy

---

## 📊 CREDENTIALS NEEDED

### DigitalOcean

- API Key: `dop_v1_e17d38c4da4dac9e5ac3d32131ba3e790b3134db16ce3804348db3257965c07a`

### Database

- PostgreSQL: `postgresql://postgres.ycdyyyggqxrkicjnnuuf:jiiancok123@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres`

### Cache

- Redis: `rediss://default:ARXJAAImcDI4YTQ5NGM2MTMyZDQ0MDg1OWQxNGM2YWM3MGJjNmViMHAyNTU3Nw@thorough-orca-5577.upstash.io:6379`

### Third-party Services

- OpenAI API Key: `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`
- Cloudinary API Key: `cpk_0e9fa30a2b984238891289b46195a246.b392beeb15db5b269525c28f9c649c79.1fXqhclBjPueuCxW4OiOCdxvTpRrMEDV`

---

## 🎯 SUCCESS METRICS

### Technical Metrics

- [ ] API response time < 200ms
- [ ] Frontend load time < 3s
- [ ] Video latency < 100ms
- [ ] 99.9% uptime

### Business Metrics

- [ ] Successful meeting creation
- [ ] Stable video connections
- [ ] Proper chat functionality
- [ ] Mobile compatibility

---

## 📞 CONTACT & SUPPORT

### Technical Issues

- Backend: Check logs di DigitalOcean App Platform
- Frontend: Check browser console dan network tab
- LiveKit: Check server logs dan metrics

### Emergency Contacts

- DevOps: [Contact Information]
- Backend Lead: [Contact Information]
- Frontend Lead: [Contact Information]

---

_Last Updated: 2025-10-29_
_Version: 1.0.0_
