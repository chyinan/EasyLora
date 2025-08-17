/**
 * 图片持久化修复测试脚本
 * 用于验证图片在编辑标签后刷新页面不会消失的问题
 */

async function testImagePersistence() {
  console.log('🧪 开始测试图片持久化修复...')
  
  try {
    // 1. 检查后端API是否正常
    console.log('1️⃣ 检查后端API状态...')
    const healthCheck = await fetch('/api/processed-images')
    if (!healthCheck.ok) {
      throw new Error('后端API不可用')
    }
    console.log('✅ 后端API正常')
    
    // 2. 检查工作目录结构
    console.log('2️⃣ 检查工作目录结构...')
    const processedImages = await healthCheck.json()
    console.log('📁 当前已处理图片数量:', processedImages.images?.length || 0)
    
    // 3. 模拟图片处理流程
    console.log('3️⃣ 模拟图片处理流程...')
    
    // 检查是否有新上传的图片
    const datasetItems = window.store?.getState()?.dataset || []
    const unprocessedItems = datasetItems.filter(item => !item.isProcessed)
    
    if (unprocessedItems.length === 0) {
      console.log('⚠️ 没有未处理的图片，请先上传一些图片')
      return
    }
    
    console.log(`📸 发现 ${unprocessedItems.length} 张未处理的图片`)
    
    // 4. 测试标签保存
    console.log('4️⃣ 测试标签保存...')
    const testItem = unprocessedItems[0]
    const testCaption = 'test_persistence, 1girl, beautiful, high quality'
    
    const saveResult = await fetch('/api/update-caption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        filename: testItem.file?.name || testItem.filename, 
        caption: testCaption 
      })
    })
    
    if (!saveResult.ok) {
      throw new Error('保存标签失败: ' + await saveResult.text())
    }
    
    const saveData = await saveResult.json()
    console.log('✅ 标签保存成功:', saveData)
    
    // 5. 等待文件移动完成
    console.log('5️⃣ 等待文件移动完成...')
    await new Promise(resolve => setTimeout(resolve, 1000))
    
    // 6. 检查文件是否已移动到处理目录
    console.log('6️⃣ 检查文件是否已移动到处理目录...')
    const updatedImages = await fetch('/api/processed-images').then(r => r.json())
    const movedImage = updatedImages.images?.find(img => 
      img.filename === (testItem.file?.name || testItem.filename)
    )
    
    if (movedImage) {
      console.log('✅ 图片已成功移动到处理目录:', movedImage)
    } else {
      console.log('❌ 图片未移动到处理目录')
    }
    
    // 7. 模拟页面刷新
    console.log('7️⃣ 模拟页面刷新...')
    const refreshResult = await fetch('/api/processed-images')
    const refreshData = await refreshResult.json()
    
    const stillExists = refreshData.images?.some(img => 
      img.filename === (testItem.file?.name || testItem.filename)
    )
    
    if (stillExists) {
      console.log('✅ 刷新后图片仍然存在 - 修复成功！')
    } else {
      console.log('❌ 刷新后图片消失 - 修复失败')
    }
    
    console.log('🎉 测试完成！')
    
  } catch (error) {
    console.error('❌ 测试失败:', error)
  }
}

// 导出测试函数
window.testImagePersistence = testImagePersistence

console.log('📝 图片持久化测试脚本已加载')
console.log('💡 使用方法: testImagePersistence()') 