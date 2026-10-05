export function formatBillingNumber(number: number) {
  return String(number).padStart(3, '0')
}
