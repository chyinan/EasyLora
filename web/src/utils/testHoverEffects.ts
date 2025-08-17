// 测试悬停效果
export const testHoverEffects = {
  // 检查删除按钮的悬停效果
  checkDeleteButtonHover: () => {
    const deleteButtons = document.querySelectorAll('button[title="删除"]')
    console.log(`找到 ${deleteButtons.length} 个删除按钮`)
    
    deleteButtons.forEach((button, index) => {
      const computedStyle = window.getComputedStyle(button)
      const opacity = computedStyle.opacity
      console.log(`删除按钮 ${index + 1}: opacity = ${opacity}`)
      
      // 检查是否有正确的类名
      const hasOpacityClasses = button.classList.contains('opacity-0') && 
                               button.classList.contains('group-hover:opacity-100')
      
      if (hasOpacityClasses) {
        console.log(`✅ 删除按钮 ${index + 1} 有正确的悬停效果类名`)
      } else {
        console.warn(`⚠️ 删除按钮 ${index + 1} 缺少悬停效果类名`)
      }
    })
  },

  // 检查图片容器是否有group类名
  checkGroupClasses: () => {
    const imageContainers = document.querySelectorAll('.group')
    console.log(`找到 ${imageContainers.length} 个带有group类名的容器`)
    
    imageContainers.forEach((container, index) => {
      const hasRelative = container.classList.contains('relative')
      const hasGroup = container.classList.contains('group')
      
      if (hasRelative && hasGroup) {
        console.log(`✅ 容器 ${index + 1} 有正确的类名组合`)
      } else {
        console.warn(`⚠️ 容器 ${index + 1} 缺少必要的类名`)
      }
    })
  },

  // 模拟悬停效果测试
  simulateHover: () => {
    const imageContainers = document.querySelectorAll('.group')
    
    imageContainers.forEach((container, index) => {
      // 模拟鼠标进入
      container.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }))
      
      setTimeout(() => {
        const deleteButton = container.querySelector('button[title="删除"]')
        if (deleteButton) {
          const computedStyle = window.getComputedStyle(deleteButton)
          const opacity = computedStyle.opacity
          console.log(`容器 ${index + 1} 悬停时删除按钮透明度: ${opacity}`)
        }
        
        // 模拟鼠标离开
        container.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }))
        
        setTimeout(() => {
          const deleteButton = container.querySelector('button[title="删除"]')
          if (deleteButton) {
            const computedStyle = window.getComputedStyle(deleteButton)
            const opacity = computedStyle.opacity
            console.log(`容器 ${index + 1} 离开时删除按钮透明度: ${opacity}`)
          }
        }, 100)
      }, 100)
    })
  }
}

export default testHoverEffects 