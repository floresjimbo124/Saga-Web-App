import { StrictMode, Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './App.css'
import { AuthGate } from './auth/AuthGate.tsx'
import { ToastProvider } from './components/Toast.tsx'
import { installClientErrorReporting } from './data/insights'

installClientErrorReporting()

const App = lazy(() => import('./App.tsx'))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthGate>
        <Suspense fallback={null}><App /></Suspense>
      </AuthGate>
    </ToastProvider>
  </StrictMode>,
)
