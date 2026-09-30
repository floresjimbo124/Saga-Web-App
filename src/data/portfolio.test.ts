import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))

import { createProject, loadPortfolio, updateProjectSetup } from './portfolio'

type QueryResult = { data: unknown; error: { message: string } | null }

function queryFor(data: unknown, error: QueryResult['error'] = null) {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    is: () => query,
    neq: () => query,
    then: (resolve: (result: QueryResult) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ data, error }).then(resolve, reject),
  }
  return query
}

const portfolioRows: Record<string, unknown[]> = {
  projects: [
    {
      id: 'project-salo', name: 'Salo Spot', prefix: 'SAL', location: 'Makati', status: 'planning',
      progress_percent: 0, client_id: 'client-salo', updated_at: '2026-09-24T00:00:00Z',
    },
    {
      id: 'project-dapitan', name: 'Dapitan Cafe', prefix: 'DAP', location: null, status: 'planning',
      progress_percent: 0, client_id: null, updated_at: '2026-09-25T00:00:00Z',
    },
  ],
  clients: [{ id: 'client-salo', name: 'Salo Hospitality' }],
  project_financial_terms: [
    {
      project_id: 'project-salo', contract_amount: null, special_discount: '0.00', down_payment_percent: '40.00',
      retention_rate_percent: '5.00', retention_method: 'final_schedule',
    },
  ],
  progress_billings: [
    { project_id: 'project-salo', amount_for_billing: '120000.00' },
  ],
  payments: [
    {
      id: 'payment-salo', project_id: 'project-salo', payer_name: 'Salo Hospitality',
      received_at: '2026-09-25T10:00:00Z', amount: '50000.00', payment_mode: 'bank_transfer',
      reference: null, receipt_number: 'SAL-0001',
    },
  ],
  retention_ledger: [
    { project_id: 'project-salo', entry_type: 'held', amount: '6000.00' },
    { project_id: 'project-salo', entry_type: 'released', amount: '1000.00' },
  ],
  project_milestones: [
    { project_id: 'project-salo', name: 'Electrical rough-in', planned_date: '2026-10-04', status: 'pending' },
  ],
  project_change_orders: [
    { project_id: 'project-salo', amount: '20000.00', retention_rate_percent: null },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockImplementation((table: string) => queryFor(portfolioRows[table] ?? []))
})

describe('portfolio data access', () => {
  it('maps project shells and aggregates billing, receipts, retention, and approved change orders', async () => {
    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')
    const dapitan = portfolio.projects.find((project) => project.id === 'project-dapitan')

    expect(salo).toMatchObject({
      client: 'Salo Hospitality',
      contract: 0,
      downPaymentPercent: 40,
      retentionRate: 5,
      retentionMethod: 'final-schedule',
      billed: 120_000,
      collected: 50_000,
      retention: 5_000,
      milestone: 'Electrical rough-in · Oct 04',
      isSetupComplete: false,
      approvedChangeOrders: [{ amount: 20_000, approved: true, retentionRatePercent: undefined }],
    })
    expect(dapitan).toMatchObject({
      client: 'Client not set',
      contract: 0,
      billed: 0,
      collected: 0,
      retention: 0,
      retentionMethod: 'final-schedule',
      isSetupComplete: false,
    })
    expect(portfolio.payments).toEqual([{
      id: 'payment-salo',
      projectId: 'project-salo',
      payer: 'Salo Hospitality',
      date: '2026-09-25T10:00:00Z',
      amount: 50_000,
      mode: 'bank transfer',
      reference: 'SAL-0001',
    }])
    expect(mocks.from).toHaveBeenCalledWith('projects')
  })

  it('surfaces RLS/query failures rather than silently showing empty records', async () => {
    mocks.from.mockImplementation((table: string) => queryFor([], table === 'projects' ? { message: 'permission denied' } : null))

    await expect(loadPortfolio()).rejects.toThrow('permission denied')
  })

  it('sends project creation to the atomic database RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: 'new-project-id', error: null })

    await expect(createProject({
      name: 'New Cafe',
      clientName: 'New Cafe Group',
      prefix: 'NEW',
      contractAmount: 750_000,
      downPaymentPercent: 40,
      retentionRatePercent: 5,
      retentionMethod: 'final_schedule',
    })).resolves.toBe('new-project-id')

    expect(mocks.rpc).toHaveBeenCalledWith('create_project_with_terms', expect.objectContaining({
      p_organization_id: 'org-sagact',
      p_project_name: 'New Cafe',
      p_client_name: 'New Cafe Group',
      p_down_payment_percent: 40,
    }))
  })

  it('sends existing-project contract setup to its atomic RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    await updateProjectSetup({
      projectId: 'project-salo',
      clientName: 'Salo Hospitality Group',
      contractAmount: 4_500_000,
      specialDiscount: 50_000,
      downPaymentPercent: 40,
      retentionRatePercent: 5,
      retentionMethod: 'final_schedule',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('update_project_setup', expect.objectContaining({
      p_project_id: 'project-salo',
      p_special_discount: 50_000,
      p_down_payment_percent: 40,
      p_retention_method: 'final_schedule',
    }))
  })
})
