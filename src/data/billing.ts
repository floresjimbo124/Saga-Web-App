import { supabase } from '../lib/supabase'
import { calculateReceivablesAging } from '../finance/receivables-aging'

export type ProjectBilling = {
  id: string
  billingNumber: number
  status: 'draft' | 'issued' | 'void'
  progressPercent: number
  amount: number
  issuedAt: string | null
  dueAt: string | null
  voidReason: string | null
}

export type OpenProjectBilling = {
  id: string
  contractId: string | null
  billingNumber: number
  outstandingAmount: number
  dueAt: string | null
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function loadProjectBillings(projectId: string, contractId?: string): Promise<ProjectBilling[]> {
  let query = requireSupabase()
    .from('progress_billings')
    .select('id, contract_id, billing_number, status, progress_percent, amount_for_billing, issued_at, due_at, void_reason')
    .eq('project_id', projectId)
  query = contractId ? query.eq('contract_id', contractId) : query.is('contract_id', null)
  const { data, error } = await query.order('billing_number', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id,
    billingNumber: row.billing_number,
    status: row.status,
    progressPercent: Number(row.progress_percent),
    amount: Number(row.amount_for_billing),
    issuedAt: row.issued_at,
    dueAt: row.due_at,
    voidReason: row.void_reason,
  }))
}

export async function loadOpenProjectBillings(projectId: string, contractId?: string | null): Promise<OpenProjectBilling[]> {
  const client = requireSupabase()
  let billings = client.from('progress_billings')
    .select('id, project_id, contract_id, billing_number, amount_for_billing, issued_at, created_at, due_at')
    .eq('project_id', projectId)
    .eq('status', 'issued')
  let payments = client.from('payments')
    .select('id, project_id, contract_id, amount, created_at, payment_type')
    .eq('project_id', projectId)
    .is('voided_at', null)
  if (contractId !== undefined) {
    billings = contractId ? billings.eq('contract_id', contractId) : billings.is('contract_id', null)
    payments = contractId ? payments.eq('contract_id', contractId) : payments.is('contract_id', null)
  }
  const [billingResult, paymentResult, allocationResult] = await Promise.all([
    billings,
    payments,
    client.from('payment_allocations')
      .select('payment_id, billing_id, amount')
      .eq('project_id', projectId),
  ])
  for (const result of [billingResult, paymentResult, allocationResult]) {
    if (result.error) throw new Error(result.error.message)
  }

  const outstanding = calculateReceivablesAging(
    (billingResult.data ?? []).map((billing) => ({
      id: billing.id,
      projectId: billing.project_id,
      contractId: billing.contract_id ?? null,
      projectName: '',
      clientName: '',
      billingNumber: billing.billing_number,
      amount: Number(billing.amount_for_billing),
      issuedAt: billing.issued_at,
      createdAt: billing.created_at,
      dueAt: billing.due_at,
    })),
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
  return outstanding.map((billing) => ({
    id: billing.id,
    contractId: billing.contractId ?? null,
    billingNumber: billing.billingNumber,
    outstandingAmount: billing.outstandingAmount,
    dueAt: billing.dueAt,
  }))
}

export async function updateProjectProgress(input: { projectId: string; contractId?: string; progressPercent: number; summary?: string }) {
  const { error } = await requireSupabase().rpc(input.contractId ? 'update_project_contract_progress' : 'update_project_progress', {
    p_project_id: input.projectId,
    ...(input.contractId ? { p_contract_id: input.contractId } : {}),
    p_progress_percent: input.progressPercent,
    p_summary: input.summary?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function issueProjectBilling(projectId: string, dueDate: string | null, contractId?: string) {
  const { data, error } = await requireSupabase()
    .rpc(contractId ? 'issue_project_contract_billing' : 'issue_progress_billing', {
      p_project_id: projectId,
      ...(contractId ? { p_contract_id: contractId } : {}),
      p_due_date: dueDate,
    })
    .single()
  if (error) throw new Error(error.message)
  const row = data as { billing_id: string; billing_number: number; amount_for_billing: number | string } | null
  if (!row) throw new Error('Billing was issued without returning its details.')
  return { billingId: row.billing_id, billingNumber: row.billing_number, amount: Number(row.amount_for_billing) }
}

export async function voidProjectBilling(billingId: string, reason: string) {
  const { error } = await requireSupabase().rpc('void_progress_billing', {
    p_billing_id: billingId,
    p_reason: reason.trim(),
  })
  if (error) throw new Error(error.message)
}
