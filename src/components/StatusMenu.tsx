import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type StatusMenuOption<T extends string> = {
  value: T
  label: string
  description: string
  tone: 'green' | 'amber' | 'red' | 'blue' | 'grey'
}

/** Pill-shaped status picker with a styled menu (replaces the native select). */
export function StatusMenu<T extends string>({ label, value, options, disabled, onChange }: {
  label: string
  value: T
  options: StatusMenuOption<T>[]
  disabled?: boolean
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [isSheet, setIsSheet] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches)

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px)')
    const update = () => setIsSheet(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const current = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [open])

  const openMenu = () => {
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)))
    setOpen(true)
  }

  const choose = (next: T) => {
    setOpen(false)
    buttonRef.current?.focus()
    if (next !== value) onChange(next)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMenu() }
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); setOpen(false); buttonRef.current?.focus() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (index + 1) % options.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (index - 1 + options.length) % options.length) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(options[activeIndex].value) }
    else if (event.key === 'Tab') setOpen(false)
  }

  return <div className="status-menu" ref={rootRef} onKeyDown={onKeyDown}>
    <button
      ref={buttonRef}
      type="button"
      className={`status-menu-trigger tone-${current.tone}`}
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-label={`${label}: ${current.label}`}
      disabled={disabled}
      onClick={() => open ? setOpen(false) : openMenu()}
    >
      <span className="status-menu-dot" aria-hidden="true" />
      <span>{current.label}</span>
      <ChevronDown size={14} className="status-menu-chevron" aria-hidden="true" />
    </button>
    {open && (() => { const menu = <div ref={popoverRef} className={`status-menu-popover${isSheet ? ' is-sheet' : ''}`} role="listbox" aria-label={label} aria-activedescendant={`${label}-${options[activeIndex].value}`}>
      <div className="status-menu-title">{label}</div>
      {options.map((option, index) => <div
        key={option.value}
        id={`${label}-${option.value}`}
        role="option"
        aria-selected={option.value === value}
        className={`status-menu-option tone-${option.tone}${index === activeIndex ? ' is-active' : ''}`}
        onPointerEnter={() => setActiveIndex(index)}
        onClick={() => choose(option.value)}
      >
        <span className="status-menu-dot" aria-hidden="true" />
        <span className="status-menu-copy"><strong>{option.label}</strong></span>
        {option.value === value && <Check size={15} className="status-menu-check" aria-hidden="true" />}
      </div>)}
    </div>
    return isSheet ? createPortal(<div className="status-menu-sheet-backdrop">{menu}</div>, document.body) : menu })()}
  </div>
}
