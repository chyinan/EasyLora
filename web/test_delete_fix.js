// 测试删除图片功能是否正常工作的脚本
console.log('测试删除图片功能...');

// 测试后端删除API
async function testDeleteAPI() {
  try {
    console.log('测试删除API...');
    
    // 模拟删除请求
    const response = await fetch('http://127.0.0.1:8000/api/delete-image', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: 'test_image.jpg' })
    });
    
    if (response.ok) {
      console.log('✓ 删除API正常工作');
    } else {
      console.log('✗ 删除API返回错误:', response.status);
    }
  } catch (error) {
    console.log('✗ 删除API测试失败:', error.message);
  }
}

// 测试获取处理后图片API
async function testGetProcessedImages() {
  try {
    console.log('测试获取处理后图片API...');
    
    const response = await fetch('http://127.0.0.1:8000/api/processed-images');
    
    if (response.ok) {
      const data = await response.json();
      console.log('✓ 获取处理后图片API正常工作，当前有', data.images?.length || 0, '张图片');
    } else {
      console.log('✗ 获取处理后图片API返回错误:', response.status);
    }
  } catch (error) {
    console.log('✗ 获取处理后图片API测试失败:', error.message);
  }
}

// 运行测试
async function runTests() {
  console.log('开始测试...');
  
  // 等待后端启动
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  await testGetProcessedImages();
  await testDeleteAPI();
  
  console.log('测试完成！');
}

// 如果直接在浏览器中运行
if (typeof window !== 'undefined') {
  window.testDeleteFix = runTests;
  console.log('测试函数已加载，可以在控制台中运行 testDeleteFix() 来测试');
} else {
  // 如果在Node.js环境中运行
  runTests();
} 