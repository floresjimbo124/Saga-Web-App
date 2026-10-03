import { describe, expect, it } from 'vitest'
import { calculateClientProjectReceivables } from './client-project-receivables'

const project = {
  id: 'project-1',
  name: 'Harbor Office',
  clientName: 'Northwind Builders',
  createdAt: '2026-10-01T00:00:00Z',
  downPaymentAmount: 100_000,
  billings: [],
  payments: [],
  allocations: [],
}

describe('client project receivables', () => {
  it('includes an unpaid contractual down payment before progress billings are issued', () => {
    expect(calculateClientProjectReceivables([project], '2026-10-03')).toMatchObject([{
      id: 'down-payment:project-1',
      kind: 'down-payment',
      amount: 100_000,
      outstandingAmount: 100_000,
      daysOverdue: 0,
    }])
  })

  it('applies recorded payments to the down payment before later billings', () => {
    const receivables = calculateClientProjectReceivables([{
      ...project,
      billings: [{
        id: 'billing-1',
        number: 1,
        amount: 50_000,
        issuedAt: '2026-10-02T00:00:00Z',
        createdAt: '2026-10-02T00:00:00Z',
        dueAt: '2026-10-15',
      }],
      payments: [{
        id: 'payment-1',
        amount: 125_000,
        recordedAt: '2026-10-03T00:00:00Z',
        paymentType: 'down_payment',
      }],
    }], '2026-10-03')

    expect(receivables).toMatchObject([{
      id: 'billing-1',
      outstandingAmount: 25_000,
    }])
  })

  it('retains only the unpaid portion of the down payment', () => {
    expect(calculateClientProjectReceivables([{
      ...project,
      payments: [{
        id: 'payment-1',
        amount: 40_000,
        recordedAt: '2026-10-03T00:00:00Z',
        paymentType: 'down_payment',
      }],
    }], '2026-10-03')).toMatchObject([{
      id: 'down-payment:project-1',
      amount: 100_000,
      outstandingAmount: 60_000,
    }])
  })
})
