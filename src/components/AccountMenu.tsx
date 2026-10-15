import { useEffect, useRef, useState } from 'react'
import { ChevronRight, LogOut, UserRound } from 'lucide-react'

export function AccountMenu({ name, caption, photoUrl, onOpenProfile, onSignOut }: {
  name: string
  caption: string
  photoUrl?: string
  onOpenProfile: () => void
  onSignOut: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !container.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [isOpen])

  const initial = name.trim().charAt(0).toUpperCase()
  return <div className="client-account" ref={container}>
    <button type="button" className="client-account-button" aria-haspopup="menu" aria-expanded={isOpen} onClick={() => setIsOpen((open) => !open)}>
      <span className="client-account-avatar">{photoUrl ? <img src={photoUrl} alt="" /> : initial || <UserRound size={15} />}</span>
      <span className="client-account-name">{name}</span>
      <ChevronRight className="client-account-caret" size={14} aria-hidden="true" />
    </button>
    {isOpen && <div className="client-account-menu" role="menu">
      <div className="client-account-menu-head"><strong>{name}</strong><small>{caption}</small></div>
      <button type="button" role="menuitem" onClick={() => { setIsOpen(false); onOpenProfile() }}><UserRound size={15} />Profile</button>
      <button type="button" role="menuitem" className="is-danger" onClick={onSignOut}><LogOut size={15} />Sign out</button>
    </div>}
  </div>
}
