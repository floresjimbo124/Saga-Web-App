import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Pencil, Trash2, X } from 'lucide-react'
import { ToastContext } from './toast-context'

type ToastMessage = {
  id: number
  text: string
  action: 'create' | 'update' | 'delete'
  confirm?: boolean
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const confirmationRef = useRef<((confirmed: boolean) => void) | null>(null)

  const showToast = (text: string, action: ToastMessage['action'] = 'create') => {
    confirmationRef.current?.(false)
    confirmationRef.current = null
    setToast({ id: Date.now(), text, action })
  }

  const confirmToast = (text: string) => new Promise<boolean>((resolve) => {
    confirmationRef.current?.(false)
    confirmationRef.current = resolve
    setToast({ id: Date.now(), text, action: 'create', confirm: true })
  })

  const dismissToast = (confirmed = false) => {
    confirmationRef.current?.(confirmed)
    confirmationRef.current = null
    setToast(null)
  }

  useEffect(() => {
    if (!toast || toast.confirm) return
    const timeout = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timeout)
  }, [toast])

  return <ToastContext.Provider value={{ showToast, confirmToast }}>
    {children}
    {toast && <div key={toast.id} className={`app-toast${toast.confirm ? ' app-toast-confirm' : ''}`} role={toast.confirm ? 'alertdialog' : 'status'} aria-live={toast.confirm ? 'assertive' : 'polite'}>
      <span className={`app-toast-icon app-toast-icon-${toast.action}${toast.confirm ? ' app-toast-icon-confirm' : ''}`}>
        {toast.confirm
          ? <AlertTriangle size={22} aria-hidden="true" />
          : toast.action === 'update'
            ? <Pencil size={16} aria-hidden="true" />
            : toast.action === 'delete'
              ? <Trash2 size={16} aria-hidden="true" />
              : <Check size={16} aria-hidden="true" />}
      </span>
      <span className="app-toast-message">{toast.text}</span>
      {toast.confirm && <div className="app-toast-actions">
        <button type="button" className="button button-secondary" onClick={() => dismissToast(false)}>Cancel</button>
        <button type="button" className="button button-primary" onClick={() => dismissToast(true)}>Confirm</button>
      </div>}
      <button type="button" className="app-toast-close" aria-label={toast.confirm ? 'Cancel confirmation' : 'Dismiss notification'} onClick={() => dismissToast(false)}><X size={15} /></button>
    </div>}
  </ToastContext.Provider>
}
