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
  billingNumber: number
  outstandingAmount: number
  dueAt: string | null
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export async function loadProjectBillings(projectId: string): Promise<ProjectBilling[]> {
  const { data, error } = await requireSupabase()
    .from('progress_billings')
    .select('id, billing_number, status, progress_percent, amount_for_billing, issued_at, due_at, void_reason')
    .eq('project_id', projectId)
    .order('billing_number', { ascending: false })
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

export async function loadOpenProjectBillings(projectId: string): Promise<OpenProjectBilling[]> {
  const client = requireSupabase()
  const [billingResult, paymentResult, allocationResult] = await Promise.all([
    client.from('progress_billings')
      .select('id, project_id, billing_number, amount_for_billing, issued_at, created_at, due_at')
      .eq('project_id', projectId)
      .eq('status', 'issued'),
    client.from('payments')
      .select('id, project_id, amount, created_at, payment_type')
      .eq('project_id', projectId)
      .is('voided_at', null),
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
    billingNumber: billing.billingNumber,
    outstandingAmount: billing.outstandingAmount,
    dueAt: billing.dueAt,
  }))
}

export async function updateProjectProgress(input: { projectId: string; progressPercent: number; summary?: string }) {
  const { error } = await requireSupabase().rpc('update_project_progress', {
    p_project_id: input.projectId,
    p_progress_percent: input.progressPercent,
    p_summary: input.summary?.trim() || null,
  })
  if (error) throw new Error(error.message)
}

export async function issueProjectBilling(projectId: string, dueDate: string | null) {
  const { data, error } = await requireSupabase()
    .rpc('issue_progress_billing', { p_project_id: projectId, p_due_date: dueDate })
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
