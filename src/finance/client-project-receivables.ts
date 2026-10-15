import { calculateReceivablesAging, type ReceivableAgingItem } from './receivables-aging'

type ClientReceivableProject = {
  id: string
  name: string
  clientName: string
  createdAt: string
  downPaymentAmount: number
  billings: {
    id: string
    contractId?: string | null
    number: number
    amount: number
    issuedAt: string | null
    createdAt: string
    dueAt: string | null
  }[]
  payments: {
    id: string
    contractId?: string | null
    amount: number
    recordedAt: string
    paymentType: string
  }[]
  changeOrders: {
    id: string
    contractId: string | null
    amount: number
    status: 'pending_approval' | 'approved'
    approvedAt: string
  }[]
  allocations: {
    paymentId: string
    billingId: string
    amount: number
  }[]
}

export function calculateClientProjectReceivables(
  projects: readonly ClientReceivableProject[],
  asOfDate?: string,
): ReceivableAgingItem[] {
  return calculateReceivablesAging(
    projects.flatMap((project) => [
      ...(project.downPaymentAmount > 0 ? [{
        id: `down-payment:${project.id}`,
        projectId: project.id,
        contractId: null,
        projectName: project.name,
        clientName: project.clientName,
        billingNumber: 0,
        amount: project.downPaymentAmount,
        issuedAt: project.createdAt,
        createdAt: project.createdAt,
        dueAt: null,
        kind: 'down-payment' as const,
      }] : []),
      ...project.billings
        .filter((billing) => !project.changeOrders.some((order) => order.status === 'approved' && order.contractId === billing.contractId))
        .map((billing) => ({
          id: billing.id,
          projectId: project.id,
          contractId: billing.contractId,
          projectName: project.name,
          clientName: project.clientName,
          billingNumber: billing.number,
          amount: billing.amount,
          issuedAt: billing.issuedAt,
          createdAt: billing.createdAt,
          dueAt: billing.dueAt,
          kind: 'billing' as const,
        })),
      ...project.changeOrders
        .filter((changeOrder) => changeOrder.status === 'approved' && changeOrder.contractId)
        .map((changeOrder) => ({
          id: `change-order:${changeOrder.id}`,
          projectId: project.id,
          contractId: changeOrder.contractId,
          projectName: project.name,
          clientName: project.clientName,
          billingNumber: 0,
          amount: changeOrder.amount,
          issuedAt: changeOrder.approvedAt,
          createdAt: changeOrder.approvedAt,
          dueAt: null,
          kind: 'change-order' as const,
        })),
    ]),
    projects.flatMap((project) => project.payments.map((payment) => ({
      id: payment.id,
      projectId: project.id,
      contractId: payment.contractId,
      amount: payment.amount,
      recordedAt: payment.recordedAt,
      paymentType: payment.paymentType,
    }))),
    projects.flatMap((project) => project.allocations),
    asOfDate,
  )
}
