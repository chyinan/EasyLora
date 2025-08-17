// 测试行间距修复效果
export const testRowSpacing = {
  // 生成测试数据来验证行间距
  generateTestData: (count: number = 50) => {
    return Array.from({ length: count }, (_, index) => ({
      id: `test-${index}`,
      filename: `test-image-${index}.jpg`,
      previewUrl: `https://picsum.photos/120/120?random=${index}`,
      caption: `这是一个很长的测试标签 ${index}，用来测试行间距是否足够显示完整的标签内容而不被遮挡`,
      isProcessed: false
    }))
  },

  // 检查行间距是否足够
  checkRowSpacing: () => {
    const rows = document.querySelectorAll('[data-testid="virtual-row"]')
    let hasOverlap = false
    
    rows.forEach((row, index) => {
      if (index > 0) {
        const prevRow = rows[index - 1]
        const prevRect = prevRow.getBoundingClientRect()
        const currentRect = row.getBoundingClientRect()
        
        // 检查是否有重叠
        if (currentRect.top < prevRect.bottom) {
          hasOverlap = true
          console.warn(`行 ${index} 与行 ${index - 1} 有重叠`)
        }
      }
    })
    
    if (!hasOverlap) {
      console.log('✅ 行间距检查通过，没有重叠')
    } else {
      console.warn('⚠️ 检测到行间距重叠问题')
    }
    
    return !hasOverlap
  },

  // 测量实际行高度
  measureRowHeight: () => {
    const rows = document.querySelectorAll('[data-testid="virtual-row"]')
    const heights: number[] = []
    
    rows.forEach((row) => {
      const rect = row.getBoundingClientRect()
      heights.push(rect.height)
    })
    
    const avgHeight = heights.reduce((a, b) => a + b, 0) / heights.length
    const minHeight = Math.min(...heights)
    const maxHeight = Math.max(...heights)
    
    console.log('行高度统计:')
    console.log(`平均高度: ${avgHeight.toFixed(2)}px`)
    console.log(`最小高度: ${minHeight.toFixed(2)}px`)
    console.log(`最大高度: ${maxHeight.toFixed(2)}px`)
    
    return { avgHeight, minHeight, maxHeight, heights }
  }
}

export default testRowSpacing 