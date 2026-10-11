import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPaymentReceiptPdf, getCurrentReceiptDate } from './payment-receipt-pdf'

const mocks = vi.hoisted(() => ({ textCalls: [] as unknown[][] }))

vi.mock('jspdf', async (importOriginal) => {
  const actual = await importOriginal<typeof import('jspdf')>()
  return {
    ...actual,
    jsPDF: class extends actual.jsPDF {
      constructor(...args: ConstructorParameters<typeof actual.jsPDF>) {
        super(...args)
        const originalText = this.text.bind(this)
        this.text = (...textArgs) => {
          mocks.textCalls.push(textArgs)
          return originalText(...textArgs)
        }
      }
    },
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  mocks.textCalls.length = 0
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
      receivedDate: '2026-09-29',
      paymentType: 'down_payment',
      paymentMode: 'bank_transfer',
      reference: 'BANK-REF-12',
    })

    expect(pdf.getFontList().Roboto).toEqual(['normal', 'bold'])
    expect(mocks.textCalls.some(([label, , y]) => label === 'Date acknowledged: October 3, 2026' && y === 70)).toBe(true)
    expect(mocks.textCalls.some(([label, x, y]) => label === 'Date received: September 29, 2026' && x === 20 && y === 78)).toBe(true)
  })
})