import React from 'react'
import { ErrorBoundary } from './ui/ErrorBoundary'
import App from './ui/App'
import './index.css'

function MainApp() {
  return (
    <div className="App">
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </div>
  )
}

export default MainApp 