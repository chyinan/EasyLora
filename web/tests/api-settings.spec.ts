import { test, expect } from '@playwright/test'

test('GET/POST /api/settings returns and persists', async ({ request }) => {
  const base = 'http://localhost:5173'

  // GET merged settings through the dev server proxy
  const r1 = await request.get(base + '/api/settings')
  expect(r1.ok()).toBeTruthy()
  const s1 = await r1.json()
  expect(s1).toHaveProperty('DEFAULT_OUTPUT_DIR')
  expect(s1).toHaveProperty('LR_SLIDER_MIN')

  // POST update
  const newPattern = 'auto_test_{date}_{steps}.safetensors'
  const r2 = await request.post(base + '/api/settings', { data: { OUTPUT_LORA_FILENAME: newPattern } })
  expect(r2.ok()).toBeTruthy()
  const s2 = await r2.json()
  expect(s2.ok).toBeTruthy()
  expect(s2).toHaveProperty('settings')
  expect(s2.settings.OUTPUT_LORA_FILENAME).toBe(newPattern)

  // verify persisted
  const r3 = await request.get(base + '/api/settings')
  const s3 = await r3.json()
  expect(s3.OUTPUT_LORA_FILENAME).toBe(newPattern)
})

