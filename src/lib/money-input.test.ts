import { describe, expect, it } from 'vitest'
import { formatMoneyInput, normalizeMoneyInput, parseMoneyInput } from './money-input'

describe('money input formatting', () => {
  it('adds grouping commas while retaining decimals as typed', () => {
    expect(formatMoneyInput('1234')).toBe('1,234')
    expect(formatMoneyInput('1234567.89')).toBe('1,234,567.89')
    expect(formatMoneyInput('1234.')).toBe('1,234.')
  })

  it('normalizes pasted currency text and ignores extra decimal separators', () => {
    expect(normalizeMoneyInput('₱1,234.50')).toBe('1234.50')
    expect(formatMoneyInput('1.2.3')).toBe('1.23')
  })

  it('parses grouped amounts to numbers', () => {
    expect(parseMoneyInput('1,234.50')).toBe(1234.5)
    expect(parseMoneyInput('')).toBe(0)
  })
})
