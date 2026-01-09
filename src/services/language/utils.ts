/**
 * 语言检测工具
 * 用于判断文件应该使用哪个语言服务 (Daemon vs IPC)
 */

import { DAEMON_EXTENSION_MAP, DAEMON_SUPPORTED_LANGUAGES } from '@/types/daemon'
import type { DaemonSupportedLanguage } from '@/types/daemon'

/**
 * 获取文件扩展名 (不依赖 Node.js path 模块)
 */
function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot === -1 || lastDot === filePath.length - 1) return ''
  return filePath.substring(lastDot).toLowerCase()
}

/**
 * 判断文件是否应使用 Daemon 语言服务
 */
export function isDaemonLanguage(filePath: string): boolean {
  const ext = getExtension(filePath)
  return ext in DAEMON_EXTENSION_MAP
}

/**
 * 判断文件是否应使用原生 TypeScript 语言服务 (IPC)
 */
export function isNativeLanguage(filePath: string): boolean {
  const ext = getExtension(filePath)
  const nativeExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']
  return nativeExtensions.includes(ext)
}

/**
 * 获取文件的语言 ID
 */
export function getLanguageId(filePath: string): string {
  const ext = getExtension(filePath)

  // Daemon 语言
  if (ext in DAEMON_EXTENSION_MAP) {
    return DAEMON_EXTENSION_MAP[ext]
  }

  // 原生 TypeScript/JavaScript 语言
  const nativeMap: Record<string, string> = {
    '.ts': 'typescript',
    '.tsx': 'typescriptreact',
    '.js': 'javascript',
    '.jsx': 'javascriptreact',
    '.mjs': 'javascript',
    '.cjs': 'javascript',
    '.mts': 'typescript',
    '.cts': 'typescript'
  }

  if (ext in nativeMap) {
    return nativeMap[ext]
  }

  // 默认返回纯文本
  return 'plaintext'
}

/**
 * 获取语言服务类型
 */
export function getLanguageServiceType(filePath: string): 'daemon' | 'native' | 'none' {
  if (isDaemonLanguage(filePath)) return 'daemon'
  if (isNativeLanguage(filePath)) return 'native'
  return 'none'
}

/**
 * 获取所有 Daemon 支持的语言列表
 */
export function getDaemonSupportedLanguages(): readonly DaemonSupportedLanguage[] {
  return DAEMON_SUPPORTED_LANGUAGES
}

/**
 * Monaco 语言 ID 到 Daemon 语言 ID 的映射
 */
export function monacoLanguageToDaemon(monacoLanguage: string): string | null {
  const mapping: Record<string, DaemonSupportedLanguage> = {
    'python': 'python',
    'go': 'go',
    'rust': 'rust',
    'c': 'c',
    'cpp': 'cpp',
    'java': 'java'
  }
  return mapping[monacoLanguage] || null
}
