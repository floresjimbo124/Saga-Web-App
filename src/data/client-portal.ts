import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

export type ClientPortalProject = {
  id: string
  name: string
  clientName: string
  location: string
  progress: number
  status: string
  createdAt: string
  updatedAt: string
  contractPrice: number
  downPaymentAmount: number
  completedAt: string | null
  retentionAmount: number
  milestones: {
    id: string
    name: string
    plannedDate: string | null
    actualDate: string | null
    status: 'pending' | 'in_progress' | 'complete' | 'blocked'
  }[]
  billings: {
    id: string
    number: number
    amount: number
    progress: number
    issuedAt: string | null
    createdAt: string
    dueAt: string | null
  }[]
  payments: {
    id: string
    receiptNumber: string
    amount: number
    receivedAt: string
    recordedAt: string
    payerName: string
    paymentType: 'down_payment' | 'progress' | 'retention_release' | 'other'
    paymentMode: 'cash' | 'bank_transfer' | 'check' | 'card' | 'other'
    reference: string
  }[]
  allocations: {
    paymentId: string
    billingId: string
    amount: number
  }[]
  documents: {
    id: string
    fileName: string
    documentType: string
    storagePath: string
    createdAt: string
  }[]
}

type ClientProjectRetentionRow = {
  project_id: string
  retention_amount: number | string | null
  completed_at: string | null
}

type ClientProjectDownPaymentRow = {
  project_id: string
  contract_price: number | string | null
  down_payment_amount: number | string | null
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function loadClientPortalProjects(): Promise<ClientPortalProject[]> {
  const client = requireSupabase()
  const { data: projectRows, error: projectError } = await client
    .from('projects')
    .select('id, client_id, name, location, progress_percent, status, created_at, updated_at')
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .order('updated_at', { ascending: false })
  throwIfError(projectError)

  const projects = projectRows ?? []
  const projectIds = projects.map((project) => project.id)
  if (!projectIds.length) return []

  const [clientResult, billingResult, paymentResult, allocationResult, documentResult, retentionResult, downPaymentResult, milestoneResult] = await Promise.all([
    client.from('clients')
      .select('id, name')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('progress_billings')
      .select('id, project_id, billing_number, amount_for_billing, progress_percent, issued_at, created_at, due_at')
      .in('project_id', projectIds)
      .eq('status', 'issued')
      .order('billing_number', { ascending: false }),
    client.from('payments')
      .select('id, project_id, receipt_number, amount, received_at, created_at, payer_name, payment_type, payment_mode, reference')
      .in('project_id', projectIds)
      .is('voided_at', null)
      .order('received_at', { ascending: false }),
    client.from('payment_allocations')
      .select('project_id, payment_id, billing_id, amount')
      .in('project_id', projectIds),
    client.from('project_documents')
      .select('id, project_id, file_name, document_type, storage_path, created_at')
      .in('project_id', projectIds)
      .eq('client_visible', true)
      .order('created_at', { ascending: false }),
    client.rpc('get_client_project_retention'),
    client.rpc('get_client_project_down_payment'),
    client.from('project_milestones')
      .select('id, project_id, name, planned_date, actual_date, status')
      .in('project_id', projectIds)
      .eq('client_visible', true)
      .order('planned_date', { ascending: true, nullsFirst: false }),
  ])

  for (const result of [clientResult, billingResult, paymentResult, allocationResult, documentResult, retentionResult, downPaymentResult, milestoneResult]) {
    throwIfError(result.error)
  }

  const clientsById = new Map((clientResult.data ?? []).map((item) => [item.id, item.name]))
  const milestonesByProject = new Map<string, ClientPortalProject['milestones']>()
  for (const item of milestoneResult.data ?? []) {
    const milestones = milestonesByProject.get(item.project_id) ?? []
    milestones.push({
      id: item.id,
      name: item.name,
      plannedDate: item.planned_date,
      actualDate: item.actual_date,
      status: item.status,
    })
    milestonesByProject.set(item.project_id, milestones)
  }
  const billingsByProject = new Map<string, ClientPortalProject['billings']>()
  for (const item of billingResult.data ?? []) {
    const rows = billingsByProject.get(item.project_id) ?? []
    rows.push({
      id: item.id,
      number: item.billing_number,
      amount: Number(item.amount_for_billing),
      progress: Number(item.progress_percent),
      issuedAt: item.issued_at,
      createdAt: item.created_at,
      dueAt: item.due_at,
    })
    billingsByProject.set(item.project_id, rows)
  }

  const paymentsByProject = new Map<string, ClientPortalProject['payments']>()
  for (const item of paymentResult.data ?? []) {
    const rows = paymentsByProject.get(item.project_id) ?? []
    rows.push({
      id: item.id,
      receiptNumber: item.receipt_number,
      amount: Number(item.amount),
      receivedAt: item.received_at,
      recordedAt: item.created_at,
      payerName: item.payer_name,
      paymentType: item.payment_type,
      paymentMode: item.payment_mode,
      reference: item.reference ?? '',
    })
    paymentsByProject.set(item.project_id, rows)
  }

  const allocationsByProject = new Map<string, ClientPortalProject['allocations']>()
  for (const item of allocationResult.data ?? []) {
    const rows = allocationsByProject.get(item.project_id) ?? []
    rows.push({
      paymentId: item.payment_id,
      billingId: item.billing_id,
      amount: Number(item.amount),
    })
    allocationsByProject.set(item.project_id, rows)
  }

  const documentsByProject = new Map<string, ClientPortalProject['documents']>()
  for (const item of documentResult.data ?? []) {
    const rows = documentsByProject.get(item.project_id) ?? []
    rows.push({
      id: item.id,
      fileName: item.file_name,
      documentType: item.document_type,
      storagePath: item.storage_path,
      createdAt: item.created_at,
    })
    documentsByProject.set(item.project_id, rows)
  }

  const retentionByProject = new Map<string, ClientProjectRetentionRow>()
  for (const item of (retentionResult.data ?? []) as ClientProjectRetentionRow[]) {
    retentionByProject.set(item.project_id, item)
  }
  const downPaymentByProject = new Map<string, ClientProjectDownPaymentRow>()
  for (const item of (downPaymentResult.data ?? []) as ClientProjectDownPaymentRow[]) {
    downPaymentByProject.set(item.project_id, item)
  }

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    clientName: clientsById.get(project.client_id) ?? 'Client',
    location: project.location ?? 'Location not provided',
    progress: Number(project.progress_percent),
    status: project.status,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    contractPrice: Number(downPaymentByProject.get(project.id)?.contract_price ?? 0),
    downPaymentAmount: Number(downPaymentByProject.get(project.id)?.down_payment_amount ?? 0),
    completedAt: retentionByProject.get(project.id)?.completed_at ?? null,
    retentionAmount: Number(retentionByProject.get(project.id)?.retention_amount ?? 0),
    milestones: milestonesByProject.get(project.id) ?? [],
    billings: billingsByProject.get(project.id) ?? [],
    payments: paymentsByProject.get(project.id) ?? [],
    allocations: allocationsByProject.get(project.id) ?? [],
    documents: documentsByProject.get(project.id) ?? [],
  }))
}