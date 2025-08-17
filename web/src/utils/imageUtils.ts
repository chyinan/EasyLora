/**
 * 图片处理工具函数
 * 用于优化预览图片而不影响原始训练数据
 */

// 创建优化的预览图片（仅用于显示，不影响原始文件）
export async function createOptimizedPreview(file: File, maxWidth: number = 300, maxHeight: number = 300): Promise<string> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()
    
    img.onload = () => {
      // 计算缩放比例
      const scale = Math.min(maxWidth / img.width, maxHeight / img.height, 1)
      const newWidth = img.width * scale
      const newHeight = img.height * scale
      
      // 设置canvas尺寸
      canvas.width = newWidth
      canvas.height = newHeight
      
      // 绘制缩放后的图片
      ctx?.drawImage(img, 0, 0, newWidth, newHeight)
      
      // 转换为blob URL
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob)
          resolve(url)
        } else {
          reject(new Error('Failed to create preview'))
        }
      }, 'image/jpeg', 0.8) // 使用JPEG格式，质量0.8
    }
    
    img.onerror = () => reject(new Error('Failed to load image'))
    img.src = URL.createObjectURL(file)
  })
}

// 检查图片尺寸
export function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(img.src)
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = () => {
      URL.revokeObjectURL(img.src)
      reject(new Error('Failed to load image'))
    }
    img.src = URL.createObjectURL(file)
  })
}

// 验证图片是否适合训练
export async function validateImageForTraining(file: File): Promise<{ valid: boolean; warning?: string }> {
  try {
    const dimensions = await getImageDimensions(file)
    
    // 检查分辨率
    if (dimensions.width < 256 || dimensions.height < 256) {
      return {
        valid: true,
        warning: `图片分辨率较低 (${dimensions.width}x${dimensions.height})，可能影响训练效果`
      }
    }
    
    // 检查文件大小
    const maxSize = 50 * 1024 * 1024 // 50MB
    if (file.size > maxSize) {
      return {
        valid: false,
        warning: `文件过大 (${(file.size / 1024 / 1024).toFixed(1)}MB)，建议压缩后使用`
      }
    }
    
    return { valid: true }
  } catch (error) {
    return { valid: false, warning: '无法读取图片信息' }
  }
}

// 清理预览URL
export function cleanupPreviewUrl(url: string): void {
  if (url.startsWith('blob:')) {
    URL.revokeObjectURL(url)
  }
}

// 批量清理预览URL
export function cleanupPreviewUrls(urls: string[]): void {
  urls.forEach(cleanupPreviewUrl)
} 