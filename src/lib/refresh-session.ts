import type { SupabaseClient } from '@supabase/supabase-js'

type SessionAuth = Pick<SupabaseClient['auth'], 'refreshSession' | 'signOut'>

function isInvalidRefreshToken(error: { message: string; code?: string }) {
  const details = `${error.code ?? ''} ${error.message}`.toLowerCase()
  return details.includes('invalid refresh token')
    || details.includes('refresh token not found')
    || details.includes('refresh_token_not_found')
    || details.includes('refresh_token_already_used')
}

export async function refreshAccessToken(auth: SessionAuth) {
  const { data, error } = await auth.refreshSession()
  if (error) {
    if (isInvalidRefreshToken(error)) {
      const { error: signOutError } = await auth.signOut({ scope: 'local' })
      if (signOutError) {
        throw new Error(`Your session has expired. Sign in again. Could not clear the local session: ${signOutError.message}`)
      }
      throw new Error('Your expired session was cleared. Sign in again.')
    }
    throw new Error(`Could not refresh your session. Sign out and sign in again. ${error.message}`)
  }
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error('Your session has expired. Sign out and sign in again.')
  return accessToken
}
