import React, { useState, useEffect } from 'react'
import { getPerformanceMetrics, cleanupThumbnailCache, cleanupMemory } from '../utils/performanceOptimizer'

interface PerformanceData {
  fps: number
  renderTime: number
  memoryUsage?: number
  thumbnailLoadTime: number
  cacheHitRate: number
}

export default function PerformanceMonitor() {
  const [isVisible, setIsVisible] = useState(false)
  const [performanceData, setPerformanceData] = useState<PerformanceData>({
    fps: 0,
    renderTime: 0,
    thumbnailLoadTime: 0,
    cacheHitRate: 0
  })
  const [isMonitoring, setIsMonitoring] = useState(false)

  useEffect(() => {
    let intervalId: NodeJS.Timeout

    if (isMonitoring) {
      intervalId = setInterval(() => {
        const metrics = getPerformanceMetrics()
        setPerformanceData(metrics)
      }, 1000)
    }

    return () => {
      if (intervalId) {
        clearInterval(intervalId)
      }
    }
  }, [isMonitoring])

  const getFpsColor = (fps: number) => {
    if (fps >= 55) return 'text-green-500'
    if (fps >= 30) return 'text-yellow-500'
    return 'text-red-500'
  }

  const getCacheHitColor = (rate: number) => {
    if (rate >= 80) return 'text-green-500'
    if (rate >= 60) return 'text-yellow-500'
    return 'text-red-500'
  }

  const getMemoryColor = (usage?: number) => {
    if (!usage) return 'text-gray-500'
    if (usage < 100) return 'text-green-500'
    if (usage < 200) return 'text-yellow-500'
    return 'text-red-500'
  }

  const handleCleanupCache = () => {
    cleanupThumbnailCache()
    alert('缩略图缓存已清理')
  }

  const handleCleanupMemory = () => {
    cleanupMemory()
    alert('内存已清理')
  }

  if (!isVisible) {
    return (
      <button
        onClick={() => setIsVisible(true)}
        className="fixed bottom-4 right-4 bg-blue-500 text-white p-2 rounded-full shadow-lg hover:bg-blue-600 transition-colors z-50"
        title="显示性能监控"
      >
        📊
      </button>
    )
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-80 z-50">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">性能监控</h3>
        <div className="flex gap-2">
          <button
            onClick={() => setIsMonitoring(!isMonitoring)}
            className={`px-2 py-1 text-xs rounded ${
              isMonitoring 
                ? 'bg-red-500 text-white hover:bg-red-600' 
                : 'bg-green-500 text-white hover:bg-green-600'
            }`}
          >
            {isMonitoring ? '停止' : '开始'}
          </button>
          <button
            onClick={() => setIsVisible(false)}
            className="text-gray-400 hover:text-gray-600"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="space-y-2 text-xs">
        {/* FPS */}
        <div className="flex justify-between items-center">
          <span className="text-gray-600">FPS:</span>
          <span className={`font-mono ${getFpsColor(performanceData.fps)}`}>
            {performanceData.fps}
          </span>
        </div>

        {/* 渲染时间 */}
        <div className="flex justify-between items-center">
          <span className="text-gray-600">渲染时间:</span>
          <span className="font-mono text-gray-800">
            {performanceData.renderTime.toFixed(1)}ms
          </span>
        </div>

        {/* 缩略图加载时间 */}
        <div className="flex justify-between items-center">
          <span className="text-gray-600">缩略图加载:</span>
          <span className="font-mono text-gray-800">
            {performanceData.thumbnailLoadTime.toFixed(1)}ms
          </span>
        </div>

        {/* 缓存命中率 */}
        <div className="flex justify-between items-center">
          <span className="text-gray-600">缓存命中率:</span>
          <span className={`font-mono ${getCacheHitColor(performanceData.cacheHitRate)}`}>
            {performanceData.cacheHitRate.toFixed(1)}%
          </span>
        </div>

        {/* 内存使用 */}
        <div className="flex justify-between items-center">
          <span className="text-gray-600">内存使用:</span>
          <span className={`font-mono ${getMemoryColor(performanceData.memoryUsage)}`}>
            {performanceData.memoryUsage ? `${performanceData.memoryUsage}MB` : 'N/A'}
          </span>
        </div>
      </div>

      {/* 性能状态指示器 */}
      <div className="mt-3 pt-3 border-t border-gray-200">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${
            performanceData.fps >= 55 ? 'bg-green-500' : 
            performanceData.fps >= 30 ? 'bg-yellow-500' : 'bg-red-500'
          }`} />
          <span className="text-xs text-gray-600">
            {performanceData.fps >= 55 ? '性能优秀' : 
             performanceData.fps >= 30 ? '性能一般' : '性能较差'}
          </span>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="mt-3 pt-3 border-t border-gray-200 flex gap-2">
        <button
          onClick={handleCleanupCache}
          className="px-3 py-1 text-xs bg-yellow-500 text-white rounded hover:bg-yellow-600 transition-colors"
        >
          清理缓存
        </button>
        <button
          onClick={handleCleanupMemory}
          className="px-3 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 transition-colors"
        >
          清理内存
        </button>
      </div>

      {/* 性能建议 */}
      {performanceData.fps < 30 && (
        <div className="mt-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-xs text-yellow-800">
          <strong>性能建议:</strong>
          <ul className="mt-1 space-y-1">
            <li>• 减少同时显示的图片数量</li>
            <li>• 使用更小的缩略图尺寸</li>
            <li>• 检查是否有大量图片在后台加载</li>
          </ul>
        </div>
      )}

      {performanceData.cacheHitRate < 60 && (
        <div className="mt-2 p-2 bg-blue-50 border border-blue-200 rounded text-xs text-blue-800">
          <strong>缓存建议:</strong>
          <ul className="mt-1 space-y-1">
            <li>• 缩略图缓存命中率较低</li>
            <li>• 考虑预加载更多缩略图</li>
            <li>• 检查缓存清理策略</li>
          </ul>
        </div>
      )}
    </div>
  )
} 