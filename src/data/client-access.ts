import { supabase } from '../lib/supabase'

export type ClientAccessAccount = {
  userId: string
  email: string
  status: 'pending' | 'accepted'
  invitedAt: string
}

async function invokeClientAccess(projectId: string, action: string, details: Record<string, string> = {}) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { data: sessionData, error: sessionError } = await supabase.auth.refreshSession()
  if (sessionError) throw new Error(`Could not refresh your session. Sign out and sign in again. ${sessionError.message}`)
  const accessToken = sessionData.session?.access_token
  if (!accessToken) throw new Error('Your session has expired. Sign out and sign in again.')

  const { data, error } = await supabase.functions.invoke('invite-client', {
    body: { action, projectId, ...details },
    headers: { Authorization: `Bearer ${accessToken}` },
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
  return data as Record<string, unknown> | null
}

export async function inviteClientToProject(projectId: string, email: string) {
  const data = await invokeClientAccess(projectId, 'invite', { email: email.trim().toLowerCase() })
  if (!data || typeof data.invited !== 'boolean' || typeof data.emailSent !== 'boolean'
    || (data.emailError !== undefined && typeof data.emailError !== 'string')) {
    throw new Error('The invitation service returned an invalid response.')
  }
  return {
    invited: data.invited,
    emailSent: data.emailSent,
    emailError: typeof data.emailError === 'string' ? data.emailError : null,
  }
}

export async function loadClientAccess(projectId: string): Promise<ClientAccessAccount[]> {
  const data = await invokeClientAccess(projectId, 'list')
  if (!data || !Array.isArray(data.accounts)) throw new Error('The access service returned an invalid account list.')
  return data.accounts as ClientAccessAccount[]
}

export async function resendClientInvitation(projectId: string, userId: string) {
  const data = await invokeClientAccess(projectId, 'resend', { userId })
  if (!data || data.resent !== true || (data.type !== 'invitation' && data.type !== 'sign_in')) {
    throw new Error('The access service did not resend the invitation.')
  }
  return { type: data.type }
}

export async function revokeClientAccess(projectId: string, userId: string) {
  const data = await invokeClientAccess(projectId, 'revoke', { userId })
  if (!data || data.revoked !== true) throw new Error('The access service did not revoke client access.')
}