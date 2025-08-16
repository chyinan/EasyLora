import { chromium } from 'playwright';

(async () => {
  console.log('🚀 启动浏览器...');
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  try {
    console.log('📱 访问 EasyLora 应用...');
    await page.goto('http://localhost:5173');
    await page.waitForLoadState('networkidle');
    
    console.log('⏳ 等待页面完全加载...');
    await page.waitForSelector('button:has-text("开始训练")', { timeout: 10000 });
    
    console.log('🎯 点击开始训练按钮...');
    await page.click('button:has-text("开始训练")');
    
    console.log('📋 等待训练日志...');
    await page.waitForTimeout(3000);
    
    // 检查日志内容
    for (let i = 0; i < 30; i++) {
      const logs = await page.textContent('.whitespace-pre-wrap');
      if (logs && (logs.includes('检测到') || logs.includes('INFO') || logs.includes('prepare'))) {
        console.log('📝 发现训练日志:', logs.substring(0, 200) + '...');
        
        // 继续等待，检查是否成功开始训练
        for (let j = 0; j < 60; j++) {
          const currentLogs = await page.textContent('.whitespace-pre-wrap');
          
          if (currentLogs.includes('prepare optimizer') || 
              currentLogs.includes('epoch 1/') || 
              currentLogs.includes('steps/') ||
              currentLogs.includes('loss:') ||
              currentLogs.includes('lr:')) {
            console.log('🎉 训练成功开始！');
            console.log('✅ EasyLora 训练功能工作正常');
            await page.waitForTimeout(5000);
            await browser.close();
            process.exit(0);
          }
          
          if (currentLogs.includes('错误') || 
              currentLogs.includes('失败') || 
              currentLogs.includes('Traceback') ||
              currentLogs.includes('退出码')) {
            console.log('❌ 训练出现错误:');
            console.log(currentLogs.substring(Math.max(0, currentLogs.length - 500)));
            await browser.close();
            process.exit(1);
          }
          
          await page.waitForTimeout(1000);
          if (j % 10 === 0) console.log(`⏳ 监控训练状态... (${j+1}/60)`);
        }
        break;
      }
      await page.waitForTimeout(1000);
      console.log(`⏳ 等待训练日志... (${i+1}/30)`);
    }
    
    console.log('⚠️ 未能确认训练状态');
    await browser.close();
    process.exit(1);
    
  } catch (error) {
    console.log('❌ 测试过程中发生错误:', error.message);
    await browser.close();
    process.exit(1);
  }
})();