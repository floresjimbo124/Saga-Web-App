import { describe, expect, it } from 'vitest'
import { calculateCostPace } from './cost-pace'

describe('calculateCostPace', () => {
  it('does not rate projects without a positive cost budget', () => {
    expect(calculateCostPace({ costBudget: null, recordedCosts: 100, progressPercent: 50 }).level).toBe('not-rated')
    expect(calculateCostPace({ costBudget: 0, recordedCosts: 100, progressPercent: 50 }).level).toBe('not-rated')
  })

  it('is on pace when spending keeps up with progress', () => {
    expect(calculateCostPace({ costBudget: 1_000_000, recordedCosts: 600_000, progressPercent: 60 })).toMatchObject({
      level: 'on-pace', budgetUsedPercent: 60, gapPercent: 0,
    })
    expect(calculateCostPace({ costBudget: 1_000_000, recordedCosts: 300_000, progressPercent: 65 }).level).toBe('on-pace')
  })

  it('warns when spending runs 5 to 15 points ahead of progress', () => {
    expect(calculateCostPace({ costBudget: 1_000_000, recordedCosts: 750_000, progressPercent: 65 })).toMatchObject({
      level: 'watch', gapPercent: 10,
    })
  })

  it('flags overspending when spending runs more than 15 points ahead', () => {
    const pace = calculateCostPace({ costBudget: 1_000_000, recordedCosts: 800_000, progressPercent: 60 })
    expect(pace.level).toBe('overspending')
    expect(pace.detail).toBe('80% of budget spent at 60% complete')
  })

  it('clamps progress to 0-100', () => {
    expect(calculateCostPace({ costBudget: 100, recordedCosts: 0, progressPercent: 140 }).progressPercent).toBe(100)
  })
})
