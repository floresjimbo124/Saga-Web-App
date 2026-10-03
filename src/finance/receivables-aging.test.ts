import { describe, expect, it } from 'vitest'
import { calculateReceivablesAging, type ReceivableBillingInput, type ReceivablePaymentInput } from './receivables-aging'

const firstBilling: ReceivableBillingInput = {
  id: 'billing-1', projectId: 'project-1', projectName: 'Harbor Office', clientName: 'Northwind',
  billingNumber: 1, amount: 100, issuedAt: '2026-10-01T09:00:00Z', createdAt: '2026-10-01T09:00:00Z', dueAt: '2026-10-02',
}
const secondBilling: ReceivableBillingInput = {
  id: 'billing-2', projectId: 'project-1', projectName: 'Harbor Office', clientName: 'Northwind',
  billingNumber: 2, amount: 80, issuedAt: '2026-10-02T09:00:00Z', createdAt: '2026-10-02T09:00:00Z', dueAt: '2026-10-05',
}

describe('calculateReceivablesAging', () => {
  it('allocates payments only to bills issued by receipt time, oldest first', () => {
    const payments: ReceivablePaymentInput[] = [
      { id: 'payment-1', projectId: 'project-1', amount: 50, recordedAt: '2026-10-01T08:00:00Z', paymentType: 'down_payment' },
      { id: 'payment-2', projectId: 'project-1', amount: 30, recordedAt: '2026-10-01T10:00:00Z', paymentType: 'progress' },
      { id: 'payment-3', projectId: 'project-1', amount: 50, recordedAt: '2026-10-02T10:00:00Z', paymentType: 'progress' },
    ]

    const result = calculateReceivablesAging([firstBilling, secondBilling], payments, [], '2026-10-03')

    expect(result).toMatchObject([
      { id: 'billing-1', outstandingAmount: 20, bucket: '1-30', daysOverdue: 1 },
      { id: 'billing-2', outstandingAmount: 80, bucket: 'not-due', daysUntilDue: 2 },
    ])
  })

  it('places balances into due-date buckets and leaves bills without dates unaged', () => {
    const older = { ...firstBilling, dueAt: '2026-08-01' }
    const noDueDate = { ...secondBilling, id: 'billing-3', billingNumber: 3, dueAt: null }

    const result = calculateReceivablesAging([older, noDueDate], [], [], '2026-10-03')

    expect(result).toMatchObject([
      { id: 'billing-1', bucket: '61+', daysOverdue: 63 },
      { id: 'billing-3', bucket: 'no-due-date', daysOverdue: 0, daysUntilDue: null },
    ])
  })

  it('does not apply retention releases to issued billings', () => {
    const payment: ReceivablePaymentInput = {
      id: 'payment-1', projectId: 'project-1', amount: 100, recordedAt: '2026-10-01T10:00:00Z', paymentType: 'retention_release',
    }

    const [result] = calculateReceivablesAging([firstBilling], [payment], [], '2026-10-03')

    expect(result.outstandingAmount).toBe(100)
  })

  it('removes an overdue billing after a full payment is recorded with a backdated received date', () => {
    const payments: ReceivablePaymentInput[] = [{
      id: 'payment-1', projectId: 'project-1', amount: 100, recordedAt: '2026-10-03T10:00:00Z', paymentType: 'progress',
    }]

    const result = calculateReceivablesAging([firstBilling], payments, [], '2026-10-03')

    expect(result).toEqual([])
  })

  it('shows only the remaining overdue balance after a partial payment', () => {
    const payments: ReceivablePaymentInput[] = [{
      id: 'payment-1', projectId: 'project-1', amount: 60, recordedAt: '2026-10-03T10:00:00Z', paymentType: 'progress',
    }]

    const [result] = calculateReceivablesAging([firstBilling], payments, [], '2026-10-03')

    expect(result).toMatchObject({ id: 'billing-1', outstandingAmount: 40, bucket: '1-30' })
  })

  it('applies explicit allocations to the selected billing and sends only the remainder FIFO', () => {
    const payment: ReceivablePaymentInput = {
      id: 'payment-2', projectId: 'project-1', amount: 100, recordedAt: '2026-10-03T10:00:00Z', paymentType: 'progress',
    }
    const allocations = [{ paymentId: 'payment-2', billingId: 'billing-2', amount: 70 }]

    const result = calculateReceivablesAging([firstBilling, secondBilling], [payment], allocations, '2026-10-03')

    expect(result).toMatchObject([
      { id: 'billing-1', outstandingAmount: 70, bucket: '1-30' },
      { id: 'billing-2', outstandingAmount: 10, bucket: 'not-due' },
    ])
  })
})