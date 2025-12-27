/**
 * LSP 服务器配置
 */

import { app } from 'electron'
import * as path from 'path'
import * as os from 'os'
import type { LSPServerConfig } from '../types'

// ============ 二进制文件路径获取 ============

function getBinaryPath(binaryName: string): string {
  const platform = process.platform
  const arch = process.arch

  // Windows 需要 .exe 后缀
  const executableName = platform === 'win32' ? `${binaryName}.exe` : binaryName

  if (app.isPackaged) {
    // 打包后：resources/bin/{binary}
    return path.join(process.resourcesPath, 'bin', executableName)
  } else {
    // 开发环境：resources/bin/{platform}-{arch}/{binary}
    return path.join(
      __dirname,
      '../../../../resources/bin',
      `${platform}-${arch}`,
      executableName
    )
  }
}

// ============ Pyright 配置 ============

export const pyrightConfig: LSPServerConfig = {
  languageId: 'python',
  command: getBinaryPath('pyright-langserver'),
  args: ['--stdio'],
  extensions: ['.py', '.pyi', '.pyw'],
  initializationOptions: {
    python: {
      analysis: {
        autoSearchPaths: true,
        useLibraryCodeForTypes: true,
        diagnosticMode: 'openFilesOnly',
        typeCheckingMode: 'basic'
      }
    }
  }
}

// ============ gopls 配置 ============

export const goplsConfig: LSPServerConfig = {
  languageId: 'go',
  command: getBinaryPath('gopls'),
  args: ['serve'],
  extensions: ['.go'],
  initializationOptions: {
    'gofumpt': true,
    'staticcheck': true,
    'usePlaceholders': true,
    'completeUnimported': true,
    'deepCompletion': true
  },
  env: {
    GOPATH: process.env.GOPATH || path.join(os.homedir(), 'go'),
    GOROOT: process.env.GOROOT || ''
  }
}

// ============ rust-analyzer 配置 ============

export const rustAnalyzerConfig: LSPServerConfig = {
  languageId: 'rust',
  command: getBinaryPath('rust-analyzer'),
  args: [],
  extensions: ['.rs'],
  initializationOptions: {
    checkOnSave: {
      command: 'clippy'
    },
    cargo: {
      allFeatures: true,
      loadOutDirsFromCheck: true
    },
    procMacro: {
      enable: true
    },
    hover: {
      documentation: true
    }
  }
}

// ============ jdtls 配置 ============

function getJdtlsConfig(workspacePath: string): LSPServerConfig {
  const jdtlsPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'jdtls')
    : path.join(__dirname, '../../../../resources/bin', `${process.platform}-${process.arch}`, 'jdtls')

  const configPath = path.join(jdtlsPath, `config_${process.platform}`)
  const dataPath = path.join(os.tmpdir(), 'logos-jdtls-data', path.basename(workspacePath))

  return {
    languageId: 'java',
    command: path.join(jdtlsPath, 'bin', process.platform === 'win32' ? 'jdtls.bat' : 'jdtls'),
    args: [
      '-configuration', configPath,
      '-data', dataPath
    ],
    extensions: ['.java'],
    initializationOptions: {
      bundles: [],
      workspaceFolders: []
    },
    env: {
      JAVA_HOME: process.env.JAVA_HOME || ''
    }
  }
}

// ============ 配置映射 ============

export const LSP_CONFIGS: Record<string, LSPServerConfig | ((workspacePath: string) => LSPServerConfig)> = {
  'pyright': pyrightConfig,
  'gopls': goplsConfig,
  'rust-analyzer': rustAnalyzerConfig,
  'jdtls': getJdtlsConfig
}

/**
 * 获取 LSP 服务器配置
 */
export function getLSPServerConfig(serverId: string, workspacePath: string): LSPServerConfig | null {
  const config = LSP_CONFIGS[serverId]
  if (!config) return null

  if (typeof config === 'function') {
    return config(workspacePath)
  }
  return config
}

/**
 * 获取所有支持的 LSP 服务器 ID
 */
export function getSupportedLSPServers(): string[] {
  return Object.keys(LSP_CONFIGS)
}
