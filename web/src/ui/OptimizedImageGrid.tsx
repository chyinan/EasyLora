import React, { useRef, useEffect, useState, useCallback } from 'react'
import OptimizedLazyImage from './OptimizedLazyImage'
import { optimizeImageGrid } from '../utils/lightweightOptimizer'

interface ImageItem {
  id: string
  src: string
  alt?: string
  thumbnail?: string
  caption?: string
  previewUrl?: string
}

interface OptimizedImageGridProps {
  images: ImageItem[]
  className?: string
  itemClassName?: string
  useThumbnails?: boolean
  thumbnailSize?: number
  thumbnailQuality?: number
  columns?: number
  gap?: number
  onImageClick?: (image: ImageItem) => void
  onImageLoad?: (image: ImageItem) => void
  onImageError?: (image: ImageItem, error: any) => void
  onRemove?: (id: string) => void
}

const OptimizedImageGrid: React.FC<OptimizedImageGridProps> = ({
  images,
  className = '',
  itemClassName = '',
  useThumbnails = true,
  thumbnailSize = 200,
  thumbnailQuality = 80,
  columns = 4,
  gap = 16,
  onImageClick,
  onImageLoad,
  onImageError,
  onRemove
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const [visibleImages, setVisibleImages] = useState<ImageItem[]>([])
  const [isLoading, setIsLoading] = useState(true)

  // 分批渲染图片，避免一次性渲染过多
  const batchRenderImages = useCallback(() => {
    if (images.length === 0) return

    setIsLoading(true)
    
    // 先渲染前20张图片
    const initialBatch = images.slice(0, 20)
    setVisibleImages(initialBatch)
    
    // 使用 requestIdleCallback 在空闲时间渲染剩余图片
    if ('requestIdleCallback' in window) {
      (window as any).requestIdleCallback(() => {
        setVisibleImages(images)
        setIsLoading(false)
      }, { timeout: 1000 })
    } else {
      // 降级处理
      setTimeout(() => {
        setVisibleImages(images)
        setIsLoading(false)
      }, 100)
    }
  }, [images])

  // 初始化图片网格优化
  useEffect(() => {
    if (containerRef.current) {
      const cleanup = optimizeImageGrid(containerRef.current)
      return cleanup
    }
  }, [])

  // 当图片列表变化时，重新渲染
  useEffect(() => {
    batchRenderImages()
  }, [batchRenderImages])

  // 处理图片点击
  const handleImageClick = useCallback((image: ImageItem) => {
    onImageClick?.(image)
  }, [onImageClick])

  // 处理图片加载完成
  const handleImageLoad = useCallback((image: ImageItem) => {
    onImageLoad?.(image)
  }, [onImageLoad])

  // 处理图片加载错误
  const handleImageError = useCallback((image: ImageItem, error: any) => {
    onImageError?.(image, error)
  }, [onImageError])

  // 动态计算网格样式
  const gridStyle = {
    display: 'grid',
    gridTemplateColumns: `repeat(${columns}, 1fr)`,
    gap: `${gap}px`,
    padding: `${gap}px`
  }

  if (images.length === 0) {
    return (
      <div className={`flex items-center justify-center h-64 text-gray-500 ${className}`}>
        暂无图片
      </div>
    )
  }

  return (
    <div className={className}>
      {/* 图片网格容器 */}
      <div 
        ref={containerRef}
        style={gridStyle}
        className="w-full"
      >
        {visibleImages.map((image) => (
          <div
            key={image.id}
            className={`relative group cursor-pointer transition-transform duration-200 hover:scale-105 ${itemClassName}`}
            onClick={() => handleImageClick(image)}
          >
            <OptimizedLazyImage
              src={image.previewUrl || image.src}
              alt={image.caption || image.alt || image.id}
              useThumbnail={useThumbnails}
              thumbnailWidth={thumbnailSize}
              thumbnailHeight={thumbnailSize}
              thumbnailQuality={thumbnailQuality}
              className="w-full h-full object-cover rounded-lg shadow-md"
              onLoad={() => handleImageLoad(image)}
              onError={() => handleImageError(image, undefined)}
            />
            
            {/* 悬停效果 */}
            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 transition-all duration-200 rounded-lg" />
            
            {/* 删除按钮 */}
            {onRemove && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onRemove(image.id)
                }}
                className="absolute top-2 right-2 w-6 h-6 bg-red-500 hover:bg-red-600 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center text-xs font-bold"
                title="删除图片"
              >
                ×
              </button>
            )}
            
            {/* 图片信息 */}
            {image.alt && (
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black to-transparent p-3 rounded-b-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                <p className="text-white text-sm truncate">{image.alt}</p>
              </div>
            )}
            
            {/* 标签信息 - 始终显示 */}
            {image.caption && (
              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-70 p-2 rounded-b-lg">
                <p className="text-white text-xs truncate">{image.caption}</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* 加载状态指示器 */}
      {isLoading && visibleImages.length < images.length && (
        <div className="flex items-center justify-center py-8">
          <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
          <span className="ml-3 text-gray-600">加载中...</span>
        </div>
      )}

      {/* 图片总数显示 */}
      <div className="text-center py-4 text-sm text-gray-500">
        共 {images.length} 张图片
      </div>
    </div>
  )
}

export default OptimizedImageGrid 