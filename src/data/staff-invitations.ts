import { supabase } from '../lib/supabase'
import { refreshAccessToken } from '../lib/refresh-session'
import type { StaffTitle } from './tasks'

export type StaffAccount = {
  userId: string
  email: string
  name: string
  title: StaffTitle
  status: 'accepted' | 'pending'
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

async function invokeStaffAccess(body: Record<string, string>) {
  const client = requireSupabase()
  const accessToken = await refreshAccessToken(client.auth)

  const { data, error } = await client.functions.invoke('manage-staff', {
    body,
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
  if (!data || typeof data !== 'object') throw new Error('The staff-management service returned an invalid response.')
  return data as Record<string, unknown>
}

export async function inviteStaffMember(input: {
  email: string
  name: string
  title: StaffTitle
}) {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Enter a valid staff email address.')
  if (name.length < 2 || name.length > 120) throw new Error('Name must contain between 2 and 120 characters.')

  const data = await invokeStaffAccess({ action: 'invite', email, name, title: input.title })
  if (data.invited !== true || typeof data.emailSent !== 'boolean'
    || (data.emailError !== undefined && typeof data.emailError !== 'string')) {
    throw new Error('The staff-management service returned an invalid invitation response.')
  }
  return {
    emailSent: data.emailSent,
    emailError: typeof data.emailError === 'string' ? data.emailError : null,
  }
}

export async function resendStaffInvitation(userId: string) {
  const data = await invokeStaffAccess({ action: 'resend', userId })
  if (data.resent !== true || (data.type !== 'invitation' && data.type !== 'sign_in')) {
    throw new Error('The staff-management service did not resend the account email.')
  }
  return { type: data.type }
}

export async function revokeStaffAccess(userId: string) {
  const data = await invokeStaffAccess({ action: 'revoke', userId })
  if (data.revoked !== true) throw new Error('The staff-management service did not revoke access.')
}

export async function loadStaffMembers() {
  const data = await invokeStaffAccess({ action: 'list' })
  if (!Array.isArray(data.members)) throw new Error('The staff-management service returned an invalid member list.')
  return data.members.map((member): StaffAccount => {
    if (!member || typeof member !== 'object') throw new Error('The staff-management service returned an invalid member.')
    const row = member as Record<string, unknown>
    if (typeof row.userId !== 'string' || typeof row.email !== 'string' || typeof row.name !== 'string'
      || (row.title !== 'liaison_officer' && row.title !== 'engineer' && row.title !== 'architect')
      || (row.status !== 'accepted' && row.status !== 'pending')) {
      throw new Error('The staff-management service returned an invalid member.')
    }
    return {
      userId: row.userId,
      email: row.email,
      name: row.name,
      title: row.title,
      status: row.status,
    }
  })
}
