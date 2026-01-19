import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

// 独立的标签按钮组件，避免渲染冲突
const TagButton = React.memo(({ tag, isSelected, onToggle }: {
  tag: string
  isSelected: boolean
  onToggle: (tag: string) => void
}) => {
  const [isClicking, setIsClicking] = useState(false)
  const { t } = useTranslation()

  const handleClick = useCallback(() => {
    if (isClicking) return // 防止重复点击
    setIsClicking(true)
    onToggle(tag)
    // 短暂延迟后重置点击状态
    setTimeout(() => setIsClicking(false), 100)
  }, [tag, onToggle, isClicking])

  return (
    <button
      onClick={handleClick}
      disabled={isClicking}
      className={`text-xs px-2 py-1 rounded text-left transition-colors ${
        isSelected
          ? 'bg-blue-500 text-white hover:bg-blue-600' 
          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      } disabled:opacity-50`}
      title={isSelected ? t('ClickToRemove') : t('ClickToAdd')}
    >
      {isSelected && '✓ '}{tag}
    </button>
  )
})

TagButton.displayName = 'TagButton'

interface CaptionEditorProps {
  image: {
    id?: string
    file?: File
    previewUrl?: string
    caption?: string
    filename?: string
    path?: string
    isRaw?: boolean
  }
  onClose: () => void
  onSave: (filename: string, caption: string) => void
}

export default function CaptionEditor({ image, onClose, onSave }: CaptionEditorProps) {
  const [caption, setCaption] = useState(image.caption || '')
  const [saving, setSaving] = useState(false)
  const { t } = useTranslation()

  useEffect(() => {
    setCaption(image.caption || '')
  }, [image.caption])

  const handleSave = async () => {
    setSaving(true)
    try {
      const filename = image.file?.name || image.filename || 'unknown'
      console.log('CaptionEditor save:', { 
        imageFile: image.file?.name, 
        imageFilename: image.filename, 
        finalFilename: filename,
        caption,
        isRaw: image.isRaw
      })
      await onSave(filename, caption)
      onClose()
    } catch (error) {
      console.error('CaptionEditor save failed:', error)
      alert(t('UpdateCaptionError') + ': ' + error)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleSave()
    }
  }

  // 常用标签建议
  const tagSuggestions = [
    '1girl', '1boy', '2girls', '2boys', 'group',
    'outdoor', 'indoor', 'sky', 'clouds', 'sunset', 'city', 'school', 'train', 'landscape',
    'detailed', 'beautiful', 'high quality', 'masterpiece', 'cinematic',
    'smile', 'happy', 'sad', 'serious', 'peaceful',
    'school uniform', 'casual', 'dress', 'no humans'
  ]

  const toggleTag = useCallback((tag: string) => {
    setCaption(prevCaption => {
      const tags = prevCaption.split(',').map(t => t.trim()).filter(t => t)
      const tagIndex = tags.indexOf(tag)
      
      if (tagIndex >= 0) {
        // 标签已存在，移除它
        const newTags = [...tags]
        newTags.splice(tagIndex, 1)
        return newTags.join(', ')
      } else {
        // 标签不存在，添加它
        return [...tags, tag].join(', ')
      }
    })
  }, [])

  // 使用 useMemo 来优化按钮状态计算
  const selectedTags = useMemo(() => {
    return new Set(caption.split(',').map(t => t.trim()).filter(t => t))
  }, [caption])

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-xl p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">{t('EditImageTags')}</h2>
          <button 
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center"
          >
            ✕
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* 图片预览 */}
          <div className="space-y-4">
            <div className="text-sm text-gray-600">{t('ImagePreview')}</div>
            <img 
              src={image.previewUrl || `http://127.0.0.1:8000${image.path}`} 
              alt={image.file?.name || image.filename || t('ImagePreview')}
              className="w-full max-w-md rounded-lg border shadow-sm"
            />
            <div className="text-sm text-gray-500">{image.file?.name || image.filename || t('UnknownFile')}</div>
          </div>

          {/* 标签编辑 */}
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">{t('CaptionDescription')}</label>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={handleKeyDown}
                className="w-full h-32 border rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                placeholder="shinkai_style, 1girl, beautiful, outdoor..."
                autoFocus
              />
              <div className="text-xs text-gray-500 mt-1">
                {t('CaptionTip')}
              </div>
            </div>

            {/* 常用标签建议 */}
            <div>
              <div className="text-sm font-medium mb-2">{t('CommonTags')}</div>
              <div className="grid grid-cols-2 gap-1 max-h-40 overflow-auto">
                {tagSuggestions.map((tag) => {
                  const isSelected = selectedTags.has(tag)
                  return (
                    <TagButton
                      key={tag}
                      tag={tag}
                      isSelected={isSelected}
                      onToggle={toggleTag}
                    />
                  )
                })}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex gap-3 pt-4">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 bg-blue-600 text-white py-2 px-4 rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {saving ? t('Saving') : t('SaveTags')}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {t('Cancel')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}