# Otaku

> Cross-platform anime and manga viewer with a sleek Netflix-like UI

Built with Tauri 2.0 (Rust) + React 18 + TypeScript 5

## Features (Planned)

- 🎬 **Anime Streaming** - Watch anime from multiple sources with adaptive quality
- 📚 **Manga Reader** - Read manga with smooth page navigation and zoom
- 🔌 **Extension System** - Sandboxed JavaScript extensions for content sources
- 📊 **AniList Integration** - Automatic progress tracking and library sync
- ⬇️ **Offline Downloads** - Download episodes and chapters for offline viewing
- 🎨 **Netflix-Style UI** - Beautiful dark theme with smooth animations
- ⚡ **Native Performance** - Built with Rust for speed and efficiency
- 🔒 **Secure** - Sandboxed extensions with domain whitelisting

## Tech Stack

### Frontend
- **React 18** - UI framework
- **TypeScript 5** - Type safety
- **TailwindCSS 4** - Styling with Netflix-inspired theme
- **Zustand** - Lightweight state management
- **Vite 6** - Build tool and dev server
- **Vitest** - Unit testing

### Backend
- **Tauri 2.0** - Native app framework
- **Rust** - High-performance backend
- **SQLite** - Local database
- **Tokio** - Async runtime

## Project Status

**Current Phase**: Phase 1, Week 1 ✅ Complete

### Completed
- ✅ Project initialization with Tauri + React + TypeScript
- ✅ TailwindCSS configuration with Netflix-style dark theme
- ✅ ESLint, Prettier, and Vitest setup
- ✅ Organized folder structure
- ✅ Git repository initialization

### Next Steps
- 🚧 Week 2: Core UI Shell (TopNav, AppShell, basic routing)
- 📋 Week 3: Extension system foundation
- 📋 Week 4: Search & browse functionality

## Development

### Prerequisites
- Node.js 18+ (v25.3.0 currently)
- Rust 1.77.2+ (v1.93.0 currently)
- pnpm 8+

### Getting Started

```bash
# Install dependencies
pnpm install

# Run development server (Vite only)
pnpm dev

# Run Tauri app in development mode
pnpm tauri:dev

# Build for production
pnpm tauri:build
```

### Available Scripts

```bash
# Development
pnpm dev              # Start Vite dev server
pnpm tauri:dev        # Start Tauri app with hot reload

# Build
pnpm build            # Build frontend
pnpm tauri:build      # Build complete Tauri app

# Testing
pnpm test             # Run tests in watch mode
pnpm test:run         # Run tests once
pnpm test:ui          # Run tests with UI

# Code Quality
pnpm lint             # Lint code
pnpm lint:fix         # Lint and fix
pnpm format           # Format code
pnpm format:check     # Check formatting
pnpm typecheck        # TypeScript type checking
```

## Project Structure

```
otaku/
├── src/                      # Frontend source
│   ├── components/           # React components
│   │   ├── layout/          # Layout components (TopNav, AppShell)
│   │   ├── media/           # Media components (Cards, Carousel)
│   │   ├── player/          # Video player components
│   │   ├── reader/          # Manga reader components
│   │   └── extensions/      # Extension management UI
│   ├── screens/             # Page components
│   ├── store/               # Zustand state stores
│   ├── utils/               # Utility functions
│   └── test/                # Test utilities
├── src-tauri/               # Backend source
│   ├── src/
│   │   ├── extensions/      # Extension system
│   │   ├── database/        # SQLite integration
│   │   ├── media/           # Video/image processing
│   │   ├── trackers/        # AniList integration
│   │   ├── cache/           # Caching system
│   │   └── downloads/       # Download manager
│   └── migrations/          # Database migrations
└── ...config files
```

## Design System

### Colors (Netflix-Inspired)
- Background Primary: `#141414` (Deep black)
- Background Secondary: `#1a1a1a` (Cards)
- Accent Primary: `#e50914` (Netflix red for CTAs)
- Text Primary: `#ffffff`
- Text Secondary: `#b3b3b3`

### Spacing
- Base unit: 8px (0.5rem)
- Scale: 0.5rem, 1rem, 1.5rem, 2rem, 3rem

### Typography
- Font: Inter (fallback to system fonts)
- Sizes: 12px (xs) to 48px (3xl)

## Architecture Highlights

### Extension System
- Sandboxed JavaScript execution with QuickJS
- Domain whitelisting for security
- No filesystem or Node.js API access
- Structured JSON return values

### Performance Optimizations
- Only animate `opacity` and `transform` for 60fps
- Virtual scrolling for large lists
- Image and video caching
- Smart prefetching

### Bundle Size
- Target: < 5MB installer (vs 40-100MB for Electron)
- Tauri's native rendering reduces bundle size by 95%

## Contributing

This is a personal project, but contributions are welcome! Please ensure:
- Code follows ESLint and Prettier rules
- All tests pass (`pnpm test:run`)
- TypeScript types are strict
- Commits follow conventional commit format

## License

MIT License - see LICENSE file for details

## Acknowledgments

- Inspired by Netflix's UI design
- Built with the amazing Tauri framework
- Thanks to the Rust and React communities
