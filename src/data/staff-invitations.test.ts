import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), refreshSession: vi.fn(), signOut: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { refreshSession: mocks.refreshSession, signOut: mocks.signOut }, functions: { invoke: mocks.invoke } },
}))

import { inviteStaffMember, loadStaffMembers, resendStaffInvitation, revokeStaffAccess } from './staff-invitations'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.refreshSession.mockResolvedValue({
    data: { session: { access_token: 'fresh-access-token' } },
    error: null,
  })
  mocks.signOut.mockResolvedValue({ error: null })
})

describe('staff invitations', () => {
  it('normalizes staff emails and sends the selected role', async () => {
    mocks.invoke.mockResolvedValue({ data: { invited: true, emailSent: true }, error: null })

    await expect(inviteStaffMember({
      email: ' Engineer@Example.com ',
      name: '  Alex Engineer ',
      title: 'engineer',
    })).resolves.toEqual({ emailSent: true, emailError: null })
    expect(mocks.invoke).toHaveBeenCalledWith('manage-staff', {
      body: { action: 'invite', email: 'engineer@example.com', name: 'Alex Engineer', title: 'engineer' },
      headers: { Authorization: 'Bearer fresh-access-token' },
    })
  })

  it('rejects invalid emails before calling the staff service', async () => {
    await expect(inviteStaffMember({
      email: 'not-an-email',
      name: 'Alex Engineer',
      title: 'engineer',
    })).rejects.toThrow('valid staff email')
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('loads and validates the owner-visible staff list', async () => {
    const members = [{
      userId: 'staff-1',
      email: 'liaison@example.com',
      name: 'Lee Liaison',
      title: 'liaison_officer',
      status: 'pending',
    }]
    mocks.invoke.mockResolvedValue({ data: { members }, error: null })

    await expect(loadStaffMembers()).resolves.toEqual(members)
    expect(mocks.invoke).toHaveBeenCalledWith('manage-staff', {
      body: { action: 'list' },
      headers: { Authorization: 'Bearer fresh-access-token' },
    })
  })

  it('resends invitations or sign-in links with an explicit result type', async () => {
    mocks.invoke.mockResolvedValue({ data: { resent: true, type: 'sign_in' }, error: null })

    await expect(resendStaffInvitation('staff-1')).resolves.toEqual({ type: 'sign_in' })
    expect(mocks.invoke).toHaveBeenCalledWith('manage-staff', {
      body: { action: 'resend', userId: 'staff-1' },
      headers: { Authorization: 'Bearer fresh-access-token' },
    })
  })

  it('revokes workspace access through the owner management service', async () => {
    mocks.invoke.mockResolvedValue({ data: { revoked: true }, error: null })

    await expect(revokeStaffAccess('staff-1')).resolves.toBeUndefined()
    expect(mocks.invoke).toHaveBeenCalledWith('manage-staff', {
      body: { action: 'revoke', userId: 'staff-1' },
      headers: { Authorization: 'Bearer fresh-access-token' },
    })
  })

  it('surfaces the detailed staff-management error', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error('Function returned a non-2xx status code'), {
        context: new Response(JSON.stringify({ error: 'Only a workspace owner can manage staff accounts.' }), { status: 403 }),
      }),
    })

    await expect(loadStaffMembers()).rejects.toThrow('Only a workspace owner can manage staff accounts.')
  })

  it('does not invoke the function if the session cannot be refreshed', async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'Invalid Refresh Token: Refresh Token Not Found' },
    })

    await expect(loadStaffMembers()).rejects.toThrow('Your expired session was cleared. Sign in again.')
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(mocks.invoke).not.toHaveBeenCalled()
  })

  it('does not invoke the function when there is no active session', async () => {
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: null })

    await expect(loadStaffMembers()).rejects.toThrow('Your session has expired. Sign out and sign in again.')
    expect(mocks.invoke).not.toHaveBeenCalled()
    expect(mocks.signOut).not.toHaveBeenCalled()
  })
})
