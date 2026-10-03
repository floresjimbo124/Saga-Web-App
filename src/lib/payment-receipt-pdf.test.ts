import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPaymentReceiptPdf, getCurrentReceiptDate } from './payment-receipt-pdf'

afterEach(() => {
  vi.useRealTimers()
})

describe('createPaymentReceiptPdf', () => {
  it('uses the current local date on the acknowledgement receipt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-03T08:00:00'))
    expect(getCurrentReceiptDate()).toBe('2026-10-03')
    const pdf = await createPaymentReceiptPdf({
      projectName: 'Harbor Office',
      payerName: 'Northwind Builders',
      receiptNumber: 'SAL-0002',
      amount: 125000,
      paymentType: 'down_payment',
      paymentMode: 'bank_transfer',
      reference: 'BANK-REF-12',
    })
    const output = pdf.output()

    expect(output.startsWith('%PDF-')).toBe(true)
    expect(pdf.getFontList().Roboto).toEqual(['normal', 'bold'])
    expect(output).toContain('/XObject')
  })
})