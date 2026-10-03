import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: { from: mocks.from },
}))

import { loadClientPortalProjects } from './client-portal'

const calls: { table: string; method: string; args: unknown[] }[] = []
const tableData: Record<string, unknown[]> = {
  projects: [{
    id: 'project-1', client_id: 'client-1', name: 'Harbor Office', location: 'Cebu City',
    progress_percent: '45.00', status: 'active', updated_at: '2026-10-01T00:00:00Z',
  }],
  clients: [{ id: 'client-1', name: 'Northwind Builders' }],
  project_milestones: [{
    id: 'milestone-1', project_id: 'project-1', name: 'Foundation complete',
    planned_date: '2026-10-15', status: 'in_progress',
  }],
  project_progress_updates: [{
    id: 'update-1', project_id: 'project-1', progress_percent: '45.00',
    summary: 'Foundation work is underway.', created_at: '2026-10-01T00:00:00Z',
  }],
  progress_billings: [{
    id: 'billing-1', project_id: 'project-1', billing_number: 2,
    amount_for_billing: '125000.00', progress_percent: '45.00',
    issued_at: '2026-10-01T00:00:00Z', due_at: '2026-10-15',
  }],
  payments: [{
    id: 'payment-1', project_id: 'project-1', receipt_number: 'HAR-0001',
    amount: '50000.00', received_at: '2026-10-01T00:00:00Z', payer_name: 'Northwind Builders',
    payment_type: 'progress', payment_mode: 'bank_transfer', reference: 'BANK-10',
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
})

describe('client portal data access', () => {
  it('maps assigned project updates, issued billings, payments, and shared files', async () => {
    const [project] = await loadClientPortalProjects()

    expect(project).toMatchObject({
      name: 'Harbor Office',
      clientName: 'Northwind Builders',
      progress: 45,
      milestones: [{ name: 'Foundation complete' }],
      updates: [{ summary: 'Foundation work is underway.' }],
      billings: [{ number: 2, amount: 125_000 }],
      payments: [{ receiptNumber: 'HAR-0001', amount: 50_000 }],
      documents: [{ fileName: 'Site plan.pdf' }],
    })
  })

  it('requests only client-visible updates and documents and issued billings', async () => {
    await loadClientPortalProjects()

    expect(calls).toContainEqual({ table: 'project_milestones', method: 'eq', args: ['client_visible', true] })
    expect(calls).toContainEqual({ table: 'project_progress_updates', method: 'eq', args: ['client_visible', true] })
    expect(calls).toContainEqual({ table: 'project_documents', method: 'eq', args: ['client_visible', true] })
    expect(calls).toContainEqual({ table: 'progress_billings', method: 'eq', args: ['status', 'issued'] })
  })
})