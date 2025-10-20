# GoMeet - Video Conferencing Platform

GoMeet adalah platform video conferencing dengan real-time collaboration yang dibangun dengan arsitektur modern menggunakan Go backend dan SvelteKit frontend.

## 🏗️ Arsitektur Proyek

Proyek ini menggunakan monorepo dengan struktur berikut:

```
gomeet/
├── packages/
│   ├── backend/              # Go Backend API
│   │   ├── cmd/              # Application entry point
│   │   ├── internal/         # Internal packages
│   │   ├── migrations/       # Database migrations
│   │   ├── docs/             # Swagger documentation
│   │   └── package.json      # NPM scripts untuk Go
│   └── frontend/             # SvelteKit Frontend
│       ├── src/
│       │   ├── lib/          # SvelteKit lib (server + client)
│       │   ├── routes/       # SvelteKit routes
│       │   └── components/   # Svelte components
│       ├── static/           # Static assets
│       └── package.json      # Frontend dependencies
├── docs/                     # Dokumentasi proyek
├── .env.example              # Environment variables template
├── .gitignore
├── package.json              # Root package.json (workspace)
├── pnpm-workspace.yaml       # PNPM workspace config
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- Go 1.24+
- PNPM 8+
- PostgreSQL
- Redis
- Docker & Docker Compose (optional)

### Installation

1. Clone repository:

```bash
git clone <repository-url>
cd gomeet
```

2. Install dependencies:

```bash
pnpm install:all
```

3. Setup environment variables:

```bash
cp .env.example .env
# Edit .env dengan konfigurasi yang sesuai
```

4. Setup database:

```bash
pnpm migrate:up
```

### Development

Jalankan kedua service secara bersamaan:

```bash
pnpm dev
```

Atau jalankan secara terpisah:

```bash
# Backend only
pnpm dev:backend

# Frontend only
pnpm dev:frontend
```

Frontend akan berjalan di `http://localhost:5173`
Backend akan berjalan di `http://localhost:8080`

## 📦 Available Scripts

### Development

- `pnpm dev` - Jalankan backend dan frontend secara bersamaan
- `pnpm dev:backend` - Jalankan backend development server
- `pnpm dev:frontend` - Jalankan frontend development server

### Building

- `pnpm build` - Build backend dan frontend
- `pnpm build:backend` - Build backend saja
- `pnpm build:frontend` - Build frontend saja

### Production

- `pnpm start` - Jalankan backend dan frontend di production mode
- `pnpm start:backend` - Jalankan backend production
- `pnpm start:frontend` - Jalankan frontend preview

### Testing

- `pnpm test` - Jalankan semua tests
- `pnpm test:backend` - Jalankan backend tests
- `pnpm test:frontend` - Jalankan frontend tests

### Linting & Type Checking

- `pnpm lint` - Lint semua packages
- `pnpm typecheck` - Type check semua packages

### Database

- `pnpm migrate:up` - Jalankan database migrations
- `pnpm migrate:down` - Rollback database migrations

### Docker

- `pnpm docker:build` - Build Docker images
- `pnpm docker:up` - Jalankan Docker Compose
- `pnpm docker:down` - Stop Docker Compose

## 🔧 Environment Variables

Copy `.env.example` ke `.env` dan konfigurasi:

```env
# Backend Configuration
PORT=8080
DB_HOST=localhost
DB_PORT=5432
DB_USER=gomeet
DB_PASSWORD=your_password
DB_NAME=gomeet_db

# Frontend Configuration
PUBLIC_API_URL=http://localhost:8080/api/v1
PUBLIC_WS_URL=ws://localhost:8080
PUBLIC_APP_NAME=GoMeet

# Shared Configuration
JWT_SECRET=your-secret-key
REDIS_HOST=localhost
REDIS_PORT=6379

# LiveKit Configuration (untuk video calling)
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret
LIVEKIT_HOST=wss://your-livekit-host.com
```

## 🏛️ Backend API

Backend dibangun dengan Go dan menyediakan:

- RESTful API untuk meeting management
- WebSocket untuk real-time communication
- LiveKit integration untuk video/audio calling
- PostgreSQL untuk data persistence
- Redis untuk caching dan session management

### API Documentation

Swagger documentation tersedia di `http://localhost:8080/docs` saat backend berjalan.

## 🎨 Frontend

Frontend dibangun dengan SvelteKit dan menyediakan:

- Modern UI dengan Tailwind CSS
- Real-time video conferencing dengan LiveKit
- Responsive design
- TypeScript untuk type safety
- Component-based architecture

## 🔄 Migration dari Next.js

Proyek ini sudah dimigrasi dari Next.js ke SvelteKit. Untuk informasi lengkap tentang proses migrasi, lihat:

- [RESTRUKTURISASI_PLAN.md](./RESTRUKTURISASI_PLAN.md)
- [MIGRATION_CHECKLIST.md](./MIGRATION_CHECKLIST.md)

## 🐳 Docker Development

Gunakan Docker Compose untuk development environment:

```bash
# Build dan jalankan semua services
pnpm docker:up

# Stop semua services
pnpm docker:down
```

## 📚 Dokumentasi

- [Architecture Diagram](./ARCHITECTURE_DIAGRAM_NEW.md)
- [Migration Plan](./RESTRUKTURISASI_PLAN.md)
- [Migration Checklist](./MIGRATION_CHECKLIST.md)

## 🤝 Contributing

1. Fork repository
2. Buat feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push ke branch (`git push origin feature/amazing-feature`)
5. Buka Pull Request

## 📄 License

Proyek ini dilisensikan under MIT License - lihat [LICENSE](LICENSE) file untuk details.

## 🆘 Support

Jika Anda mengalami masalah:

1. Cek [Issues](../../issues) untuk masalah yang sudah dilaporkan
2. Buat issue baru dengan detail yang lengkap
3. Join diskusi di [Discussions](../../discussions)

## 🗺️ Roadmap

- [ ] Mobile apps (React Native)
- [ ] Screen sharing
- [ ] Recording functionality
- [ ] Advanced moderation tools
- [ ] Integration dengan calendar apps
- [ ] AI-powered features

---

**Built with ❤️ by the GoMeet Team**
