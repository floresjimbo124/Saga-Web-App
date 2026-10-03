import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { functions: { invoke: mocks.invoke } },
}))

import { inviteClientToProject, loadClientAccess, resendClientInvitation, revokeClientAccess } from './client-access'

beforeEach(() => vi.clearAllMocks())

describe('client invitations', () => {
  it('invokes the protected function with a normalized email and project', async () => {
    mocks.invoke.mockResolvedValue({ data: { invited: true, emailSent: true }, error: null })

    await expect(inviteClientToProject('project-1', ' Client@Example.com ')).resolves.toEqual({
      invited: true,
      emailSent: true,
      emailError: null,
    })
    expect(mocks.invoke).toHaveBeenCalledWith('invite-client', {
      body: { action: 'invite', projectId: 'project-1', email: 'client@example.com' },
    })
  })

  it('reports when an existing account email could not be resent', async () => {
    mocks.invoke.mockResolvedValue({
      data: { invited: false, emailSent: false, emailError: 'Email rate limit exceeded.' },
      error: null,
    })

    await expect(inviteClientToProject('project-1', 'client@example.com')).resolves.toEqual({
      invited: false,
      emailSent: false,
      emailError: 'Email rate limit exceeded.',
    })
  })

  it('surfaces invitation failures', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: 'Function unavailable' } })

    await expect(inviteClientToProject('project-1', 'client@example.com')).rejects.toThrow('Function unavailable')
  })

  it('shows the detailed server error returned by the invitation function', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Edge Function returned a non-2xx status code'), {
        context: new Response(JSON.stringify({ error: 'Email provider is not configured.' }), { status: 500 }),
      }),
    })

    await expect(inviteClientToProject('project-1', 'client@example.com')).rejects.toThrow('Email provider is not configured.')
  })

  it('loads accounts linked to a client through the protected function', async () => {
    const accounts = [{ userId: 'user-1', email: 'client@example.com', status: 'pending', invitedAt: '2026-10-03T10:00:00Z' }]
    mocks.invoke.mockResolvedValue({ data: { accounts }, error: null })

    await expect(loadClientAccess('project-1')).resolves.toEqual(accounts)
    expect(mocks.invoke).toHaveBeenCalledWith('invite-client', { body: { action: 'list', projectId: 'project-1' } })
  })

  it('resends and revokes a linked client user', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { resent: true, type: 'invitation' }, error: null })
    mocks.invoke.mockResolvedValueOnce({ data: { revoked: true }, error: null })

    await expect(resendClientInvitation('project-1', 'user-1')).resolves.toEqual({ type: 'invitation' })
    await expect(revokeClientAccess('project-1', 'user-1')).resolves.toBeUndefined()
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'invite-client', { body: { action: 'resend', projectId: 'project-1', userId: 'user-1' } })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'invite-client', { body: { action: 'revoke', projectId: 'project-1', userId: 'user-1' } })
  })

  it('allows the same account to be invited to another project after revocation from one project', async () => {
    mocks.invoke.mockResolvedValueOnce({ data: { revoked: true }, error: null })
    mocks.invoke.mockResolvedValueOnce({ data: { invited: false, emailSent: true }, error: null })

    await revokeClientAccess('project-1', 'user-1')
    await expect(inviteClientToProject('project-2', 'client@example.com')).resolves.toEqual({
      invited: false,
      emailSent: true,
      emailError: null,
    })

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, 'invite-client', {
      body: { action: 'revoke', projectId: 'project-1', userId: 'user-1' },
    })
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'invite-client', {
      body: { action: 'invite', projectId: 'project-2', email: 'client@example.com' },
    })
  })

  it('returns the sign-in link type for an accepted account', async () => {
    mocks.invoke.mockResolvedValue({ data: { resent: true, type: 'sign_in' }, error: null })

    await expect(resendClientInvitation('project-1', 'user-1')).resolves.toEqual({ type: 'sign_in' })
  })
})