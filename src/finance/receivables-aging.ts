export type ReceivableAgingBucket = 'not-due' | 'no-due-date' | '1-30' | '31-60' | '61+'

export type ReceivableBillingInput = {
  id: string
  projectId: string
  projectName: string
  clientName: string
  billingNumber: number
  amount: number
  issuedAt: string | null
  createdAt: string
  dueAt: string | null
}

export type ReceivablePaymentInput = {
  id: string
  projectId: string
  amount: number
  recordedAt: string
  paymentType: string
}

export type ReceivableAllocationInput = {
  paymentId: string
  billingId: string
  amount: number
}

export type ReceivableAgingItem = ReceivableBillingInput & {
  outstandingAmount: number
  bucket: ReceivableAgingBucket
  daysOverdue: number
  daysUntilDue: number | null
}

const millisecondsPerDay = 86_400_000

function dateDay(value: string) {
  const dateOnly = value.slice(0, 10)
  const [year, month, day] = dateOnly.split('-').map(Number)
  if (!year || !month || !day) return Number.NaN
  return Math.floor(Date.UTC(year, month - 1, day) / millisecondsPerDay)
}

function eventTime(value: string) {
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? 0 : parsed
}

function todayLocal() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function calculateReceivablesAging(
  billings: readonly ReceivableBillingInput[],
  payments: readonly ReceivablePaymentInput[],
  allocations: readonly ReceivableAllocationInput[] = [],
  asOfDate = todayLocal(),
): ReceivableAgingItem[] {
  const openAmounts = new Map<string, number>()
  const events = [
    ...billings.map((billing) => ({
      type: 'billing' as const,
      projectId: billing.projectId,
      time: eventTime(billing.issuedAt ?? billing.createdAt),
      billing,
    })),
    ...payments
      .filter((payment) => payment.paymentType !== 'retention_release')
      .map((payment) => ({
        type: 'payment' as const,
        projectId: payment.projectId,
        time: eventTime(payment.recordedAt),
        payment,
      })),
  ].sort((left, right) => {
    const timeDifference = left.time - right.time
    if (timeDifference !== 0) return timeDifference
    if (left.type === right.type) return 0
    return left.type === 'payment' ? -1 : 1
  })

  for (const event of events) {
    if (event.type === 'billing') {
      openAmounts.set(event.billing.id, event.billing.amount)
      continue
    }

    let remainingPayment = event.payment.amount
    const paymentAllocations = allocations.filter((allocation) => allocation.paymentId === event.payment.id)
    for (const allocation of paymentAllocations) {
      const billing = billings.find((item) => item.id === allocation.billingId && item.projectId === event.projectId)
      if (!billing) continue
      const openAmount = openAmounts.get(billing.id) ?? 0
      const appliedAmount = Math.min(openAmount, allocation.amount)
      openAmounts.set(billing.id, openAmount - appliedAmount)
      remainingPayment -= allocation.amount
    }

    const projectBillings = billings
      .filter((billing) => billing.projectId === event.projectId && openAmounts.has(billing.id))
      .sort((left, right) => eventTime(left.issuedAt ?? left.createdAt) - eventTime(right.issuedAt ?? right.createdAt)
        || left.billingNumber - right.billingNumber)
    for (const billing of projectBillings) {
      if (remainingPayment <= 0) break
      const openAmount = openAmounts.get(billing.id) ?? 0
      const appliedAmount = Math.min(openAmount, remainingPayment)
      openAmounts.set(billing.id, openAmount - appliedAmount)
      remainingPayment -= appliedAmount
    }
  }

  const currentDay = dateDay(asOfDate)
  return billings.flatMap((billing) => {
    const outstandingAmount = openAmounts.get(billing.id) ?? 0
    if (outstandingAmount <= 0) return []
    const dueDay = billing.dueAt ? dateDay(billing.dueAt) : Number.NaN
    const daysUntilDue = Number.isFinite(dueDay) ? dueDay - currentDay : null
    const daysOverdue = daysUntilDue === null ? 0 : Math.max(0, -daysUntilDue)
    const bucket: ReceivableAgingBucket = daysUntilDue === null
      ? 'no-due-date'
      : daysUntilDue >= 0
        ? 'not-due'
        : daysOverdue <= 30
          ? '1-30'
          : daysOverdue <= 60
            ? '31-60'
            : '61+'
    return [{ ...billing, outstandingAmount, bucket, daysOverdue, daysUntilDue }]
  }).sort((left, right) => {
    if (left.daysOverdue !== right.daysOverdue) return right.daysOverdue - left.daysOverdue
    if (left.dueAt === null) return right.dueAt === null ? left.billingNumber - right.billingNumber : 1
    if (right.dueAt === null) return -1
    return left.dueAt.localeCompare(right.dueAt) || left.billingNumber - right.billingNumber
  })
}