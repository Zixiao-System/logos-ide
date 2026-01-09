#!/bin/bash
# Local build script for Logos IDE
# This script builds the complete application locally

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_ROOT"

echo "========================================"
echo "  Logos IDE - Local Build Script"
echo "========================================"
echo ""

# Parse arguments
BUILD_DAEMON=true
BUILD_APP=true
SKIP_TYPECHECK=false

for arg in "$@"; do
    case $arg in
        --skip-daemon)
            BUILD_DAEMON=false
            shift
            ;;
        --skip-app)
            BUILD_APP=false
            shift
            ;;
        --skip-typecheck)
            SKIP_TYPECHECK=true
            shift
            ;;
        --help)
            echo "Usage: $0 [options]"
            echo ""
            echo "Options:"
            echo "  --skip-daemon     Skip Rust daemon build"
            echo "  --skip-app        Skip Electron app build"
            echo "  --skip-typecheck  Skip TypeScript type checking"
            echo "  --help            Show this help message"
            exit 0
            ;;
    esac
done

# Check prerequisites
echo "[1/5] Checking prerequisites..."

check_command() {
    if ! command -v "$1" &> /dev/null; then
        echo "Error: $1 is not installed"
        echo "Please install $1 first"
        exit 1
    fi
}

check_command "node"
check_command "npm"

if [ "$BUILD_DAEMON" = true ]; then
    check_command "cargo"
    check_command "rustc"
fi

echo "  - Node.js: $(node --version)"
echo "  - npm: $(npm --version)"
if [ "$BUILD_DAEMON" = true ]; then
    echo "  - Rust: $(rustc --version)"
    echo "  - Cargo: $(cargo --version)"
fi
echo ""

# Install npm dependencies
echo "[2/5] Installing npm dependencies..."
npm install
echo ""

# Build Daemon
if [ "$BUILD_DAEMON" = true ]; then
    echo "[3/5] Building Rust daemon (logos-daemon)..."

    cd logos-lang
    cargo build --release --package logos-daemon
    cd "$PROJECT_ROOT"

    echo "  Daemon build complete: logos-lang/target/release/logos-daemon"
else
    echo "[3/5] Skipping daemon build (--skip-daemon)"
fi
echo ""

# TypeScript type check
if [ "$SKIP_TYPECHECK" = true ]; then
    echo "[4/5] Skipping TypeScript type check (--skip-typecheck)"
else
    echo "[4/5] Running TypeScript type check..."
    npm run typecheck
fi
echo ""

# Build Electron app
if [ "$BUILD_APP" = true ]; then
    echo "[5/5] Building Electron application..."

    # Run vite build and electron-builder
    npx vue-tsc --noEmit || true  # Already checked above
    npx vite build
    npx electron-builder

    echo ""
    echo "========================================"
    echo "  Build Complete!"
    echo "========================================"
    echo ""
    echo "Output directory: release/"
    echo ""
    ls -la release/ 2>/dev/null || echo "  (No release files found)"
else
    echo "[5/5] Skipping Electron app build (--skip-app)"
fi

echo ""
echo "Done!"
