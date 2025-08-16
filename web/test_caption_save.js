import { chromium } from 'playwright';

(async () => {
  console.log('🧪 测试标签保存功能...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('📱 访问 EasyLora 应用...');
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    console.log('⏳ 等待处理后图片面板加载...');
    await page.waitForSelector('text=处理后的图片与标签', { timeout: 10000 });
    
    console.log('🖼️ 寻找第一张图片...');
    const firstImage = page.locator('.group.cursor-pointer').first();
    await firstImage.waitFor();
    
    // 获取第一张图片的当前标签
    const currentCaption = await firstImage.locator('.text-xs.text-gray-600').textContent();
    console.log('📝 当前标签:', currentCaption);
    
    console.log('🎯 点击第一张图片打开编辑器...');
    await firstImage.click();
    
    console.log('⏳ 等待标签编辑器打开...');
    await page.waitForSelector('text=编辑图片标签', { timeout: 5000 });
    
    // 修改标签
    const testCaption = 'shinkai_style, TEST_SAVE_FUNCTION, 1girl, beautiful, test_tag';
    console.log('✏️ 修改标签为:', testCaption);
    
    const textarea = page.locator('textarea');
    await textarea.fill(testCaption);
    
    console.log('💾 点击保存按钮...');
    await page.click('button:has-text("保存标签")');
    
    // 等待保存完成
    await page.waitForTimeout(2000);
    
    console.log('🔍 验证标签是否保存成功...');
    
    // 重新点击图片查看标签
    await page.waitForTimeout(1000);
    await firstImage.click();
    await page.waitForSelector('textarea');
    
    const savedCaption = await page.locator('textarea').inputValue();
    console.log('📋 保存后的标签:', savedCaption);
    
    if (savedCaption.includes('TEST_SAVE_FUNCTION')) {
      console.log('✅ 标签保存成功！前端显示正确');
    } else {
      console.log('❌ 标签保存失败！前端显示不正确');
    }
    
    // 关闭编辑器并检查文件
    await page.click('button:has-text("取消")');
    await page.waitForTimeout(1000);
    
    console.log('📁 现在检查文件系统中的标签文件...');
    
    await browser.close();
    
  } catch (error) {
    console.log('❌ 测试过程中发生错误:', error.message);
    await browser.close();
  }
})();