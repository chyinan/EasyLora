/**
 * 图片缓存管理模块
 * 
 * 提供高效的图片缓存策略:
 * - 服务端缩略图 API 缓存
 * - 客户端 Blob URL 生命周期管理
 * - LRU 缓存淘汰策略
 */

// ============== 配置常量 ==============

const THUMBNAIL_BASE_URL = '/api/thumbnail'
const DEFAULT_THUMBNAIL_SIZE = 200
const DEFAULT_QUALITY = 80

// ============== 缓存管理 ==============

class BlobUrlCache {
  private cache = new Map<string, string>()
  private maxSize: number

  constructor(maxSize = 100) {
    this.maxSize = maxSize
  }

  get(key: string): string | undefined {
    return this.cache.get(key)
  }

  set(key: string, url: string): void {
    // LRU: 如果超过最大容量，删除最早的条目
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        const oldUrl = this.cache.get(firstKey)
        if (oldUrl?.startsWith('blob:')) {
          URL.revokeObjectURL(oldUrl)
        }
        this.cache.delete(firstKey)
      }
    }
    this.cache.set(key, url)
  }

  revoke(key: string): void {
    const url = this.cache.get(key)
    if (url?.startsWith('blob:')) {
      URL.revokeObjectURL(url)
    }
    this.cache.delete(key)
  }

  clear(): void {
    for (const url of this.cache.values()) {
      if (url.startsWith('blob:')) {
        URL.revokeObjectURL(url)
      }
    }
    this.cache.clear()
  }
}

// 全局缓存实例
const blobCache = new BlobUrlCache(100)

// ============== 缩略图 URL 生成 ==============

interface ThumbnailOptions {
  width?: number
  height?: number
  quality?: number
}

/**
 * 获取服务端缩略图 URL
 */
export function getThumbnailUrl(
  pathOrUrl: string,
  options: ThumbnailOptions = {}
): string {
  if (!pathOrUrl) return ''
  
  // Blob URL 直接返回（客户端预览）
  if (pathOrUrl.startsWith('blob:')) {
    return pathOrUrl
  }

  const { 
    width = DEFAULT_THUMBNAIL_SIZE, 
    height = DEFAULT_THUMBNAIL_SIZE,
    quality = DEFAULT_QUALITY
  } = options

  // 提取路径
  let path = pathOrUrl
  if (path.startsWith('http')) {
    try {
      const url = new URL(path)
      path = url.pathname
    } catch {
      // 解析失败，使用原始路径
    }
  }

  // 验证是否为 workspace 路径
  if (path.startsWith('/workspace/') || path.startsWith('workspace/')) {
    const cleanPath = path.startsWith('/') ? path : '/' + path
    return `${THUMBNAIL_BASE_URL}?path=${encodeURIComponent(cleanPath)}&width=${width}&height=${height}&quality=${quality}`
  }

  // 其他路径直接返回
  return pathOrUrl
}

// ============== 图片尺寸检测 ==============

export interface ImageDimensions {
  width: number
  height: number
}

/**
 * 获取图片尺寸
 */
export function getImageDimensions(file: File): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: img.width, height: img.height })
    }
    
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法读取图片信息'))
    }
    
    img.src = url
  })
}

// ============== 图片验证 ==============

export interface ValidationResult {
  valid: boolean
  warning?: string
}

const MAX_FILE_SIZE = 50 * 1024 * 1024 // 50MB
const MIN_DIMENSION = 256

/**
 * 验证图片是否适合训练
 */
export async function validateImageForTraining(file: File): Promise<ValidationResult> {
  // 检查文件大小
  if (file.size > MAX_FILE_SIZE) {
    return {
      valid: false,
      warning: `文件过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，建议压缩后使用`
    }
  }

  // 检查尺寸
  try {
    const dimensions = await getImageDimensions(file)
    
    if (dimensions.width < MIN_DIMENSION || dimensions.height < MIN_DIMENSION) {
      return {
        valid: true,
        warning: `图片分辨率较低 (${dimensions.width}x${dimensions.height})，可能影响训练效果`
      }
    }
    
    return { valid: true }
  } catch {
    return { valid: false, warning: '无法读取图片信息' }
  }
}

// ============== 预览 URL 管理 ==============

/**
 * 创建预览 URL（带缓存）
 */
export function createPreviewUrl(file: File): string {
  const key = `${file.name}-${file.size}-${file.lastModified}`
  
  let url = blobCache.get(key)
  if (!url) {
    url = URL.createObjectURL(file)
    blobCache.set(key, url)
  }
  
  return url
}

/**
 * 清理预览 URL
 */
export function cleanupPreviewUrl(url: string): void {
  if (url.startsWith('blob:')) {
    // 尝试从缓存中移除
    URL.revokeObjectURL(url)
  }
}

/**
 * 批量清理预览 URL
 */
export function cleanupPreviewUrls(urls: string[]): void {
  urls.forEach(cleanupPreviewUrl)
}

/**
 * 清理所有缓存
 */
export function clearAllCaches(): void {
  blobCache.clear()
}

// ============== 图片预加载 ==============

/**
 * 预加载图片
 */
export function preloadImage(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`Failed to load: ${src}`))
    img.src = src
  })
}

/**
 * 批量预加载图片（带并发控制）
 */
export async function preloadImages(
  sources: string[],
  concurrency = 4
): Promise<void> {
  const queue = [...sources]
  const workers: Promise<void>[] = []

  async function worker() {
    while (queue.length > 0) {
      const src = queue.shift()
      if (src) {
        try {
          await preloadImage(src)
        } catch {
          // 忽略单个加载失败
        }
      }
    }
  }

  for (let i = 0; i < Math.min(concurrency, sources.length); i++) {
    workers.push(worker())
  }

  await Promise.all(workers)
}
