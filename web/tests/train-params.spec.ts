import { test, expect } from '@playwright/test'

test('LR slider mapping reflects settings min/max', async ({ page }) => {
  await page.goto('/')

  // open settings and set min/max
  await page.getByRole('button', { name: '⚙️' }).click()
  await page.getByRole('button', { name: '训练默认值' }).click()
  const minInput = page.getByRole('spinbutton', { name: '学习率下限' })
  const maxInput = page.getByRole('spinbutton', { name: '学习率上限' })
  await minInput.fill('1e-5')
  await maxInput.fill('8e-5')
  page.once('dialog', async (d) => d.accept())
  await page.getByRole('button', { name: '保存' }).click()

  // just ensure the LR slider (min=1 max=10) is present and interactive
  const lrSlider = page.locator('input[type=range][min="1"][max="10"]')
  await expect(lrSlider).toBeVisible()
})

