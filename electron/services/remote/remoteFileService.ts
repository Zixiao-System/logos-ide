/**
 * Remote File Service
 * SFTP-based file operations for remote development
 */
import type { SFTPWrapper, Stats } from 'ssh2'
import type { RemoteFileStat, RemoteFileNode } from './types'
import { SSHConnectionManager } from './sshConnection'

export class RemoteFileService {
  constructor(private connectionManager: SSHConnectionManager) {}

  /**
   * Read directory contents
   */
  async readDirectory(connectionId: string, dirPath: string, recursive = false): Promise<RemoteFileNode[]> {
    const sftp = this.getSFTP(connectionId)

    return new Promise((resolve, reject) => {
      sftp.readdir(dirPath, async (err, list) => {
        if (err) {
          reject(new Error(`Failed to read directory: ${err.message}`))
          return
        }

        const nodes: RemoteFileNode[] = []

        for (const item of list) {
          const itemPath = this.joinPath(dirPath, item.filename)
          const isDirectory = (item.attrs.mode & 0o40000) !== 0

          const node: RemoteFileNode = {
            name: item.filename,
            path: itemPath,
            isDirectory
          }

          if (recursive && isDirectory) {
            try {
              node.children = await this.readDirectory(connectionId, itemPath, true)
            } catch {
              // Skip directories we can't read
              node.children = []
            }
          }

          nodes.push(node)
        }

        // Sort: directories first, then alphabetically
        nodes.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1
          }
          return a.name.localeCompare(b.name)
        })

        resolve(nodes)
      })
    })
  }

  /**
   * Read file contents
   */
  async readFile(connectionId: string, filePath: string): Promise<string> {
    const sftp = this.getSFTP(connectionId)

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const readStream = sftp.createReadStream(filePath, { encoding: undefined })

      readStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      readStream.on('end', () => {
        const buffer = Buffer.concat(chunks)
        resolve(buffer.toString('utf-8'))
      })

      readStream.on('error', (err: Error) => {
        reject(new Error(`Failed to read file: ${err.message}`))
      })
    })
  }

  /**
   * Read file as buffer
   */
  async readFileBuffer(connectionId: string, filePath: string): Promise<Buffer> {
    const sftp = this.getSFTP(connectionId)

    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      const readStream = sftp.createReadStream(filePath, { encoding: undefined })

      readStream.on('data', (chunk: Buffer) => {
        chunks.push(chunk)
      })

      readStream.on('end', () => {
        resolve(Buffer.concat(chunks))
      })

      readStream.on('error', (err: Error) => {
        reject(new Error(`Failed to read file: ${err.message}`))
      })
    })
  }

  /**
   * Write file contents
   */
  async writeFile(connectionId: string, filePath: string, content: string): Promise<void> {
    const sftp = this.getSFTP(connectionId)

    return new Promise((resolve, reject) => {
      const writeStream = sftp.createWriteStream(filePath)

      writeStream.on('close', () => {
        resolve()
      })

      writeStream.on('error', (err: Error) => {
        reject(new Error(`Failed to write file: ${err.message}`))
      })

      writeStream.end(content, 'utf-8')
    })
  }

  /**
   * Create a new file
   */
  async createFile(connectionId: string, filePath: string, content = ''): Promise<void> {
    return this.writeFile(connectionId, filePath, content)
  }

  /**
   * Create a directory
   */
  async createDirectory(connectionId: string, dirPath: string): Promise<void> {
    const sftp = this.getSFTP(connectionId)

    return new Promise((resolve, reject) => {
      sftp.mkdir(dirPath, (err) => {
        if (err) {
          reject(new Error(`Failed to create directory: ${err.message}`))
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Delete a file or directory
   */
  async deleteItem(connectionId: string, itemPath: string): Promise<void> {
    const sftp = this.getSFTP(connectionId)
    const stat = await this.stat(connectionId, itemPath)

    if (stat.isDirectory) {
      await this.deleteDirectoryRecursive(connectionId, itemPath)
    } else {
      return new Promise((resolve, reject) => {
        sftp.unlink(itemPath, (err) => {
          if (err) {
            reject(new Error(`Failed to delete file: ${err.message}`))
          } else {
            resolve()
          }
        })
      })
    }
  }

  /**
   * Rename/move a file or directory
   */
  async renameItem(connectionId: string, oldPath: string, newPath: string): Promise<void> {
    const sftp = this.getSFTP(connectionId)

    return new Promise((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => {
        if (err) {
          reject(new Error(`Failed to rename: ${err.message}`))
        } else {
          resolve()
        }
      })
    })
  }

  /**
   * Check if a file/directory exists
   */
  async exists(connectionId: string, itemPath: string): Promise<boolean> {
    try {
      await this.stat(connectionId, itemPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get file/directory stats
   */
  async stat(connectionId: string, itemPath: string): Promise<RemoteFileStat> {
    const sftp = this.getSFTP(connectionId)

    return new Promise((resolve, reject) => {
      sftp.stat(itemPath, (err, stats: Stats) => {
        if (err) {
          reject(new Error(`Failed to stat: ${err.message}`))
          return
        }

        const mode = stats.mode
        resolve({
          name: this.basename(itemPath),
          path: itemPath,
          isDirectory: (mode & 0o40000) !== 0,
          isFile: (mode & 0o100000) !== 0,
          isSymlink: (mode & 0o120000) === 0o120000,
          size: stats.size,
          mtime: stats.mtime * 1000,
          atime: stats.atime * 1000,
          mode
        })
      })
    })
  }

  /**
   * Copy a file
   */
  async copyFile(connectionId: string, sourcePath: string, targetPath: string): Promise<void> {
    const content = await this.readFileBuffer(connectionId, sourcePath)
    const sftp = this.getSFTP(connectionId)

    return new Promise((resolve, reject) => {
      const writeStream = sftp.createWriteStream(targetPath)

      writeStream.on('close', () => {
        resolve()
      })

      writeStream.on('error', (err: Error) => {
        reject(new Error(`Failed to copy file: ${err.message}`))
      })

      writeStream.end(content)
    })
  }

  // ============ Private Methods ============

  private getSFTP(connectionId: string): SFTPWrapper {
    const sftp = this.connectionManager.getSFTP(connectionId)
    if (!sftp) {
      throw new Error('Connection not available or SFTP not initialized')
    }
    return sftp
  }

  private async deleteDirectoryRecursive(connectionId: string, dirPath: string): Promise<void> {
    const sftp = this.getSFTP(connectionId)

    // Read directory contents
    const items = await this.readDirectory(connectionId, dirPath)

    // Delete all contents first
    for (const item of items) {
      if (item.isDirectory) {
        await this.deleteDirectoryRecursive(connectionId, item.path)
      } else {
        await new Promise<void>((resolve, reject) => {
          sftp.unlink(item.path, (err) => {
            if (err) reject(err)
            else resolve()
          })
        })
      }
    }

    // Delete the directory itself
    return new Promise((resolve, reject) => {
      sftp.rmdir(dirPath, (err) => {
        if (err) {
          reject(new Error(`Failed to delete directory: ${err.message}`))
        } else {
          resolve()
        }
      })
    })
  }

  private joinPath(...parts: string[]): string {
    // Use Unix-style paths for remote
    return parts.join('/').replace(/\/+/g, '/')
  }

  private basename(filePath: string): string {
    const parts = filePath.split('/')
    return parts[parts.length - 1] || filePath
  }
}
