import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './auth/AuthGate.tsx'
import { ToastProvider } from './components/Toast.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <AuthGate>
        <App />
      </AuthGate>
    </ToastProvider>
  </StrictMode>,
)
