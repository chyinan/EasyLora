import React, { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import {
  useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface DraggableImageItemProps {
  id: string
  image: any
  onImageClick: (image: any) => void
  onRemove: (id: string) => void
  children?: React.ReactNode
}

// 可拖拽的图片项组件
function DraggableImageItem({ id, image, onImageClick, onRemove, children }: DraggableImageItemProps) {
  const [isDeleting, setIsDeleting] = useState(false)
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  const style = {
    transform: isDeleting ? 'scale(0.8)' : CSS.Transform.toString(transform),
    transition: isDeleting ? 'opacity 0.2s ease-out, transform 0.2s ease-out' : transition,
    opacity: isDragging ? 0.5 : isDeleting ? 0 : 1,
  }

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDeleting(true)
    
    // 延迟执行删除，让动画有时间播放
    setTimeout(() => {
      onRemove(id)
    }, 200)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="relative group cursor-move"
      onClick={() => onImageClick(image)}
    >
      {children}
      <button
        className={`absolute -top-2 -right-2 bg-white rounded-full shadow-soft w-7 h-7 hidden group-hover:block transition-all duration-150 z-20 ${
          isDeleting 
            ? 'bg-red-500 text-white scale-110' 
            : 'hover:bg-red-50 hover:text-red-500 hover:scale-105'
        }`}
        onClick={handleRemove}
        title="删除"
        disabled={isDeleting}
      >
        {isDeleting ? '✓' : '✕'}
      </button>
    </div>
  )
}

interface DraggableImageGridProps {
  images: any[]
  onImageClick: (image: any) => void
  onRemove: (id: string) => void
  onReorder: (newOrder: any[]) => void
  renderImage: (image: any) => React.ReactNode
  className?: string
}

export default function DraggableImageGrid({
  images,
  onImageClick,
  onRemove,
  onReorder,
  renderImage,
  className = "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3"
}: DraggableImageGridProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // 减少激活距离，让拖拽更容易触发
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event

    if (active.id !== over?.id) {
      const oldIndex = images.findIndex(img => img.id === active.id)
      const newIndex = images.findIndex(img => img.id === over?.id)
      
      const newOrder = arrayMove(images, oldIndex, newIndex)
      onReorder(newOrder)
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={images.map(img => img.id)} strategy={rectSortingStrategy}>
        <div className={className}>
          {images.map((image) => (
            <DraggableImageItem
              key={image.id}
              id={image.id}
              image={image}
              onImageClick={onImageClick}
              onRemove={onRemove}
            >
              {renderImage(image)}
            </DraggableImageItem>
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
} 