export type PaymentType = 'down_payment' | 'progress' | 'change_order' | 'retention_release' | 'other'

const paymentTypeLabels: Record<PaymentType, string> = {
  down_payment: 'Down payment',
  progress: 'Progress payment',
  change_order: 'Change order payment',
  retention_release: 'Retention release',
  other: 'Other payment',
}

export function formatPaymentType(paymentType: PaymentType) {
  return paymentTypeLabels[paymentType]
}
