import { describe, expect, it } from 'vitest'
import { createChangeOrderPdf } from './change-order-pdf'

describe('change order PDF', () => {
  it('keeps long descriptions and the contract amount within paginated content', async () => {
    const pdf = await createChangeOrderPdf({
      projectName: 'Salo Spot',
      clientName: 'Salo Hospitality',
      location: 'Makati',
      changeOrderNumber: 'SAL-CO-001',
      title: 'Additional work',
      description: 'Additional work detail. '.repeat(80),
      amount: 25_000,
      items: [{
        item: 'Additional electrical work',
        description: 'Additional work detail. '.repeat(80),
        remarks: 'Extended wiring and equipment',
        cost: 25_000,
      }],
      contractTimeAdjustmentDays: 14,
      issuedAt: '2026-10-01T00:00:00Z',
    })

    expect(pdf.getNumberOfPages()).toBeGreaterThan(1)
    expect(pdf.output('arraybuffer').byteLength).toBeGreaterThan(0)
  })
})
