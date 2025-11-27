import React, { useState, useRef, useEffect, useCallback } from 'react'

interface OptimizedLazyImageProps {
  src: string
  alt?: string
  className?: string
  placeholder?: string
  onLoad?: () => void
  onError?: () => void
  loading?: 'lazy' | 'eager'
  // 缩略图相关属性
  useThumbnail?: boolean
  thumbnailWidth?: number
  thumbnailHeight?: number
  thumbnailQuality?: number
  [key: string]: any
}

const OptimizedLazyImage: React.FC<OptimizedLazyImageProps> = ({
  src,
  alt = '',
  className = '',
  placeholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iMTIwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik02MCA2NUw0MCA0NUg4MEw2MCA2NVoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+',
  onLoad,
  onError,
  loading = 'lazy',
  // 缩略图相关参数
  useThumbnail = false,
  thumbnailWidth = 200,
  thumbnailHeight = 200,
  thumbnailQuality = 80,
  ...props
}) => {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // 图片加载完成
  const handleLoad = useCallback(() => {
    setIsLoaded(true)
    setHasError(false)
    onLoad?.()
  }, [onLoad])

  // 图片加载失败
  const handleError = useCallback(() => {
    setHasError(true)
    setIsLoaded(false)
    onError?.()
  }, [onError])

  // 设置交叉观察器 - 轻量级实现
  useEffect(() => {
    if (loading === 'eager') {
      setIsLoaded(true)
      return
    }

    if (!imgRef.current) return

    // 使用轻量级的交叉观察器
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            // 立即开始加载图片
            const img = entry.target as HTMLImageElement
            if (img.dataset.src) {
              img.src = img.dataset.src
              img.removeAttribute('data-src')
            }
            
            // 停止观察
            if (observerRef.current) {
              observerRef.current.unobserve(img)
            }
          }
        })
      },
      {
        rootMargin: '100px', // 提前100px开始加载，避免滚动卡顿
        threshold: 0.1
      }
    )

    observerRef.current.observe(imgRef.current)

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [loading])

  // 生成缩略图URL的函数 - 修复版本
  const getThumbnailUrl = useCallback((originalUrl: string) => {
    if (!useThumbnail || !originalUrl) return originalUrl
    
    try {
      // 从原始URL中提取文件路径
      let filePath = ''
      
      if (originalUrl.includes('/api/get-image/')) {
        // 处理 /api/get-image/ 路径
        filePath = originalUrl.replace('/api/get-image/', '')
      } else if (originalUrl.includes('/workspace/')) {
        // 处理 /workspace/ 路径
        filePath = originalUrl.replace('/workspace/', '')
      } else if (originalUrl.startsWith('/')) {
        // 处理其他绝对路径
        filePath = originalUrl.substring(1)
      } else {
        // 处理相对路径
        filePath = originalUrl
      }

      // 确保文件路径不为空
      if (!filePath || filePath === 'undefined') {
        console.warn('无法提取文件路径:', originalUrl)
        return originalUrl
      }

      // 构建缩略图URL - 使用正确的API格式
      const params = new URLSearchParams({
        width: thumbnailWidth.toString(),
        height: thumbnailHeight.toString(),
        quality: thumbnailQuality.toString()
      })
      
      return `/api/thumbnail/${filePath}?${params.toString()}`
    } catch (error) {
      console.warn('生成缩略图URL失败:', error, '原始URL:', originalUrl)
      return originalUrl
    }
  }, [useThumbnail, thumbnailWidth, thumbnailHeight, thumbnailQuality])

  // 获取最终的图片URL
  const finalSrc = useThumbnail ? getThumbnailUrl(src) : src

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* 占位符 - 轻量级实现 */}
      {!isLoaded && !hasError && (
        <img
          src={placeholder}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'blur(1px)' }}
        />
      )}
      
      {/* 加载中指示器 - 简化版 */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="w-4 h-4 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
      )}
      
      {/* 错误状态 */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-400 text-xs">
          加载失败
        </div>
      )}
      
      {/* 实际图片 - 使用 data-src 实现懒加载 */}
      <img
        ref={imgRef}
        data-src={finalSrc}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-200 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        loading={loading}
        decoding="async" // 异步解码，提升性能
        {...props}
      />
    </div>
  )
}

export default OptimizedLazyImage 