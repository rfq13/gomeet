# Diagram Arsitektur Baru GoMeet

## Visualisasi Struktur Folder

```mermaid
graph TD
    A[gomeet/] --> B[packages/]
    A --> C[shared/]
    A --> D[docs/]
    A --> E[scripts/]
    A --> F[docker/]
    A --> G[.env.example]
    A --> H[package.json]
    A --> I[pnpm-workspace.yaml]
    A --> J[docker-compose.yml]

    B --> K[backend/]
    B --> L[frontend/]

    K --> M[cmd/]
    K --> N[internal/]
    K --> O[migrations/]
    K --> P[docs/]
    K --> Q[go.mod]
    K --> R[.env.example]

    L --> S[src/]
    L --> T[static/]
    L --> U[tests/]
    L --> V[package.json]
    L --> W[svelte.config.js]
    L --> X[vite.config.ts]

    S --> Y[lib/]
    S --> Z[routes/]
    S --> AA[components/]
    S --> BB[app.html]

    C --> CC[types/]
    C --> DD[utils/]
```

## Arsitektur High-Level

```mermaid
graph LR
    subgraph "Development Environment"
        A[docker-compose.yml] --> B[PostgreSQL]
        A --> C[Redis]
        A --> D[Backend API]
        A --> E[Frontend Dev Server]
    end

    subgraph "Backend (Go)"
        D --> F[Gin Router]
        F --> G[Controllers]
        G --> H[Services]
        H --> I[GORM Database]
        H --> J[Redis Cache]
        D --> K[WebSocket Hub]
        D --> L[Swagger Docs]
    end

    subgraph "Frontend (SvelteKit)"
        E --> M[SvelteKit Router]
        M --> N[Pages/Routes]
        N --> O[Components]
        O --> P[Stores]
        P --> Q[API Client]
        Q --> D
        E --> R[WebSocket Client]
        R --> K
    end

    subgraph "Shared"
        S[TypeScript Types]
        T[Utility Functions]
        U[Constants]
    end

    Q -.-> S
    P -.-> T
    D -.-> S
```

## Flow Data Aplikasi

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend (SvelteKit)
    participant A as API Client
    participant B as Backend (Go)
    participant D as Database
    participant R as Redis
    participant W as WebSocket

    U->>F: User Action
    F->>A: API Request
    A->>B: HTTP Request
    B->>D: Query/Update
    B->>R: Cache Operation
    B-->>A: Response
    A-->>F: Data Update
    F-->>U: UI Update

    Note over F,W: Real-time Communication
    F->>W: WebSocket Connect
    W->>B: Handle Connection
    B-->>W: Broadcast Message
    W-->>F: Push Update
    F-->>U: Real-time UI
```

## Component Architecture

```mermaid
graph TD
    subgraph "Frontend Components (Svelte)"
        A[Layout Components] --> B[Header.svelte]
        A --> C[Sidebar.svelte]
        A --> D[Footer.svelte]

        E[UI Components] --> F[Button.svelte]
        E --> G[Input.svelte]
        E --> H[Modal.svelte]
        E --> I[Card.svelte]

        J[Feature Components] --> K[MeetingCard.svelte]
        J --> L[ChatPanel.svelte]
        J --> M[VideoGrid.svelte]
        J --> N[ParticipantList.svelte]

        O[Page Components] --> P[Dashboard.svelte]
        O --> Q[Meeting/[id].svelte]
        O --> R[Auth.svelte]
    end

    subgraph "Backend Services (Go)"
        S[Auth Service] --> T[JWT Management]
        S --> U[User Validation]

        V[Meeting Service] --> W[CRUD Operations]
        V --> X[Participant Management]

        Y[Chat Service] --> Z[Message Handling]
        Y --> AA[Real-time Updates]

        BB[WebSocket Service] --> CC[Connection Management]
        BB --> DD[Message Broadcasting]
    end
```

## Deployment Architecture

```mermaid
graph TB
    subgraph "Production Environment"
        A[Load Balancer] --> B[Frontend CDN]
        A --> C[Backend API Cluster]

        B --> D[SvelteKit Static Files]

        C --> E[API Server 1]
        C --> F[API Server 2]
        C --> G[API Server N]

        E --> H[PostgreSQL Primary]
        F --> H
        G --> H

        I[PostgreSQL Replica] --> H

        E --> J[Redis Cluster]
        F --> J
        G --> J

        K[WebSocket Gateway] --> C
    end

    subgraph "Monitoring & Logging"
        L[Application Logs]
        M[Metrics Collection]
        N[Error Tracking]
    end

    E -.-> L
    F -.-> L
    G -.-> L
    E -.-> M
    F -.-> M
    G -.-> M
    E -.-> N
    F -.-> N
    G -.-> N
```

## Development Workflow

```mermaid
graph LR
    A[Developer] --> B[git clone]
    B --> C[docker-compose up]
    C --> D[Backend Ready]
    C --> E[Frontend Ready]

    D --> F[Hot Reload Go]
    E --> G[Hot Reload Svelte]

    H[Code Changes] --> I[Auto Format]
    I --> J[Lint Check]
    J --> K[Type Check]
    K --> L[Run Tests]
    L --> M[Commit]

    M --> N[CI/CD Pipeline]
    N --> O[Build Backend]
    N --> P[Build Frontend]
    N --> Q[Run E2E Tests]
    N --> R[Deploy to Staging]

    S[Manual Approval] --> T[Deploy to Production]
```

## Technology Stack

```mermaid
graph TD
    A[GoMeet Application] --> B[Frontend]
    A --> C[Backend]
    A --> D[Infrastructure]

    B --> E[SvelteKit]
    B --> F[TypeScript]
    B --> G[Tailwind CSS]
    B --> H[Vite]

    C --> I[Go 1.24]
    C --> J[Gin Framework]
    C --> K[GORM]
    C --> L[WebSocket]

    D --> M[PostgreSQL]
    D --> N[Redis]
    D --> O[Docker]
    D --> P[Nginx]

    Q[Development Tools] --> R[PNPM Workspaces]
    Q --> S[Air (Go Hot Reload)]
    Q --> T[ESLint]
    Q --> U[Prettier]
```

## Security Architecture

```mermaid
graph TD
    A[Security Layers] --> B[Frontend Security]
    A --> C[Backend Security]
    A --> D[Infrastructure Security]

    B --> E[CSRF Protection]
    B --> F[XSS Prevention]
    B --> G[Content Security Policy]

    C --> H[JWT Authentication]
    C --> I[Rate Limiting]
    C --> J[CORS Configuration]
    C --> K[Input Validation]
    C --> L[SQL Injection Prevention]

    D --> M[HTTPS/TLS]
    D --> N[Firewall Rules]
    D --> O[Database Encryption]
    D --> P[Secret Management]
```

## Performance Considerations

```mermaid
graph LR
    A[Performance Optimization] --> B[Frontend]
    A --> C[Backend]
    A --> D[Database]

    B --> E[Code Splitting]
    B --> F[Lazy Loading]
    B --> G[Asset Optimization]
    B --> H[CDN Caching]

    C --> I[Connection Pooling]
    C --> J[Response Caching]
    C --> K[Gzip Compression]
    C --> L[API Rate Limiting]

    D --> M[Query Optimization]
    D --> N[Indexing Strategy]
    D --> O[Connection Pooling]
    D --> P[Read Replicas]
```

## Migration Strategy

```mermaid
graph TD
    A[Migration Phases] --> B[Phase 1: Setup]
    A --> C[Phase 2: Backend]
    A --> D[Phase 3: Frontend]
    A --> E[Phase 4: Integration]
    A --> F[Phase 5: Testing]
    A --> G[Phase 6: Deployment]

    B --> H[Create Structure]
    B --> I[Setup Workspace]
    B --> J[Move Backend]

    C --> K[Update Imports]
    C --> L[Fix CORS]
    C --> M[Test APIs]

    D --> N[Setup SvelteKit]
    D --> O[Migrate Components]
    D --> P[Convert Hooks]

    E --> Q[API Integration]
    E --> R[WebSocket Setup]
    E --> S[Type Sharing]

    F --> T[Unit Tests]
    F --> U[Integration Tests]
    F --> V[E2E Tests]

    G --> W[Staging Deploy]
    G --> X[Production Deploy]
    G --> Y[Monitor & Optimize]
```
