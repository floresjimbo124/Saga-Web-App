import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

export type ClientPortalProject = {
  id: string
  name: string
  clientName: string
  location: string
  progress: number
  status: string
  updatedAt: string
  milestones: {
    id: string
    name: string
    plannedDate: string | null
    status: string
  }[]
  updates: {
    id: string
    progress: number
    summary: string
    createdAt: string
  }[]
  billings: {
    id: string
    number: number
    amount: number
    progress: number
    issuedAt: string | null
    dueAt: string | null
  }[]
  payments: {
    id: string
    receiptNumber: string
    amount: number
    receivedAt: string
    payerName: string
    paymentType: 'down_payment' | 'progress' | 'retention_release' | 'other'
    paymentMode: 'cash' | 'bank_transfer' | 'check' | 'card' | 'other'
    reference: string
  }[]
  documents: {
    id: string
    fileName: string
    documentType: string
    storagePath: string
    createdAt: string
  }[]
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
    .select('id, client_id, name, location, progress_percent, status, updated_at')
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .order('updated_at', { ascending: false })
  throwIfError(projectError)

  const projects = projectRows ?? []
  const projectIds = projects.map((project) => project.id)
  if (!projectIds.length) return []

  const [clientResult, milestoneResult, updateResult, billingResult, paymentResult, documentResult] = await Promise.all([
    client.from('clients')
      .select('id, name')
      .eq('organization_id', SAGACT_ORGANIZATION_ID),
    client.from('project_milestones')
      .select('id, project_id, name, planned_date, status')
      .in('project_id', projectIds)
      .eq('client_visible', true)
      .order('planned_date', { ascending: true, nullsFirst: false }),
    client.from('project_progress_updates')
      .select('id, project_id, progress_percent, summary, created_at')
      .in('project_id', projectIds)
      .eq('client_visible', true)
      .order('created_at', { ascending: false }),
    client.from('progress_billings')
      .select('id, project_id, billing_number, amount_for_billing, progress_percent, issued_at, due_at')
      .in('project_id', projectIds)
      .eq('status', 'issued')
      .order('billing_number', { ascending: false }),
    client.from('payments')
      .select('id, project_id, receipt_number, amount, received_at, payer_name, payment_type, payment_mode, reference')
      .in('project_id', projectIds)
      .is('voided_at', null)
      .order('received_at', { ascending: false }),
    client.from('project_documents')
      .select('id, project_id, file_name, document_type, storage_path, created_at')
      .in('project_id', projectIds)
      .eq('client_visible', true)
      .order('created_at', { ascending: false }),
  ])

  for (const result of [clientResult, milestoneResult, updateResult, billingResult, paymentResult, documentResult]) {
    throwIfError(result.error)
  }

  const clientsById = new Map((clientResult.data ?? []).map((item) => [item.id, item.name]))
  const milestonesByProject = new Map<string, ClientPortalProject['milestones']>()
  for (const item of milestoneResult.data ?? []) {
    const rows = milestonesByProject.get(item.project_id) ?? []
    rows.push({ id: item.id, name: item.name, plannedDate: item.planned_date, status: item.status })
    milestonesByProject.set(item.project_id, rows)
  }

  const updatesByProject = new Map<string, ClientPortalProject['updates']>()
  for (const item of updateResult.data ?? []) {
    const rows = updatesByProject.get(item.project_id) ?? []
    rows.push({
      id: item.id,
      progress: Number(item.progress_percent),
      summary: item.summary,
      createdAt: item.created_at,
    })
    updatesByProject.set(item.project_id, rows)
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
      payerName: item.payer_name,
      paymentType: item.payment_type,
      paymentMode: item.payment_mode,
      reference: item.reference ?? '',
    })
    paymentsByProject.set(item.project_id, rows)
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

  return projects.map((project) => ({
    id: project.id,
    name: project.name,
    clientName: clientsById.get(project.client_id) ?? 'Client',
    location: project.location ?? 'Location not provided',
    progress: Number(project.progress_percent),
    status: project.status,
    updatedAt: project.updated_at,
    milestones: milestonesByProject.get(project.id) ?? [],
    updates: updatesByProject.get(project.id) ?? [],
    billings: billingsByProject.get(project.id) ?? [],
    payments: paymentsByProject.get(project.id) ?? [],
    documents: documentsByProject.get(project.id) ?? [],
  }))
}