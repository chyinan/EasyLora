import React from 'react'

export type SortOption = 'name' | 'size' | 'date' | 'custom'

interface SortOptionsProps {
  currentSort: SortOption
  onSortChange: (sort: SortOption) => void
  onResetOrder: () => void
}

export default function SortOptions({ currentSort, onSortChange, onResetOrder }: SortOptionsProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="text-gray-500">排序:</span>
      <select
        value={currentSort}
        onChange={(e) => onSortChange(e.target.value as SortOption)}
        className="px-2 py-1 border rounded text-xs bg-white"
      >
        <option value="custom">自定义顺序</option>
        <option value="name">按文件名</option>
        <option value="size">按文件大小</option>
        <option value="date">按上传时间</option>
      </select>
      {currentSort !== 'custom' && (
        <button
          onClick={onResetOrder}
          className="px-2 py-1 text-blue-500 hover:text-blue-700 text-xs"
          title="恢复自定义顺序"
        >
          重置
        </button>
      )}
    </div>
  )
}

// 排序工具函数
export function sortImages(images: any[], sortOption: SortOption): any[] {
  const sorted = [...images]
  
  switch (sortOption) {
    case 'name':
      return sorted.sort((a, b) => {
        const nameA = a.file?.name || a.filename || ''
        const nameB = b.file?.name || b.filename || ''
        return nameA.localeCompare(nameB)
      })
    
    case 'size':
      return sorted.sort((a, b) => {
        const sizeA = a.file?.size || 0
        const sizeB = b.file?.size || 0
        return sizeB - sizeA // 从大到小
      })
    
    case 'date':
      return sorted.sort((a, b) => {
        const dateA = a.file?.lastModified || 0
        const dateB = b.file?.lastModified || 0
        return dateB - dateA // 最新的在前
      })
    
    default:
      return sorted // 保持自定义顺序
  }
} 