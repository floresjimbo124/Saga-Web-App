import { describe, expect, it } from 'vitest'
import { formatBillingNumber, receivableLabel } from './billing-number'

describe('formatBillingNumber', () => {
  it('pads billing numbers to at least three digits', () => {
    expect(formatBillingNumber(1)).toBe('001')
    expect(formatBillingNumber(12)).toBe('012')
    expect(formatBillingNumber(123)).toBe('123')
    expect(formatBillingNumber(1234)).toBe('1234')
  })
})

describe('receivableLabel', () => {
  it('numbers real progress billings', () => {
    expect(receivableLabel({ kind: 'billing', billingNumber: 2 })).toBe('Billing #002')
  })

  it('never shows the placeholder number 0', () => {
    expect(receivableLabel({ kind: 'change-order', billingNumber: 0 })).toBe('Change order')
    expect(receivableLabel({ kind: 'down-payment', billingNumber: 0 })).toBe('Contract down payment')
    expect(receivableLabel({ kind: 'retention', billingNumber: 0 })).toBe('Retention release')
    expect(receivableLabel({ billingNumber: 0 })).toBe('Billing')
  })
})
