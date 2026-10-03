import { describe, expect, it } from 'vitest'
import { calculateProfitRisk } from './profit-risk'

describe('calculateProfitRisk', () => {
  const baseline = { contractValue: 1_000_000, recordedCosts: 300_000, costBudget: 700_000, estimatedCostToComplete: 300_000 }

  it('does not rate projects until budget and estimated remaining cost are entered', () => {
    expect(calculateProfitRisk({ ...baseline, costBudget: null }).level).toBe('not-rated')
    expect(calculateProfitRisk({ ...baseline, estimatedCostToComplete: null }).level).toBe('not-rated')
  })

  it('calculates projected final cost, profit, margin, and budget variance', () => {
    expect(calculateProfitRisk(baseline)).toMatchObject({
      level: 'low', label: 'Low', tone: 'green', projectedCost: 600_000,
      projectedProfit: 400_000, projectedMarginPercent: 40, budgetVariance: -100_000,
    })
  })

  it('marks a forecast below 20 percent margin as medium', () => {
    expect(calculateProfitRisk({ ...baseline, costBudget: 820_000, estimatedCostToComplete: 520_000 })).toMatchObject({
      level: 'medium', label: 'Medium', projectedMarginPercent: 18,
    })
  })

  it('marks a projected margin below 10 percent as high', () => {
    expect(calculateProfitRisk({ ...baseline, estimatedCostToComplete: 620_000 })).toMatchObject({
      level: 'high', label: 'High', projectedMarginPercent: 8,
    })
  })

  it('raises risk when forecast cost overruns the budget', () => {
    expect(calculateProfitRisk({ ...baseline, costBudget: 500_000 })).toMatchObject({
      level: 'high', budgetVariance: 100_000,
    })
    expect(calculateProfitRisk({ ...baseline, costBudget: 550_000 })).toMatchObject({
      level: 'medium', budgetVariance: 50_000,
    })
    expect(calculateProfitRisk({ ...baseline, costBudget: 0 }).detail).toContain('over zero budget')
  })

  it('rejects invalid amounts', () => {
    expect(() => calculateProfitRisk({ ...baseline, contractValue: -1 })).toThrow(RangeError)
    expect(() => calculateProfitRisk({ ...baseline, estimatedCostToComplete: Number.NaN })).toThrow(RangeError)
  })
})