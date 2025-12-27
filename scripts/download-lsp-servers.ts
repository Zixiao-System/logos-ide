#!/usr/bin/env npx ts-node
/**
 * LSP 服务器下载脚本
 * 下载各语言的 LSP 服务器到 resources/bin/{platform}-{arch}/ 目录
 */

import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import * as https from 'https'
import * as http from 'http'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PLATFORM = process.platform
const ARCH = process.arch

// 目标目录
const BIN_DIR = path.join(__dirname, '..', 'resources', 'bin', `${PLATFORM}-${ARCH}`)

// 创建目录
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
    console.log(`Created directory: ${dir}`)
  }
}

// 下载文件
function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const protocol = url.startsWith('https') ? https : http

    console.log(`Downloading: ${url}`)

    const request = protocol.get(url, (response) => {
      // Handle redirects
      if (response.statusCode === 301 || response.statusCode === 302) {
        const redirectUrl = response.headers.location
        if (redirectUrl) {
          file.close()
          fs.unlinkSync(dest)
          downloadFile(redirectUrl, dest).then(resolve).catch(reject)
          return
        }
      }

      if (response.statusCode !== 200) {
        file.close()
        fs.unlinkSync(dest)
        reject(new Error(`Failed to download: ${response.statusCode}`))
        return
      }

      response.pipe(file)

      file.on('finish', () => {
        file.close()
        console.log(`Downloaded: ${dest}`)
        resolve()
      })
    })

    request.on('error', (err) => {
      file.close()
      fs.unlinkSync(dest)
      reject(err)
    })
  })
}

// 解压 tar.gz
async function extractTarGz(file: string, dest: string): Promise<void> {
  console.log(`Extracting: ${file} to ${dest}`)
  execSync(`tar -xzf "${file}" -C "${dest}"`, { stdio: 'inherit' })
}

// ============ Pyright ============

async function downloadPyright(): Promise<void> {
  console.log('\n=== Downloading Pyright ===')

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-'))

  try {
    // 使用 npm 安装 pyright
    console.log('Installing pyright via npm...')
    execSync('npm pack pyright@latest', { cwd: tempDir, stdio: 'inherit' })

    // 找到下载的 tgz 文件
    const files = fs.readdirSync(tempDir)
    const tgzFile = files.find(f => f.startsWith('pyright-') && f.endsWith('.tgz'))
    if (!tgzFile) {
      throw new Error('Pyright package not found')
    }

    // 解压
    await extractTarGz(path.join(tempDir, tgzFile), tempDir)

    // 复制 langserver
    const langserverSrc = path.join(tempDir, 'package', 'dist', 'pyright-langserver.js')
    if (!fs.existsSync(langserverSrc)) {
      throw new Error('pyright-langserver.js not found in package')
    }

    const wrapperName = PLATFORM === 'win32' ? 'pyright-langserver.cmd' : 'pyright-langserver'
    const wrapperPath = path.join(BIN_DIR, wrapperName)

    // 复制整个 dist 目录
    const distSrc = path.join(tempDir, 'package', 'dist')
    const distDest = path.join(BIN_DIR, 'pyright-dist')
    ensureDir(distDest)

    // 复制所有文件
    const copyRecursive = (src: string, dest: string) => {
      const entries = fs.readdirSync(src, { withFileTypes: true })
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name)
        const destPath = path.join(dest, entry.name)
        if (entry.isDirectory()) {
          ensureDir(destPath)
          copyRecursive(srcPath, destPath)
        } else {
          fs.copyFileSync(srcPath, destPath)
        }
      }
    }
    copyRecursive(distSrc, distDest)

    // 创建启动脚本
    const startScript = PLATFORM === 'win32'
      ? `@echo off\nnode "%~dp0pyright-dist\\pyright-langserver.js" %*`
      : `#!/bin/sh\nexec node "$(dirname "$0")/pyright-dist/pyright-langserver.js" "$@"`

    fs.writeFileSync(wrapperPath, startScript)
    if (PLATFORM !== 'win32') {
      fs.chmodSync(wrapperPath, '755')
    }

    console.log('Pyright installed successfully')
  } finally {
    // 清理
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

// ============ gopls ============

async function downloadGopls(): Promise<void> {
  console.log('\n=== Downloading gopls ===')

  // 检查 go 是否可用
  try {
    execSync('go version', { stdio: 'pipe' })
  } catch {
    console.log('Go not found, skipping gopls download')
    console.log('To install gopls, run: go install golang.org/x/tools/gopls@latest')
    return
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gopls-'))

  try {
    // 使用 go install 安装 gopls
    console.log('Installing gopls via go install...')
    const env = {
      ...process.env,
      GOBIN: tempDir
    }
    execSync('go install golang.org/x/tools/gopls@latest', { env, stdio: 'inherit' })

    // 复制到目标目录
    const goplsName = PLATFORM === 'win32' ? 'gopls.exe' : 'gopls'
    const goplsSrc = path.join(tempDir, goplsName)
    const goplsDest = path.join(BIN_DIR, goplsName)

    if (fs.existsSync(goplsSrc)) {
      fs.copyFileSync(goplsSrc, goplsDest)
      if (PLATFORM !== 'win32') {
        fs.chmodSync(goplsDest, '755')
      }
      console.log('gopls installed successfully')
    } else {
      console.log('gopls binary not found after install')
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

// ============ rust-analyzer ============

async function downloadRustAnalyzer(): Promise<void> {
  console.log('\n=== Downloading rust-analyzer ===')

  // 确定平台和架构
  let target: string
  if (PLATFORM === 'darwin') {
    target = ARCH === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  } else if (PLATFORM === 'linux') {
    target = ARCH === 'arm64' ? 'aarch64-unknown-linux-gnu' : 'x86_64-unknown-linux-gnu'
  } else if (PLATFORM === 'win32') {
    target = 'x86_64-pc-windows-msvc'
  } else {
    console.log(`Unsupported platform: ${PLATFORM}`)
    return
  }

  const ext = PLATFORM === 'win32' ? '.exe' : ''
  const fileName = `rust-analyzer-${target}${ext}`

  // 获取最新版本
  const latestUrl = 'https://api.github.com/repos/rust-lang/rust-analyzer/releases/latest'

  try {
    const response = await new Promise<string>((resolve, reject) => {
      https.get(latestUrl, {
        headers: { 'User-Agent': 'logos-ide' }
      }, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve(data))
        res.on('error', reject)
      }).on('error', reject)
    })

    const release = JSON.parse(response)
    const asset = release.assets.find((a: { name: string }) =>
      a.name === fileName || a.name === `${fileName}.gz`
    )

    if (!asset) {
      console.log(`rust-analyzer asset not found for ${target}`)
      console.log('Available assets:', release.assets.map((a: { name: string }) => a.name).join(', '))
      return
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rust-analyzer-'))

    try {
      const downloadPath = path.join(tempDir, asset.name)
      await downloadFile(asset.browser_download_url, downloadPath)

      const destPath = path.join(BIN_DIR, PLATFORM === 'win32' ? 'rust-analyzer.exe' : 'rust-analyzer')

      // 如果是 .gz 文件，解压
      if (asset.name.endsWith('.gz')) {
        execSync(`gunzip -c "${downloadPath}" > "${destPath}"`, { stdio: 'inherit' })
      } else {
        fs.copyFileSync(downloadPath, destPath)
      }

      if (PLATFORM !== 'win32') {
        fs.chmodSync(destPath, '755')
      }

      console.log('rust-analyzer installed successfully')
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  } catch (error) {
    console.error('Failed to download rust-analyzer:', error)
  }
}

// ============ jdtls ============

async function downloadJdtls(): Promise<void> {
  console.log('\n=== Downloading Eclipse JDT Language Server ===')

  // jdtls 版本 (2024-12)
  const version = '1.43.0'
  const timestamp = '202412191447'

  // jdtls 是 Java 应用，跨平台通用
  const fileName = `jdt-language-server-${version}-${timestamp}.tar.gz`
  const downloadUrl = `https://download.eclipse.org/jdtls/milestones/${version}/${fileName}`

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jdtls-'))

  try {
    const downloadPath = path.join(tempDir, fileName)
    await downloadFile(downloadUrl, downloadPath)

    // 解压到目标目录
    const jdtlsDir = path.join(BIN_DIR, 'jdtls')
    ensureDir(jdtlsDir)
    await extractTarGz(downloadPath, jdtlsDir)

    // 设置可执行权限
    if (PLATFORM !== 'win32') {
      const binDir = path.join(jdtlsDir, 'bin')
      if (fs.existsSync(binDir)) {
        const files = fs.readdirSync(binDir)
        for (const file of files) {
          const filePath = path.join(binDir, file)
          fs.chmodSync(filePath, '755')
        }
      }
    }

    console.log('jdtls installed successfully')
  } catch (error) {
    console.error('Failed to download jdtls:', error)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

// ============ 主函数 ============

async function main(): Promise<void> {
  console.log(`\nDownloading LSP servers for ${PLATFORM}-${ARCH}`)
  console.log(`Target directory: ${BIN_DIR}\n`)

  ensureDir(BIN_DIR)

  // 解析命令行参数
  const args = process.argv.slice(2)
  const downloadAll = args.length === 0 || args.includes('--all')
  const servers = {
    pyright: downloadAll || args.includes('--pyright'),
    gopls: downloadAll || args.includes('--gopls'),
    'rust-analyzer': downloadAll || args.includes('--rust-analyzer'),
    jdtls: downloadAll || args.includes('--jdtls'),
  }

  if (servers.pyright) await downloadPyright()
  if (servers.gopls) await downloadGopls()
  if (servers['rust-analyzer']) await downloadRustAnalyzer()
  if (servers.jdtls) await downloadJdtls()

  console.log('\n=== Done ===')
  console.log(`LSP servers installed to: ${BIN_DIR}`)
}

main().catch(console.error)
