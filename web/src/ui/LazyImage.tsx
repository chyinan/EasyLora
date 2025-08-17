import React, { useState, useRef, useEffect, useCallback } from 'react'

interface LazyImageProps {
  src: string
  alt?: string
  className?: string
  placeholder?: string
  onLoad?: () => void
  onError?: () => void
  loading?: 'lazy' | 'eager'
  [key: string]: any
}

export default function LazyImage({
  src,
  alt = '',
  className = '',
  placeholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iMTIwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik02MCA2NUw0MCA0NUg4MEw2MCA2NVoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+',
  onLoad,
  onError,
  loading = 'lazy',
  ...props
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [isInView, setIsInView] = useState(false)
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

  // 设置交叉观察器
  useEffect(() => {
    if (loading === 'eager') {
      setIsInView(true)
      return
    }

    if (!imgRef.current) return

    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setIsInView(true)
            // 一旦进入视口就停止观察
            if (observerRef.current) {
              observerRef.current.disconnect()
            }
          }
        })
      },
      {
        rootMargin: '50px', // 提前50px开始加载
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

  // 当图片进入视口时开始加载
  useEffect(() => {
    if (isInView && imgRef.current) {
      const img = imgRef.current
      
      // 如果图片还没有src，设置src开始加载
      if (!img.src || img.src === placeholder) {
        img.src = src
      }
    }
  }, [isInView, src, placeholder])

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* 占位符 */}
      {!isLoaded && !hasError && (
        <img
          src={placeholder}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
          style={{ filter: 'blur(1px)' }}
        />
      )}
      
      {/* 加载中指示器 */}
      {!isLoaded && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
      )}
      
      {/* 错误状态 */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 text-gray-400 text-xs">
          加载失败
        </div>
      )}
      
      {/* 实际图片 */}
      <img
        ref={imgRef}
        src={isInView ? src : placeholder}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        onLoad={handleLoad}
        onError={handleError}
        {...props}
      />
    </div>
  )
} 