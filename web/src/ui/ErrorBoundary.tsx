import React from 'react'
import { withTranslation, WithTranslation } from 'react-i18next'

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
}

class ErrorBoundaryInternal extends React.Component<
  React.PropsWithChildren<{}> & WithTranslation,
  ErrorBoundaryState
> {
  constructor(props: React.PropsWithChildren<{}> & WithTranslation) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  render() {
    const { t } = this.props
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 max-w-md mx-4">
            <div className="text-center">
              <div className="text-red-500 text-4xl mb-4">⚠️</div>
              <h2 className="text-lg font-bold mb-2">{t('ErrorOccurred')}</h2>
              <p className="text-gray-600 text-sm mb-4">
                {t('ErrorBoundaryTip')}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => this.setState({ hasError: false })}
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  {t('Retry')}
                </button>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {t('RefreshPage')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export const ErrorBoundary = withTranslation()(ErrorBoundaryInternal)