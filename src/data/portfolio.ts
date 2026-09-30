import { SAGACT_ORGANIZATION_ID } from '../lib/supabase'
import { supabase } from '../lib/supabase'

export type ProjectStatus = 'On track' | 'Needs attention' | 'Planning'

export type PortfolioProject = {
  id: string
  name: string
  client: string
  location: string
  prefix: string
  contract: number
  isSetupComplete: boolean
  specialDiscount: number
  approvedChangeOrders: { amount: number; approved: boolean; retentionRatePercent?: number }[]
  billed: number
  collected: number
  retention: number
  progress: number
  downPaymentPercent: number
  retentionRate: number
  retentionMethod: 'final-schedule' | 'per-billing'
  status: ProjectStatus
  updatedAt: string
  milestone: string
}

export type PortfolioPayment = {
  id: string
  projectId: string
  payer: string
  date: string
  amount: number
  mode: string
  reference: string
}

export type CreateProjectInput = {
  name: string
  clientName: string
  prefix: string
  contractAmount: number
  downPaymentPercent: number
  retentionRatePercent: number
  retentionMethod: 'final_schedule' | 'per_billing'
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function projectStatus(status: string): ProjectStatus {
  if (status === 'on_hold') return 'Needs attention'
  if (status === 'active' || status === 'completed' || status === 'closed') return 'On track'
  return 'Planning'
}

function retentionMethod(method: string | undefined): PortfolioProject['retentionMethod'] {
  return method === 'per_billing' ? 'per-billing' : 'final-schedule'
}

export async function loadPortfolio() {
  const client = requireSupabase()
  const [projectResult, clientResult, termResult, billingResult, paymentResult, retentionResult, milestoneResult, changeOrderResult] = await Promise.all([
    client.from('projects')
      .select('id, name, prefix, location, status, progress_percent, client_id, updated_at')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .order('created_at', { ascending: true }),
    client.from('clients')
      .select('id, name')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_financial_terms')
      .select('project_id, contract_amount, special_discount, down_payment_percent, retention_rate_percent, retention_method')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('progress_billings')
      .select('project_id, amount_for_billing')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .eq('status', 'issued'),
    client.from('payments')
      .select('id, project_id, payer_name, received_at, amount, payment_mode, reference, receipt_number')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .is('voided_at', null)
      .order('received_at', { ascending: false }),
    client.from('retention_ledger')
      .select('project_id, entry_type, amount')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_milestones')
      .select('project_id, name, planned_date, status')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .neq('status', 'complete')
      .order('planned_date', { ascending: true, nullsFirst: false }),
    client.from('project_change_orders')
      .select('project_id, amount, retention_rate_percent')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .eq('status', 'approved'),
  ])

  for (const result of [projectResult, clientResult, termResult, billingResult, paymentResult, retentionResult, milestoneResult, changeOrderResult]) {
    throwIfError(result.error)
  }

  const clientsById = new Map((clientResult.data ?? []).map((item) => [item.id, item.name]))
  const termsByProject = new Map((termResult.data ?? []).map((item) => [item.project_id, item]))
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
  const payments: PortfolioPayment[] = (paymentResult.data ?? []).map((payment) => {
    collectedByProject.set(payment.project_id, (collectedByProject.get(payment.project_id) ?? 0) + Number(payment.amount))
    return {
      id: payment.id,
      projectId: payment.project_id,
      payer: payment.payer_name,
      date: payment.received_at,
      amount: Number(payment.amount),
      mode: payment.payment_mode.replaceAll('_', ' '),
      reference: payment.receipt_number ?? payment.reference ?? '',
    }
  })

  const heldByProject = new Map<string, number>()
  for (const entry of retentionResult.data ?? []) {
    const amount = Number(entry.amount) * (entry.entry_type === 'released' ? -1 : entry.entry_type === 'held' ? 1 : 0)
    heldByProject.set(entry.project_id, (heldByProject.get(entry.project_id) ?? 0) + amount)
  }
  const milestoneByProject = new Map<string, string>()
  for (const milestone of milestoneResult.data ?? []) {
    if (!milestoneByProject.has(milestone.project_id)) {
      const date = milestone.planned_date ? new Date(`${milestone.planned_date}T12:00:00`) : null
      const plannedDate = date ? new Intl.DateTimeFormat('en-PH', { month: 'short', day: '2-digit' }).format(date) : 'Date not set'
      milestoneByProject.set(milestone.project_id, `${milestone.name} · ${plannedDate}`)
    }
  }

  const projects: PortfolioProject[] = (projectResult.data ?? []).map((project) => {
    const terms = termsByProject.get(project.id)
    return {
      id: project.id,
      name: project.name,
      client: project.client_id ? clientsById.get(project.client_id) ?? 'Client unavailable' : 'Client not set',
      location: project.location ?? 'Location not set',
      prefix: project.prefix,
      contract: Number(terms?.contract_amount ?? 0),
      isSetupComplete: Boolean(project.client_id && terms?.contract_amount !== null && terms?.contract_amount !== undefined),
      specialDiscount: Number(terms?.special_discount ?? 0),
      approvedChangeOrders: changeOrdersByProject.get(project.id) ?? [],
      billed: billedByProject.get(project.id) ?? 0,
      collected: collectedByProject.get(project.id) ?? 0,
      retention: Math.max(0, heldByProject.get(project.id) ?? 0),
      progress: Number(project.progress_percent),
      downPaymentPercent: Number(terms?.down_payment_percent ?? 0),
      retentionRate: Number(terms?.retention_rate_percent ?? 5),
      retentionMethod: retentionMethod(terms?.retention_method),
      status: projectStatus(project.status),
      updatedAt: project.updated_at,
      milestone: milestoneByProject.get(project.id) ?? 'No upcoming milestone',
    }
  })

  return { projects, payments }
}

export async function createProject(input: CreateProjectInput) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('create_project_with_terms', {
    p_organization_id: SAGACT_ORGANIZATION_ID,
    p_project_name: input.name.trim(),
    p_client_name: input.clientName.trim(),
    p_prefix: input.prefix,
    p_contract_amount: input.contractAmount,
    p_down_payment_percent: input.downPaymentPercent,
    p_retention_rate_percent: input.retentionRatePercent,
    p_retention_method: input.retentionMethod,
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
}

export async function recordProjectPayment(input: RecordProjectPaymentInput) {
  const client = requireSupabase()
  const { data, error } = await client.rpc('record_project_payment', {
    p_project_id: input.projectId,
    p_payment_type: input.paymentType,
    p_amount: input.amount,
    p_received_date: input.receivedDate,
    p_payment_mode: input.paymentMode,
    p_payer_name: input.payerName.trim(),
    p_reference: input.reference?.trim() || null,
  }).single()
  throwIfError(error)
  const payment = data as { payment_id: string; receipt_number: string } | null
  if (!payment) throw new Error('Payment was recorded without a receipt number.')
  return { paymentId: payment.payment_id, receiptNumber: payment.receipt_number }
}