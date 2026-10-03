import { supabase } from '../lib/supabase'

export async function inviteClientToProject(projectId: string, email: string) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data, error } = await supabase.functions.invoke('invite-client', {
    body: { projectId, email: email.trim().toLowerCase() },
  })
  if (error) {
    const context = (error as Error & { context?: unknown }).context
    if (context instanceof Response) {
      const responseBody: unknown = await context.clone().json().catch(() => null)
      if (responseBody && typeof responseBody === 'object' && 'error' in responseBody && typeof responseBody.error === 'string') {
        throw new Error(responseBody.error)
      }
    }
    throw new Error(error.message)
  }
  if (!data || typeof data.invited !== 'boolean') throw new Error('The invitation service returned an invalid response.')
  return { invited: data.invited as boolean }
}