import React, { useEffect, useState } from 'react'
import { useUI } from '../store'

interface Props { onClose: () => void }

type InputRowProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'form'> & {
  label: string
  field: string
  form: Record<string, any>
  setForm: React.Dispatch<React.SetStateAction<Record<string, any>>>
}

const isPathField = (field: string) => /DIR|PATH|MODEL|SDXL|SD_WEBUI|WORKSPACE|SCRIPTS|VAE/i.test(field)
const toDisplayPath = (v: any) => (typeof v === 'string' ? v.replace(/\\\\/g, '\\') : v)
const toPersistPath = (v: any) => (typeof v === 'string' ? v.replace(/\\/g, '\\\\') : v)

const SettingsInput = React.memo(function SettingsInput({
  label, field, form, setForm, className, type, children, ...rest
}: InputRowProps) {
  return (
    <div className="mb-3">
      <div className="text-sm mb-1">{label}</div>
      <input
        {...rest}
        type={type || 'text'}
        aria-label={label}
        value={isPathField(field) ? toDisplayPath(form?.[field] ?? '') : (form?.[field] ?? '')}
        onChange={(e) => {
          const raw = e.target.value
          const val = type === 'number' ? raw : (isPathField(field) ? toPersistPath(raw) : raw)
          setForm(prev => ({ ...prev, [field]: val }))
        }}
        className={"w-full border rounded-xl px-3 py-2" + (className ? ` ${className}` : '')}
      />
      {children}
    </div>
  )
})

const SettingsSwitch = React.memo(function SettingsSwitch({
  label, field, form, setForm
}: { label: string; field: string; form: Record<string, any>; setForm: React.Dispatch<React.SetStateAction<Record<string, any>>> }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="text-sm">{label}</div>
      <input
        type="checkbox"
        checked={!!form?.[field]}
        onChange={(e) => setForm(prev => ({ ...prev, [field]: e.target.checked }))}
      />
    </div>
  )
})

export default function Settings({ onClose }: Props) {
  const { settings, setSettings } = useUI()
  const [tab, setTab] = useState<'paths' | 'train' | 'net' | 'adv'>('paths')
  const [form, setForm] = useState<Record<string, any>>(settings || {})

  // 只在 settings 真正变化时才更新 form，避免光标丢失
  useEffect(() => {
    if (settings && JSON.stringify(settings) !== JSON.stringify(form)) {
      setForm(settings)
    }
  }, [settings])

  const save = async () => {
    try {
      // 保存时将字符串数字转回 number
      const processedForm = Object.fromEntries(
        Object.entries(form).map(([k, v]) => {
          if (typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v))) {
            return [k, Number(v)]
          }
          return [k, v]
        })
      )

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(processedForm)
      })
      const json = await res.json()
      if (json.ok) {
        setSettings(json.settings)
        if (json.need_restart) alert('部分设置需重启后端生效（镜像/缓存/代理）')
        onClose()
      } else {
        alert('保存失败：' + (json.error || ''))
      }
    } catch (e: any) {
      alert('保存失败：' + (e?.message || e))
    }
  }

  const Input = (p: Omit<InputRowProps, 'form' | 'setForm'>) => (
    <SettingsInput {...p} form={form} setForm={setForm} />
  )
  const Switch = ({ label, field }: { label: string; field: string }) => (
    <SettingsSwitch label={label} field={field} form={form} setForm={setForm} />
  )

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div className="bg-white w-[880px] max-h-[80vh] rounded-2xl shadow-xl overflow-hidden flex flex-col">
        <div className="h-14 flex items-center justify-between px-5 border-b">
          <div className="font-semibold">设置</div>
          <button className="p-2 hover:bg-gray-100 rounded-lg" onClick={onClose}>✕</button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-44 border-r p-3 space-y-2">
            <button className={`w-full text-left px-3 py-2 rounded-lg ${tab==='paths'?'bg-gray-100':''}`} onClick={()=>setTab('paths')}>路径/导出</button>
            <button className={`w-full text-left px-3 py-2 rounded-lg ${tab==='train'?'bg-gray-100':''}`} onClick={()=>setTab('train')}>训练默认值</button>
            <button className={`w-full text-left px-3 py-2 rounded-lg ${tab==='net'?'bg-gray-100':''}`} onClick={()=>setTab('net')}>下载与网络</button>
            <button className={`w-full text-left px-3 py-2 rounded-lg ${tab==='adv'?'bg-gray-100':''}`} onClick={()=>setTab('adv')}>高级</button>
          </div>
          <div className="flex-1 p-5 overflow-auto">
            {tab==='paths' && (
              <div>
                <Input label="导出目录" field="DEFAULT_OUTPUT_DIR" placeholder="outputs/" />
                <Input label="文件名模式" field="OUTPUT_LORA_FILENAME" placeholder="custom_lora_{date}_{steps}.safetensors">
                  <div className="text-xs text-gray-500 mt-1">支持 {'{'}date{'}'}、{'{'}steps{'}'}、{'{'}name{'}'}</div>
                </Input>
                <Input label="SD WebUI LoRA 目录" field="DEFAULT_SD_WEBUI_LORA_DIR" placeholder="D:\\...\\models\\Lora" />
                <Switch label="训练完成后复制到 SD WebUI LoRA 目录" field="COPY_TO_SD_WEBUI_ON_FINISH" />
                <Input label="基底模型 · SD1.5 (512)" field="DEFAULT_MODEL_512" placeholder="本地 .safetensors / diffusers 目录 / HF ID" />
                <Input label="基底模型 · SD2.1 (768)" field="DEFAULT_MODEL_768" placeholder="本地 .safetensors / diffusers 目录 / HF ID" />
                <Input label="基底模型 · SDXL (1024)" field="DEFAULT_MODEL_SDXL" placeholder="本地 .safetensors / diffusers 目录 / HF ID" />
                <Input label="工作区目录" field="DEFAULT_WORKSPACE_DIR" placeholder="workspace" />
                <Input label="sd-scripts 路径" field="DEFAULT_KOHYA_SCRIPTS_DIR" placeholder="D:\\tools\\sd-scripts" />
                <Input label="可选：VAE 路径" field="DEFAULT_VAE_PATH" placeholder="(可留空)" />
              </div>
            )}
            {tab==='train' && (
              <div>
                <Input label="学习率下限" field="LR_SLIDER_MIN" type="number" step="1e-6" placeholder="1e-5" />
                <Input label="学习率上限" field="LR_SLIDER_MAX" type="number" step="1e-6" placeholder="1e-4" />
                <Input label="LoRA rank 默认(512)" field="DEFAULT_RANK_512" type="number" />
                <Input label="LoRA rank 默认(768)" field="DEFAULT_RANK_768" type="number" />
                <Input label="LoRA rank 默认(1024)" field="DEFAULT_RANK_1024" type="number" />
                <Input label="步数默认(512)" field="DEFAULT_STEPS_512" type="number" />
                <Input label="步数默认(768)" field="DEFAULT_STEPS_768" type="number" />
                <Input label="步数默认(1024)" field="DEFAULT_STEPS_1024" type="number" />
                <Input label="train_batch_size" field="DEFAULT_BATCH_SIZE" type="number" />
                <Input label="gradient_accumulation_steps" field="DEFAULT_GRAD_ACCUM" type="number" />
                <Input label="分辨率判定阈值(768)" field="RES_THRESHOLD_768" type="number" />
                <Input label="分辨率判定阈值(SDXL)" field="RES_THRESHOLD_SDXL" type="number" />
                <Input label="最多生成 N 个模型(0=不限制)" field="MAX_MODELS_BEFORE_CLEAN" type="number" />
                <Switch label="默认开启断点续训" field="DEFAULT_AUTO_RESUME" />
                <Switch label="低显存自适应(自动降分/策略)" field="LOW_VRAM_ENABLE" />
                <Input label="低显存阈值(GB)" field="LOW_VRAM_THRESHOLD_GB" type="number" />
              </div>
            )}
            {tab==='net' && (
              <div>
                <Input label="HF_ENDPOINT(镜像站链接)" field="HF_ENDPOINT" placeholder="https://hf-mirror.com" />
                <Input label="HF_HOME" field="HF_HOME" />
                <Input label="TRANSFORMERS_CACHE" field="TRANSFORMERS_CACHE" />
                <Input label="HTTP_PROXY" field="HTTP_PROXY" />
                <Input label="HTTPS_PROXY" field="HTTPS_PROXY" />
                <Switch label="只下载必需文件(diffusers)" field="ONLY_DOWNLOAD_ESSENTIAL" />
                <Input label="下载并发度" field="MAX_DOWNLOAD_WORKERS" type="number" />
              </div>
            )}
            {tab==='adv' && (
              <div>
                <Input label="mixed_precision(fp16/bf16)" field="MIXED_PRECISION" placeholder="fp16" />
                <Switch label="xformers" field="USE_XFORMERS" />
                <Switch label="sdpa" field="USE_SDPA" />
                <Switch label="gradient_checkpointing" field="GRADIENT_CHECKPOINTING" />
                <Switch label="enable_bucket" field="ENABLE_BUCKET" />
                <Input label="bucket_reso_steps" field="BUCKET_RESO_STEPS" type="number" />
                <Input label="min_bucket_reso" field="MIN_BUCKET_RESO" type="number" />
                <Input label="max_bucket_reso" field="MAX_BUCKET_RESO" type="number" />
                <Input label="数据增强份数 augment_factor" field="AUGMENT_FACTOR" type="number" />
                <Input label="Caption 前缀" field="CAPTION_PREFIX" />
                <Input label="Caption 后缀" field="CAPTION_SUFFIX" />
                <Switch label="自动在标签开头添加模型名称" field="AUTO_ADD_MODEL_NAME_PREFIX" />
                <div className="text-xs text-gray-500 mt-1 ml-4">
                开启后，新导入图片的标签会自动在开头添加当前设置的模型名称
                </div>
                <Input label="保存最近 N 次步数" field="SAVE_LAST_N_STEPS" type="number" />
                <Input label="保存最近 N 次 epoch" field="SAVE_LAST_N_EPOCHS" type="number" />
                <Input label="额外参数透传(--network_args 等)" field="EXTRA_ARGS" placeholder="key=value;key2=value2" />
              </div>
            )}
          </div>
        </div>
        <div className="h-14 border-t flex items-center justify-end gap-3 px-6">
          <button className="btn-compact hover:bg-gray-100" onClick={onClose}>取消</button>
          <button className="btn-primary btn-compact ml-1" onClick={save}>保存</button>
        </div>
      </div>
    </div>
  )
}
