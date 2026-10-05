export type ProfitRiskLevel = 'not-rated' | 'low' | 'medium' | 'high' | 'critical'

export type ProjectProfitForecastInput = {
  contractValue: number
  recordedCosts: number
  costBudget: number | null
  estimatedCostToComplete: number | null
}

export type ProfitRiskSummary = {
  level: ProfitRiskLevel
  label: string
  tone: 'neutral' | 'green' | 'gold' | 'red'
  projectedCost: number | null
  projectedProfit: number | null
  projectedMarginPercent: number | null
  budgetVariance: number | null
  detail: string
}

export function calculateProfitRisk(input: ProjectProfitForecastInput): ProfitRiskSummary {
  const { contractValue, recordedCosts, costBudget, estimatedCostToComplete } = input
  if (!Number.isFinite(contractValue) || contractValue < 0 || !Number.isFinite(recordedCosts) || recordedCosts < 0) {
    throw new RangeError('Contract value and recorded costs must be finite, non-negative amounts.')
  }
  for (const [name, value] of [['Cost budget', costBudget], ['Estimated cost to complete', estimatedCostToComplete]] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new RangeError(`${name} must be a finite, non-negative amount.`)
    }
  }

  if (contractValue === 0 || costBudget === null || estimatedCostToComplete === null) {
    return {
      level: 'not-rated',
      label: 'Not rated',
      tone: 'neutral',
      projectedCost: null,
      projectedProfit: null,
      projectedMarginPercent: null,
      budgetVariance: null,
      detail: 'Enter a cost budget and estimate to complete',
    }
  }

  const projectedCost = recordedCosts + estimatedCostToComplete
  const projectedProfit = contractValue - projectedCost
  const projectedMarginPercent = projectedProfit / contractValue * 100
  const budgetVariance = projectedCost - costBudget
  const budgetOverrunPercent = costBudget > 0 ? budgetVariance / costBudget * 100 : null
  const highBudgetOverrun = budgetVariance > 0 && (budgetOverrunPercent === null || budgetOverrunPercent > 10)
  const budgetDetail = budgetVariance > 0
    ? budgetOverrunPercent === null ? ' · over zero budget' : ` · ${Math.round(budgetOverrunPercent)}% over budget`
    : ''
  const detail = `Projected margin ${Math.round(projectedMarginPercent)}%${budgetDetail}`

  if (projectedMarginPercent < 0) {
    return {
      level: 'critical',
      label: 'Critical / Loss',
      tone: 'red',
      projectedCost,
      projectedProfit,
      projectedMarginPercent,
      budgetVariance,
      detail,
    }
  }
  if (projectedMarginPercent < 10 || highBudgetOverrun) {
    return {
      level: 'high',
      label: 'High',
      tone: 'red',
      projectedCost,
      projectedProfit,
      projectedMarginPercent,
      budgetVariance,
      detail,
    }
  }
  if (projectedMarginPercent < 20 || budgetVariance > 0) {
    return {
      level: 'medium',
      label: 'Medium',
      tone: 'gold',
      projectedCost,
      projectedProfit,
      projectedMarginPercent,
      budgetVariance,
      detail,
    }
  }
  return {
    level: 'low',
    label: 'Low',
    tone: 'green',
    projectedCost,
    projectedProfit,
    projectedMarginPercent,
    budgetVariance,
    detail,
  }
}