import { describe, expect, it } from 'vitest'
import { createPaymentReceiptPdf } from './payment-receipt-pdf'

describe('createPaymentReceiptPdf', () => {
  it('creates an acknowledgement receipt with the payment details', async () => {
    const pdf = await createPaymentReceiptPdf({
      projectName: 'Harbor Office',
      payerName: 'Northwind Builders',
      receiptNumber: 'SAL-0002',
      amount: 125000,
      receivedDate: '2026-10-01',
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