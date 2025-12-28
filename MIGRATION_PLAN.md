# Logos IDE Migration Plan

## Overview

This document outlines the plan to migrate Logos IDE from the PRTS DevOps Platform monorepo to a standalone repository.

## Migration Goals

1. **Independence**: Allow Logos IDE to be developed, versioned, and released independently
2. **Reusability**: Enable Logos IDE to be used in other projects beyond PRTS
3. **Simplified CI/CD**: Dedicated pipelines for IDE builds and releases
4. **Community Contribution**: Lower barrier for contributors interested only in the IDE

## New Repository Structure

```
logos-ide/
├── .github/
│   ├── workflows/
│   │   ├── build.yml           # Build workflow for all platforms
│   │   ├── release.yml         # Release automation
│   │   └── test.yml            # Unit & E2E tests
│   └── ISSUE_TEMPLATE/
├── electron/
│   ├── main.ts                 # Electron main process
│   ├── preload.ts              # Preload scripts
│   └── services/               # Backend services (file system, git, etc.)
├── src/
│   ├── components/             # Vue components
│   ├── stores/                 # Pinia stores
│   ├── views/                  # View components
│   ├── types/                  # TypeScript types
│   ├── utils/                  # Utility functions
│   ├── styles/                 # Global styles
│   ├── router/                 # Vue Router config
│   ├── App.vue
│   └── main.ts
├── public/                     # Static assets
├── build/                      # Build resources (icons, etc.)
├── docs/                       # Documentation
│   ├── ARCHITECTURE.md
│   ├── DEVELOPMENT.md
│   └── API.md
├── tests/
│   ├── unit/
│   └── e2e/
├── .gitignore
├── .eslintrc.js
├── .prettierrc
├── package.json
├── tsconfig.json
├── vite.config.ts
├── electron-builder.yml
├── README.md
├── CHANGELOG.md
├── CONTRIBUTING.md
└── LICENSE
```

## Migration Steps

### Phase 1: Preparation (Before Migration)

- [ ] **1.1** Create new GitHub repository: `logos-ide` or `Zixiao-System/logos-ide`
- [ ] **1.2** Set up repository settings (branch protection, secrets, etc.)
- [ ] **1.3** Prepare CI/CD workflow files
- [ ] **1.4** Create standalone documentation

### Phase 2: Code Migration

- [ ] **2.1** Copy IDE source code to new repository
- [ ] **2.2** Update package.json with new repository URLs
- [ ] **2.3** Update import paths if necessary
- [ ] **2.4** Remove PRTS-specific dependencies (if any)
- [ ] **2.5** Add generic configuration options

### Phase 3: CI/CD Setup

- [ ] **3.1** Configure GitHub Actions for builds
  - macOS (Intel + Apple Silicon)
  - Windows (x64)
  - Linux (x64, arm64)
- [ ] **3.2** Set up automatic releases
- [ ] **3.3** Configure code signing (Apple Developer ID, Windows code signing)
- [ ] **3.4** Set up auto-update server (electron-updater)

### Phase 4: Integration

- [ ] **4.1** Update PRTS monorepo to use Logos IDE as dependency
- [ ] **4.2** Create npm package for embedding (optional)
- [ ] **4.3** Document integration methods

### Phase 5: Post-Migration

- [ ] **5.1** Archive old ide/ directory in monorepo
- [ ] **5.2** Update all documentation references
- [ ] **5.3** Announce migration to contributors

## Files to Migrate

### Core Files
| Source | Destination | Notes |
|--------|-------------|-------|
| `ide/electron/` | `electron/` | Electron main/preload |
| `ide/src/` | `src/` | Vue application |
| `ide/package.json` | `package.json` | Update repo URLs |
| `ide/vite.config.ts` | `vite.config.ts` | No changes |
| `ide/tsconfig.json` | `tsconfig.json` | No changes |
| `ide/index.html` | `index.html` | No changes |

### Files to Create
| File | Purpose |
|------|---------|
| `README.md` | Standalone documentation |
| `CHANGELOG.md` | Version history |
| `CONTRIBUTING.md` | Contribution guidelines |
| `LICENSE` | MIT License |
| `.github/workflows/*.yml` | CI/CD pipelines |
| `electron-builder.yml` | Build configuration |
| `docs/` | Extended documentation |

### Files to Exclude
| File | Reason |
|------|--------|
| `ide/llms-full.txt` | Development artifact |
| `ide/dist/` | Build output |
| `ide/dist-electron/` | Build output |
| `ide/release/` | Release builds |
| `ide/node_modules/` | Dependencies |
| `ide/.DS_Store` | macOS system file |

## package.json Updates

```json
{
  "name": "lsp-ide",
  "version": "0.1.0",
  "description": "Logos IDE - A modern, lightweight code editor built with Electron and Vue 3",
  "repository": {
    "type": "git",
    "url": "https://github.com/Zixiao-System/logos-ide.git"
  },
  "homepage": "https://github.com/Zixiao-System/logos-ide",
  "bugs": {
    "url": "https://github.com/Zixiao-System/logos-ide/issues"
  }
}
```

## GitHub Actions Workflow

### Build Workflow (build.yml)

```yaml
name: Build

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build
      - uses: actions/upload-artifact@v4
        with:
          name: dist-${{ matrix.os }}
          path: release/
```

### Release Workflow (release.yml)

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    strategy:
      matrix:
        include:
          - os: macos-latest
            arch: universal
          - os: windows-latest
            arch: x64
          - os: ubuntu-latest
            arch: x64
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run electron:build
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: softprops/action-gh-release@v1
        with:
          files: release/*
```

## PRTS Integration Options

After migration, PRTS can integrate Logos IDE in several ways:

### Option 1: Git Submodule
```bash
git submodule add https://github.com/Zixiao-System/logos-ide.git ide
```

### Option 2: npm Dependency
```json
{
  "dependencies": {
    "logos-ide": "github:Zixiao-System/lsp-ide"
  }
}
```

### Option 3: Standalone Download
Download pre-built binaries from GitHub Releases.

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| Phase 1 | 1 day | None |
| Phase 2 | 1-2 days | Phase 1 |
| Phase 3 | 2-3 days | Phase 2 |
| Phase 4 | 1 day | Phase 3 |
| Phase 5 | 1 day | Phase 4 |

**Total: ~1 week**

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking changes during migration | High | Thorough testing before archiving old code |
| Lost git history | Medium | Use `git filter-repo` to preserve history |
| CI/CD failures | Medium | Test workflows in separate branch first |
| Code signing issues | Low | Document signing process thoroughly |

## Rollback Plan

If migration fails:
1. Keep monorepo ide/ directory unchanged
2. Delete new repository
3. Document lessons learned
4. Retry with updated plan

---

*Last updated: 2024-12-25*
