import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

const photoBucket = 'project-documents'
const maximumPhotoSize = 10 * 1024 * 1024
const allowedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const allowedPhotoExtensions = new Set(['jpg', 'jpeg', 'png', 'webp'])

export type ProjectMilestoneStatus = 'pending' | 'in_progress' | 'complete' | 'blocked'

export type ProjectMilestone = {
  id: string
  name: string
  startDate: string | null
  plannedDate: string | null
  actualDate: string | null
  completionPercent: number
  status: ProjectMilestoneStatus
  clientVisible: boolean
  photoStoragePath: string | null
}

export type SaveProjectMilestoneInput = {
  projectId: string
  name: string
  startDate: string | null
  plannedDate: string | null
  actualDate: string | null
  completionPercent: number
  status: ProjectMilestoneStatus
  clientVisible: boolean
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function validateMilestone(input: SaveProjectMilestoneInput) {
  if (!input.name.trim()) throw new Error('Enter a milestone name.')
  for (const [label, date] of [['Start date', input.startDate], ['End date', input.plannedDate], ['Actual date', input.actualDate]] as const) {
    if (date === null) continue
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`${label} must be a valid date.`)
    }
  }
  if (input.startDate && input.plannedDate && input.startDate > input.plannedDate) {
    throw new Error('End date cannot be before the start date.')
  }
  if (!Number.isFinite(input.completionPercent)
    || input.completionPercent < 0
    || input.completionPercent > 100
    || Math.round(input.completionPercent * 100) / 100 !== input.completionPercent) {
    throw new Error('Milestone completion must be from 0 to 100 with up to two decimal places.')
  }
}

export function validateProjectMilestonePhoto(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!allowedPhotoExtensions.has(extension) || !allowedPhotoTypes.has(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.')
  }
  if (file.size === 0) throw new Error('The selected image is empty.')
  if (file.size > maximumPhotoSize) throw new Error('Milestone photos must be 10 MB or smaller.')
}

export async function uploadProjectMilestonePhoto(projectId: string, milestoneId: string, file: File, previousStoragePath: string | null) {
  validateProjectMilestonePhoto(file)
  const client = requireSupabase()
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const storagePath = `${SAGACT_ORGANIZATION_ID}/${projectId}/milestones/${milestoneId}/${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await client.storage.from(photoBucket).upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) throw new Error(uploadError.message)

  const { data, error } = await client.from('project_milestones')
    .update({ photo_storage_path: storagePath })
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', projectId)
    .eq('id', milestoneId)
    .eq('status', 'complete')
    .select('id')
    .maybeSingle()
  if (error || !data) {
    const { error: cleanupError } = await client.storage.from(photoBucket).remove([storagePath])
    if (cleanupError) {
      throw new Error(`Could not attach the photo to this completed milestone. The uploaded file also could not be cleaned up: ${cleanupError.message}`)
    }
    throw new Error(error?.message ?? 'Save the milestone as complete before attaching a photo.')
  }
  if (previousStoragePath) {
    const { error: cleanupError } = await client.storage.from(photoBucket).remove([previousStoragePath])
    if (cleanupError) {
      throw new Error(`The new milestone photo was saved, but the previous photo could not be deleted: ${cleanupError.message}`)
    }
  }
  return storagePath
}

export async function deleteProjectMilestonePhoto(projectId: string, milestoneId: string, storagePath: string) {
  const client = requireSupabase()
  const { error: updateError } = await client.from('project_milestones')
    .update({ photo_storage_path: null })
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', projectId)
    .eq('id', milestoneId)
    .eq('photo_storage_path', storagePath)
  if (updateError) throw new Error(updateError.message)
  const { error: removeError } = await client.storage.from(photoBucket).remove([storagePath])
  if (removeError) throw new Error(`The milestone photo was detached, but its stored file could not be deleted: ${removeError.message}`)
}

export async function createProjectMilestonePhotoUrl(storagePath: string) {
  const { data, error } = await requireSupabase().storage.from(photoBucket).createSignedUrl(storagePath, 3600)
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Could not create a secure milestone photo link.')
  return data.signedUrl
}

export async function createProjectMilestone(input: SaveProjectMilestoneInput) {
  validateMilestone(input)
  const { data, error } = await requireSupabase().from('project_milestones').insert({
    organization_id: SAGACT_ORGANIZATION_ID,
    project_id: input.projectId,
    name: input.name.trim(),
    start_date: input.startDate,
    planned_date: input.plannedDate,
    actual_date: input.actualDate,
    completion_percent: input.completionPercent,
    status: input.status,
    client_visible: input.clientVisible,
  }).select('id').single()
  if (error) throw new Error(error.message)
  return (data as { id: string }).id
}

export async function updateProjectMilestone(milestoneId: string, input: SaveProjectMilestoneInput) {
  validateMilestone(input)
  const { error } = await requireSupabase().from('project_milestones')
    .update({
      name: input.name.trim(),
      start_date: input.startDate,
      planned_date: input.plannedDate,
      actual_date: input.actualDate,
      completion_percent: input.completionPercent,
      status: input.status,
      client_visible: input.clientVisible,
    })
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', input.projectId)
    .eq('id', milestoneId)
  if (error) throw new Error(error.message)
}

export async function deleteProjectMilestone(projectId: string, milestoneId: string) {
  const client = requireSupabase()
  const { data: milestone, error: loadError } = await client.from('project_milestones')
    .select('photo_storage_path')
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', projectId)
    .eq('id', milestoneId)
    .maybeSingle()
  if (loadError) throw new Error(loadError.message)

  const { error } = await client.from('project_milestones')
    .delete()
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', projectId)
    .eq('id', milestoneId)
  if (error) throw new Error(error.message)

  if (milestone?.photo_storage_path) {
    const { error: removeError } = await client.storage.from(photoBucket).remove([milestone.photo_storage_path])
    if (removeError) throw new Error(`The milestone was deleted, but its stored photo could not be deleted: ${removeError.message}`)
  }
}
