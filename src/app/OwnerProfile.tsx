import { useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight, LogOut, Settings2, X, History } from 'lucide-react'
import { supabase } from '../lib/supabase'


export function MobileOwnerProfile({ name, title, email, onSignOut, onOpenActivity }: { name: string; title: string; email: string; onSignOut: () => void; onOpenActivity: () => void }) {
  const [isAccountSettingsOpen, setIsAccountSettingsOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [passwordUpdated, setPasswordUpdated] = useState(false)

  const closeAccountSettings = () => {
    if (isUpdatingPassword) return
    setIsAccountSettingsOpen(false)
    setPassword('')
    setPasswordConfirmation('')
    setPasswordError('')
    setPasswordUpdated(false)
  }

  const updatePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) {
      setPasswordError('Password updates are unavailable because authentication is not configured.')
      return
    }
    if (password.length < 8) {
      setPasswordError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== passwordConfirmation) {
      setPasswordError('The passwords do not match.')
      return
    }

    setPasswordError('')
    setIsUpdatingPassword(true)
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPasswordUpdated(true)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'An unexpected error occurred.'
      setPasswordError(`Could not update your password: ${message}`)
    } finally {
      setIsUpdatingPassword(false)
    }
  }

  return <section className="mobile-owner-profile-page" aria-labelledby="mobile-profile-title">
    {isAccountSettingsOpen && createPortal(<div className="modal-backdrop mobile-password-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAccountSettings() }}>
      <section className="project-modal mobile-password-dialog" role="dialog" aria-modal="true" aria-labelledby="account-settings-title">
        <div className="modal-heading">
          <div><h2 id="account-settings-title">Account Settings</h2></div>
          <button className="icon-button" type="button" onClick={closeAccountSettings} aria-label="Close" disabled={isUpdatingPassword}><X size={18} /></button>
        </div>
        {passwordUpdated
          ? <div className="mobile-password-success" role="status">
            <p>Your password has been updated.</p>
            <div className="modal-actions"><button type="button" className="button button-primary" onClick={closeAccountSettings}>Done</button></div>
          </div>
          : <>
            <p className="modal-intro">Choose a new password for your account. Use at least 8 characters.</p>
            <form onSubmit={(event) => { void updatePassword(event) }}>
              <label className="form-field">New password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
              <label className="form-field">Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
              {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
              <div className="modal-actions">
                <button type="button" className="button button-secondary" onClick={closeAccountSettings} disabled={isUpdatingPassword}>Cancel</button>
                <button type="submit" className="button button-primary" disabled={isUpdatingPassword}>{isUpdatingPassword ? 'Updating…' : 'Update password'}</button>
              </div>
            </form>
          </>}
      </section>
    </div>, document.body)}
    <header className="mobile-profile-heading">
      <h1 id="mobile-profile-title">Profile</h1>
    </header>
    <section className="mobile-profile-identity surface-card" aria-label="Account identity">
      <span className="mobile-profile-avatar owner-profile-avatar" aria-hidden="true">{name.trim().charAt(0).toUpperCase() || 'U'}</span>
      <span className="mobile-profile-identity-copy">
        <strong>{name}</strong>
        <span>{title}</span>
        {email && <small>{email}</small>}
      </span>
    </section>
    <section className="mobile-profile-settings surface-card" aria-label="Profile settings" role="list">
      <button className="mobile-profile-setting-row" type="button" onClick={() => setIsAccountSettingsOpen(true)} role="listitem">
        <span className="mobile-profile-setting-icon" aria-hidden="true"><Settings2 size={17} /></span>
        <span>Account Settings</span>
        <ChevronRight className="mobile-profile-setting-chevron" size={16} aria-hidden="true" />
      </button>
    </section>
    <section className="mobile-profile-settings surface-card" aria-label="Workspace" role="list">
      <button className="mobile-profile-setting-row" type="button" onClick={onOpenActivity} role="listitem">
        <span className="mobile-profile-setting-icon" aria-hidden="true"><History size={17} /></span>
        <span>Activity history</span>
        <ChevronRight className="mobile-profile-setting-chevron" size={16} aria-hidden="true" />
      </button>
    </section>
    <button type="button" className="mobile-profile-sign-out" onClick={onSignOut}>
      <LogOut size={17} aria-hidden="true" />
      <span>Log Out</span>
    </button>
  </section>
}


