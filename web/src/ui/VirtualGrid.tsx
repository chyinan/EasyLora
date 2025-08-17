import React, { useMemo, useRef, useEffect, useState } from 'react'

interface VirtualGridProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  itemHeight: number
  itemWidth: number
  containerHeight: number
  containerWidth: number
  overscan?: number
}

export function VirtualGrid<T>({
  items,
  renderItem,
  itemHeight,
  itemWidth,
  containerHeight,
  containerWidth,
  overscan = 5
}: VirtualGridProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)

  // 计算网格布局
  const gridInfo = useMemo(() => {
    const columns = Math.floor(containerWidth / itemWidth)
    const rows = Math.ceil(items.length / columns)
    const totalHeight = rows * itemHeight
    
    return {
      columns,
      rows,
      totalHeight,
      itemHeight,
      itemWidth
    }
  }, [items.length, containerWidth, itemWidth, itemHeight])

  // 计算可见范围
  const visibleRange = useMemo(() => {
    const startRow = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
    const endRow = Math.min(
      gridInfo.rows - 1,
      Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan
    )
    
    const startIndex = startRow * gridInfo.columns
    const endIndex = Math.min(items.length - 1, (endRow + 1) * gridInfo.columns - 1)
    
    return { startIndex, endIndex, startRow, endRow }
  }, [scrollTop, containerHeight, gridInfo, items.length, overscan])

  // 处理滚动事件
  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop)
  }

  // 渲染可见的项目
  const visibleItems = useMemo(() => {
    const items: React.ReactNode[] = []
    for (let i = visibleRange.startIndex; i <= visibleRange.endIndex; i++) {
      if (i < items.length) {
        const row = Math.floor(i / gridInfo.columns)
        const col = i % gridInfo.columns
        
        items.push(
          <div
            key={i}
            style={{
              position: 'absolute',
              top: row * itemHeight,
              left: col * itemWidth,
              width: itemWidth,
              height: itemHeight
            }}
          >
            {renderItem(items[i], i)}
          </div>
        )
      }
    }
    return items
  }, [visibleRange, gridInfo, items, renderItem])

  return (
    <div
      ref={containerRef}
      style={{
        height: containerHeight,
        overflow: 'auto',
        position: 'relative'
      }}
      onScroll={handleScroll}
    >
      <div style={{ height: gridInfo.totalHeight, position: 'relative' }}>
        {visibleItems}
      </div>
    </div>
  )
}

// 简化的虚拟网格组件，用于图片网格
interface ImageGridProps {
  images: Array<{ id: string; src: string; alt?: string }>
  onImageClick?: (image: any) => void
  className?: string
  containerHeight?: number
}

export function ImageGrid({ 
  images, 
  onImageClick, 
  className = "",
  containerHeight = 320 
}: ImageGridProps) {
  const itemSize = 120 // 图片尺寸
  const gap = 12 // 间距
  
  const renderImage = (image: any, index: number) => (
    <div
      key={image.id}
      className={`cursor-pointer group ${className}`}
      onClick={() => onImageClick?.(image)}
      style={{
        width: itemSize,
        height: itemSize,
        padding: gap / 2
      }}
    >
      <div className="relative w-full h-full">
        <img
          src={image.src}
          alt={image.alt || ''}
          className="w-full h-full object-cover rounded-lg border hover:border-blue-400 transition-colors"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 rounded-lg transition-all flex items-center justify-center">
          <span className="text-white text-xs opacity-0 group-hover:opacity-100">
            点击编辑
          </span>
        </div>
      </div>
    </div>
  )

  return (
    <VirtualGrid
      items={images}
      renderItem={renderImage}
      itemHeight={itemSize + gap}
      itemWidth={itemSize + gap}
      containerHeight={containerHeight}
      containerWidth={800} // 假设容器宽度
      overscan={3}
    />
  )
} 