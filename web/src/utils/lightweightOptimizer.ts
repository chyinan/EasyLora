/**
 * 轻量级前端性能优化工具
 * 专注于图片渲染性能，不增加复杂逻辑
 */

interface ImageLoadState {
  loaded: boolean
  error: boolean
  timestamp: number
}

class LightweightImageOptimizer {
  private imageCache = new Map<string, ImageLoadState>()
  private observer: IntersectionObserver | null = null
  private container: HTMLElement | null = null

  constructor() {
    this.setupIntersectionObserver()
  }

  /**
   * 设置交叉观察器 - 核心优化
   */
  private setupIntersectionObserver() {
    if (!window.IntersectionObserver) return

    this.observer = new IntersectionObserver(
      (entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target as HTMLImageElement
            this.loadImage(img)
          }
        })
      },
      {
        rootMargin: '100px', // 提前100px开始加载
        threshold: 0.1
      }
    )
  }

  /**
   * 优化图片网格容器
   */
  optimizeContainer(container: HTMLElement) {
    this.container = container
    
    // 使用 passive 事件监听器优化滚动
    let ticking = false
    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          this.handleScrollOptimized()
          ticking = false
        })
        ticking = true
      }
    }
    
    container.addEventListener('scroll', handleScroll, { passive: true })
    
    // 立即优化可见图片
    this.optimizeVisibleImages()
    
    return () => {
      container.removeEventListener('scroll', handleScroll)
    }
  }

  /**
   * 优化的滚动处理
   */
  private handleScrollOptimized() {
    if (!this.container) return
    
    // 使用 requestIdleCallback 在空闲时间处理
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => {
        this.optimizeVisibleImages()
      }, { timeout: 100 })
    } else {
      // 降级处理
      setTimeout(() => this.optimizeVisibleImages(), 16)
    }
  }

  /**
   * 优化可见区域内的图片
   */
  private optimizeVisibleImages() {
    if (!this.container) return
    
    const images = this.container.querySelectorAll('img[data-src]:not([data-optimized])')
    images.forEach(img => {
      const rect = img.getBoundingClientRect()
      if (this.isInViewport(rect)) {
        this.optimizeImage(img as HTMLImageElement)
      }
    })
  }

  /**
   * 判断元素是否在视口内
   */
  private isInViewport(rect: DOMRect): boolean {
    return (
      rect.top < window.innerHeight + 200 &&
      rect.bottom > -200 &&
      rect.left < window.innerWidth + 200 &&
      rect.right > -200
    )
  }

  /**
   * 优化单个图片
   */
  private optimizeImage(img: HTMLImageElement) {
    if (img.dataset.optimized) return
    
    const src = img.dataset.src
    if (!src) return
    
    // 标记为已优化
    img.dataset.optimized = 'true'
    
    // 检查缓存
    if (this.imageCache.has(src)) {
      const state = this.imageCache.get(src)!
      if (state.loaded) {
        this.setImageSrc(img, src)
        return
      }
    }
    
    // 使用交叉观察器
    if (this.observer) {
      this.observer.observe(img)
    } else {
      // 降级：直接加载
      this.loadImage(img)
    }
  }

  /**
   * 加载图片
   */
  private loadImage(img: HTMLImageElement) {
    const src = img.dataset.src
    if (!src) return
    
    // 检查是否已经在加载
    if (img.dataset.loading === 'true') return
    
    img.dataset.loading = 'true'
    
    // 创建新的图片对象预加载
    const tempImg = new Image()
    
    tempImg.onload = () => {
      // 缓存成功状态
      this.imageCache.set(src, {
        loaded: true,
        error: false,
        timestamp: Date.now()
      })
      
      // 设置图片源
      this.setImageSrc(img, src)
      
      // 清理
      tempImg.onload = null
      tempImg.onerror = null
      delete img.dataset.loading
    }
    
    tempImg.onerror = () => {
      // 缓存错误状态
      this.imageCache.set(src, {
        loaded: false,
        error: true,
        timestamp: Date.now()
      })
      
      // 显示错误状态
      this.showImageError(img)
      
      // 清理
      tempImg.onload = null
      tempImg.onerror = null
      delete img.dataset.loading
    }
    
    tempImg.src = src
  }

  /**
   * 设置图片源
   */
  private setImageSrc(img: HTMLImageElement, src: string) {
    // 使用 requestAnimationFrame 确保平滑过渡
    requestAnimationFrame(() => {
      img.src = src
      img.classList.add('image-loaded')
      
      // 移除 data-src 属性
      img.removeAttribute('data-src')
      
      // 停止观察
      if (this.observer) {
        this.observer.unobserve(img)
      }
    })
  }

  /**
   * 显示图片错误状态
   */
  private showImageError(img: HTMLImageElement) {
    img.classList.add('image-error')
    
    // 可以设置一个默认的错误图片
    // img.src = 'data:image/svg+xml;base64,...'
  }

  /**
   * 清理缓存
   */
  cleanupCache(maxAge: number = 5 * 60 * 1000) {
    const now = Date.now()
    const keysToDelete: string[] = []
    
    this.imageCache.forEach((state, key) => {
      if (now - state.timestamp > maxAge) {
        keysToDelete.push(key)
      }
    })
    
    keysToDelete.forEach(key => {
      this.imageCache.delete(key)
    })
    
    if (keysToDelete.length > 0) {
      console.log(`清理了 ${keysToDelete.length} 个图片缓存`)
    }
  }

  /**
   * 获取性能统计
   */
  getStats() {
    let loaded = 0
    let errors = 0
    
    this.imageCache.forEach(state => {
      if (state.loaded) loaded++
      if (state.error) errors++
    })
    
    return {
      total: this.imageCache.size,
      loaded,
      errors,
      cacheHitRate: this.imageCache.size > 0 ? (loaded / this.imageCache.size) * 100 : 0
    }
  }

  /**
   * 销毁优化器
   */
  destroy() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    this.imageCache.clear()
    this.container = null
  }
}

// 创建全局实例
export const imageOptimizer = new LightweightImageOptimizer()

// 导出工具函数
export function optimizeImageGrid(container: HTMLElement) {
  return imageOptimizer.optimizeContainer(container)
}

export function getImageStats() {
  return imageOptimizer.getStats()
}

export function cleanupImageCache() {
  imageOptimizer.cleanupCache()
}

export function destroyImageOptimizer() {
  imageOptimizer.destroy()
} 