import { describe, expect, it } from 'vitest'
import { formatBillingNumber } from './billing-number'

describe('formatBillingNumber', () => {
  it('pads billing numbers to at least three digits', () => {
    expect(formatBillingNumber(1)).toBe('001')
    expect(formatBillingNumber(12)).toBe('012')
    expect(formatBillingNumber(123)).toBe('123')
    expect(formatBillingNumber(1234)).toBe('1234')
  })
})
