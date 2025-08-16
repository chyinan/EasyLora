import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useUI } from '../store'
import Settings from './Settings'
import CaptionEditor from './CaptionEditor'
import { ErrorBoundary } from './ErrorBoundary'

function SettingsButton() {
  const { settingsOpen, set } = useUI()
  return (
    <button className="p-2 rounded-lg hover:bg-gray-100" title="设置" onClick={() => set({ settingsOpen: true })}>
      <img src="/settings.png" alt="设置" className="w-5 h-5" />
    </button>
  )
}

function TopBar() {
  return (
    <div className="h-16 bg-white shadow-soft flex items-center justify-between px-6">
      <div className="flex items-center gap-3">
        <img src="/logo.png" className="w-8 h-8 rounded-lg" alt="logo" />
        <div className="font-extrabold text-2xl">EasyLora</div>
      </div>
             <div className="flex items-center gap-2">
         <button className="p-2 rounded-lg hover:bg-gray-100" title="帮助">
           <img src="/help.png" alt="帮助" className="w-5 h-5" />
         </button>
         <SettingsButton />
       </div>
    </div>
  )
}

function UploadArea() {
  const { dataset, addFiles, removeItem, clearDataset } = useUI()
  const onDrop = useCallback((accepted: File[]) => addFiles(accepted), [addFiles])
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop, accept: { 'image/*': [] } })

  return (
    <div className="card p-6">
      <div
        {...getRootProps()}
        className={`border-2 border-dashed rounded-xl h-72 flex items-center justify-center text-center cursor-pointer ${
          isDragActive ? 'border-brandEnd bg-purple-50' : 'border-gray-200'
        }`}
      >
        <input {...getInputProps()} />
        <div>
          <img src="/upload.png" alt="上传" className="w-16 h-16 mb-3 mx-auto" />
          <div className="font-semibold text-lg">拖拽图片到此处，或点击选择</div>
          <div className="text-gray-500 text-sm mt-1">建议 5-50 张</div>
        </div>
      </div>

      {dataset.length > 0 && (
        <>
          <div className="flex items-center justify-between mt-4">
            <button className="px-4 py-2 bg-gray-100 rounded-xl hover:bg-gray-200" onClick={clearDataset}>
              清空数据
            </button>
            <div className="text-sm text-gray-500">分辨率低于 512px 的图片可能影响效果</div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 mt-4 max-h-64 overflow-auto pr-1">
            {dataset.map((d) => (
              <div key={d.id} className="relative group">
                <img src={d.previewUrl} className="w-full h-28 object-cover rounded-xl" />
                <button
                  className="absolute -top-2 -right-2 bg-white rounded-full shadow-soft w-7 h-7 hidden group-hover:block"
                  onClick={() => removeItem(d.id)}
                  title="删除"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ParamsPanel() {
  const { modelName, baseModel, learningRate, trainSteps, saveEverySteps, autoResume, set, progress, eta, settings } = useUI()
  const [showSavedTip, setShowSavedTip] = useState(false)

  // 检测设置变化并显示保存提示
  const showSaveTip = () => {
    setShowSavedTip(true)
    setTimeout(() => setShowSavedTip(false), 2000)
  }

  return (
    <div className="card p-6 relative">
      {/* 保存提示 */}
      {showSavedTip && (
        <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-2 py-1 rounded-lg shadow-lg animate-pulse z-10">
          ✓ 设置已保存
        </div>
      )}
      
      <div className="mb-3">
        <div className="text-sm mb-1">模型名称</div>
        <input
          className="w-full border rounded-xl px-3 py-2"
          value={modelName}
          onChange={(e) => {
            set({ modelName: e.target.value })
            showSaveTip()
          }}
        />
      </div>

      <div className="mb-3">
        <div className="text-sm mb-1">基底模型</div>
        <select
          className="w-full border rounded-xl px-3 py-2"
          value={baseModel}
          onChange={(e) => {
            set({ baseModel: e.target.value as any })
            showSaveTip()
          }}
        >
          <option value="SD1.5">SD1.5</option>
          <option value="SD2.1">SD2.1</option>
          <option value="SDXL">SDXL</option>
        </select>
      </div>

      <div className="mb-3">
        <div className="text-sm mb-1">学习率：{learningRate}</div>
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={learningRate}
          onChange={(e) => {
            set({ learningRate: Number(e.target.value) })
            showSaveTip()
          }}
          onInput={(e) => {
            const target = e.target as HTMLInputElement
            const progress = ((Number(target.value) - Number(target.min)) / (Number(target.max) - Number(target.min))) * 100
            target.style.setProperty('--range-progress', `${progress}%`)
          }}
          className="w-full"
          style={{
            '--range-progress': `${((learningRate - 1) / (10 - 1)) * 100}%`
          } as React.CSSProperties}
        />
      </div>

      <div className="mb-6">
        <div className="text-sm mb-1">训练步数：{trainSteps}</div>
        <input
          type="range"
          min={500}
          max={4000}
          step={100}
          value={trainSteps}
          onChange={(e) => {
            set({ trainSteps: Number(e.target.value) })
            showSaveTip()
          }}
          onInput={(e) => {
            const target = e.target as HTMLInputElement
            const progress = ((Number(target.value) - Number(target.min)) / (Number(target.max) - Number(target.min))) * 100
            target.style.setProperty('--range-progress', `${progress}%`)
          }}
          className="w-full"
          style={{
            '--range-progress': `${((trainSteps - 500) / (4000 - 500)) * 100}%`
          } as React.CSSProperties}
        />
      </div>

      <div className="mb-4">
        <div className="text-sm mb-1">每 N 步保存（0=关闭）</div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={0}
            step={50}
            className="flex-1 border rounded-xl px-3 py-2"
            value={saveEverySteps}
            onChange={(e) => {
              set({ saveEverySteps: Math.max(0, Number(e.target.value)) })
              showSaveTip()
            }}
          />
          <button
            type="button"
            onClick={() => {
              set({ autoResume: !autoResume })
              showSaveTip()
            }}
            className="flex items-center gap-3 select-none"
            aria-pressed={autoResume}
          >
            <span
              className={
                `inline-flex items-center justify-center w-8 h-8 rounded-lg border-2 transition ` +
                (autoResume
                  ? 'border-transparent shadow-soft'
                  : 'border-gray-300 bg-white hover:border-brandEnd')
              }
            >
              {autoResume && (
                <img src="/yes.png" alt="✓"/>
              )}
            </span>
            <span className="text-base font-medium">断点续训</span>
          </button>
        </div>
      </div>

      <StartTrainingButton />

      <div className="mt-6">
        <div className="h-2 bg-gray-200 rounded-xl overflow-hidden">
          <div className="h-full bg-gradient-to-r from-brandStart to-brandEnd" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
        <ProgressInfo />
      </div>
    </div>
  )
}

function ProcessedImagesPanel() {
  const [processedImages, setProcessedImages] = useState<any[]>([])
  const [selectedImage, setSelectedImage] = useState<any>(null)
  const [loading, setLoading] = useState(false)

  const loadProcessedImages = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/processed-images')
      if (res.ok) {
        const data = await res.json()
        setProcessedImages(data.images || [])
      }
    } catch (error) {
      console.error('加载处理后图片失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const updateCaption = async (filename: string, caption: string) => {
    try {
      const res = await fetch('/api/update-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename, caption })
      })
      
      if (res.ok) {
        const data = await res.json()
        // 更新本地状态
        setProcessedImages(prev => 
          prev.map(img => 
            img.filename === filename 
              ? { ...img, caption: data.caption }
              : img
          )
        )
      } else {
        throw new Error('保存失败')
      }
    } catch (error) {
      throw error
    }
  }

  useEffect(() => {
    loadProcessedImages()
    // 每5秒刷新一次，以防有新处理的图片
    const interval = setInterval(loadProcessedImages, 5000)
    return () => clearInterval(interval)
  }, [])

  if (processedImages.length === 0) {
    return (
      <div className="card p-6 mt-4">
        <div className="text-center text-gray-500">
          {loading ? '正在加载...' : '暂无处理后的图片，请先上传并处理图片'}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="card p-6 mt-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">处理后的图片与标签</h3>
          <button 
            onClick={loadProcessedImages}
            className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
          >
            刷新
          </button>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 max-h-80 overflow-auto">
          {processedImages.map((image) => (
            <div key={image.filename} className="group cursor-pointer" onClick={() => setSelectedImage(image)}>
              <div className="relative">
                <img 
                  src={`http://127.0.0.1:8000${image.path}`}
                  alt={image.filename}
                  className="w-full h-24 object-cover rounded-lg border hover:border-blue-400 transition-colors"
                />
                <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 rounded-lg transition-all flex items-center justify-center">
                  <span className="text-white text-xs opacity-0 group-hover:opacity-100">点击编辑标签</span>
                </div>
              </div>
              <div className="text-xs text-gray-600 mt-1 truncate" title={image.caption}>
                {image.caption || '无标签'}
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {selectedImage && (
        <ErrorBoundary>
          <CaptionEditor
            image={selectedImage}
            onClose={() => setSelectedImage(null)}
            onSave={updateCaption}
          />
        </ErrorBoundary>
      )}
    </>
  )
}

function LogsPanel() {
  const { logs } = useUI()
  return (
    <div className="card p-4 mt-4 min-h-56 max-h-52 overflow-auto text-sm whitespace-pre-wrap break-all w-full max-w-full overflow-x-hidden">{logs.join('\n')}</div>
  )
}

function ProgressInfo() {
  const { progress, eta, stepText } = useUI()
  return (
    <div className="text-sm text-gray-600 mt-1 flex justify-between">
      <span>{stepText}</span>
      <span>时间：{eta}</span>
    </div>
  )
}

function StartTrainingButton() {
  const { dataset, set, resetProgress, addLog, settings, modelName } = useUI()
  const [loading, setLoading] = useState(false)

  const start = async () => {
    setLoading(true)
    resetProgress()
    
    // 检查是否有已处理的图片
    try {
      const processedRes = await fetch('/api/processed-images')
      const processedData = processedRes.ok ? await processedRes.json() : { images: [] }
      const hasProcessedImages = processedData.images && processedData.images.length > 0
      
      if (!hasProcessedImages && !dataset.length) {
        setLoading(false)
        return alert('请先上传图片或确保有已处理的图片')
      }
      
      if (hasProcessedImages) {
        addLog(`检测到 ${processedData.images.length} 张已处理的图片，直接开始训练...`)
      } else {
        addLog('开始上传与训练...')
        // 上传新图片
        const form = new FormData()
        for (const item of dataset) form.append('files', item.file)
        await fetch('/api/upload', { method: 'POST', body: form })
      }
    } catch (error) {
      if (!dataset.length) {
        setLoading(false)
        return alert('无法检查已处理图片，请先上传图片')
      }
      addLog('开始上传与训练...')
      // 上传图片
      const form = new FormData()
      for (const item of dataset) form.append('files', item.file)
      await fetch('/api/upload', { method: 'POST', body: form })
    }

    // 连接 WebSocket 获取实时进度（附带前端设置的参数）
    const qs = new URLSearchParams()
    qs.set('steps', String(useUI.getState().trainSteps))
    {
      const lrMin = settings?.LR_SLIDER_MIN ?? 1e-5
      const lrMax = settings?.LR_SLIDER_MAX ?? 1e-4
      const v = useUI.getState().learningRate
      const mapped = lrMin + (lrMax - lrMin) * ((Math.min(10, Math.max(1, v)) - 1) / 9)
      qs.set('lr', String(mapped))
    }
    if (useUI.getState().saveEverySteps > 0) qs.set('save_every', String(useUI.getState().saveEverySteps))
    if (useUI.getState().autoResume) qs.set('auto_resume', '1')
    // 将模型名称透传给后端（用于默认文件名 {name}_{steps}）
    qs.set('name', modelName || 'model')
    const ws = new WebSocket(`ws://127.0.0.1:8000/ws/train?${qs.toString()}`)
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data)
      if (msg.type === 'log') addLog(msg.data)
      if (msg.type === 'progress') {
        const text = (msg.cur && msg.total) ? `${msg.cur}/${msg.total}` : `${Math.round((msg.p||0)*100)}%`
        set({ progress: msg.p, eta: msg.elapsed ?? msg.eta ?? '--:--', stepText: text })
      }
      if (msg.type === 'done') {
        addLog(`完成：${msg.path}`)
        ws.close()
        setLoading(false)
      }
      if (msg.type === 'error') {
        addLog(`错误：${msg.error}`)
        ws.close()
        setLoading(false)
      }
    }
    ws.onerror = () => {
      addLog('WebSocket 连接失败，请先启动后端 server.py')
      setLoading(false)
    }
  }

  const stop = async () => {
    try {
      await fetch('/api/stop', { method: 'POST' })
      addLog('已发送停止指令，正在终止训练...')
      setLoading(false)
    } catch (e) {
      addLog('停止失败')
    }
  }

  return (
    loading ? (
      <div className="flex gap-3">
        <button className="btn-primary flex-1 text-center text-lg py-3" onClick={start} disabled>
          训练中...
        </button>
        <button className="px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200" onClick={stop}>
          停止
        </button>
      </div>
    ) : (
      <button className="btn-primary w-full text-center text-lg py-3" onClick={start}>
        开始训练
      </button>
    )
  )
}

export default function App() {
  const { settingsOpen, set, setSettings, modelName, stepText } = useUI()
  const [showRestoredTip, setShowRestoredTip] = useState(false)
  const [gpu, setGpu] = useState<string>("--")
  const [cpu, setCpu] = useState<string>("--")
  const [ram, setRam] = useState<number | null>(null)
  const [vram, setVram] = useState<number | null>(null)

  useEffect(() => {
    // 检查是否有恢复的设置
    const savedSettings = localStorage.getItem('easylora-settings')
    if (savedSettings && modelName) {
      setShowRestoredTip(true)
      setTimeout(() => setShowRestoredTip(false), 3000)
    }
  }, [modelName])

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch('/api/settings')
        if (!res.ok) return
        const json = await res.json()
        if (json && typeof json === 'object') {
          setSettings(json)
          // 应用设置中的默认断点续训
          if (typeof json.DEFAULT_AUTO_RESUME === 'boolean') {
            set({ autoResume: json.DEFAULT_AUTO_RESUME })
          }
        }
      } catch (e) {
        // ignore
      }
    })()
  }, [])

  // 周期性拉取系统信息
  useEffect(() => {
    let timer: any
    const tick = async () => {
      try {
        const res = await fetch('/api/system-stats')
        if (res.ok) {
          const data = await res.json()
          if (data) {
            if (typeof data.gpu === 'string') setGpu(data.gpu)
            if (typeof data.cpu === 'string') setCpu(data.cpu)
            if (typeof data.ram_percent === 'number') setRam(data.ram_percent)
            if (typeof data.vram_percent === 'number') setVram(data.vram_percent)
          }
        }
      } catch (e) {
        // ignore
      } finally {
        timer = setTimeout(tick, 3000)
      }
    }
    tick()
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="min-h-screen flex flex-col">
      <TopBar />
      {/* 设置恢复提示 */}
      {showRestoredTip && (
        <div className="bg-blue-50 border-l-4 border-blue-400 p-3 mx-6 mt-4">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <svg className="w-4 h-4 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3 text-sm text-blue-700">✓ 已恢复上次的训练设置</div>
          </div>
        </div>
      )}
      <div className="container mx-auto px-6 pt-6 pb-2 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        <div className="lg:col-span-7 flex flex-col">
          <UploadArea />
          <ProcessedImagesPanel />
        </div>
        <div className="lg:col-span-5 flex flex-col w-full">
          <ParamsPanel />
          <div className="flex-1">
            <LogsPanel />
          </div>
        </div>
      </div>
      <div className="h-12 flex items-center justify-between text-sm text-gray-600 px-6">
        <div>
          <span className="mr-4">GPU：{gpu}</span>
          <span className="mr-4">CPU：{cpu}</span>
          <span className="mr-4">RAM：{ram !== null ? `${ram}%` : '--'}</span>
          <span>VRAM：{vram !== null ? `${vram}%` : '--'}</span>
        </div>
        <div>Step：{stepText}</div>
      </div>
      {settingsOpen && <Settings onClose={() => set({ settingsOpen: false })} />}
    </div>
  )
}

