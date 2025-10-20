# GoMeet Frontend (SvelteKit)

Frontend aplikasi GoMeet dibangun dengan SvelteKit dan TypeScript.

## Fitur

- 🎯 Video conferencing dengan WebRTC
- 💬 Real-time chat
- 🎨 UI modern dengan Tailwind CSS
- 📱 Responsive design
- 🔐 Authentication
- 🗂️ Meeting management

## Teknologi

- **Framework**: SvelteKit
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **UI Components**: Bits UI
- **Icons**: Lucide Svelte
- **Video**: LiveKit Client
- **State Management**: Svelte Stores

## Development

### Prerequisites

- Node.js 18+
- pnpm

### Installation

```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```

### Available Scripts

- `pnpm dev` - Start development server
- `pnpm build` - Build for production
- `pnpm preview` - Preview production build
- `pnpm check` - Run type checking
- `pnpm lint` - Run linting
- `pnpm format` - Format code

## Project Structure

```
src/
├── lib/              # Utility functions and shared code
│   ├── app.css       # Global styles
│   └── utils.ts      # Utility functions
├── components/       # Svelte components
├── routes/           # SvelteKit routes
├── hooks/            # SvelteKit hooks
└── types/            # TypeScript type definitions
```

## Environment Variables

Create a `.env.local` file in the root:

```env
PUBLIC_API_URL=http://localhost:8080/api/v1
PUBLIC_WS_URL=ws://localhost:8080
PUBLIC_APP_NAME=GoMeet
```

## Build & Deployment

```bash
# Build for production
pnpm build

# Preview production build
pnpm preview
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request
