import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: { from: mocks.from, rpc: mocks.rpc },
}))

import { createProject, loadPortfolio, recordProjectExpense, recordProjectExpenses, recordProjectPayment, updateProjectCostForecast, updateProjectExpense, updateProjectPayment, updateProjectSetup, updateProjectState } from './portfolio'

type QueryResult = { data: unknown; error: { message: string } | null }

function queryFor(data: unknown, error: QueryResult['error'] = null) {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    not: () => query,
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
      start_date: '2026-09-20', deadline: '2026-11-02', progress_percent: 0, health_status: 'on_track', client_id: 'client-salo',
      created_at: '2026-09-24T00:00:00Z', updated_at: '2026-09-24T00:00:00Z',
    },
    {
      id: 'project-dapitan', name: 'Dapitan Cafe', prefix: 'DAP', location: null, status: 'completed',
      start_date: null, deadline: null, progress_percent: 0, health_status: 'needs_attention', client_id: null,
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
  payment_allocations: [],
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
    { id: 'milestone-salo', project_id: 'project-salo', name: 'Electrical rough-in', start_date: null, planned_date: '2026-10-04', actual_date: null, completion_percent: 0, status: 'pending', client_visible: true },
  ],
  project_change_orders: [
    {
      id: 'change-order-approved', project_id: 'project-salo', title: 'Approved extra work',
      order_number: 1,
      description: 'Extra electrical work', amount: '20000.00', retention_rate_percent: null,
      line_items: [{ item: 'Temporary fencing', description: 'Install fencing', remarks: 'Material and labor', cost: '20000.00' }],
      contract_time_adjustment_days: 12,
      status: 'approved', created_at: '2026-10-01T00:00:00Z', decided_at: '2026-10-02T00:00:00Z',
      decision_note: 'Approved by client.',
    },
    {
      id: 'change-order-draft', project_id: 'project-salo', title: 'Draft extra work',
      order_number: 2,
      description: null, amount: '1500000.00', retention_rate_percent: null,
      status: 'draft', created_at: '2026-10-02T00:00:00Z', decided_at: null, decision_note: null,
    },
  ],
  project_contracts: [
    { id: 'contract-approved', project_id: 'project-salo', change_order_id: 'change-order-approved', progress_percent: '35.00' },
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
      startDate: '2026-09-20',
      deadline: '2026-11-02',
      contract: 0,
      costBudget: 800_000,
      estimatedCostToComplete: 620_000,
      downPaymentPercent: 40,
      retentionRate: 5,
      retentionMethod: 'final-schedule',
      billed: 140_000,
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
      changeOrders: [
        { id: 'change-order-approved', title: 'Approved extra work', status: 'approved', amount: 20_000, orderNumber: 1, items: [{ item: 'Temporary fencing', description: 'Install fencing', remarks: 'Material and labor', cost: 20_000 }], contractTimeAdjustmentDays: 12, contractId: 'contract-approved', contractProgress: 35, decidedAt: '2026-10-02T00:00:00Z', decisionNote: 'Approved by client.' },
        { id: 'change-order-draft', title: 'Draft extra work', status: 'draft', amount: 1_500_000, orderNumber: 2, decidedAt: null, decisionNote: '' },
      ],
    })
    expect(dapitan).toMatchObject({
      client: 'Client not set',
      status: 'completed',
      healthStatus: 'needs_attention',
      startDate: null,
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
      contractId: null,
      billingAllocations: [],
    }])
    expect(mocks.from).toHaveBeenCalledWith('projects')
    expect(portfolio.receivables).toEqual(expect.arrayContaining([expect.objectContaining({
      id: 'billing-salo-1',
      projectName: 'Salo Spot',
      clientName: 'Salo Hospitality',
      outstandingAmount: 70_000,
    })]))
  })

  it('maps payment allocations to billing numbers for payment history', async () => {
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'payment_allocations'
        ? [{ payment_id: 'payment-salo', billing_id: 'billing-salo-1', amount: '35000.00' }]
        : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()

    expect(portfolio.payments.find((payment) => payment.id === 'payment-salo')?.billingAllocations)
      .toEqual([{ billingNumber: 1, amount: 35_000 }])
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

    expect(salo?.billed).toBe(540_000)
    expect(portfolio.receivables).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'down-payment:project-salo', outstandingAmount: 350_000, kind: 'down-payment' }),
      expect.objectContaining({ id: 'billing-salo-1', outstandingAmount: 120_000 }),
    ]))
  })

  it('keeps approved change-order receivables separate and nets their scoped payments once', async () => {
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'progress_billings'
        ? [
          ...portfolioRows.progress_billings,
          {
            id: 'billing-change-order', project_id: 'project-salo', contract_id: 'contract-approved',
            billing_number: 1, amount_for_billing: '5000.00', issued_at: '2026-10-03T09:00:00Z',
            due_at: '2026-10-10', created_at: '2026-10-03T09:00:00Z',
          },
        ]
        : table === 'payments'
          ? [
            ...portfolioRows.payments,
            {
              id: 'payment-change-order', project_id: 'project-salo', contract_id: 'contract-approved',
              payer_name: 'Salo Hospitality', received_at: '2026-10-04T10:00:00Z',
              created_at: '2026-10-04T10:00:00Z', amount: '7000.00', payment_type: 'change_order',
              payment_mode: 'bank_transfer', reference: null, receipt_number: 'SAL-0002',
            },
          ]
          : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()

    expect(portfolio.receivables).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'change-order:change-order-approved',
        contractId: 'contract-approved',
        amount: 20_000,
        outstandingAmount: 13_000,
        kind: 'change-order',
      }),
      expect.objectContaining({ id: 'billing-salo-1', outstandingAmount: 70_000 }),
    ]))
    expect(portfolio.receivables).not.toContainEqual(expect.objectContaining({ id: 'billing-change-order' }))
  })

  it('includes project-assigned weekly payroll as a project expense', async () => {
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'payroll_employees'
        ? [{ id: 'employee-1', full_name: 'Juan Dela Cruz' }]
        : table === 'payroll_weekly_entries'
          ? [{ id: 'payroll-1', employee_id: 'employee-1', week_start: '2026-10-05', project_id: 'project-salo', gross_pay: '5000.00', finalized_at: '2026-10-11T15:59:00Z' }]
          : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')

    expect(salo?.outflow).toBe(17_500.5)
    expect(salo?.expenses).toContainEqual({
      id: 'payroll:payroll-1',
      projectId: 'project-salo',
      contractId: null,
      date: '2026-10-11',
      category: 'payroll',
      description: 'Payroll · Juan Dela Cruz (Oct 5–Oct 11)',
      vendor: '',
      amount: 5_000,
    })
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
        ? [{ id: 'milestone-dapitan', project_id: 'project-dapitan', name: 'Handover', planned_date: '2026-09-30', actual_date: '2026-09-30', status: 'complete', client_visible: true }]
        : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')
    const dapitan = portfolio.projects.find((project) => project.id === 'project-dapitan')

    expect(salo?.milestone).toBe('No milestones scheduled')
    expect(dapitan?.milestone).toBe('All milestones complete')
  })

  it('loads editable milestone fields and prioritizes an in-progress milestone', async () => {
    mocks.from.mockImplementation((table: string) => queryFor(
      table === 'project_milestones'
        ? [
          { id: 'milestone-pending', project_id: 'project-salo', name: 'Paint', start_date: null, planned_date: '2026-10-04', actual_date: null, completion_percent: 0, status: 'pending', client_visible: false },
          { id: 'milestone-active', project_id: 'project-salo', name: 'Electrical rough-in', start_date: '2026-10-05', planned_date: '2026-10-10', actual_date: null, completion_percent: 60, status: 'in_progress', client_visible: true },
        ]
        : portfolioRows[table] ?? [],
    ))

    const portfolio = await loadPortfolio()
    const salo = portfolio.projects.find((project) => project.id === 'project-salo')

    expect(salo?.milestones).toEqual([
      { id: 'milestone-pending', name: 'Paint', startDate: null, plannedDate: '2026-10-04', actualDate: null, completionPercent: 0, status: 'pending', clientVisible: false, photoStoragePath: null },
      { id: 'milestone-active', name: 'Electrical rough-in', startDate: '2026-10-05', plannedDate: '2026-10-10', actualDate: null, completionPercent: 60, status: 'in_progress', clientVisible: true, photoStoragePath: null },
    ])
    expect(salo?.milestone).toContain('Electrical rough-in')
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
      startDate: '2026-09-20',
      deadline: '2026-12-31',
      downPaymentPercent: 40,
      retentionRatePercent: 5,
      retentionMethod: 'final_schedule',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('update_project_contract_schedule', expect.objectContaining({
      p_project_id: 'project-salo',
      p_special_discount: 50_000,
      p_down_payment_percent: 40,
      p_retention_method: 'final_schedule',
      p_start_date: '2026-09-20',
      p_deadline: '2026-12-31',
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

  it('records payments with explicit billing allocations atomically', async () => {
    mocks.rpc.mockReturnValue({
      single: () => Promise.resolve({ data: { payment_id: 'payment-1', receipt_number: 'SAL-AR-0002' }, error: null }),
    })

    await expect(recordProjectPayment({
      projectId: 'project-salo',
      paymentType: 'progress',
      amount: 125_000,
      receivedDate: '2026-10-03',
      paymentMode: 'bank_transfer',
      payerName: 'Salo Hospitality',
      allocations: [{ billingId: 'billing-salo-1', amount: 125_000 }],
    })).resolves.toEqual({ paymentId: 'payment-1', receiptNumber: 'SAL-AR-0002' })

    expect(mocks.rpc).toHaveBeenCalledWith('record_project_payment_with_allocations', expect.objectContaining({
      p_project_id: 'project-salo',
      p_amount: 125_000,
      p_received_date: '2026-10-03',
      p_allocations: [{ billing_id: 'billing-salo-1', amount: 125_000 }],
      p_contract_id: null,
    }))
  })

  it('assigns a logged payment to the selected change-order contract', async () => {
    mocks.rpc.mockReturnValue({
      single: () => Promise.resolve({ data: { payment_id: 'payment-contract-1', receipt_number: 'SAL-AR-0003' }, error: null }),
    })

    await recordProjectPayment({
      projectId: 'project-salo',
      contractId: 'contract-approved',
      paymentType: 'progress',
      amount: 5_000,
      receivedDate: '2026-10-03',
      paymentMode: 'cash',
      payerName: 'Salo Hospitality',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('record_project_payment_with_allocations', expect.objectContaining({
      p_project_id: 'project-salo',
      p_contract_id: 'contract-approved',
      p_allocations: [],
    }))
  })

  it('updates editable payment receipt details through the project payment RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    await updateProjectPayment({
      paymentId: 'payment-salo',
      paymentType: 'progress',
      amount: 62_500,
      receivedDate: '2026-10-04',
      paymentMode: 'cash',
      payerName: 'Salo Hospitality',
      reference: 'CASH-104',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('update_project_payment', {
      p_payment_id: 'payment-salo',
      p_payment_type: 'progress',
      p_amount: 62_500,
      p_received_date: '2026-10-04',
      p_payment_mode: 'cash',
      p_payer_name: 'Salo Hospitality',
      p_reference: 'CASH-104',
    })
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

  it('records change-order expenses against their own contract', async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null })

    await expect(recordProjectExpenses([{
      projectId: 'project-salo',
      contractId: 'contract-approved',
      date: '2026-10-03',
      category: 'materials',
      description: 'Additional wiring',
      amount: 2_000,
    }])).resolves.toBe(1)

    expect(mocks.rpc).toHaveBeenCalledWith('record_project_contract_expenses', {
      p_contract_id: 'contract-approved',
      p_expenses: [{
        project_id: 'project-salo',
        expense_date: '2026-10-03',
        category: 'materials',
        description: 'Additional wiring',
        vendor: null,
        amount: 2_000,
      }],
    })
  })

  it('updates an existing project expense through the project-scoped RPC', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null })

    await updateProjectExpense({
      id: 'expense-salo',
      date: '2026-10-02',
      category: 'materials',
      description: ' Corrected supplies ',
      vendor: ' BuildCo ',
      amount: 12_750,
    })

    expect(mocks.rpc).toHaveBeenCalledWith('update_project_expense', {
      p_expense_id: 'expense-salo',
      p_expense_date: '2026-10-02',
      p_category: 'materials',
      p_description: 'Corrected supplies',
      p_vendor: 'BuildCo',
      p_amount: 12_750,
    })
  })
})
