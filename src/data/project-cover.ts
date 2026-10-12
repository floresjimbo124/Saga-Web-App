import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

const coverBucket = 'project-documents'
const maximumCoverSize = 10 * 1024 * 1024
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const allowedExtensions = new Set(['jpg', 'jpeg', 'png', 'webp'])

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

export function validateProjectCoverPhoto(file: File) {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!allowedExtensions.has(extension) || !allowedTypes.has(file.type)) {
    throw new Error('Choose a JPG, PNG, or WebP image.')
  }
  if (file.size === 0) throw new Error('The selected image is empty.')
  if (file.size > maximumCoverSize) throw new Error('Project cover photos must be 10 MB or smaller.')
}

export async function uploadProjectCoverPhoto(projectId: string, file: File, previousStoragePath: string | null) {
  validateProjectCoverPhoto(file)
  const client = requireSupabase()
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  const storagePath = `${SAGACT_ORGANIZATION_ID}/${projectId}/cover/${crypto.randomUUID()}.${extension}`
  const { error: uploadError } = await client.storage.from(coverBucket).upload(storagePath, file, {
    cacheControl: '3600',
    contentType: file.type,
    upsert: false,
  })
  if (uploadError) throw new Error(uploadError.message)

  const { data, error } = await client.from('projects')
    .update({ cover_photo_storage_path: storagePath })
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('id', projectId)
    .select('id')
    .maybeSingle()
  if (error || !data) {
    const { error: cleanupError } = await client.storage.from(coverBucket).remove([storagePath])
    if (cleanupError) {
      throw new Error(`Could not save the project cover photo. The uploaded file also could not be cleaned up: ${cleanupError.message}`)
    }
    throw new Error(error?.message ?? 'Could not save the project cover photo.')
  }
  if (previousStoragePath) {
    const { error: cleanupError } = await client.storage.from(coverBucket).remove([previousStoragePath])
    if (cleanupError) {
      throw new Error(`The new project cover photo was saved, but the previous photo could not be deleted: ${cleanupError.message}`)
    }
  }
  return storagePath
}

export async function deleteProjectCoverPhoto(projectId: string, storagePath: string) {
  const client = requireSupabase()
  const { data, error: updateError } = await client.from('projects')
    .update({ cover_photo_storage_path: null })
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('id', projectId)
    .eq('cover_photo_storage_path', storagePath)
    .select('id')
    .maybeSingle()
  if (updateError || !data) throw new Error(updateError?.message ?? 'Could not remove the project cover photo.')
  const { error: removeError } = await client.storage.from(coverBucket).remove([storagePath])
  if (removeError) throw new Error(`The project cover was detached, but its stored file could not be deleted: ${removeError.message}`)
}

export async function createProjectCoverPhotoUrl(storagePath: string) {
  const { data, error } = await requireSupabase().storage.from(coverBucket).createSignedUrl(storagePath, 3600)
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Could not create a secure project cover photo link.')
  return data.signedUrl
}
