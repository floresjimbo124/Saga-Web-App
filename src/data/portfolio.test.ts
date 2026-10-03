import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))

import { createProject, loadPortfolio, recordProjectExpense, recordProjectExpenses, recordProjectPayment, updateProjectCostForecast, updateProjectDeadline, updateProjectSetup, updateProjectState } from './portfolio'

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
      deadline: '2026-11-02', progress_percent: 0, health_status: 'on_track', client_id: 'client-salo',
      created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z',
    },
    {
      id: 'project-dapitan', name: 'Dapitan Cafe', prefix: 'DAP', location: null, status: 'completed',
      deadline: null, progress_percent: 0, health_status: 'needs_attention', client_id: null,
      created_at: '2026-09-25T00:00:00Z', updated_at: '2026-09-25T00:00:00Z',
    },
  ],
  clients: [{ id: 'client-salo', name: 'Salo Hospitality', email: 'client@salo.example' }],
  project_financial_terms: [
    {
      project_id: 'project-salo', contract_amount: null, special_discount: '0.00', down_payment_percent: '40.00',
      retention_rate_percent: '5.00', retention_method: 'final_schedule',
    },
  ],
  project_cost_forecasts: [{
    project_id: 'project-salo', cost_budget: '800000.00', estimated_cost_to_complete: '620000.00',
  }],
  progress_billings: [
    {
      id: 'billing-salo-1', project_id: 'project-salo', billing_number: 1, amount_for_billing: '120000.00',
      issued_at: '2026-09-25T09:00:00Z', due_at: '2026-10-02', created_at: '2026-09-25T09:00:00Z',
    },
  ],
  payments: [
    {
      id: 'payment-salo', project_id: 'project-salo', payer_name: 'Salo Hospitality',
      received_at: '2026-09-25T10:00:00Z', created_at: '2026-10-03T10:00:00Z', amount: '50000.00', payment_type: 'down_payment', payment_mode: 'bank_transfer',
      reference: null, receipt_number: 'SAL-0001',
    },
  ],
  project_expenses: [
    {
      id: 'expense-salo', project_id: 'project-salo', expense_date: '2026-10-01', category: 'materials',
      description: 'Concrete supplies', vendor: 'BuildCo', amount: '12500.50',
    },
    {
      id: 'expense-dapitan', project_id: 'project-dapitan', expense_date: '2026-09-30', category: 'transport',
      description: 'Site delivery', vendor: null, amount: '3000.00',
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
  it('maps project shells and ages billings using when payments were recorded', async () => {
    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')
    const dapitan = portfolio.projects.find((project) => project.id === 'project-dapitan')

    expect(salo).toMatchObject({
      clientId: 'client-salo',
      client: 'Salo Hospitality',
      clientEmail: 'client@salo.example',
      status: 'planning',
      healthStatus: 'on_track',
      deadline: '2026-11-02',
      contract: 0,
      costBudget: 800_000,
      estimatedCostToComplete: 620_000,
      downPaymentPercent: 40,
      retentionRate: 5,
      retentionMethod: 'final-schedule',
      billed: 120_000,
      collected: 50_000,
      outflow: 12_500.5,
      expenses: [{
        id: 'expense-salo', projectId: 'project-salo', date: '2026-10-01', category: 'materials',
        description: 'Concrete supplies', vendor: 'BuildCo', amount: 12_500.5,
      }],
      retention: 5_000,
      milestone: 'Electrical rough-in · Oct 04',
      isSetupComplete: false,
      approvedChangeOrders: [{ amount: 20_000, approved: true, retentionRatePercent: undefined }],
    })
    expect(dapitan).toMatchObject({
      client: 'Client not set',
      status: 'completed',
      healthStatus: 'needs_attention',
      contract: 0,
      billed: 0,
      collected: 0,
      outflow: 3_000,
      expenses: [{
        id: 'expense-dapitan', projectId: 'project-dapitan', date: '2026-09-30', category: 'transport',
        description: 'Site delivery', vendor: '', amount: 3_000,
      }],
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
      receiptNumber: 'SAL-0001',
      paymentType: 'down_payment',
      paymentMode: 'bank_transfer',
      paymentReference: '',
      reference: 'SAL-0001',
    }])
    expect(mocks.from).toHaveBeenCalledWith('projects')
    expect(portfolio.receivables).toMatchObject([{
      id: 'billing-salo-1',
      projectName: 'Salo Spot',
      clientName: 'Salo Hospitality',
      outstandingAmount: 70_000,
    }])
  })

  it('counts the contracted down payment alongside issued progress billings', async () => {
    const terms = portfolioRows.project_financial_terms[0] as Record<string, unknown>
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'project_financial_terms'
        ? [{ ...terms, contract_amount: '1000000.00' }]
        : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')

    expect(salo?.billed).toBe(520_000)
    expect(portfolio.receivables).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'down-payment:project-salo', outstandingAmount: 350_000, kind: 'down-payment' }),
      expect.objectContaining({ id: 'billing-salo-1', outstandingAmount: 120_000 }),
    ]))
  })

  it('shows the contract retention amount even before the ledger has any held entries', async () => {
    const terms = portfolioRows.project_financial_terms[0] as Record<string, unknown>
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'project_financial_terms'
        ? [{ ...terms, contract_amount: '1000000.00', special_discount: '0.00' }]
        : table === 'retention_ledger'
          ? []
          : table === 'project_change_orders'
            ? []
            : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')

    expect(salo?.retention).toBe(50_000)
  })

  it('does not deduct a retention release payment twice when the ledger already records the release', async () => {
    const retentionPayment = {
      id: 'retention-payment-salo',
      project_id: 'project-salo',
      payer_name: 'Salo Hospitality',
      received_at: '2026-10-03T10:00:00Z',
      created_at: '2026-10-03T10:00:00Z',
      amount: '1000.00',
      payment_type: 'retention_release',
      payment_mode: 'bank_transfer',
      reference: null,
      receipt_number: 'SAL-0002',
    }
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'payments'
        ? [...portfolioRows.payments, retentionPayment]
        : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')

    expect(salo?.retention).toBe(5_000)
  })

  it('adds retention to receivables only after a completed project reaches its release date', async () => {
    const projects = portfolioRows.projects.map((project) => ({
      ...(project as Record<string, unknown>),
      completed_at: '2026-08-01',
    }))
    const terms = [
      ...portfolioRows.project_financial_terms,
      {
        project_id: 'project-dapitan',
        contract_amount: '100000.00',
        special_discount: '0.00',
        down_payment_percent: '0.00',
        retention_rate_percent: '5.00',
        retention_method: 'final_schedule',
      },
    ]
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'projects'
        ? projects
        : table === 'project_financial_terms'
          ? terms
          : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()

    expect(portfolio.receivables).toContainEqual(expect.objectContaining({
      id: 'retention:project-dapitan',
      kind: 'retention',
      amount: 5_000,
    }))
    expect(portfolio.receivables).not.toContainEqual(expect.objectContaining({
      id: 'retention:project-salo',
    }))
  })

  it('distinguishes unscheduled milestones from milestones that are all complete', async () => {
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'project_milestones'
        ? [{ project_id: 'project-dapitan', name: 'Handover', planned_date: '2026-09-30', status: 'complete' }]
        : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')
    const dapitan = portfolio.projects.find((project) => project.id === 'project-dapitan')

    expect(salo?.milestone).toBe('No milestones scheduled')
    expect(dapitan?.milestone).toBe('All milestones complete')
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
      location: 'Cebu City',
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
      p_location: 'Cebu City',
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

  it('updates lifecycle status and health through the owner RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    await updateProjectState({
      projectId: 'project-salo',
      status: 'active',
      healthStatus: 'needs_attention',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('update_project_state', {
      p_project_id: 'project-salo',
      p_status: 'active',
      p_health_status: 'needs_attention',
    })
  })

  it('updates a project deadline through the owner RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    await updateProjectDeadline('project-salo', '2026-12-31')

    expect(mocks.rpc).toHaveBeenCalledWith('update_project_deadline', {
      p_project_id: 'project-salo',
      p_deadline: '2026-12-31',
    })
  })

  it('records payments with explicit billing allocations atomically', async () => {
    mocks.rpc.mockReturnValue({
      single: () => Promise.resolve({ data: { payment_id: 'payment-1', receipt_number: 'SAL-0002' }, error: null }),
    })

    await expect(recordProjectPayment({
      projectId: 'project-salo',
      paymentType: 'progress',
      amount: 125_000,
      receivedDate: '2026-10-03',
      paymentMode: 'bank_transfer',
      payerName: 'Salo Hospitality',
      allocations: [{ billingId: 'billing-salo-1', amount: 125_000 }],
    })).resolves.toEqual({ paymentId: 'payment-1', receiptNumber: 'SAL-0002' })

    expect(mocks.rpc).toHaveBeenCalledWith('record_project_payment_with_allocations', expect.objectContaining({
      p_project_id: 'project-salo',
      p_amount: 125_000,
      p_allocations: [{ billingId: 'billing-salo-1', amount: 125_000 }],
    }))
  })

  it('saves project cost forecasts through the owner RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    await updateProjectCostForecast({
      projectId: 'project-salo',
      costBudget: 800_000,
      estimatedCostToComplete: 620_000,
    })

    expect(mocks.rpc).toHaveBeenCalledWith('update_project_cost_forecast', {
      p_project_id: 'project-salo',
      p_cost_budget: 800_000,
      p_estimated_cost_to_complete: 620_000,
    })
  })

  it('records project expenses through the project-scoped RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: 'expense-salo', error: null })

    await expect(recordProjectExpense({
      projectId: 'project-salo',
      date: '2026-10-01',
      category: 'materials',
      description: ' Concrete supplies ',
      vendor: ' BuildCo ',
      amount: 12_500.5,
    })).resolves.toBe('expense-salo')

    expect(mocks.rpc).toHaveBeenCalledWith('record_project_expense', {
      p_project_id: 'project-salo',
      p_expense_date: '2026-10-01',
      p_category: 'materials',
      p_description: 'Concrete supplies',
      p_vendor: 'BuildCo',
      p_amount: 12_500.5,
    })
  })

  it('records multiple project expenses atomically in one RPC call', async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null })

    await expect(recordProjectExpenses([
      { projectId: 'project-salo', date: '2026-10-01', category: 'materials', description: 'Concrete', vendor: 'BuildCo', amount: 12_500.5 },
      { projectId: 'project-dapitan', date: '2026-09-30', category: 'transport', description: 'Delivery', amount: 3_000 },
    ])).resolves.toBe(2)

    expect(mocks.rpc).toHaveBeenCalledWith('record_project_expenses', {
      p_expenses: [
        { project_id: 'project-salo', expense_date: '2026-10-01', category: 'materials', description: 'Concrete', vendor: 'BuildCo', amount: 12_500.5 },
        { project_id: 'project-dapitan', expense_date: '2026-09-30', category: 'transport', description: 'Delivery', vendor: null, amount: 3_000 },
      ],
    })
  })
})
