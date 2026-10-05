export function parseMoneyInput(value: string) {
  return Number(value.replaceAll(',', ''))
}

export function formatMoneyInput(value: string) {
  const cleaned = value.replace(/[^\d.]/g, '')
  const decimalIndex = cleaned.indexOf('.')
  const integerPart = decimalIndex === -1 ? cleaned : cleaned.slice(0, decimalIndex)
  const decimalPart = decimalIndex === -1 ? '' : `.${cleaned.slice(decimalIndex + 1).replaceAll('.', '')}`
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${groupedInteger}${decimalPart}`
}

export function normalizeMoneyInput(value: string) {
  return formatMoneyInput(value).replaceAll(',', '')
}
