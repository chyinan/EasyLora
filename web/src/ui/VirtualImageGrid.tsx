import React, { useState, useEffect, useRef, useCallback } from 'react'
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

// Memoized Item Component to prevent unnecessary re-renders
const GridItem = React.memo(({ 
  image, 
  width, 
  isDragging, 
  isDragTarget, 
  onDragStart, 
  onDragEnd, 
  onDragOver, 
  onClick, 
  onRemove, 
  renderImage 
}: any) => {
  return (
    <div
      className={`relative group ${isDragging ? 'opacity-50' : ''} ${isDragTarget ? 'ring-2 ring-blue-500' : ''}`}
      style={{ width }}
      draggable={!!onDragStart}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onClick}
    >
      {renderImage(image)}
      
      <button
        onClick={(e) => {
          e.stopPropagation()
          onRemove(image.id)
        }}
        className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full text-xs hover:bg-red-600 transition-all opacity-0 group-hover:opacity-100 flex items-center justify-center z-20"
        title="删除"
      >
        ×
      </button>
    </div>
  )
}, (prev, next) => {
  return (
    prev.image === next.image &&
    prev.width === next.width &&
    prev.isDragging === next.isDragging &&
    prev.isDragTarget === next.isDragTarget &&
    // We assume functions are stable or we don't care if they change for render purposes unless other props change
    // Ideally parent ensures these are stable, but even if not, re-rendering a single item is cheap.
    // The main saving is not re-rendering ALL items.
    true
  )
})

export default React.memo(function VirtualImageGrid({
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

  // Dynamic layout calculation
  const [containerWidth, setContainerWidth] = useState(0)
  const [layout, setLayout] = useState({ columns, itemWidth })

  useEffect(() => {
    if (!parentRef.current) return

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width
        if (width === 0) return
        
        setContainerWidth(width)
        
        const gap = 8
        const minItemWidth = 120 // Slightly larger minimum
        const maxItemWidth = 200
        
        let bestColumns = Math.floor((width + gap) / (minItemWidth + gap))
        bestColumns = Math.max(2, Math.min(bestColumns, 12)) // Min 2 cols, Max 12
        
        // Calculate item width to fill space
        const newItemWidth = (width - (bestColumns - 1) * gap) / bestColumns
        
        setLayout({ columns: bestColumns, itemWidth: newItemWidth })
      }
    })

    observer.observe(parentRef.current)
    return () => observer.disconnect()
  }, [])

  const { columns: dynamicColumns, itemWidth: dynamicItemWidth } = layout
  const rows = Math.ceil(images.length / dynamicColumns)
  const actualRowHeight = itemHeight + 40 + 16 // Heuristic height

  const rowVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => actualRowHeight,
    overscan: 3,
  })

  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    if (!onReorder) return
    setDragState({
      isDragging: true,
      draggedId: images[index].id,
      draggedIndex: index,
      targetIndex: index
    })
    e.dataTransfer.effectAllowed = 'move'
    // Use a transparent image or keeping the default ghost
    // e.dataTransfer.setDragImage(e.target as Element, 0, 0)
  }, [images, onReorder])

  const handleDragEnd = useCallback(() => {
    if (!onReorder || !dragState.isDragging || dragState.draggedIndex === null || dragState.targetIndex === null) {
      setDragState(prev => ({ ...prev, isDragging: false, draggedId: null, draggedIndex: null, targetIndex: null }))
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

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (dragState.isDragging && dragState.draggedIndex !== null && dragState.targetIndex !== index) {
      setDragState(prev => ({ ...prev, targetIndex: index }))
    }
  }, [dragState])

  return (
    <div
      ref={parentRef}
      className={`overflow-auto ${className}`}
      style={{ height: '100%', minHeight: '200px' }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * dynamicColumns
          const endIndex = Math.min(startIndex + dynamicColumns, images.length)
          const rowImages = images.slice(startIndex, endIndex)

          return (
            <div
              key={virtualRow.key}
              className="flex gap-2 absolute top-0 left-0 w-full"
              style={{
                height: actualRowHeight,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {rowImages.map((image, colIndex) => {
                const globalIndex = startIndex + colIndex
                const isDragging = dragState.draggedId === image.id
                const isDragTarget = dragState.targetIndex === globalIndex

                return (
                  <GridItem
                    key={image.id || globalIndex}
                    image={image}
                    width={dynamicItemWidth}
                    isDragging={isDragging}
                    isDragTarget={isDragTarget}
                    onDragStart={onReorder ? (e: any) => handleDragStart(e, globalIndex) : undefined}
                    onDragEnd={onReorder ? handleDragEnd : undefined}
                    onDragOver={onReorder ? (e: any) => handleDragOver(e, globalIndex) : undefined}
                    onClick={() => onImageClick(image)}
                    onRemove={onRemove}
                    renderImage={renderImage}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
})
