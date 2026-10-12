import { describe, expect, it, vi } from 'vitest'
import { refreshAccessToken } from './refresh-session'

describe('refreshAccessToken', () => {
  it('returns a fresh access token', async () => {
    const auth = {
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: 'fresh-access-token' } },
        error: null,
      }),
      signOut: vi.fn(),
    }

    await expect(refreshAccessToken(auth as never)).resolves.toBe('fresh-access-token')
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('clears the local session when the refresh token is invalid', async () => {
    const auth = {
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid Refresh Token: Refresh Token Not Found' },
      }),
      signOut: vi.fn().mockResolvedValue({ error: null }),
    }

    await expect(refreshAccessToken(auth as never)).rejects.toThrow('Your expired session was cleared. Sign in again.')
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('surfaces a local sign-out error when clearing an invalid session fails', async () => {
    const auth = {
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid Refresh Token: Refresh Token Not Found' },
      }),
      signOut: vi.fn().mockResolvedValue({ error: { message: 'Storage is unavailable.' } }),
    }

    await expect(refreshAccessToken(auth as never)).rejects.toThrow(
      'Your session has expired. Sign in again. Could not clear the local session: Storage is unavailable.',
    )
  })

  it('does not sign out for other refresh errors', async () => {
    const auth = {
      refreshSession: vi.fn().mockResolvedValue({
        data: { session: null },
        error: { message: 'Network unavailable.' },
      }),
      signOut: vi.fn(),
    }

    await expect(refreshAccessToken(auth as never)).rejects.toThrow(
      'Could not refresh your session. Sign out and sign in again. Network unavailable.',
    )
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it('reports when there is no active session', async () => {
    const auth = {
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null }, error: null }),
      signOut: vi.fn(),
    }

    await expect(refreshAccessToken(auth as never)).rejects.toThrow('Your session has expired. Sign out and sign in again.')
  })
})
