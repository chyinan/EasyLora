import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { validateImageForTraining, cleanupPreviewUrl } from './utils/imageCache'
import { checkExistingCaptions, syncCaptionsToLocal } from './utils/captionSync'
import { SortOption, sortImages } from './ui/SortOptions'

export type BaseModel = 'SD1.5' | 'SD2.1' | 'SDXL'

export interface DatasetItem {
  id: string
  file: File | null
  filename?: string
  path?: string
  previewUrl: string
  caption?: string
  isProcessed?: boolean
  isRaw?: boolean
}

interface UIState {
  modelName: string
  baseModel: BaseModel
  learningRate: number
  trainSteps: number
  saveEverySteps: number
  autoResume: boolean
  optimizerType: string
  unetLr: number
  textEncoderLr: number
  uploading: boolean
  progress: number
  eta: string
  stepText: string
  logs: string[]
  dataset: DatasetItem[]
  settingsOpen: boolean
  settings: any | null
  sortOption: SortOption

  set: (partial: Partial<UIState>) => void
  addLog: (line: string) => void
  addFiles: (files: File[]) => void
  removeItem: (id: string) => void
  clearDataset: () => void
  resetProgress: () => void
  setSettings: (s: any) => void
  cleanupPreviewUrls: () => void
  updateItemCaption: (id: string, caption: string) => void
  markItemAsProcessed: (id: string) => void
  syncExistingCaptions: () => void
  loadRawUploads: () => void
  reorderDataset: (newOrder: DatasetItem[]) => void
  setSortOption: (option: SortOption) => void
}

export const useUI = create<UIState>()(
  persist(
    (set, get) => ({
      modelName: 'shinkai_style',
      baseModel: 'SDXL',
      learningRate: 5,
      trainSteps: 1200,
      saveEverySteps: 0,
      autoResume: true,
      optimizerType: 'AdamW8bit',
      unetLr: 0,
      textEncoderLr: 0,
      uploading: false,
      progress: 0,
      eta: '--:--',
      stepText: 'Idle',
      logs: [],
      dataset: [],
      settingsOpen: false,
      settings: null,
      sortOption: 'custom',

      set: (partial) => set(partial),
      addLog: (line) => set({ logs: [...get().logs, line].slice(-500) }),
      addFiles: async (files) => {
        const items = []
        const warnings: string[] = []
        
        for (const file of files) {
          const validation = await validateImageForTraining(file)
          if (!validation.valid) {
            warnings.push(`${file.name}: ${validation.warning}`)
            continue
          }
          if (validation.warning) {
            warnings.push(`${file.name}: ${validation.warning}`)
          }
          
          // 先上传文件到后端
          try {
            const formData = new FormData()
            formData.append('files', file)
            
            const response = await fetch('/api/upload', {
              method: 'POST',
              body: formData
            })
            
            if (!response.ok) {
              throw new Error(`上传失败: ${response.status}`)
            }
            
            const result = await response.json()
            if (!result.ok) {
              throw new Error(`上传失败: ${result.error || '未知错误'}`)
            }
            
            console.log(`文件 ${file.name} 上传成功`)
            
          } catch (error) {
            console.error(`文件 ${file.name} 上传失败:`, error)
            warnings.push(`${file.name}: 上传失败 - ${error}`)
            continue
          }
          
          items.push({
            id: `${file.name}-${Math.random().toString(36).slice(2)}`,
            file: file,
            filename: file.name,
            previewUrl: URL.createObjectURL(file),
          })
        }
        
        if (warnings.length > 0) {
          console.warn('图片验证警告:', warnings)
        }
        
        set({ dataset: [...get().dataset, ...items] })
      },
      removeItem: (id) => {
        const item = get().dataset.find(d => d.id === id)
        if (item) {
          cleanupPreviewUrl(item.previewUrl)
          
          // 立即从UI中移除，提升响应速度
          set({ dataset: get().dataset.filter((d) => d.id !== id) })
          
          // 如果是已处理的图片，在后台异步删除文件
          if (item.isProcessed) {
            const filename = item.file ? item.file.name : item.filename
            if (filename) {
              // 使用setTimeout让删除操作不阻塞UI
              setTimeout(() => {
                fetch('/api/delete-image', {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ filename })
                }).catch(error => {
                  console.error('删除图片文件失败:', error)
                  // 如果删除失败，可以考虑重新添加到UI中
                })
              }, 0)
            }
          }
          
          // 如果是raw_uploads中的图片，在后台异步删除文件
          if (item.isRaw) {
            const filename = item.filename
            if (filename) {
              setTimeout(async () => {
                try {
                  const res = await fetch('/api/delete-raw-image', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ filename })
                  })
                  if (!res.ok) {
                    console.error('删除raw_uploads图片失败:', await res.text())
                  }
                } catch (error) {
                  console.error('删除raw_uploads图片时发生错误:', error)
                }
              }, 0)
            }
          }
        }
      },
      clearDataset: () => {
        // 清理所有预览URL
        get().dataset.forEach(item => {
          cleanupPreviewUrl(item.previewUrl)
        })
        set({ dataset: [] })
      },
            resetProgress: () => set({ progress: 0, eta: '--:--', stepText: 'Idle' }),
      setSettings: (s) => {
        // 仅更新配置，不覆盖 autoResume 等用户手动修改的状态
        set((state) => ({
          settings: s,
          // 如果用户从未手动切换过 autoResume（比如初次加载），才应用默认配置
          // 但这里我们无法知道用户是否手动切换过，所以更安全的做法是只在初始化时应用一次
          // 或者完全不覆盖，只相信本地存储的状态
        }))
      },
      cleanupPreviewUrls: () => {
        // 清理所有预览URL的辅助方法
        get().dataset.forEach(item => {
          cleanupPreviewUrl(item.previewUrl)
        })
      },
      updateItemCaption: (id: string, caption: string) => {
        set({
          dataset: get().dataset.map(item => 
            item.id === id ? { ...item, caption } : item
          )
        })
      },
      markItemAsProcessed: (id: string) => {
        set({
          dataset: get().dataset.map(item => 
            item.id === id ? { 
              ...item, 
              isProcessed: true,
              // 为已处理的图片添加必要的属性，确保能正确显示
              filename: item.file ? item.file.name : item.filename,
              path: `/workspace/processed/dataset/${item.file ? item.file.name : item.filename}`
            } : item
          )
        })
      },
      syncExistingCaptions: async () => {
        try {
          const existingImages = await checkExistingCaptions()
          const currentDataset = get().dataset
          
          // 同步已存在的标签到本地状态
          for (const existingImage of existingImages) {
            const existingItem = currentDataset.find(item => 
              item.file && item.file.name === existingImage.filename
            )
            
            if (existingItem) {
              // 更新已存在的项目
              set({
                dataset: currentDataset.map(item => 
                  item.id === existingItem.id 
                  ? { ...item, caption: existingImage.caption, isProcessed: true }
                  : item
                )
              })
            }
          }
        } catch (error) {
          console.error('同步已存在标签失败:', error)
        }
      },
      
      loadRawUploads: async () => {
        try {
          const res = await fetch('/api/raw-uploads')
          if (res.ok) {
            const data = await res.json()
            const rawImages = data.images || []
            
            // 过滤掉已经在dataset中的图片
            const currentDataset = get().dataset
            const existingFilenames = new Set(currentDataset.map(item => item.file?.name))
            
            const newRawItems = rawImages
              .filter((img: any) => !existingFilenames.has(img.filename))
              .map((img: any) => ({
                id: `raw-${img.filename}-${Math.random().toString(36).slice(2)}`,
                file: null, // raw_uploads中的图片没有File对象
                filename: img.filename,
                previewUrl: `http://127.0.0.1:8000${img.path}`,
                isRaw: true,
                caption: undefined
              }))
            
            if (newRawItems.length > 0) {
              set({ dataset: [...currentDataset, ...newRawItems] })
              console.log(`加载了 ${newRawItems.length} 张未处理的图片`)
            }
          }
        } catch (error) {
          console.error('加载raw_uploads图片失败:', error)
        }
      },
       reorderDataset: (newOrder: DatasetItem[]) => {
         set({ dataset: newOrder })
       },
       setSortOption: (option: SortOption) => {
         const currentDataset = get().dataset
         const sortedDataset = sortImages(currentDataset, option)
         set({ dataset: sortedDataset, sortOption: option })
       },
    }),
    {
      name: 'easylora-settings', // 本地存储的key名称
      partialize: (state) => ({
        // 只保存用户设置，不保存临时状态
         modelName: state.modelName,
         baseModel: state.baseModel,
         learningRate: state.learningRate,
         trainSteps: state.trainSteps,
         saveEverySteps: state.saveEverySteps,
         autoResume: state.autoResume,
         optimizerType: state.optimizerType,
         unetLr: state.unetLr,
         textEncoderLr: state.textEncoderLr,
         sortOption: state.sortOption,
      }),
    }
  )
)
