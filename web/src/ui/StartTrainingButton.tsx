import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUI } from '../store'

type Phase = 'checking' | 'connecting' | 'running' | 'stopping' | 'ready'
type Progress = { p: number; eta?: string; cur?: number; total?: number }
type Snapshot = {
  status: 'idle' | 'running' | 'stopping' | 'completed' | 'cancelled' | 'failed'
  progress?: Progress | null
  path?: string | null
  download_url?: string | null
  error?: string | null
}

function showProgress(msg: Progress) {
  const stepText = msg.cur != null && msg.total ? `${msg.cur}/${msg.total}` : `${Math.round(msg.p * 100)}%`
  useUI.getState().set({ progress: msg.p, eta: msg.eta || '--:--', stepText })
}

// Opening /ws/train starts a job. Recovery must ONLY query the read-only status endpoint.
export default function StartTrainingButton() {
  const { t } = useTranslation()
  const [phase, setPhase] = useState<Phase>('checking')
  const [download, setDownload] = useState<string | null>(null)
  const [recover, setRecover] = useState(0)
  const socket = useRef<WebSocket | null>(null)
  const { addLog, set, resetProgress, uploading } = useUI()

  const finish = useCallback((status: Snapshot['status'], path?: string | null, url?: string | null, error?: string | null) => {
    if (status === 'completed') {
      set({ progress: 1, stepText: 'Done' })
      setDownload(url ?? null)
      addLog(`${t('Done')}: ${path ?? ''}`)
    } else if (status === 'cancelled') {
      set({ stepText: 'Cancelled' })
      addLog(t('Cancelled'))
    } else if (status === 'failed') {
      set({ stepText: 'Error' })
      addLog(`${t('Error')}: ${error ?? ''}`)
    }
    setPhase('ready')
  }, [addLog, set, t])

  useEffect(() => {
    let disposed = false
    let warned = false
    let timer: ReturnType<typeof setTimeout>
    async function readStatus() {
      if (socket.current) return
      try {
        const response = await fetch('/api/training-status')
        if (!response.ok) throw new Error(String(response.status))
        const job: Snapshot = await response.json()
        if (disposed || socket.current) return
        if (job.progress) showProgress(job.progress)
        if (job.status === 'running' || job.status === 'stopping') {
          setPhase(job.status)
          timer = setTimeout(readStatus, 1000)
        } else {
          finish(job.status, job.path, job.download_url, job.error)
        }
      } catch {
        if (disposed || socket.current) return
        if (!warned) { addLog(t('WsError')); warned = true }
        // Backend may still be starting. Don't guess that a running job finished.
        timer = setTimeout(readStatus, 2000)
      }
    }
    readStatus()
    return () => { disposed = true; clearTimeout(timer) }
  }, [recover, finish, addLog, t])

  useEffect(() => () => {
    const ws = socket.current
    if (ws) {
      ws.onclose = null
      ws.onmessage = null
      ws.onerror = null
      ws.onopen = null
      ws.close()
    }
  }, [])

  function start() {
    if (phase !== 'ready' || socket.current) return
    const state = useUI.getState()
    const lrMin = Number(state.settings?.LR_SLIDER_MIN ?? 1e-5)
    const lrMax = Number(state.settings?.LR_SLIDER_MAX ?? 1e-4)
    const qs = new URLSearchParams({
      name: state.modelName || 'model',
      base_model: state.baseModel,
      steps: String(state.trainSteps),
      lr: String(lrMin + (lrMax - lrMin) * (Math.min(10, Math.max(1, state.learningRate)) - 1) / 9),
      save_every: String(state.saveEverySteps),
      auto_resume: state.autoResume ? '1' : '0',
      optimizer_type: state.optimizerType,
    })
    if (state.unetLr > 0) qs.set('unet_lr', String(state.unetLr))
    if (state.textEncoderLr > 0) qs.set('text_encoder_lr', String(state.textEncoderLr))
    // Files are already uploaded on drop; sending them again would overwrite captions/datasets.
    resetProgress()
    setDownload(null)
    setPhase('connecting')
    const url = new URL('/ws/train', window.location.href)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    url.search = qs.toString()
    const ws = new WebSocket(url)
    socket.current = ws
    let terminal = false
    ws.onopen = () => setPhase('running')
    ws.onmessage = ({ data }) => {
      const msg = JSON.parse(data)
      if (msg.type === 'log') addLog(msg.data)
      else if (msg.type === 'progress') showProgress(msg)
      else if (['done', 'error', 'cancelled'].includes(msg.type)) {
        terminal = true
        finish(msg.type === 'done' ? 'completed' : msg.type === 'error' ? 'failed' : 'cancelled',
          msg.path, msg.download_url, msg.error)
        ws.close()
      }
    }
    ws.onerror = () => addLog(t('WsError'))
    ws.onclose = () => {
      socket.current = null
      if (!terminal) {
        setPhase('checking')
        setRecover(x => x + 1)
      }
    }
  }

  async function stop() {
    setPhase('stopping')
    try {
      const res = await fetch('/api/stop', { method: 'POST' })
      if (!res.ok) throw new Error(String(res.status))
      addLog(t('LogStopping'))
      // Keep Start disabled until the worker has exited.
    } catch {
      addLog(t('StopFailed'))
      if (socket.current?.readyState === WebSocket.OPEN) {
        setPhase('running')
      } else {
        setPhase('checking')
        setRecover(x => x + 1)
      }
    }
  }

  return <>
    <div className="flex gap-3">
      <button className="btn-primary flex-1 text-center text-lg py-3" onClick={start} disabled={phase !== 'ready' || uploading}>
        {t(({ ready: 'StartTraining', checking: 'CheckingStatus', connecting: 'Connecting', running: 'Training', stopping: 'Stopping' })[phase])}
      </button>
      {(phase === 'running' || phase === 'stopping') && (
        <button className="px-4 py-3 rounded-xl bg-gray-100 hover:bg-gray-200" onClick={stop} disabled={phase === 'stopping'}>
          {t('Stop')}
        </button>
      )}
    </div>
    {download && <a className="mt-2 inline-block underline" href={download} download>{t('DownloadModel')}</a>}
  </>
}
