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
  it('labels change-order receipts as change-order payments', async () => {
    await createPaymentReceiptPdf({
      projectName: 'Harbor Office',
      payerName: 'Northwind Builders',
      receiptNumber: 'SAL-0003',
      amount: 426331,
      receivedDate: '2026-10-13',
      paymentType: 'change_order',
      changeOrderLabel: 'SAL-CO-001 · Additional work',
      paymentMode: 'bank_transfer',
      reference: '',
    })

    expect(mocks.textCalls.some(([label, x, y]) => String(label).includes('SAL-CO-001 · Additional work') && x === 65 && y === 192)).toBe(true)
    expect(mocks.textCalls.some(([label, x, y]) => String(label).includes('Change order payment') && x === 65 && y === 204)).toBe(true)
  })

  it('uses the allocated billing as the payment type without a separate allocation line', async () => {
    await createPaymentReceiptPdf({
      projectName: 'Project Test',
      payerName: 'Erika Test',
      receiptNumber: 'PRO-0002',
      amount: 35_000,
      receivedDate: '2026-10-14',
      paymentType: 'progress',
      billingAllocations: [{
        billingNumber: '001',
      }],
      paymentMode: 'bank_transfer',
      reference: '',
    })

    expect(mocks.textCalls.some(([label, x, y]) => label === 'Billing #001' && x === 65 && y === 204)).toBe(true)
    expect(mocks.textCalls.some(([label]) => String(label).includes('Applied PHP'))).toBe(false)
  })

  it('lists all allocated billings in the payment type when a payment covers multiple bills', async () => {
    await createPaymentReceiptPdf({
      projectName: 'Project Test',
      payerName: 'Erika Test',
      receiptNumber: 'PRO-AR-0003',
      amount: 50_000,
      receivedDate: '2026-10-14',
      paymentType: 'progress',
      billingAllocations: [{ billingNumber: '001' }, { billingNumber: '002' }],
      paymentMode: 'bank_transfer',
      reference: '',
    })

    expect(mocks.textCalls.some(([label, x, y]) => label === 'Billing #001, Billing #002' && x === 65 && y === 204)).toBe(true)
  })

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