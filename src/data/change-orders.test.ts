import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  createChangeOrderPdf: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: {
    from: mocks.from,
    rpc: mocks.rpc,
    storage: { from: () => ({ upload: mocks.upload, remove: mocks.remove }) },
  },
}))

vi.mock('../lib/change-order-pdf', () => ({
  createChangeOrderPdf: mocks.createChangeOrderPdf,
}))

import { createProjectChangeOrder, respondToProjectChangeOrder, submitProjectChangeOrder, updateProjectChangeOrderDraft } from './change-orders'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.rpc.mockImplementation(() => ({
    single: () => Promise.resolve({ data: { id: 'change-order-1', order_number: 1 }, error: null }),
  }))
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
  mocks.createChangeOrderPdf.mockResolvedValue({ output: () => new Blob(['pdf']) })
})

describe('project change order data access', () => {
  it('creates a numbered draft through the project-locked RPC', async () => {
    await expect(createProjectChangeOrder({
      projectId: 'project-1',
      items: [{
        item: 'Temporary fencing',
        description: 'Install fencing',
        remarks: 'Material and labor',
        cost: 1_500_000,
      }],
      contractTimeAdjustmentDays: 12,
    })).resolves.toEqual({ id: 'change-order-1', orderNumber: 1 })

    expect(mocks.rpc).toHaveBeenCalledWith('create_project_change_order', {
      p_project_id: 'project-1',
      p_line_items: [{
        item: 'Temporary fencing',
        description: 'Install fencing',
        remarks: 'Material and labor',
        cost: 1_500_000,
      }],
      p_contract_time_adjustment_days: 12,
    })
  })

  it('updates a draft without changing its assigned order number', async () => {
    mocks.rpc.mockResolvedValue({ error: null })

    await expect(updateProjectChangeOrderDraft({
      projectId: 'project-1',
      changeOrderId: 'change-order-1',
      items: [{ item: '  Fencing ', description: ' Work ', remarks: ' Notes ', cost: 250 }],
      contractTimeAdjustmentDays: -2,
    })).resolves.toBeUndefined()

    expect(mocks.rpc).toHaveBeenCalledWith('update_project_change_order_draft', {
      p_project_id: 'project-1',
      p_change_order_id: 'change-order-1',
      p_line_items: [{ item: 'Fencing', description: 'Work', remarks: 'Notes', cost: 250 }],
      p_contract_time_adjustment_days: -2,
    })
  })

  it('rejects invalid draft edits before calling the update RPC', async () => {
    await expect(updateProjectChangeOrderDraft({
      projectId: 'project-1',
      changeOrderId: 'change-order-1',
      items: [],
      contractTimeAdjustmentDays: 0,
    })).rejects.toThrow(RangeError)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('creates, uploads, and submits the numbered PDF', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'create_project_change_order'
      ? { single: () => Promise.resolve({ data: { id: 'change-order-1', order_number: 1 }, error: null }) }
      : Promise.resolve({ error: null }))

    await expect(submitProjectChangeOrder({
      projectId: 'project-1',
      changeOrderId: 'change-order-1',
      projectPrefix: 'SAL',
      orderNumber: 1,
      projectName: 'Salo Spot',
      clientName: 'Salo Hospitality',
      location: 'Makati',
      title: 'Additional work',
      description: '',
      amount: 25_000,
      items: [{
        item: 'Temporary fencing',
        description: 'Install temporary fencing',
        remarks: 'Material and labor',
        cost: 25_000,
      }],
      contractTimeAdjustmentDays: -3,
    })).resolves.toBeUndefined()

    expect(mocks.createChangeOrderPdf).toHaveBeenCalledWith(expect.objectContaining({
      changeOrderNumber: 'SAL-CO-001',
      projectName: 'Salo Spot',
      items: [expect.objectContaining({ item: 'Temporary fencing', cost: 25_000 })],
      contractTimeAdjustmentDays: -3,
    }))
    expect(mocks.upload).toHaveBeenCalledWith(
      'org-sagact/project-1/change-orders/change-order-1/SAL-CO-001.pdf',
      expect.any(Blob),
      expect.objectContaining({ contentType: 'application/pdf' }),
    )
    expect(mocks.rpc).toHaveBeenCalledWith('submit_project_change_order', {
      p_project_id: 'project-1',
      p_change_order_id: 'change-order-1',
      p_pdf_storage_path: 'org-sagact/project-1/change-orders/change-order-1/SAL-CO-001.pdf',
    })
  })

  it('removes the uploaded PDF if submission fails', async () => {
    mocks.rpc.mockImplementation((name: string) => name === 'create_project_change_order'
      ? { single: () => Promise.resolve({ data: { id: 'change-order-1', order_number: 1 }, error: null }) }
      : Promise.resolve({ error: { message: 'Submission failed.' } }))

    await expect(submitProjectChangeOrder({
      projectId: 'project-1', changeOrderId: 'change-order-1', projectPrefix: 'SAL', orderNumber: 1,
      projectName: 'Salo Spot', clientName: 'Salo Hospitality', location: 'Makati',
      title: 'Additional work', description: '', amount: 25_000,
      items: [{ item: 'Temporary fencing', description: '', remarks: '', cost: 25_000 }],
      contractTimeAdjustmentDays: 0,
    })).rejects.toThrow('Submission failed.')
    expect(mocks.remove).toHaveBeenCalledWith([
      'org-sagact/project-1/change-orders/change-order-1/SAL-CO-001.pdf',
    ])
  })

  it('records the client decision through the approval RPC', async () => {
    mocks.rpc.mockResolvedValue({ error: null })
    await respondToProjectChangeOrder('change-order-1', true)
    expect(mocks.rpc).toHaveBeenCalledWith('respond_to_change_order', {
      p_change_order_id: 'change-order-1',
      p_approved: true,
      p_note: null,
    })
  })

  it('rejects invalid draft values', async () => {
    await expect(createProjectChangeOrder({
      projectId: 'project-1',
      items: [],
      contractTimeAdjustmentDays: 0,
    })).rejects.toThrow(RangeError)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('rejects a non-whole-day contract adjustment', async () => {
    await expect(createProjectChangeOrder({
      projectId: 'project-1',
      items: [{ item: 'Fencing', description: '', remarks: '', cost: 100 }],
      contractTimeAdjustmentDays: 1.5,
    })).rejects.toThrow('whole number of days')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
