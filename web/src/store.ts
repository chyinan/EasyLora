import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { validateImageForTraining, cleanupPreviewUrl } from './utils/imageCache'
import { easyLoraApi } from './utils/apiClient'
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
  removeItem: (id: string) => Promise<boolean>
  clearDataset: () => void
  resetProgress: () => void
  setSettings: (s: any) => void
  cleanupPreviewUrls: () => void
  updateItemCaption: (id: string, caption: string) => void
  markItemAsProcessed: (id: string) => void
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
      optimizerType: 'AdamW',
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
        if (get().uploading) return
        set({ uploading: true })
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
              const error = await response.json().catch(() => ({}))
              throw new Error(error.detail || error.error || `上传失败: ${response.status}`)
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
            isRaw: true,
            previewUrl: URL.createObjectURL(file),
          })
        }
        
        if (warnings.length > 0) {
          get().addLog(warnings.join('\n'))
        }
        
        set({ dataset: [...get().dataset, ...items], uploading: false })
      },
      removeItem: async (id) => {
        const item = get().dataset.find(d => d.id === id)
        const name = item?.filename ?? item?.file?.name
        if (!item || !name) return false
        try {
          if (item.isProcessed) await easyLoraApi.deleteImage(name)
          else await easyLoraApi.deleteRawImage(name)
          cleanupPreviewUrl(item.previewUrl)
          set({ dataset: get().dataset.filter(d => d.id !== id) })
          return true
        } catch (error) {
          get().addLog(`${name}: ${error}`)
          return false
        }
      },
      clearDataset: async () => {
        // This control belongs to the raw gallery; never erase captioned training images.
        for (const item of get().dataset.filter(item => !item.isProcessed)) {
          await get().removeItem(item.id)
        }
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
              isRaw: false,
              previewUrl: item.previewUrl.startsWith('blob:') ? item.previewUrl : `/workspace/processed/dataset/${item.filename}`,
              // 为已处理的图片添加必要的属性，确保能正确显示
              filename: item.file ? item.file.name : item.filename,
              path: `/workspace/processed/dataset/${item.file ? item.file.name : item.filename}`
            } : item
          )
        })
      },
      loadRawUploads: async () => {
        try {
          const res = await fetch('/api/raw-uploads')
          if (res.ok) {
            const data = await res.json()
            const rawImages = data.images || []
            
            // 过滤掉已经在dataset中的图片
            const currentDataset = get().dataset
            const existingFilenames = new Set(currentDataset.map(item => item.file?.name ?? item.filename))
            
            const newRawItems = rawImages
              .filter((img: any) => !existingFilenames.has(img.filename))
              .map((img: any) => ({
                id: `raw-${img.filename}-${Math.random().toString(36).slice(2)}`,
                file: null, // raw_uploads中的图片没有File对象
                filename: img.filename,
                previewUrl: img.path,
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
