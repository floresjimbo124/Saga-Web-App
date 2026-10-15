export type CostPaceLevel = 'not-rated' | 'on-pace' | 'watch' | 'overspending'

export type CostPaceSummary = {
  level: CostPaceLevel
  label: string
  budgetUsedPercent: number | null
  progressPercent: number
  gapPercent: number | null
  detail: string
}

/**
 * Compares how much of the cost budget has been spent with how much of the work is done.
 * Spending well ahead of progress is the earliest warning that a project will overrun.
 */
export function calculateCostPace(input: { costBudget: number | null; recordedCosts: number; progressPercent: number }): CostPaceSummary {
  const progressPercent = Math.min(100, Math.max(0, Number.isFinite(input.progressPercent) ? input.progressPercent : 0))
  if (input.costBudget === null || !Number.isFinite(input.costBudget) || input.costBudget <= 0) {
    return { level: 'not-rated', label: 'No budget', budgetUsedPercent: null, progressPercent, gapPercent: null, detail: 'Set a cost budget to compare spending with progress' }
  }

  const budgetUsedPercent = Math.max(0, input.recordedCosts) / input.costBudget * 100
  const gapPercent = budgetUsedPercent - progressPercent
  const rounded = (value: number) => Math.round(value)

  if (gapPercent > 15) {
    return { level: 'overspending', label: 'Overspending', budgetUsedPercent, progressPercent, gapPercent, detail: `${rounded(budgetUsedPercent)}% of budget spent at ${rounded(progressPercent)}% complete` }
  }
  if (gapPercent > 5) {
    return { level: 'watch', label: 'Watch costs', budgetUsedPercent, progressPercent, gapPercent, detail: `Spending ${rounded(gapPercent)} points ahead of progress` }
  }
  return { level: 'on-pace', label: 'On pace', budgetUsedPercent, progressPercent, gapPercent, detail: `${rounded(budgetUsedPercent)}% of budget spent at ${rounded(progressPercent)}% complete` }
}
