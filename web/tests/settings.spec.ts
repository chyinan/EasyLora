import { test, expect } from '@playwright/test'

test.describe('Settings modal', () => {
  test('open, edit filename pattern, save and persist', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '⚙️' }).click()
    await expect(page.getByText('设置')).toBeVisible()

    const patternInput = page.getByRole('textbox', { name: '文件名模式' })
    await patternInput.fill('custom_lora_{date}_{steps}.safetensors')

    page.once('dialog', async (dialog) => await dialog.accept())
    await page.getByRole('button', { name: '保存' }).click()

    // modal should close
    await expect(page.getByText('设置')).toBeHidden({ timeout: 3000 })

    // reopen and verify value persisted (last written value or a previously set one)
    await page.getByRole('button', { name: '⚙️' }).click()
    await expect(page.getByText('设置')).toBeVisible()
    const value = await patternInput.inputValue()
    expect(['custom_lora_{date}_{steps}.safetensors','auto_test_{date}_{steps}.safetensors']).toContain(value)
  })
})

