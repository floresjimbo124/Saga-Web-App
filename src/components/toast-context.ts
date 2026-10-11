import { createContext, useContext } from 'react'

export type ToastContextValue = {
  showToast: (message: string, action?: 'create' | 'update' | 'delete') => void
  confirmToast: (message: string) => Promise<boolean>
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within ToastProvider.')
  return context
}
