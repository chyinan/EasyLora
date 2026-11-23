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
        value={form?.[field] ?? ''}
        onChange={(e) => {
          const raw = e.target.value
          const val = type === 'number' && raw !== '' ? Number(raw) : raw
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
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
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

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
      <div role="dialog" aria-modal="true" aria-label={t('Settings')} className="bg-white w-[880px] max-h-[80vh] rounded-2xl shadow-xl overflow-hidden flex flex-col">
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
                <SettingsInput form={form} setForm={setForm} label={t('ExportDir')} field="DEFAULT_OUTPUT_DIR" placeholder="outputs/" />
                <SettingsInput form={form} setForm={setForm} label={t('FileNamePattern')} field="OUTPUT_LORA_FILENAME" placeholder="custom_lora_{date}_{steps}.safetensors">
                  <div className="text-xs text-gray-500 mt-1">{t('FileNamePatternTip')}</div>
                </SettingsInput>
                <SettingsInput form={form} setForm={setForm} label={t('SdWebUiLoraDir')} field="DEFAULT_SD_WEBUI_LORA_DIR" placeholder="D:\\...\\models\\Lora" />
                <SettingsSwitch form={form} setForm={setForm} label={t('CopyAfterFinish')} field="COPY_TO_SD_WEBUI_ON_FINISH" />
                <SettingsInput form={form} setForm={setForm} label={t('BaseModel512')} field="DEFAULT_MODEL_512" placeholder="local .safetensors / diffusers dir / HF ID" />
                <SettingsInput form={form} setForm={setForm} label={t('BaseModel768')} field="DEFAULT_MODEL_768" placeholder="local .safetensors / diffusers dir / HF ID" />
                <SettingsInput form={form} setForm={setForm} label={t('BaseModelSdxl')} field="DEFAULT_MODEL_SDXL" placeholder="local .safetensors / diffusers dir / HF ID" />
                <SettingsInput form={form} setForm={setForm} label={t('WorkspaceDir')} field="DEFAULT_WORKSPACE_DIR" placeholder="workspace" />
                <SettingsInput form={form} setForm={setForm} label={t('KohyaScriptsDir')} field="DEFAULT_KOHYA_SCRIPTS_DIR" placeholder="D:\\tools\\sd-scripts" />
                <SettingsInput form={form} setForm={setForm} label={t('VaePath')} field="DEFAULT_VAE_PATH" placeholder="(Optional)" />
              </div>
            )}
            {tab==='train' && (
              <div className="space-y-1">
                <SettingsInput form={form} setForm={setForm} label={t('LrSliderMin')} field="LR_SLIDER_MIN" type="number" step="1e-6" placeholder="1e-5" />
                <SettingsInput form={form} setForm={setForm} label={t('LrSliderMax')} field="LR_SLIDER_MAX" type="number" step="1e-6" placeholder="1e-4" />
                <SettingsInput form={form} setForm={setForm} label={t('DefaultRank512')} field="DEFAULT_RANK_512" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('DefaultRank768')} field="DEFAULT_RANK_768" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('DefaultRank1024')} field="DEFAULT_RANK_1024" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('DefaultSteps512')} field="DEFAULT_STEPS_512" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('DefaultSteps768')} field="DEFAULT_STEPS_768" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('DefaultSteps1024')} field="DEFAULT_STEPS_1024" type="number" />
                <SettingsInput form={form} setForm={setForm} label="train_batch_size" field="DEFAULT_BATCH_SIZE" type="number" />
                <SettingsInput form={form} setForm={setForm} label="gradient_accumulation_steps" field="DEFAULT_GRAD_ACCUM" type="number" />
                <SettingsInput form={form} setForm={setForm} label="Resolution threshold (768)" field="RES_THRESHOLD_768" type="number" />
                <SettingsInput form={form} setForm={setForm} label="Resolution threshold (SDXL)" field="RES_THRESHOLD_SDXL" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('MaxModelsBeforeClean')} field="MAX_MODELS_BEFORE_CLEAN" type="number" />
                <SettingsSwitch form={form} setForm={setForm} label={t('AutoResume')} field="DEFAULT_AUTO_RESUME" />
                <SettingsSwitch form={form} setForm={setForm} label={t('LowVramEnable')} field="LOW_VRAM_ENABLE" />
                <SettingsInput form={form} setForm={setForm} label={t('LowVramThreshold')} field="LOW_VRAM_THRESHOLD_GB" type="number" />
              </div>
            )}
            {tab==='net' && (
              <div className="space-y-1">
                <SettingsInput form={form} setForm={setForm} label={t('HfEndpoint')} field="HF_ENDPOINT" placeholder="https://hf-mirror.com" />
                <SettingsInput form={form} setForm={setForm} label="HF_HOME" field="HF_HOME" />
                <SettingsInput form={form} setForm={setForm} label="TRANSFORMERS_CACHE" field="TRANSFORMERS_CACHE" />
                <SettingsInput form={form} setForm={setForm} label="HTTP_PROXY" field="HTTP_PROXY" />
                <SettingsInput form={form} setForm={setForm} label="HTTPS_PROXY" field="HTTPS_PROXY" />
                <SettingsSwitch form={form} setForm={setForm} label={t('OnlyDownloadEssential')} field="ONLY_DOWNLOAD_ESSENTIAL" />
                <SettingsInput form={form} setForm={setForm} label={t('MaxDownloadWorkers')} field="MAX_DOWNLOAD_WORKERS" type="number" />
              </div>
            )}
            {tab==='adv' && (
              <div className="space-y-1">
                <SettingsInput form={form} setForm={setForm} label={t('MixedPrecision')} field="MIXED_PRECISION" placeholder="fp16" />
                <SettingsSwitch form={form} setForm={setForm} label="xformers" field="USE_XFORMERS" />
                <SettingsSwitch form={form} setForm={setForm} label="sdpa" field="USE_SDPA" />
                <SettingsSwitch form={form} setForm={setForm} label="gradient_checkpointing" field="GRADIENT_CHECKPOINTING" />
                <SettingsSwitch form={form} setForm={setForm} label="enable_bucket" field="ENABLE_BUCKET" />
                <SettingsInput form={form} setForm={setForm} label="bucket_reso_steps" field="BUCKET_RESO_STEPS" type="number" />
                <SettingsInput form={form} setForm={setForm} label="min_bucket_reso" field="MIN_BUCKET_RESO" type="number" />
                <SettingsInput form={form} setForm={setForm} label="max_bucket_reso" field="MAX_BUCKET_RESO" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('AugmentFactor')} field="AUGMENT_FACTOR" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('CaptionPrefix')} field="CAPTION_PREFIX" />
                <SettingsInput form={form} setForm={setForm} label={t('CaptionSuffix')} field="CAPTION_SUFFIX" />
                <SettingsSwitch form={form} setForm={setForm} label={t('AutoAddModelPrefix')} field="AUTO_ADD_MODEL_NAME_PREFIX" />
                <div className="text-xs text-gray-500 mt-1 ml-4">
                {t('AutoAddModelPrefixTip')}
                </div>
                <SettingsInput form={form} setForm={setForm} label={t('SaveLastNSteps')} field="SAVE_LAST_N_STEPS" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('SaveLastNEpochs')} field="SAVE_LAST_N_EPOCHS" type="number" />
                <SettingsInput form={form} setForm={setForm} label={t('ExtraArgs')} field="EXTRA_ARGS" placeholder="key=value;key2=value2" />
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
