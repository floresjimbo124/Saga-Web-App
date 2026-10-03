export type RetentionMethod = 'final-schedule' | 'per-billing'

export type ApprovedChangeOrder = {
  amount: number
  approved: boolean
  retentionRatePercent?: number
}

export type ProjectFinanceInput = {
  contractAmount: number
  specialDiscount?: number
  approvedChangeOrders?: readonly ApprovedChangeOrder[]
  progressPercent: number
  retentionRatePercent: number
  retentionMethod: RetentionMethod
  billedToDate: number
  paymentsReceived: number
  retentionHeld: number
  retentionReleased?: number
}

export type ProjectFinanceSummary = {
  contractValue: number
  retentionCap: number
  retentionRemaining: number
  billableCeiling: number
  earnedToDate: number
  billableEarnedToDate: number
  amountForBilling: number
  unbilledBillable: number
  receivablesDue: number
  overbilledAmount: number
}

function requireAmount(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, non-negative amount.`)
  }
}

function requirePercent(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new RangeError(`${name} must be between 0 and 100.`)
  }
}

export function calculateProjectFinance(input: ProjectFinanceInput): ProjectFinanceSummary {
  const discount = input.specialDiscount ?? 0
  const changeOrders = input.approvedChangeOrders ?? []
  const released = input.retentionReleased ?? 0

  requireAmount('Contract amount', input.contractAmount)
  requireAmount('Special discount', discount)
  requireAmount('Billed to date', input.billedToDate)
  requireAmount('Payments received', input.paymentsReceived)
  requireAmount('Retention held', input.retentionHeld)
  requireAmount('Retention released', released)
  requirePercent('Progress', input.progressPercent)
  requirePercent('Retention rate', input.retentionRatePercent)

  if (discount > input.contractAmount) {
    throw new RangeError('Special discount cannot exceed the contract amount.')
  }

  const discountedContract = input.contractAmount - discount
  const approvedOrders = changeOrders.filter((order) => order.approved)
  for (const order of approvedOrders) {
    requireAmount('Approved change order', order.amount)
    if (order.retentionRatePercent !== undefined) {
      requirePercent('Change order retention rate', order.retentionRatePercent)
    }
  }

  const approvedChangeOrderTotal = approvedOrders.reduce((sum, order) => sum + order.amount, 0)
  const contractValue = Math.round(discountedContract + approvedChangeOrderTotal)
  const baseRetention = discountedContract * input.retentionRatePercent / 100
  const changeOrderRetention = approvedOrders.reduce(
    (sum, order) => sum + order.amount * (order.retentionRatePercent ?? input.retentionRatePercent) / 100,
    0,
  )
  const retentionCap = Math.round(baseRetention + changeOrderRetention)

  if (released > retentionCap) {
    throw new RangeError('Retention released cannot exceed the retention cap.')
  }
  if (released > input.retentionHeld) {
    throw new RangeError('Retention released cannot exceed retention currently held.')
  }

  const normalizedRetentionHeld = Math.min(Math.max(input.retentionHeld, 0), retentionCap)
  const retentionRemaining = retentionCap - released
  const billableCeiling = contractValue - retentionRemaining
  const earnedToDate = Math.round(contractValue * input.progressPercent / 100)
  const billableEarnedToDate = Math.min(earnedToDate, billableCeiling)
  const amountForBilling = Math.max(0, billableEarnedToDate - input.paymentsReceived)
  const unpaidBilledAmount = Math.max(0, input.billedToDate - input.paymentsReceived)
  const retentionDeduction = input.retentionMethod === 'per-billing'
    ? Math.min(unpaidBilledAmount, normalizedRetentionHeld)
    : 0

  return {
    contractValue,
    retentionCap,
    retentionRemaining,
    billableCeiling,
    earnedToDate,
    billableEarnedToDate,
    amountForBilling,
    unbilledBillable: Math.max(0, billableEarnedToDate - input.billedToDate),
    receivablesDue: Math.max(0, unpaidBilledAmount - retentionDeduction),
    overbilledAmount: Math.max(0, input.billedToDate - billableCeiling),
  }
}