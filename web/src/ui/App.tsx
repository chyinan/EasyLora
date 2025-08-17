import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDropzone } from 'react-dropzone'
import { useUI } from '../store'
import Settings from './Settings'
import CaptionEditor from './CaptionEditor'
import { ErrorBoundary } from './ErrorBoundary'
import DraggableImageGrid from './DraggableImageGrid'
import VirtualImageGrid from './VirtualImageGrid'
import LazyImage from './LazyImage'
import SortOptions, { SortOption } from './SortOptions'

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

// 优化的上传区域组件
function UploadArea() {
  const { dataset, addFiles, removeItem, clearDataset, updateItemCaption, markItemAsProcessed, syncExistingCaptions, reorderDataset, sortOption, setSortOption } = useUI()
  const [selectedImage, setSelectedImage] = useState<any>(null)
  const [showSuccessTip, setShowSuccessTip] = useState(false)
  
  // 组件加载时同步已存在的标签和raw_uploads中的图片
  useEffect(() => {
    syncExistingCaptions()
    // 加载raw_uploads中未处理的图片
    const { loadRawUploads } = useUI.getState()
    loadRawUploads()
  }, [syncExistingCaptions])

  // 组件卸载时清理预览URL
  useEffect(() => {
    return () => {
      // 组件卸载时不需要清理，因为store中的清理逻辑已经处理了
    }
  }, [])

  const onDrop = useCallback(async (accepted: File[]) => {
    // 文件大小和类型验证
    const validFiles = accepted.filter(file => {
      // 检查文件类型
      if (!file.type.startsWith('image/')) {
        console.warn(`跳过非图片文件: ${file.name}`)
        return false
      }
      
      // 检查文件大小 (限制为50MB)
      const maxSize = 50 * 1024 * 1024 // 50MB
      if (file.size > maxSize) {
        console.warn(`文件过大，跳过: ${file.name} (${(file.size / 1024 / 1024).toFixed(1)}MB)`)
        return false
      }
      
      return true
    })
    
    if (validFiles.length !== accepted.length) {
      alert(`已跳过 ${accepted.length - validFiles.length} 个无效文件`)
    }
    
    await addFiles(validFiles)
    
    // 添加文件后同步已存在的标签
    setTimeout(() => {
      syncExistingCaptions()
    }, 100)
  }, [addFiles, syncExistingCaptions])

  const { getRootProps, getInputProps, isDragActive } = useDropzone({ 
    onDrop, 
    accept: { 'image/*': [] },
    maxSize: 50 * 1024 * 1024, // 50MB
    multiple: true
  })

  const handleImageClick = (image: any) => {
    setSelectedImage(image)
  }

  const handleReorder = (newOrder: any[]) => {
    reorderDataset(newOrder)
  }

  const handleSortChange = (option: SortOption) => {
    setSortOption(option)
  }

  const handleResetOrder = () => {
    setSortOption('custom')
  }

  const handleSaveCaption = async (filename: string, caption: string) => {
    try {
      // 获取当前设置，决定是否自动添加模型名称前缀
      const { settings, modelName } = useUI.getState()
      const autoAddPrefix = settings?.AUTO_ADD_MODEL_NAME_PREFIX
      
      let finalCaption = caption
      if (autoAddPrefix && modelName && modelName.trim()) {
        // 如果开启了自动添加前缀，且用户输入的标签不以模型名称开头，则自动添加
        const modelNameTrimmed = modelName.trim()
        if (!finalCaption.trim().startsWith(modelNameTrimmed)) {
          finalCaption = `${modelNameTrimmed}, ${finalCaption.trim()}`
        }
      }
      
      const res = await fetch('/api/update-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          filename, 
          caption: finalCaption,
          autoAddPrefix: autoAddPrefix || false,
          modelName: modelName || ''
        })
      })
      
      if (res.ok) {
        // 更新本地状态
        if (selectedImage.id) {
          updateItemCaption(selectedImage.id, finalCaption)
          markItemAsProcessed(selectedImage.id)
        }
        
        // 保存成功后关闭编辑器
        setSelectedImage(null)
        // 显示成功提示
        setShowSuccessTip(true)
        setTimeout(() => setShowSuccessTip(false), 3000)
      } else {
        throw new Error('保存失败')
      }
    } catch (error) {
      throw error
    }
  }

  return (
    <div className="card p-6 relative">
      {/* 成功提示 */}
      {showSuccessTip && (
        <div className="absolute top-2 right-2 bg-green-500 text-white text-xs px-3 py-2 rounded-lg shadow-lg z-20">
          ✓ 标签保存成功，图片已移至处理区域
        </div>
      )}
      
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
          <div className="text-gray-500 text-sm mt-1">建议 5-50 张，单文件最大 50MB</div>
        </div>
      </div>

      {dataset.length > 0 && (
        <>
                     <div className="flex items-center justify-between mt-4">
             <button className="px-4 py-2 bg-gray-100 rounded-xl hover:bg-gray-200" onClick={clearDataset}>
               清空数据
             </button>
             <div className="flex items-center gap-4">
               <div className="text-sm text-gray-500">
                 <span className="mr-2">分辨率低于 512px 的图片可能影响效果</span>
                 <span className="text-blue-500">拖拽可调整顺序</span>
               </div>
               <SortOptions
                 currentSort={sortOption}
                 onSortChange={handleSortChange}
                 onResetOrder={handleResetOrder}
               />
             </div>
           </div>
                                           <VirtualImageGrid
                        images={dataset.filter(d => !d.isProcessed)}
                        onImageClick={handleImageClick}
                        onRemove={removeItem}
                        onReorder={handleReorder}
                        className="mt-4 max-h-64 pr-1"
                        itemHeight={120}
                        renderImage={(d) => (
                          <div className="relative">
                            <LazyImage 
                              src={d.previewUrl} 
                              className="w-full h-28 rounded-xl"
                              loading="lazy"
                              alt={d.file?.name || d.filename || 'unknown'}
                            />
                            <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 rounded-xl transition-all flex items-center justify-center">
                              <span className="text-white text-xs opacity-0 group-hover:opacity-100">点击编辑标签</span>
                            </div>
                            {d.caption && (
                              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs p-1 rounded-b-xl truncate">
                                {d.caption}
                              </div>
                            )}
                          </div>
                        )}
                      />
        </>
      )}

      {/* 标签编辑器 */}
      {selectedImage && (
        <ErrorBoundary>
          <CaptionEditor
            image={selectedImage}
            onClose={() => setSelectedImage(null)}
            onSave={handleSaveCaption}
          />
        </ErrorBoundary>
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
  const { dataset, reorderDataset, removeItem } = useUI()
  const [selectedImage, setSelectedImage] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [existingProcessedImages, setExistingProcessedImages] = useState<any[]>([])

  // 过滤出已处理的图片
  const processedImages = dataset.filter(item => item.isProcessed)

  // 加载已存在的处理后图片
  const loadExistingProcessedImages = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/processed-images')
      if (res.ok) {
        const data = await res.json()
        // 为每个图片添加唯一的id字段
        const imagesWithId = (data.images || []).map((img: any, index: number) => ({
          ...img,
          id: `existing-${img.filename}-${index}`,
          isExisting: true
        }))
        setExistingProcessedImages(imagesWithId)
      }
    } catch (error) {
      console.error('加载处理后图片失败:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadExistingProcessedImages()
  }, [])

  const updateCaption = async (filename: string, caption: string) => {
    try {
      console.log('更新已处理图片标签:', { filename, caption })
      
      // 获取当前设置，决定是否自动添加模型名称前缀
      const { settings, modelName } = useUI.getState()
      const autoAddPrefix = settings?.AUTO_ADD_MODEL_NAME_PREFIX
      
      let finalCaption = caption
      if (autoAddPrefix && modelName && modelName.trim()) {
        // 如果开启了自动添加前缀，且用户输入的标签不以模型名称开头，则自动添加
        const modelNameTrimmed = modelName.trim()
        if (!finalCaption.trim().startsWith(modelNameTrimmed)) {
          finalCaption = `${modelNameTrimmed}, ${finalCaption.trim()}`
        }
      }
      
      // 对于已处理的图片，直接更新标签文件，不移动文件
      const res = await fetch('/api/update-caption', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          filename, 
          caption: finalCaption,
          isProcessed: true,  // 标记这是已处理的图片
          autoAddPrefix: autoAddPrefix || false,
          modelName: modelName || ''
        })
      })
      
      console.log('API响应状态:', res.status)
      
      if (res.ok) {
        const data = await res.json()
        console.log('API响应数据:', data)
        
        // 更新本地状态
        setExistingProcessedImages(prev => 
          prev.map(img => 
            img.filename === filename 
              ? { ...img, caption: data.caption || finalCaption }
              : img
          )
        )
      } else {
        const errorText = await res.text()
        console.error('API错误响应:', errorText)
        throw new Error(`保存失败: ${res.status} - ${errorText}`)
      }
    } catch (error) {
      console.error('更新标签时发生错误:', error)
      throw error
    }
  }

  const handleReorder = (newOrder: any[]) => {
    // 分离新处理的图片和已存在的图片
    const newProcessedItems = newOrder.filter(item => !item.isExisting)
    const existingItems = newOrder.filter(item => item.isExisting)
    
    // 更新dataset中的已处理图片顺序
    if (newProcessedItems.length > 0) {
      const unprocessedItems = dataset.filter(item => !item.isProcessed)
      reorderDataset([...unprocessedItems, ...newProcessedItems])
    }
    
    // 更新已存在图片的顺序
    setExistingProcessedImages(existingItems)
  }

  // 合并新处理的图片和已存在的图片，避免重复，只显示有真正标签的图片
  const allProcessedImages = useMemo(() => {
    const processedIds = new Set(processedImages.map(img => img.id))
    const existingWithoutDuplicates = existingProcessedImages.filter(img => !processedIds.has(img.id))
    
    // 为新处理的图片添加必要的属性，确保能正确显示
    const enhancedProcessedImages = processedImages.map(img => ({
      ...img,
      filename: img.file ? img.file.name : img.filename,
      path: img.path || `/workspace/processed/dataset/${img.file ? img.file.name : img.filename}`,
      previewUrl: img.previewUrl || `/workspace/processed/dataset/${img.file ? img.file.name : img.filename}`
    }))
    
    // 确保已存在的图片也有正确的filename字段
    const enhancedExistingImages = existingWithoutDuplicates.map(img => ({
      ...img,
      filename: img.filename || 'unknown'  // 确保filename字段存在
    }))
    
    // 只返回有真正标签内容的图片（排除只有默认序号的图片）
    const allImages = [...enhancedProcessedImages, ...enhancedExistingImages]
    return allImages.filter(img => {
      if (!img.caption || img.caption.trim() === '') return false
      
      const caption = img.caption.trim()
      // 检查是否是默认的序号标签（只包含文件名，没有逗号分隔的标签）
      if (caption.includes(',') && caption.length > 20) {
        // 有真正的标签内容（包含逗号且长度足够）
        return true
      } else if (!caption.startsWith('img_') && caption.length > 10) {
        // 不是默认序号且长度足够
        return true
      }
      return false
    })
  }, [processedImages, existingProcessedImages])

  if (allProcessedImages.length === 0) {
    return (
      <div className="card p-6 mt-4">
        <div className="text-center text-gray-500">
          {loading ? '正在加载...' : '暂无处理后的图片，请先在上方上传并编辑标签'}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="card p-6 mt-4">
                 <div className="flex items-center justify-between mb-4">
           <h3 className="font-semibold">处理后的图片与标签 ({allProcessedImages.length})</h3>
           <div className="flex items-center gap-2">
             <span className="text-xs text-blue-500">拖拽可调整顺序</span>
             <button 
               onClick={loadExistingProcessedImages}
               className="px-3 py-1 text-sm bg-gray-100 rounded hover:bg-gray-200"
             >
               刷新
             </button>
           </div>
         </div>
        
                                   <VirtualImageGrid
                    images={allProcessedImages}
                    onImageClick={setSelectedImage}
                    onRemove={async (id) => {
                      const image = allProcessedImages.find(img => img.id === id)
                      if (image) {
                        // 立即从UI中移除，提升响应速度
                        if (image.isExisting) {
                          // 立即更新UI
                          setExistingProcessedImages(prev => prev.filter(img => img.id !== id))
                          
                          // 在后台异步删除文件
                          setTimeout(async () => {
                            try {
                              const res = await fetch('/api/delete-image', {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ filename: image.filename })
                              })
                              
                              if (!res.ok) {
                                console.error('删除图片失败:', await res.text())
                                // 如果删除失败，可以考虑重新添加到UI中
                              }
                            } catch (error) {
                              console.error('删除图片时发生错误:', error)
                            }
                          }, 0)
                        } else {
                          // 对于新处理的图片，使用store的removeItem
                          removeItem(id)
                        }
                      }
                    }}
                    onReorder={handleReorder}
                    className="max-h-80"
                    itemHeight={100}
                                          renderImage={(image) => (
                        <div className="relative">
                          <LazyImage 
                            src={image.previewUrl || `http://127.0.0.1:8000${image.path}`}
                            alt={image.file?.name || image.filename}
                            className="w-full h-24 rounded-lg border hover:border-blue-400 transition-colors"
                            loading="lazy"
                          />
                          <div className="absolute inset-0 bg-black bg-opacity-0 group-hover:bg-opacity-20 rounded-lg transition-all flex items-center justify-center">
                            <span className="text-white text-xs opacity-0 group-hover:opacity-100">点击编辑标签</span>
                          </div>
                          <div className="text-xs text-gray-600 mt-2 mb-1 truncate" title={image.caption}>
                            {image.caption || '无标签'}
                          </div>
                        </div>
                      )}
                  />
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

