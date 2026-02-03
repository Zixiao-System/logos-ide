/**
 * Debug Adapter Registry - Defines built-in debug adapters
 */
import * as path from 'path'
import * as os from 'os'

/**
 * Supported debug adapter types
 */
export type AdapterType = 'node' | 'python' | 'cppdbg' | 'lldb' | 'go'

/**
 * Information about a debug adapter
 */
export interface AdapterInfo {
  /** Adapter type identifier */
  type: AdapterType
  /** Display name */
  displayName: string
  /** File extensions this adapter handles */
  languages: string[]
  /** Whether the adapter is installed/available */
  installed: boolean
  /** Adapter version if available */
  version?: string
  /** Path to the adapter binary */
  binaryPath?: string
  /** Description */
  description?: string
}

/**
 * Definition of a debug adapter
 */
export interface AdapterDefinition {
  /** Adapter type identifier */
  type: AdapterType
  /** Display name */
  displayName: string
  /** File extensions this adapter handles */
  languages: string[]
  /** Description */
  description: string
  /** How to resolve the adapter binary */
  resolvePaths: AdapterResolvePath[]
  /** Default launch configuration template */
  defaultLaunchConfig: Record<string, unknown>
  /** Environment variables required */
  requiredEnv?: string[]
}

/**
 * Ways to find an adapter binary
 */
export interface AdapterResolvePath {
  /** Type of resolution */
  type: 'vscode-extension' | 'system-path' | 'npm-global' | 'pip-module' | 'custom'
  /** For vscode-extension: the extension ID */
  extensionId?: string
  /** For vscode-extension: relative path to binary within extension */
  relativePath?: string
  /** For system-path: the command name */
  command?: string
  /** For pip-module: the module name */
  moduleName?: string
  /** For npm-global: the package name */
  packageName?: string
  /** Platform-specific overrides */
  platform?: {
    darwin?: Partial<AdapterResolvePath>
    linux?: Partial<AdapterResolvePath>
    win32?: Partial<AdapterResolvePath>
  }
}

/**
 * Built-in adapter definitions
 */
export const BUILTIN_ADAPTERS: AdapterDefinition[] = [
  // Node.js / JavaScript / TypeScript
  {
    type: 'node',
    displayName: 'Node.js',
    languages: ['javascript', 'typescript', 'js', 'ts', 'mjs', 'cjs'],
    description: 'Debug Node.js applications using js-debug',
    resolvePaths: [
      {
        type: 'vscode-extension',
        extensionId: 'ms-vscode.js-debug',
        relativePath: 'src/dapDebugServer.js'
      },
      {
        type: 'vscode-extension',
        extensionId: 'ms-vscode.js-debug-nightly',
        relativePath: 'src/dapDebugServer.js'
      },
      {
        type: 'system-path',
        command: 'node',
        platform: {
          win32: { command: 'node.exe' }
        }
      }
    ],
    defaultLaunchConfig: {
      type: 'node',
      request: 'launch',
      name: 'Launch Node.js',
      program: '${workspaceFolder}/index.js',
      cwd: '${workspaceFolder}',
      console: 'integratedTerminal',
      skipFiles: ['<node_internals>/**']
    }
  },

  // Python
  {
    type: 'python',
    displayName: 'Python',
    languages: ['python', 'py'],
    description: 'Debug Python applications using debugpy',
    resolvePaths: [
      {
        type: 'vscode-extension',
        extensionId: 'ms-python.python',
        relativePath: 'bundled/debugpy/adapter'
      },
      {
        type: 'pip-module',
        moduleName: 'debugpy'
      },
      {
        type: 'system-path',
        command: 'python',
        platform: {
          win32: { command: 'python.exe' }
        }
      }
    ],
    defaultLaunchConfig: {
      type: 'python',
      request: 'launch',
      name: 'Launch Python',
      program: '${file}',
      cwd: '${workspaceFolder}',
      console: 'integratedTerminal',
      justMyCode: true
    },
    requiredEnv: ['PYTHONPATH']
  },

  // C/C++ with GDB (Linux/Windows)
  {
    type: 'cppdbg',
    displayName: 'C/C++ (GDB)',
    languages: ['c', 'cpp', 'c++', 'h', 'hpp'],
    description: 'Debug C/C++ applications using GDB',
    resolvePaths: [
      {
        type: 'vscode-extension',
        extensionId: 'ms-vscode.cpptools',
        relativePath: 'debugAdapters/bin/OpenDebugAD7',
        platform: {
          win32: { relativePath: 'debugAdapters/bin/OpenDebugAD7.exe' },
          darwin: { relativePath: 'debugAdapters/bin/OpenDebugAD7' }
        }
      },
      {
        type: 'system-path',
        command: 'gdb',
        platform: {
          win32: { command: 'gdb.exe' }
        }
      }
    ],
    defaultLaunchConfig: {
      type: 'cppdbg',
      request: 'launch',
      name: 'Launch C/C++',
      program: '${workspaceFolder}/a.out',
      cwd: '${workspaceFolder}',
      MIMode: 'gdb',
      setupCommands: [
        {
          description: 'Enable pretty-printing for gdb',
          text: '-enable-pretty-printing',
          ignoreFailures: true
        }
      ]
    }
  },

  // C/C++ with LLDB (macOS)
  {
    type: 'lldb',
    displayName: 'C/C++ (LLDB)',
    languages: ['c', 'cpp', 'c++', 'h', 'hpp', 'swift'],
    description: 'Debug C/C++ applications using LLDB (preferred on macOS)',
    resolvePaths: [
      {
        type: 'vscode-extension',
        extensionId: 'vadimcn.vscode-lldb',
        relativePath: 'adapter/codelldb',
        platform: {
          darwin: { relativePath: 'adapter/codelldb' },
          linux: { relativePath: 'adapter/codelldb' }
        }
      },
      {
        type: 'system-path',
        command: 'lldb-vscode',
        platform: {
          darwin: { command: 'lldb-vscode' },
          linux: { command: 'lldb-vscode' }
        }
      }
    ],
    defaultLaunchConfig: {
      type: 'lldb',
      request: 'launch',
      name: 'Launch with LLDB',
      program: '${workspaceFolder}/a.out',
      cwd: '${workspaceFolder}',
      args: []
    }
  },

  // Go with Delve
  {
    type: 'go',
    displayName: 'Go',
    languages: ['go'],
    description: 'Debug Go applications using Delve',
    resolvePaths: [
      {
        type: 'vscode-extension',
        extensionId: 'golang.go',
        relativePath: 'dist/debugAdapter.js'
      },
      {
        type: 'system-path',
        command: 'dlv',
        platform: {
          win32: { command: 'dlv.exe' }
        }
      }
    ],
    defaultLaunchConfig: {
      type: 'go',
      request: 'launch',
      name: 'Launch Go',
      mode: 'auto',
      program: '${workspaceFolder}',
      cwd: '${workspaceFolder}'
    }
  }
]

/**
 * Get common VS Code extension directories
 */
export function getVSCodeExtensionPaths(): string[] {
  const home = os.homedir()
  const platform = process.platform

  const paths: string[] = []

  // VS Code extensions
  if (platform === 'darwin') {
    paths.push(path.join(home, '.vscode', 'extensions'))
    paths.push(path.join(home, '.vscode-insiders', 'extensions'))
  } else if (platform === 'win32') {
    paths.push(path.join(home, '.vscode', 'extensions'))
    paths.push(path.join(home, '.vscode-insiders', 'extensions'))
  } else {
    // Linux
    paths.push(path.join(home, '.vscode', 'extensions'))
    paths.push(path.join(home, '.vscode-server', 'extensions'))
    paths.push(path.join(home, '.vscode-insiders', 'extensions'))
  }

  // Cursor extensions (if using Cursor editor)
  paths.push(path.join(home, '.cursor', 'extensions'))

  return paths
}

/**
 * Get the adapter definition by type
 */
export function getAdapterDefinition(type: AdapterType): AdapterDefinition | undefined {
  return BUILTIN_ADAPTERS.find(a => a.type === type)
}

/**
 * Get adapter types that support a given language
 */
export function getAdaptersForLanguage(language: string): AdapterDefinition[] {
  const lang = language.toLowerCase()
  return BUILTIN_ADAPTERS.filter(a =>
    a.languages.some(l => l.toLowerCase() === lang)
  )
}
