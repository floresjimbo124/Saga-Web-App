import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

const bucketName = 'project-documents'
const maximumFileSize = 50 * 1024 * 1024
const allowedExtensions = new Set(['pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx', 'dwg', 'dxf'])

export type ProjectDocument = {
  id: string
  projectId: string
  fileName: string
  documentType: string
  storagePath: string
  clientVisible: boolean
  createdAt: string
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function throwIfError(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export function validateProjectDocumentFile(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!allowedExtensions.has(extension)) {
    throw new Error('Choose a PDF, image, Office document, or CAD drawing.')
  }
  if (file.size === 0) throw new Error('The selected file is empty.')
  if (file.size > maximumFileSize) throw new Error('Files must be 50 MB or smaller.')
}

export async function loadProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  const { data, error } = await requireSupabase()
    .from('project_documents')
    .select('id, project_id, file_name, document_type, storage_path, client_visible, created_at')
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  throwIfError(error)
  return (data ?? []).map((item) => ({
    id: item.id,
    projectId: item.project_id,
    fileName: item.file_name,
    documentType: item.document_type,
    storagePath: item.storage_path,
    clientVisible: item.client_visible,
    createdAt: item.created_at,
  }))
}

export async function uploadProjectDocument(input: {
  projectId: string
  file: File
  documentType: string
  clientVisible: boolean
}) {
  validateProjectDocumentFile(input.file)
  const client = requireSupabase()
  const safeFileName = input.file.name.normalize('NFKC')
    .replace(/[\\/]/g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
  const storagePath = `${SAGACT_ORGANIZATION_ID}/${input.projectId}/${crypto.randomUUID()}-${safeFileName}`
  const { error: uploadError } = await client.storage.from(bucketName).upload(storagePath, input.file, {
    cacheControl: '3600',
    contentType: input.file.type || undefined,
    upsert: false,
  })
  throwIfError(uploadError)

  const { error: insertError } = await client.from('project_documents').insert({
    organization_id: SAGACT_ORGANIZATION_ID,
    project_id: input.projectId,
    storage_path: storagePath,
    file_name: input.file.name,
    document_type: input.documentType,
    client_visible: input.clientVisible,
  })
  if (insertError) {
    await client.storage.from(bucketName).remove([storagePath])
    throw new Error(insertError.message)
  }
}

export async function setProjectDocumentVisibility(projectId: string, documentId: string, clientVisible: boolean) {
  const { error } = await requireSupabase()
    .from('project_documents')
    .update({ client_visible: clientVisible })
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', projectId)
    .eq('id', documentId)
  throwIfError(error)
}

export async function deleteProjectDocument(projectId: string, document: ProjectDocument) {
  const client = requireSupabase()
  const { error: storageError } = await client.storage.from(bucketName).remove([document.storagePath])
  throwIfError(storageError)
  const { error } = await client.from('project_documents')
    .delete()
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', projectId)
    .eq('id', document.id)
  throwIfError(error)
}

export async function createProjectDocumentUrl(storagePath: string) {
  const { data, error } = await requireSupabase().storage.from(bucketName).createSignedUrl(storagePath, 60)
  throwIfError(error)
  if (!data) throw new Error('Could not create a secure document link.')
  return data.signedUrl
}