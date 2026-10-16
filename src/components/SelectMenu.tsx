import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export type SelectMenuOption<T extends string> = { value: T; label: string }

/**
 * Form-field dropdown with a styled list. The list is rendered on <body> and placed under
 * the field, so dialogs and scroll containers can't clip it.
 */
export function SelectMenu<T extends string>({ id, label, value, options, onChange, disabled }: {
  id?: string
  label: string
  value: T
  options: SelectMenuOption<T>[]
  onChange: (value: T) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [position, setPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const current = options.find((option) => option.value === value) ?? options[0]

  useEffect(() => {
    if (!open) return
    const place = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const below = window.innerHeight - rect.bottom - 12
      const above = rect.top - 12
      const openUp = below < 220 && above > below
      const maxHeight = Math.max(160, Math.min(320, openUp ? above : below))
      setPosition({ top: openUp ? rect.top - 6 - maxHeight : rect.bottom + 6, left: rect.left, width: rect.width, maxHeight })
    }
    place()
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (!buttonRef.current?.contains(target) && !listRef.current?.contains(target)) setOpen(false)
    }
    const onScroll = (event: Event) => { if (!listRef.current?.contains(event.target as Node)) setOpen(false) }
    window.addEventListener('pointerdown', onPointer)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('pointerdown', onPointer)
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [open])

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>('.is-active')?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  const openList = () => {
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
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) { event.preventDefault(); openList() }
      return
    }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setOpen(false); buttonRef.current?.focus() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => (index + 1) % options.length) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => (index - 1 + options.length) % options.length) }
    else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(options[activeIndex].value) }
    else if (event.key === 'Tab') setOpen(false)
  }

  const listId = `${id ?? label.replace(/\s+/g, '-').toLowerCase()}-options`

  return <div className="select-menu" onKeyDown={onKeyDown}>
    <button
      ref={buttonRef}
      id={id}
      type="button"
      className="select-menu-field"
      aria-haspopup="listbox"
      aria-expanded={open}
      aria-controls={open ? listId : undefined}
      aria-label={`${label}: ${current?.label ?? ''}`}
      disabled={disabled}
      onClick={() => open ? setOpen(false) : openList()}
    >
      <span>{current?.label}</span>
      <ChevronDown size={16} className="select-menu-chevron" aria-hidden="true" />
    </button>
    {open && createPortal(<div
      ref={listRef}
      id={listId}
      className="select-menu-list"
      role="listbox"
      aria-label={label}
      aria-activedescendant={`${listId}-${options[activeIndex]?.value}`}
      style={position ? { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight } : { visibility: 'hidden' }}
    >
      {options.map((option, index) => <div
        key={option.value}
        id={`${listId}-${option.value}`}
        role="option"
        aria-selected={option.value === value}
        className={`select-menu-option${index === activeIndex ? ' is-active' : ''}${option.value === value ? ' is-selected' : ''}`}
        onPointerEnter={() => setActiveIndex(index)}
        onClick={() => choose(option.value)}
      >
        <span>{option.label}</span>
        {option.value === value && <Check size={15} aria-hidden="true" />}
      </div>)}
    </div>, document.body)}
  </div>
}
