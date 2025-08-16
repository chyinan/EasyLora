import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type BaseModel = 'SD1.5' | 'SD2.1' | 'SDXL'

export interface DatasetItem {
  id: string
  file: File
  previewUrl: string
}

interface UIState {
  modelName: string
  baseModel: BaseModel
  learningRate: number
  trainSteps: number
  saveEverySteps: number
  autoResume: boolean
  uploading: boolean
  progress: number
  eta: string
  stepText: string
  logs: string[]
  dataset: DatasetItem[]
  settingsOpen: boolean
  settings: any | null

  set: (partial: Partial<UIState>) => void
  addLog: (line: string) => void
  addFiles: (files: File[]) => void
  removeItem: (id: string) => void
  clearDataset: () => void
  resetProgress: () => void
  setSettings: (s: any) => void
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
      uploading: false,
      progress: 0,
      eta: '--:--',
      stepText: '闲置',
      logs: [],
      dataset: [],
      settingsOpen: false,
      settings: null,

      set: (partial) => set(partial),
      addLog: (line) => set({ logs: [...get().logs, line].slice(-500) }),
      addFiles: (files) => {
        const items = files.map((f) => ({
          id: `${f.name}-${Math.random().toString(36).slice(2)}`,
          file: f,
          previewUrl: URL.createObjectURL(f),
        }))
        set({ dataset: [...get().dataset, ...items] })
      },
      removeItem: (id) => set({ dataset: get().dataset.filter((d) => d.id !== id) }),
      clearDataset: () => set({ dataset: [] }),
      resetProgress: () => set({ progress: 0, eta: '--:--', stepText: '闲置' }),
      setSettings: (s) => set({ settings: s }),
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
      }),
    }
  )
)

