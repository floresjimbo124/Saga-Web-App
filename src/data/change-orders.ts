import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'
import { formatChangeOrderNumber } from '../lib/change-order-number'
import type { ProjectChangeOrderItem } from './portfolio'

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

function validateDraftInput(input: {
  items: ProjectChangeOrderItem[]
  contractTimeAdjustmentDays: number
}) {
  if (!input.items.length) throw new RangeError('Add at least one change-order item.')
  if (!Number.isSafeInteger(input.contractTimeAdjustmentDays)) {
    throw new RangeError('Contract time adjustment must be a whole number of days.')
  }
  if (input.contractTimeAdjustmentDays < -2_147_483_648 || input.contractTimeAdjustmentDays > 2_147_483_647) {
    throw new RangeError('Contract time adjustment is outside the supported day range.')
  }
  for (const [index, item] of input.items.entries()) {
    if (!item.item.trim()) throw new RangeError(`Enter an item name for row ${index + 1}.`)
    if (!Number.isFinite(item.cost) || item.cost <= 0) {
      throw new RangeError(`Enter a cost greater than zero for row ${index + 1}.`)
    }
  }
}

function serializeLineItems(items: ProjectChangeOrderItem[]) {
  return items.map((item) => ({
    item: item.item.trim(),
    description: item.description.trim(),
    remarks: item.remarks.trim(),
    cost: item.cost,
  }))
}

export async function createProjectChangeOrder(input: {
  projectId: string
  items: ProjectChangeOrderItem[]
  contractTimeAdjustmentDays: number
}): Promise<{ id: string; orderNumber: number }> {
  validateDraftInput(input)

  const { data, error } = await requireSupabase().rpc('create_project_change_order', {
    p_project_id: input.projectId,
    p_line_items: serializeLineItems(input.items),
    p_contract_time_adjustment_days: input.contractTimeAdjustmentDays,
  }).single()
  throwIfError(error)
  const changeOrder = data as { id: string; order_number: number } | null
  if (!changeOrder?.id || !changeOrder.order_number) throw new Error('Change order was created without returning its number.')
  return { id: changeOrder.id, orderNumber: changeOrder.order_number }
}

export async function updateProjectChangeOrderDraft(input: {
  projectId: string
  changeOrderId: string
  items: ProjectChangeOrderItem[]
  contractTimeAdjustmentDays: number
}) {
  validateDraftInput(input)
  const { error } = await requireSupabase().rpc('update_project_change_order_draft', {
    p_project_id: input.projectId,
    p_change_order_id: input.changeOrderId,
    p_line_items: serializeLineItems(input.items),
    p_contract_time_adjustment_days: input.contractTimeAdjustmentDays,
  })
  throwIfError(error)
}

export async function submitProjectChangeOrder(input: {
  projectId: string
  changeOrderId: string
  projectPrefix: string
  orderNumber: number
  projectName: string
  clientName: string
  location: string
  title: string
  description: string
  amount: number
  items: ProjectChangeOrderItem[]
  contractTimeAdjustmentDays: number
}) {
  const client = requireSupabase()
  const changeOrderNumber = formatChangeOrderNumber(input.projectPrefix, input.orderNumber)
  const { createChangeOrderPdf } = await import('../lib/change-order-pdf')
  const pdf = await createChangeOrderPdf({
    projectName: input.projectName,
    clientName: input.clientName,
    location: input.location,
    changeOrderNumber,
    title: input.title,
    description: input.description,
    amount: input.amount,
    items: input.items,
    contractTimeAdjustmentDays: input.contractTimeAdjustmentDays,
    issuedAt: new Date().toISOString(),
  })
  const storagePath = `${SAGACT_ORGANIZATION_ID}/${input.projectId}/change-orders/${input.changeOrderId}/${changeOrderNumber}.pdf`
  const { error: uploadError } = await client.storage.from('project-documents').upload(storagePath, pdf.output('blob'), {
    cacheControl: '3600',
    contentType: 'application/pdf',
    upsert: true,
  })
  throwIfError(uploadError)

  const { error } = await client.rpc('submit_project_change_order', {
    p_project_id: input.projectId,
    p_change_order_id: input.changeOrderId,
    p_pdf_storage_path: storagePath,
  })
  if (error) {
    const { error: cleanupError } = await client.storage.from('project-documents').remove([storagePath])
    if (cleanupError) throw new Error(`${error.message} The uploaded PDF could not be cleaned up: ${cleanupError.message}`)
    throw new Error(error.message)
  }
}

export async function createChangeOrderPdfUrl(storagePath: string, download = false) {
  const { data, error } = await requireSupabase().storage
    .from('project-documents')
    .createSignedUrl(storagePath, 60, download ? { download: true } : undefined)
  throwIfError(error)
  if (!data?.signedUrl) throw new Error('Could not create a secure change-order PDF link.')
  return data.signedUrl
}

export async function respondToProjectChangeOrder(changeOrderId: string, approved: boolean, note?: string) {
  const { error } = await requireSupabase().rpc('respond_to_change_order', {
    p_change_order_id: changeOrderId,
    p_approved: approved,
    p_note: note?.trim() || null,
  })
  throwIfError(error)
}
