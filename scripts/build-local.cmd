@echo off
REM Local build script for Logos IDE (Windows)
REM This script builds the complete application locally

setlocal enabledelayedexpansion

echo ========================================
echo   Logos IDE - Local Build Script
echo ========================================
echo.

REM Parse arguments
set BUILD_DAEMON=true
set BUILD_APP=true
set SKIP_TYPECHECK=false

:parse_args
if "%~1"=="" goto :done_args
if "%~1"=="--skip-daemon" (
    set BUILD_DAEMON=false
    shift
    goto :parse_args
)
if "%~1"=="--skip-app" (
    set BUILD_APP=false
    shift
    goto :parse_args
)
if "%~1"=="--skip-typecheck" (
    set SKIP_TYPECHECK=true
    shift
    goto :parse_args
)
if "%~1"=="--help" (
    echo Usage: %0 [options]
    echo.
    echo Options:
    echo   --skip-daemon     Skip Rust daemon build
    echo   --skip-app        Skip Electron app build
    echo   --skip-typecheck  Skip TypeScript type checking
    echo   --help            Show this help message
    exit /b 0
)
shift
goto :parse_args
:done_args

REM Check prerequisites
echo [1/5] Checking prerequisites...

where node >nul 2>&1
if errorlevel 1 (
    echo Error: node is not installed
    echo Please install Node.js first
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo Error: npm is not installed
    echo Please install Node.js first
    exit /b 1
)

if "%BUILD_DAEMON%"=="true" (
    where cargo >nul 2>&1
    if errorlevel 1 (
        echo Error: cargo is not installed
        echo Please install Rust first: https://rustup.rs
        exit /b 1
    )
)

for /f "tokens=*" %%i in ('node --version') do echo   - Node.js: %%i
for /f "tokens=*" %%i in ('npm --version') do echo   - npm: %%i
if "%BUILD_DAEMON%"=="true" (
    for /f "tokens=*" %%i in ('rustc --version') do echo   - Rust: %%i
)
echo.

REM Install npm dependencies
echo [2/5] Installing npm dependencies...
call npm install
if errorlevel 1 (
    echo Error: npm install failed
    exit /b 1
)
echo.

REM Build Daemon
if "%BUILD_DAEMON%"=="true" (
    echo [3/5] Building Rust daemon ^(logos-daemon^)...

    pushd logos-lang
    cargo build --release --package logos-daemon
    if errorlevel 1 (
        echo Error: cargo build failed
        popd
        exit /b 1
    )
    popd

    echo   Daemon build complete: logos-lang\target\release\logos-daemon.exe
) else (
    echo [3/5] Skipping daemon build ^(--skip-daemon^)
)
echo.

REM TypeScript type check
if "%SKIP_TYPECHECK%"=="true" (
    echo [4/5] Skipping TypeScript type check ^(--skip-typecheck^)
) else (
    echo [4/5] Running TypeScript type check...
    call npm run typecheck
    if errorlevel 1 (
        echo Error: TypeScript type check failed
        exit /b 1
    )
)
echo.

REM Build Electron app
if "%BUILD_APP%"=="true" (
    echo [5/5] Building Electron application...

    call npx vite build
    if errorlevel 1 (
        echo Error: Vite build failed
        exit /b 1
    )

    call npx electron-builder
    if errorlevel 1 (
        echo Error: electron-builder failed
        exit /b 1
    )

    echo.
    echo ========================================
    echo   Build Complete!
    echo ========================================
    echo.
    echo Output directory: release\
    echo.
    dir release\ 2>nul || echo   ^(No release files found^)
) else (
    echo [5/5] Skipping Electron app build ^(--skip-app^)
)

echo.
echo Done!
