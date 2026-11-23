// Exercise the mounted React controls without a browser, model, or GPU.
import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import renderer from 'react-test-renderer'
import '../src/i18n'
import StartTrainingButton from '../src/ui/StartTrainingButton'
import Settings from '../src/ui/Settings'
import { useUI } from '../src/store'

const { act, create } = renderer
const originalFetch = globalThis.fetch
const originalWS = globalThis.WebSocket
const initial = useUI.getState()
let view: ReturnType<typeof create> | undefined
const calls: string[] = []
let status: Record<string, unknown>
let settingsPayload: Record<string, unknown>

class Socket {
  static OPEN = 1
  static instances: Socket[] = []
  readyState = Socket.OPEN
  onopen?: () => void
  onmessage?: (message: { data: string }) => void
  onclose?: () => void
  constructor(public url: URL) { Socket.instances.push(this) }
  close() { this.onclose?.() }
  sendEvent(message: object) { this.onmessage?.({ data: JSON.stringify(message) }) }
}
beforeEach(() => {
  useUI.setState(initial)
  status = { status: 'idle' }
  calls.length = 0
  Socket.instances = []
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {location: {href: 'https://lora.example/'} } })
  globalThis.WebSocket = Socket as unknown as typeof WebSocket
  globalThis.fetch = async (url, options) => {
    calls.push(`${options?.method || 'GET'} ${url}`)
    if (url === '/api/training-status') return Response.json(status)
    if (url === '/api/stop') return Response.json({ ok: true })
    if (url === '/api/settings') {
      settingsPayload = JSON.parse(String(options?.body))
      return Response.json({ ok: true, settings: settingsPayload })
    }
    throw Error('Unexpected endpoint: ' + url)
  }
})
afterEach(() => {
  act(() => view?.unmount())
  globalThis.fetch = originalFetch
  globalThis.WebSocket = originalWS
  Reflect.deleteProperty(globalThis, 'window')
})
const button = (name: string) => view!.root.findAllByType('button').find(b => b.children.includes(name))!
const mount = async (element = <StartTrainingButton />) => {
  await act(async () => { view = create(element) })
}
test('selected base, explicit disabled resume/interval and LR reach same-origin training; stop waits for exit', async () => {
  useUI.setState({baseModel:'SD1.5', trainSteps:10, autoResume:false, saveEverySteps:0, optimizerType:'AdamW'})
  await mount()
  act(() => button('开始训练').props.onClick())
  const ws = Socket.instances[0]
  assert.equal(ws.url.origin, 'wss://lora.example')
  assert.equal(ws.url.pathname, '/ws/train')
  for (const [name, value] of Object.entries({base_model:'SD1.5', steps:'10', auto_resume:'0', save_every:'0', optimizer_type:'AdamW'}))
    assert.equal(ws.url.searchParams.get(name), value)
  assert.ok(Math.abs(Number(ws.url.searchParams.get('lr')) - 5e-5) < 1e-12)
  act(() => ws.onopen?.())
  await act(async () => button('停止').props.onClick())
  assert.deepEqual(calls, ['GET /api/training-status', 'POST /api/stop'])
  assert.equal(button('正在停止...').props.disabled, true)
  act(() => ws.sendEvent({type:'cancelled'}))
  assert.equal(button('开始训练').props.disabled, false)
  assert.equal(useUI.getState().stepText, 'Cancelled')
})
test('reload recovers an active job without launching a second; completed result is downloadable', async () => {
  status = {status:'running', progress:{p:0.2, cur:2, total:10, eta:'00:04'}}
  await mount()
  assert.equal(button('训练中...').props.disabled, true)
  assert.equal(useUI.getState().stepText, '2/10')
  status = {status:'completed', path:'out/smoke.safetensors', download_url:'/api/training-output'}
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 1100)) })
  assert.equal(view!.root.findByType('a').props.href, '/api/training-output')
  assert.equal(Socket.instances.length, 0)
})
test('an unexpected socket close recovers terminal status without starting a second job', async () => {
  await mount()
  act(() => button('开始训练').props.onClick())
  status = { status:'failed', error:'test worker exited' }
  await act(async () => { Socket.instances[0].close() })
  assert.equal(button('开始训练').props.disabled, false)
  assert.ok(useUI.getState().logs.join('\n').includes('test worker exited'))
  assert.equal(Socket.instances.length, 1)
})
test('editing a Windows checkpoint path keeps the same input instance and serializes backslashes once', async () => {
  await mount(<Settings onClose={() => {}} />)
  const field = () => view!.root.findByProps({placeholder:'local .safetensors / diffusers dir / HF ID', field:'DEFAULT_MODEL_512'}).findByType('input')
  const before = field()
  const path = 'C:\\Models\\sd15.safetensors'
  for (const value of ['C:', path]) act(() => field().props.onChange({ target: { value } }))
  assert.equal(field(), before)
  await act(async () => button('保存').props.onClick())
  assert.equal(settingsPayload.DEFAULT_MODEL_512, path)
})
test('clear raw uploads deletes backend copies but keeps failed deletions and annotated images', async () => {
  useUI.setState({ dataset: [
    {id:'raw', filename:'new.jpg', previewUrl:'/workspace/raw_uploads/new.jpg', file:null},
    {id:'retry', filename:'retry.jpg', previewUrl:'/workspace/raw_uploads/retry.jpg', file:null},
    {id:'saved', filename:'saved.jpg', previewUrl:'/workspace/processed/dataset/saved.jpg', file:null, isProcessed:true, caption:'猫'},
  ] })
  globalThis.fetch = async (url, options) => {
    const {filename} = JSON.parse(String(options?.body))
    calls.push(`${options?.method} ${url} ${filename}`)
    if (filename === 'retry.jpg') return Response.json({error:'busy'}, {status:409})
    return Response.json({ok:true})
  }
  await useUI.getState().clearDataset()
  assert.deepEqual(calls, ['DELETE /api/delete-raw-image new.jpg', 'DELETE /api/delete-raw-image retry.jpg'])
  assert.deepEqual(useUI.getState().dataset.map(item => item.id), ['retry','saved'])
  assert.ok(useUI.getState().logs.some(line => line.includes('busy')))
})
