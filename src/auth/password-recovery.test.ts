import { describe, expect, it } from 'vitest'
import { clearPasswordRecoveryCallback, hasFailedPasswordRecovery, hasPendingPasswordRecovery } from './password-recovery'

describe('hasPendingPasswordRecovery', () => {
  it('detects Supabase recovery callbacks in hash or query parameters', () => {
    expect(hasPendingPasswordRecovery({ hash: '#access_token=token&type=recovery', search: '' })).toBe(true)
    expect(hasPendingPasswordRecovery({ hash: '', search: '?type=recovery&code=abc' })).toBe(true)
  })

  it('does not treat other auth callbacks as password recovery', () => {
    expect(hasPendingPasswordRecovery({ hash: '#access_token=token&type=invite', search: '' })).toBe(false)
    expect(hasPendingPasswordRecovery({ hash: '', search: '?projectId=project-1' })).toBe(false)
  })
})

describe('hasFailedPasswordRecovery', () => {
  it('detects expired and rejected Supabase recovery callbacks', () => {
    expect(hasFailedPasswordRecovery({ hash: '', search: '?error=access_denied&error_code=otp_expired' })).toBe(true)
    expect(hasFailedPasswordRecovery({ hash: '#error=access_denied&error_code=otp_expired', search: '' })).toBe(true)
    expect(hasFailedPasswordRecovery({ hash: '', search: '?projectId=project-1' })).toBe(false)
  })
})

describe('clearPasswordRecoveryCallback', () => {
  it('removes recovery credentials while preserving unrelated query parameters', () => {
    expect(clearPasswordRecoveryCallback({
      pathname: '/',
      search: '?projectId=project-1&type=recovery&code=abc&error=access_denied&error_code=otp_expired',
    })).toBe('/?projectId=project-1')
  })
})
