# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Logos is a desktop code editor built with Electron 40 + Vue 3, featuring Monaco Editor, an integrated terminal (xterm.js + node-pty), MDUI Material Design components, and a Rust-based language analysis daemon. It supports VS Code extension hosting and WASM extensions.

## Commands

```bash
# Setup
./setup.sh                    # Full setup (install, build daemon, typecheck)
npm install                   # Install deps (runs electron-rebuild + patch-package)

# Development
npm run dev                   # Vite dev server
npm run electron:dev          # Electron dev mode

# Build
npm run build                 # Full: typecheck + vite build + electron-builder
npm run build:daemon          # Rust daemon only (cd logos-lang && cargo build --release --package logos-daemon)
./build.sh [all|daemon|frontend]

# Quality
npm run typecheck             # vue-tsc --noEmit
npm run lint                  # ESLint with auto-fix

# Testing (Vitest, happy-dom environment)
npm run test                  # Run all tests
npm run test:watch            # Watch mode
npm run test:coverage         # With v8 coverage
npx vitest run tests/unit/stores/    # Run a specific test directory
npx vitest run tests/unit/services/fileService.test.ts  # Run a single test file
```

## Architecture

### Multi-Process Model

1. **Main Process** (`electron/main.ts`) — Window management, IPC handler registration, service coordination
2. **Preload** (`electron/preload.ts`) — Context bridge exposing `window.electronAPI` to renderer
3. **Renderer** (`src/`) — Vue 3 + Pinia app with Monaco Editor
4. **Rust Daemon** (`logos-lang/`) — Language analysis via LSP protocol (Smart Mode)
5. **Extension Host** (`electron/extension-host/`) — Separate process running VS Code extensions

### IPC Communication

All renderer-to-main communication goes through `window.electronAPI`:
- `window.electronAPI.fileSystem.*`, `window.electronAPI.git.*`, `window.electronAPI.terminal.*`, etc.

### Backend Services (`electron/services/`)

Key services: `fileService` (file ops, watching), `gitService` (git CLI wrappers), `terminalService` (PTY), `intelligenceService` (diagnostic routing across TypeScript API / LSP / Rust daemon), `extensionService` (VS Code extension host lifecycle), `wasmExtensionService` (WASM extension runtime), `lspServerManager` (language server lifecycle), `languageDaemonHandlers` (Rust daemon bridge), `debugService` (DAP).

### Frontend State (`src/stores/`)

33 Pinia stores organized by feature. Core stores: `editor` (tabs, cursor, dirty state), `fileExplorer` (directory tree), `git` (branches, staging), `intelligence` (Smart/Basic mode state), `settings` (user preferences), `extensions`, `debug`, `theme`.

### Rust Daemon Workspace (`logos-lang/`)

Cargo workspace with 6 crates: `logos-core` (core processing), `logos-daemon` (LSP server), `logos-parser` (tree-sitter parsers for Python, Go, Rust, C/C++, Java, JS/TS), `logos-semantic` (type checking), `logos-index` (symbol indexing), `logos-refactor` (refactoring).

### Intelligence Modes

- **Basic Mode** — Standard LSP servers; fast startup, low memory
- **Smart Mode** — Full indexing via Rust daemon; adds call hierarchy, impact analysis, safe refactoring
- **Auto Mode** — Selects based on project size/complexity (>5000 files → Basic)

### Extension System

- VS Code extension host runs in a separate process (`electron/extension-host/`)
- WASM extensions run in a sandboxed runtime with permission enforcement
- Extension manifests follow VS Code conventions

## Code Conventions

- TypeScript throughout, strict mode enabled (`noUnusedLocals`, `noUnusedParameters`)
- Path alias: `@/` maps to `src/`
- Use MDUI web components (`<mdui-*>`) for UI elements, not custom div implementations
- Use MDUI CSS variables (`--mdui-color-*`) for colors, not hardcoded values
- Conventional Commits: `<type>(<scope>): <description>` (feat, fix, docs, style, refactor, perf, test, chore)
- Tests go in `tests/unit/` mirroring source structure (components, services, stores, extension-host)
- Test environment: Vitest with happy-dom, setup file at `tests/setup.ts`

## CI Requirements

PRs to `main` must pass:
- **Typecheck & Test** — TypeScript type checking + unit tests
- **Rust Check** — Cargo verification
- At least 1 approval, branch must be up-to-date with main
