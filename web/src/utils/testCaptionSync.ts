/**
 * 标签同步功能测试
 */

import { checkExistingCaptions, syncCaptionsToLocal } from './captionSync'

// 测试检查已存在标签
export async function testCheckExistingCaptions() {
  console.log('测试检查已存在标签...')
  try {
    const existingImages = await checkExistingCaptions()
    console.log('已存在的标签文件:', existingImages)
    return existingImages
  } catch (error) {
    console.error('测试失败:', error)
    return []
  }
}

// 测试同步标签到本地
export function testSyncCaptionsToLocal(existingImages: any[], dataset: any[]) {
  console.log('测试同步标签到本地...')
  try {
    const syncedItems = syncCaptionsToLocal(existingImages, dataset)
    console.log('同步后的项目:', syncedItems)
    return syncedItems
  } catch (error) {
    console.error('测试失败:', error)
    return []
  }
}

// 运行所有测试
export async function runAllTests() {
  console.log('开始运行标签同步测试...')
  
  const existingImages = await testCheckExistingCaptions()
  const mockDataset = [
    { id: '1', file: { name: 'test1.jpg' }, previewUrl: 'blob:test1' },
    { id: '2', file: { name: 'test2.jpg' }, previewUrl: 'blob:test2' }
  ]
  
  testSyncCaptionsToLocal(existingImages, mockDataset)
  
  console.log('测试完成')
} 