/**
 * 统一 API 客户端
 * 
 * 提供统一的错误处理、请求封装和类型安全
 */

// ============== 配置 ==============

const API_BASE_URL = ''  // 相对路径，使用代理
const DEFAULT_TIMEOUT = 30000  // 30秒

// ============== 错误类型 ==============

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
    public details?: unknown
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export class NetworkError extends Error {
  constructor(message: string = '网络连接失败，请检查后端服务是否启动') {
    super(message)
    this.name = 'NetworkError'
  }
}

export class TimeoutError extends Error {
  constructor(message: string = '请求超时') {
    super(message)
    this.name = 'TimeoutError'
  }
}

// ============== 请求封装 ==============

interface RequestOptions extends RequestInit {
  timeout?: number
}

async function request<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, ...fetchOptions } = options
  
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  
  try {
    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...fetchOptions,
      signal: controller.signal,
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      let errorMessage = `请求失败: ${response.status}`
      let errorDetails: unknown
      
      try {
        const errorData = await response.json()
        errorMessage = errorData.detail || errorData.message || errorMessage
        errorDetails = errorData
      } catch {
        // 无法解析 JSON，使用默认错误信息
      }
      
      throw new ApiError(errorMessage, response.status, undefined, errorDetails)
    }
    
    // 204 No Content 或空响应
    if (response.status === 204 || response.headers.get('content-length') === '0') {
      return {} as T
    }
    
    return await response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    
    if (error instanceof ApiError) {
      throw error
    }
    
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new TimeoutError()
      }
      if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        throw new NetworkError()
      }
    }
    
    throw error
  }
}

// ============== API 方法 ==============

export const api = {
  get<T>(endpoint: string, options?: RequestOptions): Promise<T> {
    return request<T>(endpoint, { ...options, method: 'GET' })
  },
  
  post<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    const headers: HeadersInit = {
      ...(options?.headers as Record<string, string>),
    }
    
    let body: BodyInit | undefined
    if (data instanceof FormData) {
      body = data
    } else if (data !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(data)
    }
    
    return request<T>(endpoint, { ...options, method: 'POST', headers, body })
  },
  
  put<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string>),
      },
      body: data ? JSON.stringify(data) : undefined,
    })
  },
  
  delete<T>(endpoint: string, data?: unknown, options?: RequestOptions): Promise<T> {
    return request<T>(endpoint, {
      ...options,
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers as Record<string, string>),
      },
      body: data ? JSON.stringify(data) : undefined,
    })
  },
}

// ============== 类型定义 ==============

export interface UploadResponse {
  ok: boolean
  files?: string[]
  error?: string
}

export interface CaptionUpdateRequest {
  filename: string
  caption: string
  isProcessed?: boolean
  autoAddPrefix?: boolean
  modelName?: string
}

export interface CaptionUpdateResponse {
  ok: boolean
  caption?: string
  error?: string
}

export interface ProcessedImage {
  filename: string
  path: string
  caption?: string
}

export interface ProcessedImagesResponse {
  images: ProcessedImage[]
}

export interface RawImage {
  filename: string
  path: string
}

export interface RawImagesResponse {
  images: RawImage[]
}

export interface SystemStats {
  gpu: string
  cpu: string
  ram_percent: number | null
  vram_percent: number | null
}

export interface SettingsResponse {
  LR_SLIDER_MIN?: number
  LR_SLIDER_MAX?: number
  AUTO_ADD_MODEL_NAME_PREFIX?: boolean
  [key: string]: unknown
}

// ============== 具体 API 封装 ==============

export const easyLoraApi = {
  // 上传图片
  async uploadFiles(files: File[]): Promise<UploadResponse> {
    const formData = new FormData()
    files.forEach(file => formData.append('files', file))
    return api.post<UploadResponse>('/api/upload', formData)
  },
  
  // 更新标签
  async updateCaption(data: CaptionUpdateRequest): Promise<CaptionUpdateResponse> {
    return api.post<CaptionUpdateResponse>('/api/update-caption', data)
  },
  
  // 获取已处理图片
  async getProcessedImages(): Promise<ProcessedImagesResponse> {
    return api.get<ProcessedImagesResponse>('/api/processed-images')
  },
  
  // 获取原始上传图片
  async getRawUploads(): Promise<RawImagesResponse> {
    return api.get<RawImagesResponse>('/api/raw-uploads')
  },
  
  // 删除图片
  async deleteImage(filename: string): Promise<{ ok: boolean }> {
    return api.delete('/api/delete-image', { filename })
  },
  
  // 删除原始图片
  async deleteRawImage(filename: string): Promise<{ ok: boolean }> {
    return api.delete('/api/delete-raw-image', { filename })
  },
  
  // 获取系统状态
  async getSystemStats(): Promise<SystemStats> {
    return api.get<SystemStats>('/api/system-stats')
  },
  
  // 获取设置
  async getSettings(): Promise<SettingsResponse> {
    return api.get<SettingsResponse>('/api/settings')
  },
  
  // 停止训练
  async stopTraining(): Promise<{ ok: boolean }> {
    return api.post('/api/stop')
  },
}

export default api
