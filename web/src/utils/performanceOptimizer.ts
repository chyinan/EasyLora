/**
 * 前端性能优化工具
 * 专门解决缩略图滚动卡顿问题
 */

interface ThumbnailCache {
  [key: string]: {
    data: string
    timestamp: number
    size: number
  }
}

interface PerformanceMetrics {
  fps: number
  renderTime: number
  memoryUsage?: number
  thumbnailLoadTime: number
  cacheHitRate: number
}

class ThumbnailPerformanceOptimizer {
  private thumbnailCache: ThumbnailCache = {}
  private preloadQueue: Set<string> = new Set()
  private isPreloading = false
  private performanceMetrics: PerformanceMetrics = {
    fps: 0,
    renderTime: 0,
    thumbnailLoadTime: 0,
    cacheHitRate: 0
  }
  private frameCount = 0
  private lastFrameTime = performance.now()
  private cacheHits = 0
  private cacheMisses = 0

  constructor() {
    this.startPerformanceMonitoring()
  }

  /**
   * 开始性能监控
   */
  private startPerformanceMonitoring() {
    let lastTime = performance.now()
    
    const measurePerformance = () => {
      const now = performance.now()
      const deltaTime = now - lastTime
      
      // 计算FPS
      this.frameCount++
      if (now - this.lastFrameTime >= 1000) {
        this.performanceMetrics.fps = Math.round((this.frameCount * 1000) / (now - this.lastFrameTime))
        this.frameCount = 0
        this.lastFrameTime = now
      }
      
      // 计算缓存命中率
      const totalRequests = this.cacheHits + this.cacheMisses
      if (totalRequests > 0) {
        this.performanceMetrics.cacheHitRate = (this.cacheHits / totalRequests) * 100
      }
      
      // 获取内存使用情况
      if ('memory' in performance) {
        const memory = (performance as any).memory
        this.performanceMetrics.memoryUsage = Math.round(memory.usedJSHeapSize / 1024 / 1024)
      }
      
      lastTime = now
      requestAnimationFrame(measurePerformance)
    }
    
    requestAnimationFrame(measurePerformance)
  }

  /**
   * 智能预加载缩略图
   */
  async preloadThumbnails(urls: string[], priority: 'high' | 'medium' | 'low' = 'medium') {
    if (this.isPreloading) return
    
    this.isPreloading = true
    
    try {
      const batchSize = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1
      const batches = this.chunkArray(urls, batchSize)
      
      for (const batch of batches) {
        await Promise.allSettled(
          batch.map(url => this.preloadThumbnail(url))
        )
        
        // 高优先级时立即加载，低优先级时延迟
        if (priority === 'low') {
          await this.delay(100)
        }
      }
    } finally {
      this.isPreloading = false
    }
  }

  /**
   * 预加载单个缩略图
   */
  private async preloadThumbnail(url: string): Promise<void> {
    if (this.thumbnailCache[url]) return
    
    try {
      const startTime = performance.now()
      
      // 创建图片对象预加载
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => {
          const loadTime = performance.now() - startTime
          this.performanceMetrics.thumbnailLoadTime = loadTime
          
          // 缓存缩略图数据
          this.thumbnailCache[url] = {
            data: url,
            timestamp: Date.now(),
            size: 0 // 实际大小需要从响应头获取
          }
          
          this.cacheMisses++
          resolve()
        }
        img.onerror = reject
        img.src = url
      })
    } catch (error) {
      console.warn(`预加载缩略图失败: ${url}`, error)
    }
  }

  /**
   * 获取缩略图（优先从缓存）
   */
  getThumbnail(url: string): string | null {
    const cached = this.thumbnailCache[url]
    if (cached) {
      this.cacheHits++
      return cached.data
    }
    
    this.cacheMisses++
    return null
  }

  /**
   * 清理过期缓存
   */
  cleanupCache(maxAge: number = 5 * 60 * 1000) { // 默认5分钟
    const now = Date.now()
    const keysToDelete: string[] = []
    
    for (const [key, value] of Object.entries(this.thumbnailCache)) {
      if (now - value.timestamp > maxAge) {
        keysToDelete.push(key)
      }
    }
    
    keysToDelete.forEach(key => {
      delete this.thumbnailCache[key]
    })
    
    if (keysToDelete.length > 0) {
      console.log(`清理了 ${keysToDelete.length} 个过期缓存`)
    }
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics }
  }

  /**
   * 优化滚动性能
   */
  optimizeScrollPerformance(container: HTMLElement) {
    // 使用 passive 事件监听器
    let ticking = false
    
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this.handleScrollOptimized(container)
          ticking = false
        })
        ticking = true
      }
    }
    
    container.addEventListener('scroll', handleScroll, { passive: true })
    
    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }

  /**
   * 优化的滚动处理
   */
  private handleScrollOptimized(container: HTMLElement) {
    // 获取可见区域内的图片
    const visibleImages = this.getVisibleImages(container)
    
    // 预加载可见区域附近的图片
    if (visibleImages.length > 0) {
      this.preloadThumbnails(visibleImages, 'high')
    }
    
    // 低优先级预加载即将进入视口的图片
    const upcomingImages = this.getUpcomingImages(container)
    if (upcomingImages.length > 0) {
      this.preloadThumbnails(upcomingImages, 'low')
    }
  }

  /**
   * 获取可见区域内的图片
   */
  private getVisibleImages(container: HTMLElement): string[] {
    const images = container.querySelectorAll('img[data-src]')
    const visible: string[] = []
    
    images.forEach(img => {
      const rect = img.getBoundingClientRect()
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        const src = img.getAttribute('data-src')
        if (src) visible.push(src)
      }
    })
    
    return visible
  }

  /**
   * 获取即将进入视口的图片
   */
  private getUpcomingImages(container: HTMLElement): string[] {
    const images = container.querySelectorAll('img[data-src]')
    const upcoming: string[] = []
    
    images.forEach(img => {
      const rect = img.getBoundingClientRect()
      // 预加载视口下方200px范围内的图片
      if (rect.top < window.innerHeight + 200 && rect.top > window.innerHeight) {
        const src = img.getAttribute('data-src')
        if (src) upcoming.push(src)
      }
    })
    
    return upcoming
  }

  /**
   * 数组分块
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = []
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size))
    }
    return chunks
  }

  /**
   * 延迟函数
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 批量清理内存
   */
  cleanupMemory() {
    // 清理缓存
    this.thumbnailCache = {}
    
    // 清理预加载队列
    this.preloadQueue.clear()
    
    // 强制垃圾回收（如果支持）
    if ('gc' in window) {
      (window as any).gc()
    }
    
    console.log('内存清理完成')
  }
}

// 创建全局实例
export const thumbnailOptimizer = new ThumbnailPerformanceOptimizer()

// 导出工具函数
export function optimizeImageGrid(container: HTMLElement) {
  return thumbnailOptimizer.optimizeScrollPerformance(container)
}

export function preloadThumbnails(urls: string[], priority?: 'high' | 'medium' | 'low') {
  return thumbnailOptimizer.preloadThumbnails(urls, priority)
}

export function getPerformanceMetrics() {
  return thumbnailOptimizer.getPerformanceMetrics()
}

export function cleanupThumbnailCache() {
  thumbnailOptimizer.cleanupCache()
}

export function cleanupMemory() {
  thumbnailOptimizer.cleanupMemory()
} 