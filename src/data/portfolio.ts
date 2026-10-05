import { SAGACT_ORGANIZATION_ID } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { calculateProjectFinance } from '../finance/project-finance'
import { calculateReceivablesAging } from '../finance/receivables-aging'
import { getRetentionDueDate, isRetentionDue } from '../finance/retention-due'
import type { ProjectMilestone } from './project-milestones'

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'closed'
export type ProjectHealthStatus = 'on_track' | 'needs_attention'
export type ProjectExpenseCategory = 'materials' | 'labor' | 'operational_expenses' | 'payroll' | 'sub_contract' | 'rent' | 'equipment' | 'transport' | 'permits' | 'other'

export type PortfolioExpense = {
  id: string
  projectId: string
  date: string
  category: ProjectExpenseCategory
  description: string
  vendor: string
  amount: number
}

export type PortfolioProject = {
  id: string
  name: string
  clientId: string | null
  client: string
  clientEmail: string
  location: string
  prefix: string
  contract: number
  isSetupComplete: boolean
  specialDiscount: number
  costBudget: number | null
  estimatedCostToComplete: number | null
  approvedChangeOrders: { amount: number; approved: boolean; retentionRatePercent?: number }[]
  billed: number
  collected: number
  retentionPaid: number
  expenses: PortfolioExpense[]
  outflow: number
  retention: number
  progress: number
  downPaymentPercent: number
  retentionRate: number
  retentionMethod: 'final-schedule' | 'per-billing'
  status: ProjectStatus
  healthStatus: ProjectHealthStatus
  deadline: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  milestone: string
  milestones: ProjectMilestone[]
}

export type PortfolioPayment = {
  id: string
  projectId: string
  payer: string
  date: string
  amount: number
  mode: string
  receiptNumber: string | null
  paymentType: 'down_payment' | 'progress' | 'retention_release' | 'other'
  paymentMode: 'cash' | 'bank_transfer' | 'check' | 'card' | 'other'
  paymentReference: string
  reference: string
}

export type CreateProjectInput = {
  name: string
  clientName: string
  location: string
  prefix: string
  contractAmount: number
  downPaymentPercent: number
  retentionRatePercent: number
  retentionMethod: 'final_schedule' | 'per_billing'
  deadline?: string | null
}

export type RecordProjectExpenseInput = {
  projectId: string
  date: string
  category: ProjectExpenseCategory
  description: string
  vendor?: string
  amount: number
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function projectStatus(status: string): ProjectStatus {
  if (status === 'active' || status === 'on_hold' || status === 'completed' || status === 'closed') return status
  return 'planning'
}

function projectHealthStatus(status: string | null): ProjectHealthStatus {
  return status === 'needs_attention' ? 'needs_attention' : 'on_track'
}

function retentionMethod(method: string | undefined): PortfolioProject['retentionMethod'] {
  return method === 'per_billing' ? 'per-billing' : 'final-schedule'
}

export async function loadPortfolio() {
  const client = requireSupabase()
  const [projectResult, clientResult, termResult, billingResult, paymentResult, allocationResult, expenseResult, retentionResult, milestoneResult, changeOrderResult, forecastResult] = await Promise.all([
    client.from('projects')
      .select('id, name, prefix, location, deadline, status, health_status, progress_percent, client_id, completed_at, created_at, updated_at')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('created_at', { ascending: true }),
    client.from('clients')
      .select('id, name, email')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_financial_terms')
      .select('project_id, contract_amount, special_discount, down_payment_percent, retention_rate_percent, retention_method')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('progress_billings')
      .select('id, project_id, billing_number, amount_for_billing, issued_at, due_at, created_at')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .eq('status', 'issued'),
    client.from('payments')
      .select('id, project_id, payer_name, received_at, created_at, amount, payment_type, payment_mode, reference, receipt_number')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .is('voided_at', null)
      .order('received_at', { ascending: false }),
    client.from('payment_allocations')
      .select('payment_id, billing_id, amount')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_expenses')
      .select('id, project_id, expense_date, category, description, vendor, amount')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }),
    client.from('retention_ledger')
      .select('project_id, entry_type, amount')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_milestones')
      .select('id, project_id, name, planned_date, actual_date, status, client_visible')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('planned_date', { ascending: true, nullsFirst: false }),
    client.from('project_change_orders')
      .select('project_id, amount, retention_rate_percent')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .eq('status', 'approved'),
    client.from('project_cost_forecasts')
      .select('project_id, cost_budget, estimated_cost_to_complete')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
  ])

  for (const result of [projectResult, clientResult, termResult, billingResult, paymentResult, allocationResult, expenseResult, retentionResult, milestoneResult, changeOrderResult, forecastResult]) {
    throwIfError(result.error)
  }

  const clientsById = new Map((clientResult.data ?? []).map((item) => [item.id, item.name]))
  const clientEmailsById = new Map((clientResult.data ?? []).map((item) => [item.id, item.email ?? '']))
  const termsByProject = new Map((termResult.data ?? []).map((item) => [item.project_id, item]))
  const forecastsByProject = new Map((forecastResult.data ?? []).map((item) => [item.project_id, item]))
  const changeOrdersByProject = new Map<string, { amount: number; approved: boolean; retentionRatePercent?: number }[]>()
  for (const order of changeOrderResult.data ?? []) {
    const approvedOrders = changeOrdersByProject.get(order.project_id) ?? []
    approvedOrders.push({
      amount: Number(order.amount),
      approved: true,
      retentionRatePercent: order.retention_rate_percent === null ? undefined : Number(order.retention_rate_percent),
    })
    changeOrdersByProject.set(order.project_id, approvedOrders)
  }
  const billedByProject = new Map<string, number>()
  for (const billing of billingResult.data ?? []) {
    billedByProject.set(billing.project_id, (billedByProject.get(billing.project_id) ?? 0) + Number(billing.amount_for_billing))
  }

  const collectedByProject = new Map<string, number>()
  const retentionPaidByProject = new Map<string, number>()
  const payments: PortfolioPayment[] = (paymentResult.data ?? []).map((payment) => {
    collectedByProject.set(payment.project_id, (collectedByProject.get(payment.project_id) ?? 0) + Number(payment.amount))
    if (payment.payment_type === 'retention_release') {
      retentionPaidByProject.set(payment.project_id, (retentionPaidByProject.get(payment.project_id) ?? 0) + Number(payment.amount))
    }
    return {
      id: payment.id,
      projectId: payment.project_id,
      payer: payment.payer_name,
      date: payment.received_at,
      amount: Number(payment.amount),
      mode: payment.payment_mode.replaceAll('_', ' '),
      receiptNumber: payment.receipt_number,
      paymentType: payment.payment_type,
      paymentMode: payment.payment_mode,
      paymentReference: payment.reference ?? '',
      reference: payment.receipt_number ?? payment.reference ?? '',
    }
  })

  const expensesByProject = new Map<string, PortfolioExpense[]>()
  const outflowByProject = new Map<string, number>()
  for (const expense of expenseResult.data ?? []) {
    const amount = Number(expense.amount)
    const expenses = expensesByProject.get(expense.project_id) ?? []
    expenses.push({
      id: expense.id,
      projectId: expense.project_id,
      date: expense.expense_date,
      category: expense.category,
      description: expense.description,
      vendor: expense.vendor ?? '',
      amount,
    })
    expensesByProject.set(expense.project_id, expenses)
    outflowByProject.set(expense.project_id, (outflowByProject.get(expense.project_id) ?? 0) + amount)
  }

  const heldByProject = new Map<string, number>()
  const releasedByProject = new Map<string, number>()
  for (const entry of retentionResult.data ?? []) {
    const amount = Number(entry.amount)
    if (entry.entry_type === 'released') {
      releasedByProject.set(entry.project_id, (releasedByProject.get(entry.project_id) ?? 0) + amount)
    }
    const signedAmount = entry.entry_type === 'released' ? -amount : entry.entry_type === 'held' ? amount : 0
    heldByProject.set(entry.project_id, (heldByProject.get(entry.project_id) ?? 0) + signedAmount)
  }
  const milestonesByProject = new Map<string, ProjectMilestone[]>()
  for (const milestone of milestoneResult.data ?? []) {
    const projectMilestones = milestonesByProject.get(milestone.project_id) ?? []
    projectMilestones.push({
      id: milestone.id,
      name: milestone.name,
      plannedDate: milestone.planned_date,
      actualDate: milestone.actual_date,
      status: milestone.status,
      clientVisible: milestone.client_visible,
    })
    milestonesByProject.set(milestone.project_id, projectMilestones)
  }

  const projects: PortfolioProject[] = (projectResult.data ?? []).map((project) => {
    const milestones = milestonesByProject.get(project.id) ?? []
    const nextMilestone = milestones.find((milestone) => milestone.status === 'in_progress')
      ?? milestones.find((milestone) => milestone.status === 'pending')
      ?? milestones.find((milestone) => milestone.status === 'blocked')
    const milestoneLabel = nextMilestone
      ? `${nextMilestone.name} · ${nextMilestone.plannedDate
        ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: '2-digit' }).format(new Date(`${nextMilestone.plannedDate}T12:00:00`))
        : 'Date not set'}${nextMilestone.status === 'blocked' ? ' · Blocked' : ''}`
      : milestones.length ? 'All milestones complete' : 'No milestones scheduled'
    const terms = termsByProject.get(project.id)
    const forecast = forecastsByProject.get(project.id)
    const contract = Number(terms?.contract_amount ?? 0)
    const specialDiscount = Number(terms?.special_discount ?? 0)
    const downPaymentPercent = Number(terms?.down_payment_percent ?? 0)
    const retentionRate = Number(terms?.retention_rate_percent ?? 5)
    const downPaymentBilled = Math.round(Math.max(0, contract - specialDiscount) * downPaymentPercent) / 100
    const ledgerHeld = Math.max(0, heldByProject.get(project.id) ?? 0)
    const released = releasedByProject.get(project.id) ?? 0
    const retentionCap = calculateProjectFinance({
      contractAmount: contract,
      specialDiscount,
      approvedChangeOrders: changeOrdersByProject.get(project.id) ?? [],
      progressPercent: Number(project.progress_percent),
      retentionRatePercent: retentionRate,
      retentionMethod: retentionMethod(terms?.retention_method),
      billedToDate: (billedByProject.get(project.id) ?? 0) + downPaymentBilled,
      paymentsReceived: collectedByProject.get(project.id) ?? 0,
      retentionHeld: ledgerHeld,
      retentionReleased: released,
    }).retentionCap
    const heldRetention = ledgerHeld > 0 || released > 0
      ? Math.max(0, ledgerHeld)
      : contract > 0
        ? retentionCap
        : 0
    const retentionPaid = retentionPaidByProject.get(project.id) ?? 0
    const effectiveRetention = Math.max(0, heldRetention - Math.max(0, retentionPaid - released))
    return {
      id: project.id,
      name: project.name,
      clientId: project.client_id,
      client: project.client_id ? clientsById.get(project.client_id) ?? 'Client unavailable' : 'Client not set',
      clientEmail: project.client_id ? clientEmailsById.get(project.client_id) ?? '' : '',
      location: project.location ?? 'Location not set',
      prefix: project.prefix,
      contract,
      isSetupComplete: Boolean(project.client_id && terms?.contract_amount !== null && terms?.contract_amount !== undefined),
      specialDiscount,
      costBudget: forecast ? Number(forecast.cost_budget) : null,
      estimatedCostToComplete: forecast ? Number(forecast.estimated_cost_to_complete) : null,
      approvedChangeOrders: changeOrdersByProject.get(project.id) ?? [],
      billed: (billedByProject.get(project.id) ?? 0) + downPaymentBilled,
      collected: collectedByProject.get(project.id) ?? 0,
      retentionPaid,
      expenses: expensesByProject.get(project.id) ?? [],
      outflow: outflowByProject.get(project.id) ?? 0,
      retention: effectiveRetention,
      progress: Number(project.progress_percent),
      healthStatus: projectHealthStatus(project.health_status),
      downPaymentPercent,
      retentionRate,
      retentionMethod: retentionMethod(terms?.retention_method),
      status: projectStatus(project.status),
      deadline: project.deadline,
      completedAt: project.completed_at,
      createdAt: project.created_at,
      updatedAt: project.updated_at,
      milestone: milestoneLabel,
      milestones,
    }
  })

  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const receivableInputs = projects.flatMap((project) => {
    const downPaymentAmount = Math.round(Math.max(0, project.contract - project.specialDiscount)
      * project.downPaymentPercent / 100)
    return downPaymentAmount > 0 ? [{
      id: `down-payment:${project.id}`,
      projectId: project.id,
      projectName: project.name,
      clientName: project.client,
      billingNumber: 0,
      amount: downPaymentAmount,
      issuedAt: project.createdAt,
      createdAt: project.createdAt,
      dueAt: null,
      kind: 'down-payment' as const,
    }] : []
  })
  const receivables = calculateReceivablesAging(
    [
      ...receivableInputs,
      ...(billingResult.data ?? []).flatMap((billing) => {
      const project = projectsById.get(billing.project_id)
      return project ? [{
        id: billing.id,
        projectId: billing.project_id,
        projectName: project.name,
        clientName: project.client,
        billingNumber: billing.billing_number,
        amount: Number(billing.amount_for_billing),
        issuedAt: billing.issued_at,
        createdAt: billing.created_at,
        dueAt: billing.due_at,
      }] : []
      }),
    ],
    (paymentResult.data ?? []).map((payment) => ({
      id: payment.id,
      projectId: payment.project_id,
      amount: Number(payment.amount),
      recordedAt: payment.created_at,
      paymentType: payment.payment_type,
    })),
    (allocationResult.data ?? []).map((allocation) => ({
      paymentId: allocation.payment_id,
      billingId: allocation.billing_id,
      amount: Number(allocation.amount),
    })),
  )
  const today = new Date()
  const asOfDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  for (const project of projects) {
    const dueAt = getRetentionDueDate(project.completedAt)
    if (!dueAt || (project.status !== 'completed' && project.status !== 'closed')
      || !isRetentionDue(project.completedAt, asOfDate) || project.retention <= 0) continue
    receivables.push(...calculateReceivablesAging([{
      id: `retention:${project.id}`,
      projectId: project.id,
      projectName: project.name,
      clientName: project.client,
      billingNumber: 0,
      amount: project.retention,
      issuedAt: dueAt,
      createdAt: dueAt,
      dueAt,
      kind: 'retention',
    }], [], [], asOfDate))
  }

  return { projects, payments, receivables }
}

export async function updateProjectState(input: {
  projectId: string
  status: ProjectStatus
  healthStatus: ProjectHealthStatus
}) {
  const { error } = await requireSupabase().rpc('update_project_state', {
    p_project_id: input.projectId,
    p_status: input.status,
    p_health_status: input.healthStatus,
  })
  throwIfError(error)
}

export async function updateProjectDeadline(projectId: string, deadline: string | null) {
  const { error } = await requireSupabase().rpc('update_project_deadline', {
    p_project_id: projectId,
    p_deadline: deadline,
  })
  throwIfError(error)
}

export async function createProject(input: CreateProjectInput) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_project_with_terms', {
    p_organization_id: SAGACT_ORGANIZATION_ID,
    p_project_name: input.name.trim(),
    p_client_name: input.clientName.trim(),
    p_location: input.location.trim(),
    p_prefix: input.prefix,
    p_contract_amount: input.contractAmount,
    p_down_payment_percent: input.downPaymentPercent,
    p_retention_rate_percent: input.retentionRatePercent,
    p_retention_method: input.retentionMethod,
    p_deadline: input.deadline ?? null,
  })
  throwIfError(error)
  if (!data) throw new Error('Project was created without returning its ID.')
  return data
}

export type UpdateProjectSetupInput = {
  projectId: string
  clientName: string
  contractAmount: number
  specialDiscount: number
  downPaymentPercent: number
  retentionRatePercent: number
  retentionMethod: 'final_schedule' | 'per_billing'
}

export async function updateProjectSetup(input: UpdateProjectSetupInput) {
  const client = requireSupabase()
  const { error } = await client.rpc('update_project_setup', {
    p_project_id: input.projectId,
    p_client_name: input.clientName.trim(),
    p_contract_amount: input.contractAmount,
    p_special_discount: input.specialDiscount,
    p_down_payment_percent: input.downPaymentPercent,
    p_retention_rate_percent: input.retentionRatePercent,
    p_retention_method: input.retentionMethod,
  })
  throwIfError(error)
}

export type RecordProjectPaymentInput = {
  projectId: string
  paymentType: 'down_payment' | 'progress' | 'other'
  amount: number
  receivedDate: string
  paymentMode: 'cash' | 'bank_transfer' | 'check' | 'card' | 'other'
  payerName: string
  reference?: string
  allocations?: { billingId: string; amount: number }[]
}

export async function recordProjectPayment(input: RecordProjectPaymentInput) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('record_project_payment_with_allocations', {
    p_project_id: input.projectId,
    p_payment_type: input.paymentType,
    p_amount: input.amount,
    p_received_date: input.receivedDate,
    p_payment_mode: input.paymentMode,
    p_payer_name: input.payerName.trim(),
    p_reference: input.reference?.trim() || null,
    p_allocations: input.allocations ?? [],
  }).single()
  throwIfError(error)
  const payment = data as { payment_id: string; receipt_number: string } | null
  if (!payment) throw new Error('Payment was recorded without a receipt number.')
  return { paymentId: payment.payment_id, receiptNumber: payment.receipt_number }
}

export async function recordProjectExpense(input: RecordProjectExpenseInput) {
  const { data, error } = await requireSupabase().rpc('record_project_expense', {
    p_project_id: input.projectId,
    p_expense_date: input.date,
    p_category: input.category,
    p_description: input.description.trim(),
    p_vendor: input.vendor?.trim() || null,
    p_amount: input.amount,
  })
  throwIfError(error)
  if (!data) throw new Error('Expense was recorded without returning its ID.')
  return data as string
}

export async function recordProjectExpenses(inputs: RecordProjectExpenseInput[]) {
  if (!inputs.length) throw new Error('Add at least one expense row.')
  const { data, error } = await requireSupabase().rpc('record_project_expenses', {
    p_expenses: inputs.map((input) => ({
      project_id: input.projectId,
      expense_date: input.date,
      category: input.category,
      description: input.description.trim(),
      vendor: input.vendor?.trim() || null,
      amount: input.amount,
    })),
  })
  throwIfError(error)
  const savedCount = Number(data)
  if (savedCount !== inputs.length) throw new Error('Not all expense rows were recorded.')
  return savedCount
}

export async function updateProjectCostForecast(input: {
  projectId: string
  costBudget: number
  estimatedCostToComplete: number
}) {
  const { error } = await requireSupabase().rpc('update_project_cost_forecast', {
    p_project_id: input.projectId,
    p_cost_budget: input.costBudget,
    p_estimated_cost_to_complete: input.estimatedCostToComplete,
  })
  throwIfError(error)
}