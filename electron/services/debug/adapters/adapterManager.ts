/**
 * Debug Adapter Manager - Discovers, resolves, and manages debug adapter lifecycle
 */
import * as path from 'path'
import * as fs from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { StdioTransport } from '../transports/stdioTransport'
import { SocketTransport } from '../transports/socketTransport'
import { SSHTransport } from '../transports/sshTransport'
import type { ITransport, StdioTransportOptions, SocketTransportOptions, SSHTransportOptions } from '../transports/types'
import {
  BUILTIN_ADAPTERS,
  getVSCodeExtensionPaths,
  getAdapterDefinition,
  getAdaptersForLanguage
} from './adapterRegistry'
import type { AdapterType, AdapterInfo, AdapterResolvePath } from './adapterRegistry'

const execFileAsync = promisify(execFile)

/**
 * Result of resolving an adapter
 */
interface ResolvedAdapter {
  type: AdapterType
  transport: 'stdio' | 'socket'
  /** Path to the adapter binary (for stdio) */
  binaryPath?: string
  /** Arguments to pass to the adapter binary (for stdio) */
  binaryArgs?: string[]
  /** Host for socket transport */
  host?: string
  /** Port for socket transport */
  port?: number
  /** How the adapter was resolved */
  resolvedVia: string
}

/**
 * Detected debugger in a workspace
 */
export interface DetectedDebugger {
  type: AdapterType
  displayName: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export class AdapterManager {
  private resolvedAdapters: Map<AdapterType, ResolvedAdapter> = new Map()
  private cachedAvailability: Map<AdapterType, boolean> = new Map()

  /**
   * Resolve the path to a debug adapter binary
   */
  async resolveAdapter(type: AdapterType): Promise<ResolvedAdapter | null> {
    // Check cache
    const cached = this.resolvedAdapters.get(type)
    if (cached) return cached

    const definition = getAdapterDefinition(type)
    if (!definition) return null

    for (const resolvePath of definition.resolvePaths) {
      const resolved = await this.tryResolvePath(type, resolvePath)
      if (resolved) {
        this.resolvedAdapters.set(type, resolved)
        return resolved
      }
    }

    return null
  }

  /**
   * Create a transport for the given adapter type
   */
  async createTransport(type: AdapterType, workspaceFolder?: string): Promise<ITransport> {
    const resolved = await this.resolveAdapter(type)
    if (!resolved) {
      throw new Error(`Debug adapter '${type}' not found. Please install the required debugger.`)
    }

    if (resolved.transport === 'socket' && resolved.host && resolved.port) {
      const options: SocketTransportOptions = {
        host: resolved.host,
        port: resolved.port
      }
      return new SocketTransport(options)
    }

    // Default: stdio transport
    if (!resolved.binaryPath) {
      throw new Error(`No binary path found for adapter '${type}'`)
    }

    const options: StdioTransportOptions = {
      adapterPath: resolved.binaryPath,
      adapterArgs: resolved.binaryArgs,
      cwd: workspaceFolder
    }
    return new StdioTransport(options)
  }

  /**
   * Create an SSH transport for remote debugging
   */
  createSSHTransport(options: SSHTransportOptions): ITransport {
    return new SSHTransport(options)
  }

  /**
   * Get all available (installed) adapters
   */
  async getAvailableAdapters(): Promise<AdapterInfo[]> {
    const results: AdapterInfo[] = []

    for (const definition of BUILTIN_ADAPTERS) {
      const resolved = await this.resolveAdapter(definition.type)
      const installed = resolved !== null
      this.cachedAvailability.set(definition.type, installed)

      results.push({
        type: definition.type,
        displayName: definition.displayName,
        languages: definition.languages,
        installed,
        binaryPath: resolved?.binaryPath,
        description: definition.description
      })
    }

    return results
  }

  /**
   * Get only installed adapters
   */
  async getInstalledAdapters(): Promise<AdapterInfo[]> {
    const all = await this.getAvailableAdapters()
    return all.filter(a => a.installed)
  }

  /**
   * Detect which debuggers are relevant for a workspace
   */
  async detectDebuggers(workspaceFolder: string): Promise<DetectedDebugger[]> {
    const detected: DetectedDebugger[] = []

    try {
      const files = await fs.promises.readdir(workspaceFolder)
      const fileNames = files.map(f => f.toLowerCase())

      // Node.js detection
      if (fileNames.includes('package.json') || fileNames.includes('tsconfig.json')) {
        detected.push({
          type: 'node',
          displayName: 'Node.js',
          confidence: 'high',
          reason: 'Found package.json or tsconfig.json'
        })
      }

      // Python detection
      if (fileNames.some(f => f.endsWith('.py')) ||
          fileNames.includes('requirements.txt') ||
          fileNames.includes('setup.py') ||
          fileNames.includes('pyproject.toml')) {
        detected.push({
          type: 'python',
          displayName: 'Python',
          confidence: 'high',
          reason: 'Found Python files or configuration'
        })
      }

      // Go detection
      if (fileNames.includes('go.mod') || fileNames.includes('go.sum')) {
        detected.push({
          type: 'go',
          displayName: 'Go',
          confidence: 'high',
          reason: 'Found go.mod'
        })
      }

      // C/C++ detection
      if (fileNames.includes('makefile') ||
          fileNames.includes('cmakeLists.txt') ||
          fileNames.includes('cmakelists.txt') ||
          fileNames.some(f => f.endsWith('.c') || f.endsWith('.cpp') || f.endsWith('.h'))) {
        const adapterType: AdapterType = process.platform === 'darwin' ? 'lldb' : 'cppdbg'
        detected.push({
          type: adapterType,
          displayName: process.platform === 'darwin' ? 'C/C++ (LLDB)' : 'C/C++ (GDB)',
          confidence: 'high',
          reason: 'Found C/C++ files or build system'
        })
      }

      // Check file extensions for medium confidence
      for (const file of files) {
        const ext = path.extname(file).toLowerCase()
        const matchingAdapters = getAdaptersForLanguage(ext.replace('.', ''))
        for (const adapter of matchingAdapters) {
          if (!detected.some(d => d.type === adapter.type)) {
            detected.push({
              type: adapter.type,
              displayName: adapter.displayName,
              confidence: 'medium',
              reason: `Found ${ext} files`
            })
          }
        }
      }
    } catch {
      // If we can't read the directory, return empty
    }

    return detected
  }

  /**
   * Clear resolved adapter cache
   */
  clearCache(): void {
    this.resolvedAdapters.clear()
    this.cachedAvailability.clear()
  }

  // ============ Private Methods ============

  private async tryResolvePath(type: AdapterType, resolvePath: AdapterResolvePath): Promise<ResolvedAdapter | null> {
    // Apply platform-specific overrides
    const platform = process.platform as 'darwin' | 'linux' | 'win32'
    const platformOverride = resolvePath.platform?.[platform]
    const effectivePath = platformOverride ? { ...resolvePath, ...platformOverride } : resolvePath

    switch (effectivePath.type) {
      case 'vscode-extension':
        return this.resolveVSCodeExtension(type, effectivePath)
      case 'system-path':
        return this.resolveSystemPath(type, effectivePath)
      case 'pip-module':
        return this.resolvePipModule(type, effectivePath)
      case 'npm-global':
        return this.resolveNpmGlobal(type, effectivePath)
      default:
        return null
    }
  }

  private async resolveVSCodeExtension(type: AdapterType, resolvePath: AdapterResolvePath): Promise<ResolvedAdapter | null> {
    if (!resolvePath.extensionId || !resolvePath.relativePath) return null

    const extensionDirs = getVSCodeExtensionPaths()

    for (const extensionDir of extensionDirs) {
      try {
        // VS Code extension dirs have names like "publisher.name-version"
        const entries = await fs.promises.readdir(extensionDir)
        const matchingDirs = entries.filter(e =>
          e.toLowerCase().startsWith(resolvePath.extensionId!.toLowerCase())
        )

        // Sort by version (descending) to get latest
        matchingDirs.sort().reverse()

        for (const dir of matchingDirs) {
          const binaryPath = path.join(extensionDir, dir, resolvePath.relativePath!)
          try {
            await fs.promises.access(binaryPath, fs.constants.X_OK)
            return {
              type,
              transport: 'stdio',
              binaryPath,
              resolvedVia: `VS Code extension: ${resolvePath.extensionId}`
            }
          } catch {
            // Not executable, try js files
            if (binaryPath.endsWith('.js')) {
              try {
                await fs.promises.access(binaryPath, fs.constants.R_OK)
                return {
                  type,
                  transport: 'stdio',
                  binaryPath: 'node',
                  binaryArgs: [binaryPath],
                  resolvedVia: `VS Code extension: ${resolvePath.extensionId} (via node)`
                }
              } catch {
                // File not readable
              }
            }
          }
        }
      } catch {
        // Extension directory doesn't exist
      }
    }

    return null
  }

  private async resolveSystemPath(type: AdapterType, resolvePath: AdapterResolvePath): Promise<ResolvedAdapter | null> {
    if (!resolvePath.command) return null

    try {
      const { stdout } = await execFileAsync('which', [resolvePath.command])
      const binaryPath = stdout.trim()
      if (binaryPath) {
        // Special handling for specific adapter types
        const args = this.getSystemPathArgs(type, binaryPath)
        return {
          type,
          transport: 'stdio',
          binaryPath: args.binary,
          binaryArgs: args.args,
          resolvedVia: `System PATH: ${resolvePath.command}`
        }
      }
    } catch {
      // Command not found in PATH
    }

    return null
  }

  private async resolvePipModule(type: AdapterType, resolvePath: AdapterResolvePath): Promise<ResolvedAdapter | null> {
    if (!resolvePath.moduleName) return null

    // Try python -m debugpy.adapter
    const pythonCommands = ['python3', 'python']

    for (const python of pythonCommands) {
      try {
        await execFileAsync(python, ['-c', `import ${resolvePath.moduleName}`])
        return {
          type,
          transport: 'stdio',
          binaryPath: python,
          binaryArgs: ['-m', `${resolvePath.moduleName}.adapter`],
          resolvedVia: `pip module: ${resolvePath.moduleName} (via ${python})`
        }
      } catch {
        // Module not installed for this python
      }
    }

    return null
  }

  private async resolveNpmGlobal(type: AdapterType, resolvePath: AdapterResolvePath): Promise<ResolvedAdapter | null> {
    if (!resolvePath.packageName) return null

    try {
      // Get npm global prefix
      const { stdout: prefixStdout } = await execFileAsync('npm', ['config', 'get', 'prefix'])
      const npmPrefix = prefixStdout.trim()

      if (!npmPrefix) return null

      // Determine bin directory and node_modules path based on platform
      const isWindows = process.platform === 'win32'
      const binDir = isWindows ? npmPrefix : path.join(npmPrefix, 'bin')
      const nodeModulesDir = isWindows
        ? path.join(npmPrefix, 'node_modules')
        : path.join(npmPrefix, 'lib', 'node_modules')

      // First, check for executable in bin directory
      const binName = resolvePath.command || resolvePath.packageName
      const binPath = path.join(binDir, isWindows ? `${binName}.cmd` : binName)

      try {
        await fs.promises.access(binPath, fs.constants.X_OK)
        return {
          type,
          transport: 'stdio',
          binaryPath: binPath,
          resolvedVia: `npm global: ${resolvePath.packageName} (bin)`
        }
      } catch {
        // Bin not found or not executable, try package entry point
      }

      // Check node_modules for package.json to find entry point
      const packageDir = path.join(nodeModulesDir, resolvePath.packageName)
      const packageJsonPath = path.join(packageDir, 'package.json')

      try {
        const packageJsonContent = await fs.promises.readFile(packageJsonPath, 'utf-8')
        const packageJson = JSON.parse(packageJsonContent)

        // Try to find the main entry point or bin entry
        let entryPoint: string | null = null

        if (typeof packageJson.bin === 'string') {
          entryPoint = path.join(packageDir, packageJson.bin)
        } else if (typeof packageJson.bin === 'object' && packageJson.bin[binName]) {
          entryPoint = path.join(packageDir, packageJson.bin[binName])
        } else if (packageJson.main) {
          entryPoint = path.join(packageDir, packageJson.main)
        }

        if (entryPoint) {
          try {
            await fs.promises.access(entryPoint, fs.constants.R_OK)
            // Determine if it's a JS file that needs node
            if (entryPoint.endsWith('.js')) {
              return {
                type,
                transport: 'stdio',
                binaryPath: 'node',
                binaryArgs: [entryPoint],
                resolvedVia: `npm global: ${resolvePath.packageName} (via node)`
              }
            } else {
              return {
                type,
                transport: 'stdio',
                binaryPath: entryPoint,
                resolvedVia: `npm global: ${resolvePath.packageName} (entry)`
              }
            }
          } catch {
            // Entry point not accessible
          }
        }
      } catch {
        // package.json not found or not readable
      }
    } catch {
      // npm config failed - npm may not be installed
    }

    return null
  }

  /**
   * Get the correct binary and args for system-path resolved adapters
   */
  private getSystemPathArgs(type: AdapterType, binaryPath: string): { binary: string; args: string[] } {
    switch (type) {
      case 'node':
        // For Node.js, we use node with --inspect flag (actual adapter is js-debug)
        return { binary: binaryPath, args: ['--inspect-brk=0'] }

      case 'python':
        // Use python -m debugpy.adapter
        return { binary: binaryPath, args: ['-m', 'debugpy.adapter'] }

      case 'go':
        // Use dlv dap mode
        return { binary: binaryPath, args: ['dap', '--listen', '127.0.0.1:0'] }

      case 'cppdbg':
        return { binary: binaryPath, args: ['--interpreter=mi'] }

      case 'lldb':
        return { binary: binaryPath, args: [] }

      default:
        return { binary: binaryPath, args: [] }
    }
  }
}

// Singleton instance
let adapterManagerInstance: AdapterManager | null = null

export function getAdapterManager(): AdapterManager {
  if (!adapterManagerInstance) {
    adapterManagerInstance = new AdapterManager()
  }
  return adapterManagerInstance
}
