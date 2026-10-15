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
  changeOrders: [],
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

  it('keeps payments from the original contract from reducing a change-order billing', () => {
    expect(calculateClientProjectReceivables([{
      ...project,
      downPaymentAmount: 0,
      billings: [{
        id: 'change-order-billing',
        contractId: 'contract-1',
        number: 1,
        amount: 50_000,
        issuedAt: '2026-10-02T00:00:00Z',
        createdAt: '2026-10-02T00:00:00Z',
        dueAt: '2026-10-15',
      }],
      changeOrders: [{
        id: 'change-order-1',
        contractId: 'contract-1',
        amount: 50_000,
        status: 'approved',
        approvedAt: '2026-10-02T00:00:00Z',
      }],
      payments: [{
        id: 'original-contract-payment',
        contractId: null,
        amount: 40_000,
        recordedAt: '2026-10-03T00:00:00Z',
        paymentType: 'progress',
      }],
    }], '2026-10-03')).toMatchObject([{
      id: 'change-order:change-order-1',
      contractId: 'contract-1',
      amount: 50_000,
      outstandingAmount: 50_000,
    }])
  })

  it('includes unpaid approved change orders in the client due balance and subtracts their contract payments', () => {
    const receivables = calculateClientProjectReceivables([{
      ...project,
      downPaymentAmount: 0,
      changeOrders: [{
        id: 'change-order-1',
        contractId: 'contract-1',
        amount: 426_331,
        status: 'approved',
        approvedAt: '2026-10-12T00:00:00Z',
      }],
      billings: [{
        id: 'change-order-billing',
        contractId: 'contract-1',
        number: 1,
        amount: 100_000,
        issuedAt: '2026-10-12T00:00:00Z',
        createdAt: '2026-10-12T00:00:00Z',
        dueAt: null,
      }],
      payments: [{
        id: 'payment-1',
        contractId: 'contract-1',
        amount: 100_000,
        recordedAt: '2026-10-13T00:00:00Z',
        paymentType: 'progress',
      }],
    }], '2026-10-13')

    expect(receivables).toMatchObject([{
      id: 'change-order:change-order-1',
      amount: 426_331,
      outstandingAmount: 326_331,
    }])
  })
})
