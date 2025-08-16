#!/usr/bin/env python3
"""
自动化测试训练功能
使用Playwright模拟用户操作，测试训练是否能正常开始
"""

import asyncio
import time
from playwright.async_api import async_playwright

async def test_training():
    """测试训练功能"""
    async with async_playwright() as p:
        print("🚀 启动浏览器...")
        browser = await p.chromium.launch(headless=False)  # 可见模式，方便观察
        page = await browser.new_page()
        
        try:
            # 导航到应用
            print("📱 访问 EasyLora 应用...")
            await page.goto("http://localhost:5173")
            await page.wait_for_load_state('networkidle')
            
            # 等待页面加载完成
            print("⏳ 等待页面完全加载...")
            await page.wait_for_selector('[data-testid="start-training"], button:has-text("开始训练")', timeout=10000)
            
            # 检查是否有处理后的图片
            print("🖼️ 检查是否有处理后的图片...")
            processed_images = await page.locator('text=处理后的图片与标签').count()
            if processed_images > 0:
                print("✅ 发现处理后的图片面板")
            
            # 点击开始训练按钮
            print("🎯 点击开始训练按钮...")
            start_button = page.locator('button:has-text("开始训练")')
            await start_button.click()
            
            # 等待训练开始的日志出现
            print("📋 等待训练日志...")
            await page.wait_for_timeout(2000)  # 等待2秒让日志加载
            
            # 检查是否有训练日志
            logs_found = False
            for i in range(30):  # 最多等待30秒
                logs = await page.locator('.whitespace-pre-wrap').text_content()
                if logs and ("检测到" in logs or "开始训练" in logs or "INFO" in logs):
                    print(f"📝 发现训练日志: {logs[:100]}...")
                    logs_found = True
                    break
                await page.wait_for_timeout(1000)
                print(f"⏳ 等待训练日志... ({i+1}/30)")
            
            if not logs_found:
                print("❌ 未发现训练日志")
                return False
            
            # 等待更多日志，检查是否有错误
            print("🔍 检查训练状态...")
            for i in range(60):  # 最多等待60秒
                logs = await page.locator('.whitespace-pre-wrap').text_content()
                
                # 检查成功指标
                if any(keyword in logs for keyword in [
                    "prepare optimizer",
                    "epoch",
                    "step",
                    "loss",
                    "learning_rate",
                    "preparing accelerator"
                ]):
                    print("🎉 训练成功开始！发现训练进度日志")
                    print(f"📊 最新日志: {logs[-200:]}")
                    return True
                
                # 检查错误指标
                if any(keyword in logs for keyword in [
                    "错误",
                    "失败",
                    "Error:",
                    "Traceback",
                    "ImportError",
                    "ModuleNotFoundError",
                    "RuntimeError",
                    "退出码"
                ]):
                    print("❌ 训练出现错误:")
                    print(f"💥 错误日志: {logs[-500:]}")
                    return False
                
                await page.wait_for_timeout(1000)
                if i % 10 == 0:
                    print(f"⏳ 继续监控训练状态... ({i+1}/60)")
            
            print("⚠️ 训练状态不明确，可能仍在初始化中")
            final_logs = await page.locator('.whitespace-pre-wrap').text_content()
            print(f"📋 最终日志: {final_logs[-300:]}")
            return False
            
        except Exception as e:
            print(f"❌ 测试过程中发生错误: {e}")
            return False
        finally:
            print("🔄 保持浏览器开启5秒以供观察...")
            await page.wait_for_timeout(5000)
            await browser.close()

async def main():
    """主函数"""
    print("🧪 开始自动化训练测试...")
    print("=" * 50)
    
    success = await test_training()
    
    print("=" * 50)
    if success:
        print("🎉 测试成功！训练正常开始")
        print("✅ EasyLora 训练功能工作正常")
    else:
        print("❌ 测试失败！训练未能正常开始")
        print("🔧 需要进一步调试和修复")
    
    return success

if __name__ == "__main__":
    result = asyncio.run(main())
    exit(0 if result else 1)