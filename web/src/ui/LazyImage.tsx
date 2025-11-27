import React, { useState, useEffect } from 'react'

interface LazyImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  alt?: string
  className?: string
  placeholder?: string
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void
  onError?: (e: React.SyntheticEvent<HTMLImageElement, Event>) => void
}

export default React.memo(function LazyImage({
  src,
  alt = '',
  className = '',
  placeholder = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIwIiBoZWlnaHQ9IjEyMCIgdmlld0JveD0iMCAwIDEyMCAxMjAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIxMjAiIGhlaWdodD0iMTIwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik02MCA2NUw0MCA0NUg4MEw2MCA2NVoiIGZpbGw9IiM5Q0EzQUYiLz4KPC9zdmc+',
  onLoad,
  onError,
  loading = 'lazy',
  ...props
}: LazyImageProps) {
  const [isLoaded, setIsLoaded] = useState(false)
  const [hasError, setHasError] = useState(false)

  // Reset state when src changes
  useEffect(() => {
    setIsLoaded(false)
    setHasError(false)
  }, [src])

  const handleLoad = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setIsLoaded(true)
    onLoad?.(e)
  }

  const handleError = (e: React.SyntheticEvent<HTMLImageElement, Event>) => {
    setHasError(true)
    onError?.(e)
  }

  return (
    <div className={`relative overflow-hidden ${className}`}>
      {/* Placeholder / Loading State */}
      {(!isLoaded || hasError) && (
        <div className="absolute inset-0 flex items-center justify-center bg-gray-100 z-10">
          {!hasError ? (
            <div className="w-6 h-6 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
          ) : (
             <div className="text-gray-400 text-xs">加载失败</div>
          )}
        </div>
      )}
      
      {/* Actual Image */}
      <img
        src={src}
        alt={alt}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
        loading={loading}
        onLoad={handleLoad}
        onError={handleError}
        {...props}
      />
    </div>
  )
})
