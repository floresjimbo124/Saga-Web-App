export function formatChangeOrderNumber(projectPrefix: string, orderNumber: number) {
  return `${projectPrefix}-CO-${String(orderNumber).padStart(3, '0')}`
}
