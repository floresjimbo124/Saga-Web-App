import { useRef, type ChangeEvent, type InputHTMLAttributes } from 'react'
import { formatMoneyInput, normalizeMoneyInput } from '../lib/money-input'

export function MoneyInput({ value, onChange, ...inputProps }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string
  onChange: (value: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.target.value
    const caret = event.target.selectionStart ?? rawValue.length
    const formatted = formatMoneyInput(rawValue)
    const beforeCaret = formatMoneyInput(rawValue.slice(0, caret))
    const normalizedBeforeCaret = normalizeMoneyInput(beforeCaret)
    onChange(normalizeMoneyInput(formatted))

    requestAnimationFrame(() => {
      if (!inputRef.current) return
      let position = 0
      let meaningfulCharacters = 0
      const targetCount = normalizedBeforeCaret.length
      while (position < formatted.length && meaningfulCharacters < targetCount) {
        if (formatted[position] !== ',') meaningfulCharacters += 1
        position += 1
      }
      inputRef.current.setSelectionRange(position, position)
    })
  }

  return <input
    {...inputProps}
    ref={inputRef}
    type="text"
    inputMode="decimal"
    value={formatMoneyInput(value)}
    onChange={handleChange}
  />
}
