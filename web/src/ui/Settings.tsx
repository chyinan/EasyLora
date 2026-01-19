import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
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
  const { t } = useTranslation()

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
        if (json.need_restart) alert(t('PartialSettingsRestart'))
        onClose()
      } else {
        alert(t('UpdateCaptionError') + '：' + (json.error || ''))
      }
    } catch (e: any) {
      alert(t('UpdateCaptionError') + '：' + (e?.message || e))
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
        <div className="h-14 flex items-center justify-between px-5 border-b shrink-0">
          <div className="font-semibold">{t('Settings')}</div>
          <button className="p-2 hover:bg-gray-100 rounded-lg" onClick={onClose}>✕</button>
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div className="w-44 border-r p-3 space-y-2 shrink-0 overflow-y-auto">
            <button className={`w-full text-left px-3 py-2 rounded-lg ${tab==='paths'?'bg-gray-100':''}`} onClick={()=>setTab('paths')}>{t('PathsExport')}</button>
            <button className={`w-full text-left px-3 py-2 rounded-lg ${tab==='train'?'bg-gray-100':''}`} onClick={()=>setTab('train')}>{t('TrainDefaults')}</button>
            <button className={`w-full text-left px-3 py-2 rounded-lg ${tab==='net'?'bg-gray-100':''}`} onClick={()=>setTab('net')}>{t('NetAndDownload')}</button>
            <button className={`w-full text-left px-3 py-2 rounded-lg ${tab==='adv'?'bg-gray-100':''}`} onClick={()=>setTab('adv')}>{t('Advanced')}</button>
          </div>
          <div className="flex-1 p-5 overflow-y-auto">
            {tab==='paths' && (
              <div className="space-y-1">
                <Input label={t('ExportDir')} field="DEFAULT_OUTPUT_DIR" placeholder="outputs/" />
                <Input label={t('FileNamePattern')} field="OUTPUT_LORA_FILENAME" placeholder="custom_lora_{date}_{steps}.safetensors">
                  <div className="text-xs text-gray-500 mt-1">{t('FileNamePatternTip')}</div>
                </Input>
                <Input label={t('SdWebUiLoraDir')} field="DEFAULT_SD_WEBUI_LORA_DIR" placeholder="D:\\...\\models\\Lora" />
                <Switch label={t('CopyAfterFinish')} field="COPY_TO_SD_WEBUI_ON_FINISH" />
                <Input label={t('BaseModel512')} field="DEFAULT_MODEL_512" placeholder="local .safetensors / diffusers dir / HF ID" />
                <Input label={t('BaseModel768')} field="DEFAULT_MODEL_768" placeholder="local .safetensors / diffusers dir / HF ID" />
                <Input label={t('BaseModelSdxl')} field="DEFAULT_MODEL_SDXL" placeholder="local .safetensors / diffusers dir / HF ID" />
                <Input label={t('WorkspaceDir')} field="DEFAULT_WORKSPACE_DIR" placeholder="workspace" />
                <Input label={t('KohyaScriptsDir')} field="DEFAULT_KOHYA_SCRIPTS_DIR" placeholder="D:\\tools\\sd-scripts" />
                <Input label={t('VaePath')} field="DEFAULT_VAE_PATH" placeholder="(Optional)" />
              </div>
            )}
            {tab==='train' && (
              <div className="space-y-1">
                <Input label={t('LrSliderMin')} field="LR_SLIDER_MIN" type="number" step="1e-6" placeholder="1e-5" />
                <Input label={t('LrSliderMax')} field="LR_SLIDER_MAX" type="number" step="1e-6" placeholder="1e-4" />
                <Input label={t('DefaultRank512')} field="DEFAULT_RANK_512" type="number" />
                <Input label={t('DefaultRank768')} field="DEFAULT_RANK_768" type="number" />
                <Input label={t('DefaultRank1024')} field="DEFAULT_RANK_1024" type="number" />
                <Input label={t('DefaultSteps512')} field="DEFAULT_STEPS_512" type="number" />
                <Input label={t('DefaultSteps768')} field="DEFAULT_STEPS_768" type="number" />
                <Input label={t('DefaultSteps1024')} field="DEFAULT_STEPS_1024" type="number" />
                <Input label="train_batch_size" field="DEFAULT_BATCH_SIZE" type="number" />
                <Input label="gradient_accumulation_steps" field="DEFAULT_GRAD_ACCUM" type="number" />
                <Input label="Resolution threshold (768)" field="RES_THRESHOLD_768" type="number" />
                <Input label="Resolution threshold (SDXL)" field="RES_THRESHOLD_SDXL" type="number" />
                <Input label={t('MaxModelsBeforeClean')} field="MAX_MODELS_BEFORE_CLEAN" type="number" />
                <Switch label={t('AutoResume')} field="DEFAULT_AUTO_RESUME" />
                <Switch label={t('LowVramEnable')} field="LOW_VRAM_ENABLE" />
                <Input label={t('LowVramThreshold')} field="LOW_VRAM_THRESHOLD_GB" type="number" />
              </div>
            )}
            {tab==='net' && (
              <div className="space-y-1">
                <Input label={t('HfEndpoint')} field="HF_ENDPOINT" placeholder="https://hf-mirror.com" />
                <Input label="HF_HOME" field="HF_HOME" />
                <Input label="TRANSFORMERS_CACHE" field="TRANSFORMERS_CACHE" />
                <Input label="HTTP_PROXY" field="HTTP_PROXY" />
                <Input label="HTTPS_PROXY" field="HTTPS_PROXY" />
                <Switch label={t('OnlyDownloadEssential')} field="ONLY_DOWNLOAD_ESSENTIAL" />
                <Input label={t('MaxDownloadWorkers')} field="MAX_DOWNLOAD_WORKERS" type="number" />
              </div>
            )}
            {tab==='adv' && (
              <div className="space-y-1">
                <Input label={t('MixedPrecision')} field="MIXED_PRECISION" placeholder="fp16" />
                <Switch label="xformers" field="USE_XFORMERS" />
                <Switch label="sdpa" field="USE_SDPA" />
                <Switch label="gradient_checkpointing" field="GRADIENT_CHECKPOINTING" />
                <Switch label="enable_bucket" field="ENABLE_BUCKET" />
                <Input label="bucket_reso_steps" field="BUCKET_RESO_STEPS" type="number" />
                <Input label="min_bucket_reso" field="MIN_BUCKET_RESO" type="number" />
                <Input label="max_bucket_reso" field="MAX_BUCKET_RESO" type="number" />
                <Input label={t('AugmentFactor')} field="AUGMENT_FACTOR" type="number" />
                <Input label={t('CaptionPrefix')} field="CAPTION_PREFIX" />
                <Input label={t('CaptionSuffix')} field="CAPTION_SUFFIX" />
                <Switch label={t('AutoAddModelPrefix')} field="AUTO_ADD_MODEL_NAME_PREFIX" />
                <div className="text-xs text-gray-500 mt-1 ml-4">
                {t('AutoAddModelPrefixTip')}
                </div>
                <Input label={t('SaveLastNSteps')} field="SAVE_LAST_N_STEPS" type="number" />
                <Input label={t('SaveLastNEpochs')} field="SAVE_LAST_N_EPOCHS" type="number" />
                <Input label={t('ExtraArgs')} field="EXTRA_ARGS" placeholder="key=value;key2=value2" />
              </div>
            )}
          </div>
        </div>
        <div className="h-14 border-t flex items-center justify-end gap-3 px-6 shrink-0 bg-white">
          <button className="btn-compact hover:bg-gray-100" onClick={onClose}>{t('Cancel')}</button>
          <button className="btn-primary btn-compact ml-1" onClick={save}>{t('Save')}</button>
        </div>
      </div>
    </div>
  )
}
