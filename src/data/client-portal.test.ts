import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))

import { loadClientPortalProjects } from './client-portal'

const calls: { table: string; method: string; args: unknown[] }[] = []
const tableData: Record<string, unknown[]> = {
  projects: [{
    id: 'project-1', client_id: 'client-1', name: 'Harbor Office', location: 'Cebu City',
    progress_percent: '45.00', status: 'active', created_at: '2026-09-25T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
  }],
  clients: [{ id: 'client-1', name: 'Northwind Builders' }],
  progress_billings: [{
    id: 'billing-1', project_id: 'project-1', billing_number: 2,
    amount_for_billing: '125000.00', progress_percent: '45.00',
    issued_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', due_at: '2026-10-15',
  }],
  payments: [{
    id: 'payment-1', project_id: 'project-1', receipt_number: 'HAR-0001',
    amount: '50000.00', received_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z', payer_name: 'Northwind Builders',
    payment_type: 'progress', payment_mode: 'bank_transfer', reference: 'BANK-10',
  }],
  payment_allocations: [{
    project_id: 'project-1', payment_id: 'payment-1', billing_id: 'billing-1', amount: '25000.00',
  }],
  project_documents: [{
    id: 'document-1', project_id: 'project-1', file_name: 'Site plan.pdf',
    document_type: 'plan', storage_path: 'org-sagact/project-1/site-plan.pdf',
    created_at: '2026-10-01T00:00:00Z',
  }],
}

function queryFor(table: string) {
  const query = {
    select: (...args: unknown[]) => { calls.push({ table, method: 'select', args }); return query },
    eq: (...args: unknown[]) => { calls.push({ table, method: 'eq', args }); return query },
    in: (...args: unknown[]) => { calls.push({ table, method: 'in', args }); return query },
    is: (...args: unknown[]) => { calls.push({ table, method: 'is', args }); return query },
    order: (...args: unknown[]) => { calls.push({ table, method: 'order', args }); return query },
    then: (resolve: (result: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data: tableData[table] ?? [], error: null }).then(resolve, reject),
  }
  return query
}

beforeEach(() => {
  calls.length = 0
  mocks.from.mockImplementation((table: string) => queryFor(table))
  mocks.rpc.mockResolvedValue({
    data: [{
      project_id: 'project-1',
      retention_amount: '6250.00',
      completed_at: '2026-10-01',
      contract_price: '1000000.00',
      down_payment_amount: '400000.00',
    }],
    error: null,
  })
})

describe('client portal data access', () => {
  it('maps assigned project status, issued billings, payments, and shared files', async () => {
    const [project] = await loadClientPortalProjects()

    expect(project).toMatchObject({
      name: 'Harbor Office',
      clientName: 'Northwind Builders',
      completedAt: '2026-10-01',
      retentionAmount: 6_250,
      createdAt: '2026-09-25T00:00:00Z',
      contractPrice: 1_000_000,
      downPaymentAmount: 400_000,
      progress: 45,
      billings: [{ number: 2, amount: 125_000 }],
      payments: [{ receiptNumber: 'HAR-0001', amount: 50_000 }],
      allocations: [{ paymentId: 'payment-1', billingId: 'billing-1', amount: 25_000 }],
      documents: [{ fileName: 'Site plan.pdf' }],
    })
  })

  it('requests only assigned projects, issued billings, payments, allocations, and client-visible documents', async () => {
    await loadClientPortalProjects()

    expect(calls).toContainEqual({ table: 'project_documents', method: 'eq', args: ['client_visible', true] })
    expect(calls).toContainEqual({ table: 'progress_billings', method: 'eq', args: ['status', 'issued'] })
    expect(calls).toContainEqual({ table: 'payment_allocations', method: 'in', args: ['project_id', ['project-1']] })
    expect(mocks.rpc).toHaveBeenCalledWith('get_client_project_retention')
    expect(mocks.rpc).toHaveBeenCalledWith('get_client_project_down_payment')
    expect(calls.some(({ table }) => table === 'project_milestones' || table === 'project_progress_updates')).toBe(false)
  })
})