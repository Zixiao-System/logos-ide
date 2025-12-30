#!/bin/bash
# Build script for logos-lang WASM

set -e

echo "Building logos-lang WASM..."

# Check for wasm-pack
if ! command -v wasm-pack &> /dev/null; then
    echo "wasm-pack not found. Installing..."
    cargo install wasm-pack
fi

# Build for web target
wasm-pack build crates/logos-wasm \
    --target web \
    --release \
    --out-dir ../../pkg \
    --out-name logos-lang

echo "Build complete! Output in pkg/"

# Copy to src/services/language/wasm if it exists
if [ -d "../src/services/language" ]; then
    mkdir -p ../src/services/language/wasm
    cp -r pkg/* ../src/services/language/wasm/
    echo "Copied to src/services/language/wasm/"
fi

echo "Done!"
