import React, { useState, useCallback } from 'react'
import OptimizedImageGrid from './OptimizedImageGrid'
import VirtualImageGrid from './VirtualImageGrid'

interface ImageItem {
  id: string
  src: string
  alt?: string
  thumbnail?: string
}

// 模拟图片数据 - 修复URL格式
const mockImages: ImageItem[] = Array.from({ length: 1000 }, (_, i) => {
  const imageNumber = String(i).padStart(4, '0')
  return {
    id: `image-${i}`,
    src: `/api/get-image/processed/dataset/img_${imageNumber}.png`,
    alt: `图片 ${i + 1}`,
    // 移除缩略图字段，让组件自动生成
    // thumbnail: `/api/thumbnail/processed/dataset/img_${imageNumber}.png?width=200&height=200&quality=80`
  }
})

const ImageGalleryExample: React.FC = () => {
  const [viewMode, setViewMode] = useState<'grid' | 'virtual'>('grid')
  const [useThumbnails, setUseThumbnails] = useState(true)
  const [thumbnailSize, setThumbnailSize] = useState(200)
  const [thumbnailQuality, setThumbnailQuality] = useState(80)
  const [columns, setColumns] = useState(4)
  const [gap, setGap] = useState(16)

  // 处理图片点击
  const handleImageClick = useCallback((image: ImageItem) => {
    console.log('点击图片:', image)
    // 这里可以打开图片预览、编辑等功能
  }, [])

  // 处理图片加载完成
  const handleImageLoad = useCallback((image: ImageItem) => {
    console.log('图片加载完成:', image.id)
  }, [])

  // 处理图片加载错误
  const handleImageError = useCallback((image: ImageItem, error: any) => {
    console.error('图片加载失败:', image.id, error)
  }, [])

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* 控制面板 */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">图片画廊性能优化示例</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* 视图模式选择 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              视图模式
            </label>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as 'grid' | 'virtual')}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="grid">普通网格</option>
              <option value="virtual">虚拟滚动</option>
            </select>
          </div>

          {/* 缩略图开关 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              启用缩略图
            </label>
            <input
              type="checkbox"
              checked={useThumbnails}
              onChange={(e) => setUseThumbnails(e.target.checked)}
              className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
            />
          </div>

          {/* 缩略图尺寸 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              缩略图尺寸
            </label>
            <select
              value={thumbnailSize}
              onChange={(e) => setThumbnailSize(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={100}>100x100</option>
              <option value={150}>150x150</option>
              <option value={200}>200x200</option>
              <option value={300}>300x300</option>
            </select>
          </div>

          {/* 缩略图质量 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              缩略图质量
            </label>
            <select
              value={thumbnailQuality}
              onChange={(e) => setThumbnailQuality(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={60}>60%</option>
              <option value={70}>70%</option>
              <option value={80}>80%</option>
              <option value={90}>90%</option>
            </select>
          </div>

          {/* 列数 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              列数
            </label>
            <select
              value={columns}
              onChange={(e) => setColumns(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={2}>2列</option>
              <option value={3}>3列</option>
              <option value={4}>4列</option>
              <option value={5}>5列</option>
              <option value={6}>6列</option>
            </select>
          </div>

          {/* 间距 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              间距
            </label>
            <select
              value={gap}
              onChange={(e) => setGap(Number(e.target.value))}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value={8}>8px</option>
              <option value={12}>12px</option>
              <option value={16}>16px</option>
              <option value={20}>20px</option>
              <option value={24}>24px</option>
            </select>
          </div>
        </div>

        {/* 性能提示 */}
        <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <h3 className="text-sm font-semibold text-blue-800 mb-2">性能优化提示</h3>
          <ul className="text-sm text-blue-700 space-y-1">
            <li>• 启用缩略图可显著提升加载速度</li>
            <li>• 虚拟滚动适合大量图片（1000+）</li>
            <li>• 普通网格适合中等数量图片（&lt;500）</li>
            <li>• 较小的缩略图尺寸可减少内存占用</li>
          </ul>
        </div>
      </div>

      {/* 图片画廊 */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {viewMode === 'grid' ? (
          <OptimizedImageGrid
            images={mockImages}
            useThumbnails={useThumbnails}
            thumbnailSize={thumbnailSize}
            thumbnailQuality={thumbnailQuality}
            columns={columns}
            gap={gap}
            onImageClick={handleImageClick}
            onImageLoad={handleImageLoad}
            onImageError={handleImageError}
            className="p-4"
          />
        ) : (
          <VirtualImageGrid
            images={mockImages}
            useThumbnails={useThumbnails}
            thumbnailSize={thumbnailSize}
            thumbnailQuality={thumbnailQuality}
            columns={columns}
            gap={gap}
            onImageClick={handleImageClick}
            onImageLoad={handleImageLoad}
            onImageError={handleImageError}
            className="h-screen"
          />
        )}
      </div>

      {/* 使用说明 */}
      <div className="mt-6 bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-3">使用说明</h3>
        <div className="text-sm text-gray-600 space-y-2">
          <p><strong>普通网格模式：</strong>适合中等数量的图片，提供完整的图片预览和交互功能。</p>
          <p><strong>虚拟滚动模式：</strong>适合大量图片，只渲染可见区域的图片，大幅提升性能。</p>
          <p><strong>缩略图优化：</strong>自动生成不同尺寸和质量的缩略图，减少加载时间。</p>
          <p><strong>懒加载：</strong>图片只在进入视口时才开始加载，提升首屏速度。</p>
        </div>
      </div>
    </div>
  )
}

export default ImageGalleryExample 