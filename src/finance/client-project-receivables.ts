import { calculateReceivablesAging, type ReceivableAgingItem } from './receivables-aging'

type ClientReceivableProject = {
  id: string
  name: string
  clientName: string
  createdAt: string
  downPaymentAmount: number
  billings: {
    id: string
    number: number
    amount: number
    issuedAt: string | null
    createdAt: string
    dueAt: string | null
  }[]
  payments: {
    id: string
    amount: number
    recordedAt: string
    paymentType: string
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
        projectName: project.name,
        clientName: project.clientName,
        billingNumber: 0,
        amount: project.downPaymentAmount,
        issuedAt: project.createdAt,
        createdAt: project.createdAt,
        dueAt: null,
        kind: 'down-payment' as const,
      }] : []),
      ...project.billings.map((billing) => ({
        id: billing.id,
        projectId: project.id,
        projectName: project.name,
        clientName: project.clientName,
        billingNumber: billing.number,
        amount: billing.amount,
        issuedAt: billing.issuedAt,
        createdAt: billing.createdAt,
        dueAt: billing.dueAt,
        kind: 'billing' as const,
      })),
    ]),
    projects.flatMap((project) => project.payments.map((payment) => ({
      id: payment.id,
      projectId: project.id,
      amount: payment.amount,
      recordedAt: payment.recordedAt,
      paymentType: payment.paymentType,
    }))),
    projects.flatMap((project) => project.allocations),
    asOfDate,
  )
}
