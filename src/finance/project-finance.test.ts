import { describe, expect, it } from 'vitest'
import { calculateProjectFinance, type ProjectFinanceInput } from './project-finance'

const defaultInput: ProjectFinanceInput = {
  contractAmount: 1_000_000,
  progressPercent: 0,
  retentionRatePercent: 5,
  retentionMethod: 'final-schedule',
  billedToDate: 0,
  paymentsReceived: 0,
  retentionHeld: 0,
}

function calculate(overrides: Partial<ProjectFinanceInput> = {}) {
  return calculateProjectFinance({ ...defaultInput, ...overrides })
}

describe('calculateProjectFinance', () => {
  it('credits all payments, including a down payment, against earned work', () => {
    const result = calculate({ progressPercent: 60, paymentsReceived: 450_000 })

    expect(result.earnedToDate).toBe(600_000)
    expect(result.billableEarnedToDate).toBe(600_000)
    expect(result.amountForBilling).toBe(150_000)
  })

  it('caps billings at contract value less retention until release', () => {
    const held = calculate({ progressPercent: 100 })
    const partiallyReleased = calculate({ progressPercent: 100, retentionHeld: 50_000, retentionReleased: 25_000 })

    expect(held.retentionCap).toBe(50_000)
    expect(held.billableCeiling).toBe(950_000)
    expect(held.billableEarnedToDate).toBe(950_000)
    expect(partiallyReleased.billableCeiling).toBe(975_000)
  })

  it('excludes held retention from receivables only when deducted from each billing', () => {
    const billingRetention = calculate({
      retentionMethod: 'per-billing', billedToDate: 500_000, paymentsReceived: 300_000, retentionHeld: 25_000,
    })
    const finalScheduleRetention = calculate({
      retentionMethod: 'final-schedule', billedToDate: 500_000, paymentsReceived: 300_000, retentionHeld: 25_000,
    })

    expect(billingRetention.receivablesDue).toBe(175_000)
    expect(finalScheduleRetention.receivablesDue).toBe(200_000)
  })

  it('does not report retention exceeding unpaid billings as overdue', () => {
    const result = calculate({
      retentionMethod: 'per-billing', billedToDate: 500_000, paymentsReceived: 480_000, retentionHeld: 25_000,
    })

    expect(result.receivablesDue).toBe(0)
  })

  it('applies discounts and approved change-order retention rates', () => {
    const result = calculate({
      specialDiscount: 50_000,
      progressPercent: 100,
      approvedChangeOrders: [
        { amount: 100_000, approved: true },
        { amount: 50_000, approved: true, retentionRatePercent: 10 },
        { amount: 500_000, approved: false, retentionRatePercent: 50 },
      ],
    })

    expect(result.contractValue).toBe(1_100_000)
    expect(result.retentionCap).toBe(57_500)
    expect(result.billableCeiling).toBe(1_042_500)
  })

  it('reports amounts outside the retention-limited cap', () => {
    const result = calculate({ progressPercent: 100, billedToDate: 980_000 })

    expect(result.overbilledAmount).toBe(30_000)
  })

  it('rejects percentages outside their valid range', () => {
    expect(() => calculate({ progressPercent: 101 })).toThrow(RangeError)
    expect(() => calculate({ retentionRatePercent: -1 })).toThrow(RangeError)
  })

  it('does not release more retention than is currently held', () => {
    expect(() => calculate({ retentionHeld: 10_000, retentionReleased: 15_000 })).toThrow(RangeError)
  })

  it('caps over-held retention to the current cap so stale ledger values cannot distort receivables', () => {
    const result = calculate({
      retentionMethod: 'per-billing',
      billedToDate: 500_000,
      paymentsReceived: 300_000,
      retentionHeld: 60_000,
    })

    expect(result.receivablesDue).toBe(150_000)
  })
})