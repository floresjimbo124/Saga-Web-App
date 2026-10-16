import { SAGACT_ORGANIZATION_ID } from '../lib/supabase'
import { supabase } from '../lib/supabase'
import { calculateProjectFinance } from '../finance/project-finance'
import { calculateReceivablesAging } from '../finance/receivables-aging'
import { getRetentionDueDate, isRetentionDue } from '../finance/retention-due'
import type { ProjectMilestone } from './project-milestones'
import type { PaymentType } from '../lib/payment-type'

export type ProjectStatus = 'planning' | 'active' | 'on_hold' | 'completed' | 'closed'
export type ProjectHealthStatus = 'on_track' | 'needs_attention'
export type ProjectExpenseCategory = 'materials' | 'labor' | 'operational_expenses' | 'payroll' | 'sub_contract' | 'rent' | 'equipment' | 'transport' | 'permits' | 'other'
export type ProjectChangeOrderStatus = 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'void'

export type ProjectChangeOrder = {
  id: string
  projectId: string
  orderNumber: number
  pdfStoragePath: string | null
  items: ProjectChangeOrderItem[]
  contractTimeAdjustmentDays: number
  contractId: string | null
  contractProgress: number
  title: string
  description: string
  amount: number
  retentionRatePercent?: number
  status: ProjectChangeOrderStatus
  createdAt: string
  decidedAt: string | null
  decisionNote: string
}

export type ProjectChangeOrderItem = {
  item: string
  description: string
  remarks: string
  cost: number
}

export type PortfolioExpense = {
  id: string
  projectId: string
  contractId: string | null
  date: string
  category: ProjectExpenseCategory
  description: string
  vendor: string
  amount: number
  receiptStoragePath?: string | null
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
  changeOrders: ProjectChangeOrder[]
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
  startDate: string | null
  deadline: string | null
  coverPhotoStoragePath: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
  milestone: string
  milestones: ProjectMilestone[]
}

export type PortfolioPayment = {
  id: string
  projectId: string
  contractId: string | null
  payer: string
  date: string
  amount: number
  mode: string
  receiptNumber: string | null
  paymentType: PaymentType
  paymentMode: 'cash' | 'bank_transfer' | 'check' | 'card' | 'other'
  paymentReference: string
  reference: string
  billingAllocations: { billingNumber: number; amount: number }[]
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
  contractId?: string | null
  date: string
  category: ProjectExpenseCategory
  description: string
  vendor?: string
  amount: number
}

export type UpdateProjectExpenseInput = Omit<RecordProjectExpenseInput, 'projectId'> & {
  id: string
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
  const [projectResult, clientResult, termResult, billingResult, paymentResult, allocationResult, expenseResult, retentionResult, milestoneResult, changeOrderResult, contractResult, forecastResult, payrollEmployeeResult, payrollEntryResult] = await Promise.all([
    client.from('projects')
      .select('id, name, prefix, location, start_date, deadline, cover_photo_storage_path, status, health_status, progress_percent, client_id, completed_at, created_at, updated_at')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('created_at', { ascending: true }),
    client.from('clients')
      .select('id, name, email')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_financial_terms')
      .select('project_id, contract_amount, special_discount, down_payment_percent, retention_rate_percent, retention_method')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('progress_billings')
      .select('id, project_id, contract_id, billing_number, amount_for_billing, issued_at, due_at, created_at')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .eq('status', 'issued'),
    client.from('payments')
      .select('id, project_id, contract_id, payer_name, received_at, created_at, amount, payment_type, payment_mode, reference, receipt_number')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .is('voided_at', null)
      .order('received_at', { ascending: false }),
    client.from('payment_allocations')
      .select('payment_id, billing_id, amount')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_expenses')
      .select('*')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('expense_date', { ascending: false })
      .order('created_at', { ascending: false }),
    client.from('retention_ledger')
      .select('project_id, entry_type, amount')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_milestones')
      .select('id, project_id, name, start_date, planned_date, actual_date, completion_percent, status, client_visible, photo_storage_path')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('planned_date', { ascending: true, nullsFirst: false }),
    client.from('project_change_orders')
      .select('id, project_id, order_number, title, description, amount, line_items, contract_time_adjustment_days, retention_rate_percent, status, created_at, decided_at, decision_note, pdf_storage_path')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('created_at', { ascending: false }),
    client.from('project_contracts')
      .select('id, project_id, change_order_id, progress_percent')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_cost_forecasts')
      .select('project_id, cost_budget, estimated_cost_to_complete')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('payroll_employees')
      .select('id, full_name')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('payroll_weekly_entries')
      .select('id, employee_id, week_start, project_id, gross_pay, finalized_at')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .not('project_id', 'is', null)
      .not('finalized_at', 'is', null),
  ])

  for (const result of [projectResult, clientResult, termResult, billingResult, paymentResult, allocationResult, expenseResult, retentionResult, milestoneResult, changeOrderResult, contractResult, forecastResult, payrollEmployeeResult, payrollEntryResult]) {
    throwIfError(result.error)
  }

  const clientsById = new Map((clientResult.data ?? []).map((item) => [item.id, item.name]))
  const clientEmailsById = new Map((clientResult.data ?? []).map((item) => [item.id, item.email ?? '']))
  const payrollEmployeesById = new Map((payrollEmployeeResult.data ?? []).map((item) => [item.id, item.full_name]))
  const termsByProject = new Map((termResult.data ?? []).map((item) => [item.project_id, item]))
  const forecastsByProject = new Map((forecastResult.data ?? []).map((item) => [item.project_id, item]))
  const contractsByChangeOrder = new Map((contractResult.data ?? []).map((contract) => [contract.change_order_id, contract]))
  const changeOrdersByProject = new Map<string, { amount: number; approved: boolean; retentionRatePercent?: number }[]>()
  const allChangeOrdersByProject = new Map<string, ProjectChangeOrder[]>()
  for (const order of changeOrderResult.data ?? []) {
    const changeOrder: ProjectChangeOrder = {
      id: order.id,
      projectId: order.project_id,
      orderNumber: order.order_number,
      pdfStoragePath: order.pdf_storage_path ?? null,
      items: ((order.line_items ?? []) as {
        item: string
        description?: string | null
        remarks?: string | null
        cost: number | string
      }[]).map((item) => ({
        item: item.item,
        description: item.description ?? '',
        remarks: item.remarks ?? '',
        cost: Number(item.cost),
      })),
      contractTimeAdjustmentDays: order.contract_time_adjustment_days ?? 0,
      contractId: contractsByChangeOrder.get(order.id)?.id ?? null,
      contractProgress: Number(contractsByChangeOrder.get(order.id)?.progress_percent ?? 0),
      title: order.title,
      description: order.description ?? '',
      amount: Number(order.amount),
      retentionRatePercent: order.retention_rate_percent === null ? undefined : Number(order.retention_rate_percent),
      status: order.status,
      createdAt: order.created_at,
      decidedAt: order.decided_at,
      decisionNote: order.decision_note ?? '',
    }
    const projectChangeOrders = allChangeOrdersByProject.get(order.project_id) ?? []
    projectChangeOrders.push(changeOrder)
    allChangeOrdersByProject.set(order.project_id, projectChangeOrders)
    if (order.status === 'approved') {
      const approvedOrders = changeOrdersByProject.get(order.project_id) ?? []
      approvedOrders.push({
        amount: changeOrder.amount,
        approved: true,
        retentionRatePercent: changeOrder.retentionRatePercent,
      })
      changeOrdersByProject.set(order.project_id, approvedOrders)
    }
  }
  const billedByProject = new Map<string, number>()
  const billingNumbersById = new Map((billingResult.data ?? []).map((billing) => [billing.id, billing.billing_number]))
  const approvedChangeOrderContractIds = new Set([...allChangeOrdersByProject.values()].flat()
    .filter((order) => order.status === 'approved' && order.contractId)
    .map((order) => order.contractId))
  for (const billing of billingResult.data ?? []) {
    if (billing.contract_id && approvedChangeOrderContractIds.has(billing.contract_id)) continue
    billedByProject.set(billing.project_id, (billedByProject.get(billing.project_id) ?? 0) + Number(billing.amount_for_billing))
  }

  const allocationsByPayment = new Map<string, { billingNumber: number; amount: number }[]>()
  for (const allocation of allocationResult.data ?? []) {
    const billingNumber = billingNumbersById.get(allocation.billing_id)
    if (billingNumber === undefined) continue
    const paymentAllocations = allocationsByPayment.get(allocation.payment_id) ?? []
    paymentAllocations.push({ billingNumber, amount: Number(allocation.amount) })
    allocationsByPayment.set(allocation.payment_id, paymentAllocations)
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
      contractId: payment.contract_id ?? null,
      payer: payment.payer_name,
      date: payment.received_at,
      amount: Number(payment.amount),
      mode: payment.payment_mode.replaceAll('_', ' '),
      receiptNumber: payment.receipt_number,
      paymentType: payment.payment_type,
      paymentMode: payment.payment_mode,
      paymentReference: payment.reference ?? '',
      reference: payment.receipt_number ?? payment.reference ?? '',
      billingAllocations: allocationsByPayment.get(payment.id) ?? [],
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
      contractId: expense.contract_id ?? null,
      date: expense.expense_date,
      category: expense.category,
      description: expense.description,
      vendor: expense.vendor ?? '',
      amount,
      receiptStoragePath: expense.receipt_storage_path ?? null,
    })
    expensesByProject.set(expense.project_id, expenses)
    outflowByProject.set(expense.project_id, (outflowByProject.get(expense.project_id) ?? 0) + amount)
  }
  for (const payrollEntry of payrollEntryResult.data ?? []) {
    if (!payrollEntry.project_id) continue
    const weekEnd = new Date(`${payrollEntry.week_start}T12:00:00`)
    weekEnd.setDate(weekEnd.getDate() + 6)
    const expenseDate = `${weekEnd.getFullYear()}-${String(weekEnd.getMonth() + 1).padStart(2, '0')}-${String(weekEnd.getDate()).padStart(2, '0')}`
    const weekLabel = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric' })
    const amount = Number(payrollEntry.gross_pay)
    const expenses = expensesByProject.get(payrollEntry.project_id) ?? []
    expenses.push({
      id: `payroll:${payrollEntry.id}`,
      projectId: payrollEntry.project_id,
      contractId: null,
      date: expenseDate,
      category: 'payroll',
      description: `Payroll · ${payrollEmployeesById.get(payrollEntry.employee_id) ?? 'Employee'} (${weekLabel.format(new Date(`${payrollEntry.week_start}T12:00:00`))}–${weekLabel.format(weekEnd)})`,
      vendor: '',
      amount,
    })
    expensesByProject.set(payrollEntry.project_id, expenses)
    outflowByProject.set(payrollEntry.project_id, (outflowByProject.get(payrollEntry.project_id) ?? 0) + amount)
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
      startDate: milestone.start_date,
      plannedDate: milestone.planned_date,
      actualDate: milestone.actual_date,
      completionPercent: milestone.completion_percent,
      status: milestone.status,
      clientVisible: milestone.client_visible,
      photoStoragePath: milestone.photo_storage_path ?? null,
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
      changeOrders: allChangeOrdersByProject.get(project.id) ?? [],
      approvedChangeOrders: changeOrdersByProject.get(project.id) ?? [],
      billed: (billedByProject.get(project.id) ?? 0) + downPaymentBilled
        + (allChangeOrdersByProject.get(project.id) ?? [])
          .filter((order) => order.status === 'approved' && order.contractId)
          .reduce((sum, order) => sum + order.amount, 0),
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
      startDate: project.start_date,
      deadline: project.deadline,
      coverPhotoStoragePath: project.cover_photo_storage_path ?? null,
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
    const downPayment = downPaymentAmount > 0 ? [{
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
    const approvedChangeOrders = project.changeOrders
      .filter((order) => order.status === 'approved' && order.contractId)
      .map((order) => ({
        id: `change-order:${order.id}`,
        projectId: project.id,
        contractId: order.contractId,
        projectName: project.name,
        clientName: project.client,
        billingNumber: 0,
        amount: order.amount,
        issuedAt: order.decidedAt ?? order.createdAt,
        createdAt: order.decidedAt ?? order.createdAt,
        dueAt: null,
        kind: 'change-order' as const,
      }))
    return [...downPayment, ...approvedChangeOrders]
  })
  const changeOrderContractIds = new Set(
    projects.flatMap((project) => project.changeOrders
      .filter((order) => order.status === 'approved' && order.contractId)
      .map((order) => order.contractId)),
  )
  const receivables = calculateReceivablesAging(
    [
      ...receivableInputs,
      ...(billingResult.data ?? []).flatMap((billing) => {
      const project = projectsById.get(billing.project_id)
      if (billing.contract_id && changeOrderContractIds.has(billing.contract_id)) return []
      return project ? [{
        id: billing.id,
        projectId: billing.project_id,
        contractId: billing.contract_id ?? null,
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
      contractId: payment.contract_id ?? null,
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

  const billingHistory: PortfolioBillingEvent[] = (billingResult.data ?? []).map((billing) => ({
    projectId: billing.project_id,
    date: billing.issued_at ?? billing.created_at,
    amount: Number(billing.amount_for_billing),
  }))

  return { projects, payments, receivables, billingHistory }
}

/** An issued progress billing, kept for month-by-month trends. */
export type PortfolioBillingEvent = { projectId: string; date: string; amount: number }

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
  startDate: string
  deadline: string | null
}

export async function updateProjectSetup(input: UpdateProjectSetupInput) {
  const client = requireSupabase()
  const { error } = await client.rpc('update_project_contract_schedule', {
    p_project_id: input.projectId,
    p_client_name: input.clientName.trim(),
    p_contract_amount: input.contractAmount,
    p_special_discount: input.specialDiscount,
    p_down_payment_percent: input.downPaymentPercent,
    p_retention_rate_percent: input.retentionRatePercent,
    p_retention_method: input.retentionMethod,
    p_start_date: input.startDate,
    p_deadline: input.deadline,
  })
  throwIfError(error)
}

export type RecordProjectPaymentInput = {
  projectId: string
  contractId?: string | null
  paymentType: Exclude<PaymentType, 'retention_release'>
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
    p_allocations: (input.allocations ?? []).map((allocation) => ({
      billing_id: allocation.billingId,
      amount: allocation.amount,
    })),
    p_contract_id: input.contractId ?? null,
  }).single()
  throwIfError(error)
  const payment = data as { payment_id: string; receipt_number: string } | null
  if (!payment) throw new Error('Payment was recorded without a receipt number.')
  return { paymentId: payment.payment_id, receiptNumber: payment.receipt_number }
}

export async function updateProjectPayment(input: {
  paymentId: string
  paymentType: PaymentType
  amount: number
  receivedDate: string
  paymentMode: PortfolioPayment['paymentMode']
  payerName: string
  reference?: string
  contractId?: string | null
}) {
  const { error } = await requireSupabase().rpc('update_project_payment', {
    p_payment_id: input.paymentId,
    p_payment_type: input.paymentType,
    p_amount: input.amount,
    p_received_date: input.receivedDate,
    p_payment_mode: input.paymentMode,
    p_payer_name: input.payerName.trim(),
    p_reference: input.reference?.trim() || null,
    p_contract_id: input.paymentType === 'change_order' ? input.contractId ?? null : null,
  })
  throwIfError(error)
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
  const client = requireSupabase()
  const contractId = inputs[0].contractId
  if (contractId && inputs.some((input) => input.contractId !== contractId)) {
    throw new Error('Expenses in one batch must belong to the same contract.')
  }
  const expenseRows = inputs.map((input) => ({
    project_id: input.projectId,
    expense_date: input.date,
    category: input.category,
    description: input.description.trim(),
    vendor: input.vendor?.trim() || null,
    amount: input.amount,
  }))
  const { data, error } = contractId
    ? await client.rpc('record_project_contract_expenses', { p_contract_id: contractId, p_expenses: expenseRows })
    : await client.rpc('record_project_expenses', { p_expenses: expenseRows })
  throwIfError(error)
  const savedCount = Number(data)
  if (savedCount !== inputs.length) throw new Error('Not all expense rows were recorded.')
  return savedCount
}

const receiptBucket = 'expense-receipts'

async function compressReceiptImage(file: File): Promise<Blob> {
  if (!file.type.startsWith('image/')) throw new Error('Receipt must be a photo (JPG, PNG or WebP).')
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    if (blob) return blob
  } catch {
    // Fall back to the original file when the browser cannot decode it (e.g. HEIC).
  }
  if (file.size > 8 * 1024 * 1024) throw new Error('Receipt photo must be smaller than 8 MB.')
  return file
}

export async function uploadExpenseReceipt(projectId: string, file: File) {
  const blob = await compressReceiptImage(file)
  const contentType = blob.type || file.type || 'image/jpeg'
  const extension = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
  const storagePath = `${SAGACT_ORGANIZATION_ID}/${projectId}/receipts/${crypto.randomUUID()}.${extension}`
  const { error } = await requireSupabase().storage.from(receiptBucket).upload(storagePath, blob, {
    cacheControl: '3600',
    contentType,
    upsert: false,
  })
  if (error) throw new Error(error.message)
  return storagePath
}

/** Removes an uploaded receipt that was never attached to an expense (e.g. the save failed). Never throws. */
export async function discardExpenseReceipt(storagePath: string) {
  try {
    await requireSupabase().storage.from(receiptBucket).remove([storagePath])
  } catch {
    // Best effort: an orphaned receipt is harmless and only costs storage.
  }
}

export async function createExpenseReceiptUrl(storagePath: string) {
  const { data, error } = await requireSupabase().storage.from(receiptBucket).createSignedUrl(storagePath, 3600)
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Could not create a secure receipt link.')
  return data.signedUrl
}

export async function setProjectExpenseReceipt(expenseId: string, storagePath: string | null) {
  const { error } = await requireSupabase().rpc('set_project_expense_receipt', {
    p_expense_id: expenseId,
    p_receipt_storage_path: storagePath,
  })
  throwIfError(error)
}

export async function recordQuickProjectExpense(input: {
  projectId: string
  date: string
  category: ProjectExpenseCategory
  description: string
  vendor?: string
  amount: number
  receiptStoragePath: string | null
}) {
  const { data, error } = await requireSupabase().rpc('record_project_expense_quick', {
    p_project_id: input.projectId,
    p_expense_date: input.date,
    p_category: input.category,
    p_description: input.description.trim(),
    p_vendor: input.vendor?.trim() || null,
    p_amount: input.amount,
    p_receipt_storage_path: input.receiptStoragePath,
  })
  throwIfError(error)
  return data as string
}

export async function updateProjectExpense(input: UpdateProjectExpenseInput) {
  const { error } = await requireSupabase().rpc('update_project_expense', {
    p_expense_id: input.id,
    p_expense_date: input.date,
    p_category: input.category,
    p_description: input.description.trim(),
    p_vendor: input.vendor?.trim() || null,
    p_amount: input.amount,
  })
  throwIfError(error)
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