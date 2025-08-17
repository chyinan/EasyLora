import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'

interface VirtualImageGridProps {
  images: any[]
  onImageClick: (image: any) => void
  onRemove: (id: string) => void
  onReorder?: (newOrder: any[]) => void
  className?: string
  renderImage: (image: any) => React.ReactNode
  itemHeight?: number
  itemWidth?: number
  columns?: number
}

export default function VirtualImageGrid({
  images,
  onImageClick,
  onRemove,
  onReorder,
  className = '',
  renderImage,
  itemHeight = 120,
  itemWidth = 120,
  columns = 5
}: VirtualImageGridProps) {
  const parentRef = useRef<HTMLDivElement>(null)
  const [dragState, setDragState] = useState<{
    isDragging: boolean
    draggedId: string | null
    draggedIndex: number | null
    targetIndex: number | null
  }>({
    isDragging: false,
    draggedId: null,
    draggedIndex: null,
    targetIndex: null
  })

  // 动态计算列数和项目宽度
  const [containerWidth, setContainerWidth] = useState(0)
  const [dynamicColumns, setDynamicColumns] = useState(columns)
  const [dynamicItemWidth, setDynamicItemWidth] = useState(itemWidth)

  // 监听容器宽度变化
  useEffect(() => {
    const updateDimensions = () => {
      if (parentRef.current) {
        const width = parentRef.current.clientWidth
        setContainerWidth(width)
        
        // 根据容器宽度动态计算列数
        const gap = 8 // 间距
        const minItemWidth = 80 // 最小项目宽度
        const maxItemWidth = 150 // 最大项目宽度
        
        // 计算最佳列数
        let bestColumns = Math.floor(width / (minItemWidth + gap))
        bestColumns = Math.max(1, Math.min(bestColumns, 8)) // 限制在1-8列之间
        
        // 计算项目宽度
        const itemWidth = Math.max(minItemWidth, Math.min(maxItemWidth, (width - (bestColumns - 1) * gap) / bestColumns))
        
        setDynamicColumns(bestColumns)
        setDynamicItemWidth(itemWidth)
      }
    }

    updateDimensions()
    
    // 监听窗口大小变化
    const resizeObserver = new ResizeObserver(updateDimensions)
    if (parentRef.current) {
      resizeObserver.observe(parentRef.current)
    }

    return () => {
      resizeObserver.disconnect()
    }
  }, [columns, itemWidth])

  // 计算行数
  const rows = Math.ceil(images.length / dynamicColumns)
  
  // 计算实际的行高度（包含图片、标签和间距）
  const actualRowHeight = itemHeight + 40 + 16 // itemHeight + 标签高度(40px) + 行间距(16px)
  
  // 创建虚拟化器
  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => actualRowHeight,
    overscan: 2, // 预加载的行数
  })

  // 拖拽开始
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    if (!onReorder) return
    
    setDragState({
      isDragging: true,
      draggedId: images[index].id,
      draggedIndex: index,
      targetIndex: index
    })
    
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/html', '') // 必须设置数据才能开始拖拽
  }, [images, onReorder])

  // 拖拽结束
  const handleDragEnd = useCallback(() => {
    if (!onReorder || !dragState.isDragging || dragState.draggedIndex === null || dragState.targetIndex === null) {
      setDragState({
        isDragging: false,
        draggedId: null,
        draggedIndex: null,
        targetIndex: null
      })
      return
    }

    const newOrder = [...images]
    const [draggedItem] = newOrder.splice(dragState.draggedIndex, 1)
    newOrder.splice(dragState.targetIndex, 0, draggedItem)
    
    onReorder(newOrder)
    
    setDragState({
      isDragging: false,
      draggedId: null,
      draggedIndex: null,
      targetIndex: null
    })
  }, [dragState, images, onReorder])

  // 拖拽悬停
  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragState.isDragging && dragState.draggedIndex !== null) {
      setDragState(prev => ({ ...prev, targetIndex: index }))
    }
  }, [dragState])

  // 渲染单行图片
  const renderRow = useCallback((rowIndex: number) => {
    const startIndex = rowIndex * dynamicColumns
    const endIndex = Math.min(startIndex + dynamicColumns, images.length)
    const rowImages = images.slice(startIndex, endIndex)

    return (
              <div
          key={rowIndex}
          className="flex gap-2 mb-4"
          style={{
            height: itemHeight,
          }}
        >
          {rowImages.map((image, colIndex) => {
            const globalIndex = startIndex + colIndex
            const isDragging = dragState.draggedId === image.id
            const isDragTarget = dragState.targetIndex === globalIndex
            
                         return (
               <div
                 key={image.id}
                 className={`relative group ${isDragging ? 'opacity-50' : ''} ${isDragTarget ? 'ring-2 ring-blue-500' : ''}`}
                 style={{ width: dynamicItemWidth }}
                 draggable={!!onReorder}
                 onDragStart={(e) => handleDragStart(e, globalIndex)}
                 onDragEnd={handleDragEnd}
                 onDragOver={(e) => handleDragOver(e, globalIndex)}
                 onClick={() => onImageClick(image)}
               >
              {renderImage(image)}
              
                             {/* 删除按钮 */}
               <button
                 onClick={(e) => {
                   e.stopPropagation()
                   onRemove(image.id)
                 }}
                 className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 transition-all opacity-0 group-hover:opacity-100"
                 title="删除"
               >
                 ×
               </button>
            </div>
          )
        })}
        
        {/* 填充空列以保持对齐 */}
        {Array.from({ length: dynamicColumns - rowImages.length }).map((_, colIndex) => (
          <div
            key={`empty-${rowIndex}-${colIndex}`}
            style={{ width: dynamicItemWidth }}
            className="flex-shrink-0"
          />
        ))}
      </div>
    )
  }, [images, dynamicColumns, itemHeight, dynamicItemWidth, actualRowHeight, dragState, onReorder, onImageClick, onRemove, renderImage, handleDragStart, handleDragEnd, handleDragOver])

  return (
    <div
      ref={parentRef}
      className={`overflow-auto ${className}`}
      style={{ height: '100%' }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <div
            key={virtualRow.key}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderRow(virtualRow.index)}
          </div>
        ))}
      </div>
    </div>
  )
} 