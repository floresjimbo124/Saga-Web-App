export function formatBillingNumber(number: number) {
  return String(number).padStart(3, '0')
}

/**
 * Human label for an open receivable. Only real progress billings have a billing number;
 * down payments, change orders and retention use a placeholder number of 0 and get a name instead.
 */
export function receivableLabel(item: { kind?: 'billing' | 'down-payment' | 'change-order' | 'retention'; billingNumber: number }) {
  if (item.kind === 'retention') return 'Retention release'
  if (item.kind === 'down-payment') return 'Contract down payment'
  if (item.kind === 'change-order') return item.billingNumber > 0 ? `Change order billing #${formatBillingNumber(item.billingNumber)}` : 'Change order'
  return item.billingNumber > 0 ? `Billing #${formatBillingNumber(item.billingNumber)}` : 'Billing'
}
