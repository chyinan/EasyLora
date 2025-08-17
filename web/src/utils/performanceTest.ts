// 性能测试工具
export const performanceTest = {
  // 生成测试图片数据
  generateTestImages: (count: number) => {
    return Array.from({ length: count }, (_, index) => ({
      id: `test-${index}`,
      filename: `test-image-${index}.jpg`,
      previewUrl: `https://picsum.photos/120/120?random=${index}`,
      caption: `测试图片 ${index}`,
      isProcessed: false
    }))
  },

  // 测量渲染性能
  measureRenderPerformance: (callback: () => void, iterations: number = 10) => {
    const times: number[] = []
    
    for (let i = 0; i < iterations; i++) {
      const start = performance.now()
      callback()
      const end = performance.now()
      times.push(end - start)
    }
    
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const min = Math.min(...times)
    const max = Math.max(...times)
    
    console.log(`性能测试结果 (${iterations}次迭代):`)
    console.log(`平均时间: ${avg.toFixed(2)}ms`)
    console.log(`最短时间: ${min.toFixed(2)}ms`)
    console.log(`最长时间: ${max.toFixed(2)}ms`)
    
    return { avg, min, max, times }
  },

  // 测量内存使用
  measureMemoryUsage: () => {
    if ('memory' in performance) {
      const memory = (performance as any).memory
      console.log('内存使用情况:')
      console.log(`已用堆内存: ${(memory.usedJSHeapSize / 1024 / 1024).toFixed(2)}MB`)
      console.log(`总堆内存: ${(memory.totalJSHeapSize / 1024 / 1024).toFixed(2)}MB`)
      console.log(`堆内存限制: ${(memory.jsHeapSizeLimit / 1024 / 1024).toFixed(2)}MB`)
      return memory
    } else {
      console.log('当前浏览器不支持内存监控')
      return null
    }
  },

  // 测试滚动性能
  testScrollPerformance: (container: HTMLElement, scrollDistance: number = 1000) => {
    const start = performance.now()
    
    return new Promise<void>((resolve) => {
      let currentScroll = 0
      const step = 10
      
      const scrollStep = () => {
        currentScroll += step
        container.scrollTop = currentScroll
        
        if (currentScroll < scrollDistance) {
          requestAnimationFrame(scrollStep)
        } else {
          const end = performance.now()
          console.log(`滚动性能测试: ${(end - start).toFixed(2)}ms`)
          resolve()
        }
      }
      
      requestAnimationFrame(scrollStep)
    })
  }
}

// 导出默认对象
export default performanceTest 