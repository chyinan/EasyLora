import { useEffect, useRef, useState } from 'react'

interface PerformanceMetrics {
  renderTime: number
  memoryUsage?: number
  fps: number
}

export function usePerformance(componentName: string) {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    renderTime: 0,
    fps: 0
  })
  const renderCount = useRef(0)
  const lastRenderTime = useRef(performance.now())
  const frameCount = useRef(0)
  const lastFpsTime = useRef(performance.now())

  useEffect(() => {
    const startTime = performance.now()
    
    return () => {
      const endTime = performance.now()
      const renderTime = endTime - startTime
      
      renderCount.current++
      frameCount.current++
      
      // 计算FPS
      const now = performance.now()
      if (now - lastFpsTime.current >= 1000) {
        const fps = Math.round((frameCount.current * 1000) / (now - lastFpsTime.current))
        setMetrics(prev => ({
          ...prev,
          fps,
          renderTime
        }))
        
        frameCount.current = 0
        lastFpsTime.current = now
      }
      
      // 获取内存使用情况（如果支持）
      if ('memory' in performance) {
        const memory = (performance as any).memory
        setMetrics(prev => ({
          ...prev,
          memoryUsage: Math.round(memory.usedJSHeapSize / 1024 / 1024) // MB
        }))
      }
      
      // 性能警告
      if (renderTime > 16) { // 超过16ms（60fps的阈值）
        console.warn(`${componentName} 渲染时间过长: ${renderTime.toFixed(2)}ms`)
      }
    }
  })

  return metrics
}

// 防抖hook
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

// 节流hook
export function useThrottle<T>(value: T, delay: number): T {
  const [throttledValue, setThrottledValue] = useState<T>(value)
  const lastRun = useRef(Date.now())

  useEffect(() => {
    const handler = setTimeout(() => {
      if (Date.now() - lastRun.current >= delay) {
        setThrottledValue(value)
        lastRun.current = Date.now()
      }
    }, delay - (Date.now() - lastRun.current))

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return throttledValue
}

// 图片懒加载hook
export function useLazyImage(src: string, placeholder?: string) {
  const [imageSrc, setImageSrc] = useState(placeholder || src)
  const [isLoaded, setIsLoaded] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    const img = new Image()
    
    img.onload = () => {
      setImageSrc(src)
      setIsLoaded(true)
      setError(false)
    }
    
    img.onerror = () => {
      setError(true)
      setIsLoaded(false)
    }
    
    img.src = src
    
    return () => {
      img.onload = null
      img.onerror = null
    }
  }, [src])

  return { imageSrc, isLoaded, error }
} 