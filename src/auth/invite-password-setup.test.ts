import { describe, expect, it } from 'vitest'
import { clearPasswordSetupCallback, hasPendingInvitePasswordSetup } from './invite-password-setup'

describe('hasPendingInvitePasswordSetup', () => {
  it('detects Supabase invitation callbacks in the hash', () => {
    expect(hasPendingInvitePasswordSetup({ hash: '#access_token=token&type=invite', search: '' })).toBe(true)
  })

  it('detects invitation callbacks in the query string', () => {
    expect(hasPendingInvitePasswordSetup({ hash: '', search: '?type=invite' })).toBe(true)
  })

  it('detects signup confirmation callbacks for existing pending invitations', () => {
    expect(hasPendingInvitePasswordSetup({ hash: '#access_token=token&type=signup', search: '' })).toBe(true)
  })

  it('detects password setup requested by an invitation for an existing account', () => {
    expect(hasPendingInvitePasswordSetup({ hash: '#access_token=token&type=magiclink', search: '?projectId=project-1&clientPasswordSetup=1' })).toBe(true)
  })

  it('does not require setup for ordinary magic-link sign-ins', () => {
    expect(hasPendingInvitePasswordSetup({ hash: '#access_token=token&type=magiclink', search: '' })).toBe(false)
  })

  it('clears the setup flag while retaining the project deep link', () => {
    expect(clearPasswordSetupCallback({ pathname: '/', search: '?projectId=project-1&clientPasswordSetup=1' }))
      .toBe('/?projectId=project-1')
  })

  it('clears invite callback query flags after password setup', () => {
    expect(clearPasswordSetupCallback({ pathname: '/', search: '?projectId=project-1&type=invite' }))
      .toBe('/?projectId=project-1')
  })
})
