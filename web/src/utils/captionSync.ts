/**
 * 标签同步工具函数
 * 用于检测和同步已存在的标签文件
 */

export interface ProcessedImage {
  filename: string
  path: string
  caption: string
}

// 检测已存在的标签文件
export async function checkExistingCaptions(): Promise<ProcessedImage[]> {
  try {
    const res = await fetch('/api/processed-images')
    if (res.ok) {
      const data = await res.json()
      return data.images || []
    }
    return []
  } catch (error) {
    console.error('检查已存在标签失败:', error)
    return []
  }
}

// 同步标签到本地状态
export function syncCaptionsToLocal(existingImages: ProcessedImage[], dataset: any[]) {
  const syncedItems = []
  
  for (const existingImage of existingImages) {
    // 检查是否已经在dataset中
    const existingItem = dataset.find(item => 
      item.file && item.file.name === existingImage.filename
    )
    
    if (existingItem) {
      // 如果已存在，更新标签和状态
      existingItem.caption = existingImage.caption
      existingItem.isProcessed = true
      syncedItems.push(existingItem)
    } else {
      // 如果不存在，创建一个虚拟的item用于显示
      syncedItems.push({
        id: `existing-${existingImage.filename}`,
        filename: existingImage.filename,
        path: existingImage.path,
        caption: existingImage.caption,
        isProcessed: true,
        isExisting: true // 标记为已存在的文件
      })
    }
  }
  
  return syncedItems
}

// 获取图片文件名（不含扩展名）
export function getImageNameWithoutExt(filename: string): string {
  return filename.replace(/\.[^/.]+$/, '')
}

// 检查标签文件是否存在
export function hasCaptionFile(filename: string, existingImages: ProcessedImage[]): boolean {
  const nameWithoutExt = getImageNameWithoutExt(filename)
  return existingImages.some(img => 
    getImageNameWithoutExt(img.filename) === nameWithoutExt
  )
} 