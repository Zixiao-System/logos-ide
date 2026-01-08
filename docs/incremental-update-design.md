# Logos IDE 增量更新系统设计文档

## 1. 概述

本文档描述 Logos IDE 的增量更新 (Delta Update) 系统设计方案，旨在实现快速、可靠、低带宽的应用更新机制。

## 2. 设计目标

- **快速更新**: 只下载变更的部分，减少下载时间
- **低带宽**: 使用差异算法最小化更新包大小
- **可靠性**: 支持断点续传、校验和验证、回滚机制
- **无感更新**: 后台下载，用户选择重启时机
- **跨平台**: 支持 macOS、Windows、Linux

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                         Update Server                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Release     │  │ Delta       │  │ Manifest            │  │
│  │ Storage     │  │ Generator   │  │ Service             │  │
│  │ (S3/CDN)    │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTPS
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                         Logos IDE                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Update      │  │ Delta       │  │ Version             │  │
│  │ Manager     │  │ Patcher     │  │ Manager             │  │
│  │             │  │             │  │                     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 核心组件

#### 3.2.1 Update Server (更新服务器)

**Release Storage**
- 存储所有版本的完整安装包
- 使用 CDN 分发加速下载
- 支持 S3、Azure Blob、阿里云 OSS 等

**Delta Generator**
- 自动生成版本间的差异包
- 使用 bsdiff/bspatch 算法
- 支持多版本跳跃更新路径计算

**Manifest Service**
- 提供版本清单 API
- 返回更新路径和下载链接
- 支持灰度发布和强制更新

#### 3.2.2 Client Components (客户端组件)

**Update Manager**
- 定期检查更新
- 管理下载队列
- 协调更新流程

**Delta Patcher**
- 应用差异补丁
- 验证文件完整性
- 处理文件冲突

**Version Manager**
- 管理本地版本信息
- 支持版本回滚
- 维护更新历史

### 3.3 更新文件格式

#### 3.3.1 版本清单 (manifest.json)

```json
{
  "version": "2026.1.4",
  "releaseDate": "2026-01-15T00:00:00Z",
  "releaseNotes": "https://logos.app/releases/2026.1.4",
  "platforms": {
    "darwin-x64": {
      "url": "https://cdn.logos.app/releases/logos-2026.1.4-darwin-x64.zip",
      "size": 125829120,
      "sha256": "abc123...",
      "delta": {
        "from": {
          "2026.1.3": {
            "url": "https://cdn.logos.app/deltas/logos-2026.1.3-to-2026.1.4-darwin-x64.delta",
            "size": 5242880,
            "sha256": "def456..."
          },
          "2026.1.2": {
            "url": "https://cdn.logos.app/deltas/logos-2026.1.2-to-2026.1.4-darwin-x64.delta",
            "size": 8388608,
            "sha256": "ghi789..."
          }
        }
      }
    },
    "darwin-arm64": { ... },
    "win32-x64": { ... },
    "linux-x64": { ... }
  },
  "minimumVersion": "2025.1.0",
  "flags": {
    "mandatory": false,
    "rollout": 100
  }
}
```

#### 3.3.2 差异包格式

```
┌─────────────────────────────────────┐
│          Delta File Header          │
├─────────────────────────────────────┤
│ Magic Number (4 bytes): "LDLT"      │
│ Version (2 bytes)                   │
│ From Version (32 bytes)             │
│ To Version (32 bytes)               │
│ Platform (16 bytes)                 │
│ Checksum Algorithm (1 byte)         │
│ Compression Algorithm (1 byte)      │
├─────────────────────────────────────┤
│         File Operations             │
├─────────────────────────────────────┤
│ Operation Count (4 bytes)           │
│ ┌─────────────────────────────────┐ │
│ │ Op Type (1 byte):               │ │
│ │   0x01 = ADD                    │ │
│ │   0x02 = MODIFY (bsdiff)        │ │
│ │   0x03 = DELETE                 │ │
│ │   0x04 = RENAME                 │ │
│ │ Path Length (2 bytes)           │ │
│ │ Path (variable)                 │ │
│ │ Data Length (4 bytes)           │ │
│ │ Data (variable, compressed)     │ │
│ │ Target Checksum (32 bytes)      │ │
│ └─────────────────────────────────┘ │
│ ... (repeat for each operation)     │
├─────────────────────────────────────┤
│         Footer                      │
├─────────────────────────────────────┤
│ Total Checksum (32 bytes)           │
└─────────────────────────────────────┘
```

## 4. 更新流程

### 4.1 检查更新流程

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐
│ Client  │     │ Update      │     │ Manifest    │
│         │     │ Manager     │     │ Server      │
└────┬────┘     └──────┬──────┘     └──────┬──────┘
     │                 │                   │
     │ App Start       │                   │
     ├────────────────►│                   │
     │                 │  GET /manifest    │
     │                 ├──────────────────►│
     │                 │                   │
     │                 │  manifest.json    │
     │                 │◄──────────────────┤
     │                 │                   │
     │                 │ Compare Versions  │
     │                 │                   │
     │ Update Available│                   │
     │◄────────────────┤                   │
     │                 │                   │
```

### 4.2 下载更新流程

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐
│ Client  │     │ Update      │     │ CDN         │
│         │     │ Manager     │     │             │
└────┬────┘     └──────┬──────┘     └──────┬──────┘
     │                 │                   │
     │ Download Update │                   │
     ├────────────────►│                   │
     │                 │                   │
     │                 │ Check local ver   │
     │                 │ Calculate delta   │
     │                 │                   │
     │                 │ GET delta file    │
     │                 ├──────────────────►│
     │                 │                   │
     │                 │ Delta data chunks │
     │                 │◄──────────────────┤
     │ Progress: 50%   │                   │
     │◄────────────────┤                   │
     │                 │                   │
     │                 │ Verify checksum   │
     │                 │                   │
     │ Download Complete│                  │
     │◄────────────────┤                   │
```

### 4.3 应用更新流程

```
┌─────────┐     ┌─────────────┐     ┌─────────────┐
│ User    │     │ Update      │     │ Delta       │
│         │     │ Manager     │     │ Patcher     │
└────┬────┘     └──────┬──────┘     └──────┬──────┘
     │                 │                   │
     │ Restart to Update│                  │
     ├────────────────►│                   │
     │                 │                   │
     │                 │ Backup current    │
     │                 ├──────────────────►│
     │                 │                   │
     │                 │ Apply patches     │
     │                 ├──────────────────►│
     │                 │                   │
     │                 │ Verify files      │
     │                 ├──────────────────►│
     │                 │                   │
     │                 │ Success / Fail    │
     │                 │◄──────────────────┤
     │                 │                   │
     │                 │ [If Fail] Rollback│
     │                 ├──────────────────►│
     │                 │                   │
     │ Restart App     │                   │
     │◄────────────────┤                   │
```

## 5. 实现细节

### 5.1 差异算法选择

| 算法 | 优点 | 缺点 | 适用场景 |
|------|------|------|----------|
| bsdiff | 高压缩率、成熟稳定 | 内存占用高 | 二进制文件 |
| xdelta3 | 内存占用低、速度快 | 压缩率略低 | 大文件 |
| rsync | 增量同步 | 需要服务器支持 | 实时同步 |

推荐方案：使用 **bsdiff** 作为主要差异算法，针对大文件（>100MB）使用 **xdelta3**。

### 5.2 断点续传实现

```typescript
interface DownloadState {
  url: string
  totalSize: number
  downloadedSize: number
  chunks: ChunkInfo[]
  tempFilePath: string
  checksum: string
}

interface ChunkInfo {
  start: number
  end: number
  downloaded: boolean
}

class ResumeableDownloader {
  async download(url: string, destPath: string): Promise<void> {
    const state = await this.loadState(url) || await this.initState(url)

    for (const chunk of state.chunks) {
      if (chunk.downloaded) continue

      await this.downloadChunk(url, chunk, state.tempFilePath)
      chunk.downloaded = true
      await this.saveState(state)
    }

    await this.finalize(state, destPath)
  }

  private async downloadChunk(url: string, chunk: ChunkInfo, tempPath: string) {
    const response = await fetch(url, {
      headers: {
        'Range': `bytes=${chunk.start}-${chunk.end}`
      }
    })

    // Write to temp file at correct offset
    // ...
  }
}
```

### 5.3 版本回滚机制

```
app/
├── current/          # 当前版本 (symlink)
├── versions/
│   ├── 2026.1.4/     # 最新版本
│   ├── 2026.1.3/     # 上一版本 (保留用于回滚)
│   └── .../
├── pending/          # 待应用的更新
└── backup/           # 更新前的备份
```

回滚流程：
1. 保留最近 2 个版本
2. 更新失败时自动切换回上一版本
3. 用户可手动选择回滚到指定版本

### 5.4 灰度发布

```typescript
interface RolloutConfig {
  percentage: number      // 灰度比例 (0-100)
  filters: {
    region?: string[]     // 地区限制
    version?: string[]    // 版本限制
    userGroup?: string[]  // 用户组
  }
}

function shouldUpdate(config: RolloutConfig, userId: string): boolean {
  // 使用用户 ID 哈希确定是否在灰度范围内
  const hash = hashUserId(userId)
  return (hash % 100) < config.percentage
}
```

## 6. 服务端实现

### 6.1 CI/CD 集成

```yaml
# .github/workflows/release.yml
name: Release

on:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      matrix:
        os: [macos-latest, windows-latest, ubuntu-latest]
        arch: [x64, arm64]

    runs-on: ${{ matrix.os }}

    steps:
      - uses: actions/checkout@v4

      - name: Build
        run: npm run build:${{ matrix.os }}-${{ matrix.arch }}

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: logos-${{ matrix.os }}-${{ matrix.arch }}
          path: dist/

  generate-deltas:
    needs: build
    runs-on: ubuntu-latest

    steps:
      - name: Download artifacts
        uses: actions/download-artifact@v4

      - name: Generate deltas
        run: |
          for prev_version in $(get-recent-versions 5); do
            ./scripts/generate-delta.sh $prev_version ${{ github.ref_name }}
          done

      - name: Upload to CDN
        run: ./scripts/upload-release.sh

  update-manifest:
    needs: generate-deltas
    runs-on: ubuntu-latest

    steps:
      - name: Update manifest
        run: ./scripts/update-manifest.sh ${{ github.ref_name }}
```

### 6.2 API 设计

```
GET /api/v1/updates/manifest
Response: manifest.json

GET /api/v1/updates/check?version={current}&platform={platform}
Response:
{
  "updateAvailable": true,
  "latestVersion": "2026.1.4",
  "deltaUrl": "https://cdn.logos.app/deltas/...",
  "deltaSize": 5242880,
  "fullUrl": "https://cdn.logos.app/releases/...",
  "fullSize": 125829120,
  "mandatory": false,
  "releaseNotes": "..."
}

POST /api/v1/updates/report
Body:
{
  "event": "download_complete" | "install_success" | "install_failed" | "rollback",
  "fromVersion": "2026.1.3",
  "toVersion": "2026.1.4",
  "platform": "darwin-arm64",
  "error": "optional error message"
}
```

## 7. 实现计划

### 7.1 Phase 1: 基础设施

- [ ] 搭建更新服务器
- [ ] 配置 CDN 分发
- [ ] 实现版本清单 API
- [ ] 集成 CI/CD 自动发布

### 7.2 Phase 2: 客户端基础

- [ ] 实现更新检查逻辑
- [ ] 实现下载管理器
- [ ] 实现断点续传
- [ ] 实现更新通知 UI

### 7.3 Phase 3: 增量更新

- [ ] 集成 bsdiff 库
- [ ] 实现差异包生成
- [ ] 实现差异包应用
- [ ] 实现文件校验

### 7.4 Phase 4: 高级功能

- [ ] 实现版本回滚
- [ ] 实现灰度发布
- [ ] 实现更新统计
- [ ] 实现强制更新

## 8. 安全考虑

### 8.1 代码签名

- 所有发布包必须代码签名
- 客户端验证签名后才应用更新
- 支持 macOS Notarization 和 Windows Code Signing

### 8.2 传输安全

- 所有通信使用 HTTPS
- 使用证书固定 (Certificate Pinning)
- 验证服务器证书

### 8.3 完整性验证

- 使用 SHA-256 校验文件完整性
- 差异包包含目标文件校验和
- 更新后验证所有文件

## 9. 监控和告警

### 9.1 监控指标

- 更新检查成功率
- 下载成功率
- 安装成功率
- 回滚率
- 平均下载时间
- CDN 带宽使用

### 9.2 告警规则

- 安装失败率 > 5%
- 回滚率 > 2%
- 下载超时率 > 10%
- CDN 响应时间 > 3s

## 10. 参考资料

- [electron-updater](https://www.electron.build/auto-update)
- [Sparkle (macOS)](https://sparkle-project.org/)
- [NSIS (Windows)](https://nsis.sourceforge.io/)
- [bsdiff Algorithm](http://www.daemonology.net/bsdiff/)
