# Rencana Restrukturisasi Proyek GoMeet

## Analisis Struktur Saat Ini

### Struktur Proyek Existing:

```
gomeet/
├── src/                          # Next.js Frontend (React)
│   ├── app/                      # App Router
│   ├── components/               # React Components
│   ├── contexts/                 # React Contexts
│   ├── hooks/                    # Custom Hooks
│   ├── lib/                      # Utility Libraries
│   └── types/                    # TypeScript Types
├── backend/                      # Go Backend API
│   ├── cmd/                      # Application Entry Point
│   ├── internal/                 # Internal Packages
│   ├── migrations/               # Database Migrations
│   └── docs/                     # Swagger Documentation
├── gomeet-preact/                # Folder Kosong (akan dihapus)
├── components/                   # Duplicate UI Components
├── hooks/                        # Duplicate Hooks
├── lib/                          # Duplicate Libraries
└── [File konfigurasi root]
```

### Masalah yang Diidentifikasi:

1. **Duplikasi struktur**: `components/`, `hooks/`, `lib/` ada di root dan di `src/`
2. **Mixed architecture**: Next.js dan Go backend dalam satu repository
3. **Inconsistent structure**: Tidak ada pemisahan yang jelas antara frontend dan backend
4. **Unused folders**: `gomeet-preact/` kosong dan tidak digunakan

## Struktur Baru yang Diusulkan

```
gomeet/
├── packages/
│   ├── backend/                  # Go Backend API
│   │   ├── cmd/
│   │   ├── internal/
│   │   ├── migrations/
│   │   ├── docs/
│   │   ├── go.mod
│   │   ├── go.sum
│   │   └── .env.example
│   └── frontend/                 # SvelteKit Frontend
│       ├── src/
│       │   ├── lib/              # SvelteKit lib (server + client)
│       │   ├── routes/           # SvelteKit routes
│       │   ├── components/       # Svelte components
│       │   └── app.html          # SvelteKit app template
│       ├── static/               # Static assets
│       ├── tests/                # Test files
│       ├── package.json
│       ├── svelte.config.js
│       ├── vite.config.ts
│       └── .env.example
├── shared/                       # Shared types and utilities
│   ├── types/                    # TypeScript types
│   └── utils/                    # Shared utilities
├── docs/                         # Documentation
├── scripts/                      # Build and deployment scripts
├── docker/                       # Docker configurations
├── .env.example                  # Environment template
├── .gitignore
├── package.json                  # Root package.json (workspace)
├── pnpm-workspace.yaml           # PNPM workspace config
├── docker-compose.yml            # Development environment
└── README.md
```

## Langkah-Langkah Migrasi Backend

### 1. Pindahkan Backend ke `packages/backend/`

```bash
# Membuat struktur baru
mkdir -p packages/backend
mv backend/* packages/backend/
rmdir backend
```

### 2. Update Konfigurasi Backend

- **Go module**: Update import paths dari `github.com/your-org/gomeet-backend` ke relative paths
- **Environment variables**: Update path references
- **Dockerfile**: Update build context paths
- **Swagger docs**: Update base URL configurations

### 3. Konfigurasi CORS untuk Development

Update `backend/internal/config/config.go`:

```go
CORS: CORSConfig{
    AllowedOrigins: getStringSliceEnv("ALLOWED_ORIGINS", []string{
        "http://localhost:5173",  // SvelteKit default port
        "http://localhost:4173",  // SvelteKit preview port
    }),
},
```

## Pembuatan Proyek SvelteKit Baru

### 1. Inisialisasi SvelteKit

```bash
# Create new SvelteKit project
npm create svelte@latest packages/frontend
cd packages/frontend
npm install

# Install required dependencies
npm install @sveltejs/adapter-auto tailwindcss autoprefixer postcss
npm install -D @tailwindcss/typography
```

### 2. Konfigurasi SvelteKit

**svelte.config.js**:

```javascript
import adapter from "@sveltejs/adapter-auto";
import { vitePreprocess } from "@sveltejs/kit/vite";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    alias: {
      $lib: "./src/lib",
      $components: "./src/components",
      $types: "../shared/types",
    },
  },
};

export default config;
```

### 3. Migrasi Komponen dari React ke Svelte

Struktur migrasi:

- **React Components** → **Svelte Components**
- **React Hooks** → **Svelte Stores/Composition**
- **Context API** → **Svelte Context API**
- **Next.js Router** → **SvelteKit Navigation**

## File Konfigurasi yang Perlu Dipertahankan

### 1. Environment Variables

**Root .env.example**:

```env
# Backend Configuration
PORT=8080
DB_HOST=localhost
DB_PORT=5432
DB_USER=gomeet
DB_PASSWORD=
DB_NAME=gomeet_db

# Frontend Configuration
PUBLIC_API_URL=http://localhost:8080/api/v1
PUBLIC_WS_URL=ws://localhost:8080
PUBLIC_APP_NAME=GoMeet

# Shared Configuration
JWT_SECRET=your-secret-key
REDIS_HOST=localhost
REDIS_PORT=6379
```

### 2. Package.json Workspace

**Root package.json**:

```json
{
  "name": "gomeet",
  "private": true,
  "workspaces": ["packages/*"],
  "scripts": {
    "dev": "concurrently \"pnpm --filter backend dev\" \"pnpm --filter frontend dev\"",
    "build": "pnpm --filter backend build && pnpm --filter frontend build",
    "test": "pnpm --filter \"*\" test",
    "lint": "pnpm --filter \"*\" lint"
  },
  "devDependencies": {
    "concurrently": "^8.2.0"
  }
}
```

### 3. PNPM Workspace

**pnpm-workspace.yaml**:

```yaml
packages:
  - "packages/*"
  - "shared"
```

## Strategi Integrasi Backend-Frontend

### 1. API Client

Buat shared API client di `packages/frontend/src/lib/api-client.ts`:

```typescript
// Svelte version dengan $lib/ stores
import { browser } from "$app/environment";
import { writable } from "svelte/store";

export const apiBase = writable(
  browser ? import.meta.env.VITE_PUBLIC_API_URL : "http://localhost:8080/api/v1"
);

// Svelte-specific API client dengan error handling
export class APIClient {
  // ... implementation untuk Svelte
}
```

### 2. Type Sharing

**shared/types/index.ts**:

```typescript
// Shared types untuk backend dan frontend
export interface User {
  id: string;
  username: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  description?: string;
  // ... other fields
}
```

### 3. WebSocket Integration

**packages/frontend/src/lib/websocket.ts**:

```typescript
import { writable } from "svelte/store";

export const wsConnection = writable(null);

export function connectWebSocket(meetingId: string, token?: string) {
  const ws = new WebSocket(
    `${import.meta.env.VITE_PUBLIC_WS_URL}/ws/meetings/${meetingId}`
  );
  // ... implementation
}
```

## Urutan Eksekusi Migrasi

### Phase 1: Preparation (1-2 hari)

1. Backup proyek saat ini
2. Buat struktur folder baru
3. Setup workspace configuration
4. Pindahkan backend ke `packages/backend/`

### Phase 2: Backend Migration (1 hari)

1. Update import paths di Go code
2. Update konfigurasi CORS
3. Test backend functionality
4. Update Docker configuration

### Phase 3: Frontend Setup (2-3 hari)

1. Inisialisasi SvelteKit project
2. Setup Tailwind CSS
3. Migrasi utility functions
4. Setup API client

### Phase 4: Component Migration (3-5 hari)

1. Migrasi UI components (Button, Input, etc.)
2. Migrasi layout components
3. Migrasi page components
4. Migrasi custom hooks ke Svelte stores

### Phase 5: Integration & Testing (2-3 hari)

1. Test integrasi backend-frontend
2. Fix routing issues
3. Test WebSocket connections
4. Performance testing

### Phase 6: Cleanup (1 hari)

1. Hapus folder yang tidak digunakan
2. Update documentation
3. Final testing
4. Deploy ke staging

## File yang Perlu Dihapus/Dipindahkan

### Dihapus:

- `gomeet-preact/` (folder kosong)
- `components/` (duplicate di root)
- `hooks/` (duplicate di root)
- `lib/` (duplicate di root)
- `next.config.ts`
- `postcss.config.mjs`

### Dipindahkan:

- `src/` → `packages/frontend/src/` (setelah konversi ke Svelte)
- `backend/` → `packages/backend/`
- File konfigurasi root → update untuk workspace

## Risiko dan Mitigasi

### Risiko:

1. **Breaking changes**: API compatibility issues
2. **Downtime**: Selama migrasi
3. **Data loss**: Environment variables atau konfigurasi
4. **Complexity**: Learning curve untuk SvelteKit

### Mitigasi:

1. **Feature flags**: Gunakan existing feature flag system
2. **Gradual migration**: Migrasi per fitur
3. **Backup**: Complete backup sebelum mulai
4. **Testing**: Comprehensive testing di setiap phase

## Checklist Validasi

### Backend:

- [ ] API endpoints berfungsi
- [ ] WebSocket connections stabil
- [ ] Database migrations OK
- [ ] CORS configuration benar
- [ ] Environment variables valid

### Frontend:

- [ ] Routes berfungsi
- [ ] Components render correctly
- [ ] API calls successful
- [ ] WebSocket connections work
- [ ] Responsive design maintained

### Integration:

- [ ] Auth flow works
- [ ] Real-time features functional
- [ ] Error handling proper
- [ ] Performance acceptable
- [ ] Deployment ready

## Timeline Estimasi

**Total: 10-14 hari**

- Phase 1: 1-2 hari
- Phase 2: 1 hari
- Phase 3: 2-3 hari
- Phase 4: 3-5 hari
- Phase 5: 2-3 hari
- Phase 6: 1 hari

## Next Steps

1. Review dan approve rencana ini
2. Schedule migration window
3. Prepare backup strategy
4. Setup development environment
5. Mulai Phase 1 implementation
