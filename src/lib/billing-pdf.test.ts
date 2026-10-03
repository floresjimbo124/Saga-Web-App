import { describe, expect, it } from 'vitest'
import { createBillingPdf } from './billing-pdf'

describe('createBillingPdf', () => {
  it('creates a PDF containing the issued billing number and amount', async () => {
    const pdf = await createBillingPdf({
      projectName: 'Harbor Office',
      clientName: 'Northwind Builders',
      location: 'Cebu City',
      billingNumber: 42,
      amount: 125000,
      progressPercent: 60,
      issuedAt: '2026-10-01T00:00:00.000Z',
      dueAt: '2026-10-15',
    })
    const output = pdf.output()

    expect(output.startsWith('%PDF-')).toBe(true)
    expect(pdf.getFontList().Roboto).toEqual(['normal', 'bold'])
    expect(output).toContain('/XObject')
  })

})