import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, CircleAlert, LockKeyhole, LogOut, Mail, UserRound } from 'lucide-react'
import { isSupabaseConfigured, SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'
import { ClientPortalApp } from '../components/ClientPortalApp'
import { StaffTaskApp } from '../components/StaffTaskApp'
import { resolveWorkspaceAccessRoute } from './workspace-access'
import { clearPasswordSetupCallback, hasPendingInvitePasswordSetup } from './invite-password-setup'
import { clearPasswordRecoveryCallback, hasFailedPasswordRecovery, hasPendingPasswordRecovery } from './password-recovery'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [requiresPasswordSetup, setRequiresPasswordSetup] = useState(hasPendingInvitePasswordSetup)
  const [requiresPasswordRecovery, setRequiresPasswordRecovery] = useState(hasPendingPasswordRecovery)
  const [passwordRecoveryFailed, setPasswordRecoveryFailed] = useState(hasFailedPasswordRecovery)
  const [sessionReady, setSessionReady] = useState(!isSupabaseConfigured)
  const [sessionError, setSessionError] = useState('')
  const [accessResult, setAccessResult] = useState<{
    userId: string
    status: 'owner' | 'staff' | 'client' | 'denied' | 'error'
    staffName?: string
    staffTitle?: string
    error?: string
  } | null>(null)

  useEffect(() => {
    if (!supabase) return

    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      setSession(nextSession)
      setSessionReady(true)
      setSessionError('')
      if (event === 'PASSWORD_RECOVERY') setRequiresPasswordRecovery(true)
    })

    void supabase.auth.getSession().then(({ data, error }) => {
      if (!active) return
      setSession(data.session)
      setSessionReady(true)
      if (error) setSessionError('Could not restore your session. Please sign in again.')
    })

    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session || !supabase) return

    let active = true
    const client = supabase

    const verifyAccess = async () => {
      const { data: membership, error: membershipError } = await client
        .from('organization_memberships')
        .select('role')
        .eq('organization_id', SAGACT_ORGANIZATION_ID)
        .eq('user_id', session.user.id)
        .maybeSingle()

      if (!active) return
      if (membershipError) {
        setAccessResult({ userId: session.user.id, status: 'error', error: 'Could not verify your workspace access. Try again.' })
        return
      }
      const organizationRole = membership?.role ?? null
      let staffTitle: string | null = null
      let staffName: string | null = null
      if (organizationRole === 'site_staff') {
        const { data: staffMembership, error: staffMembershipError } = await client
          .from('organization_memberships')
          .select('staff_title, staff_name')
          .eq('organization_id', SAGACT_ORGANIZATION_ID)
          .eq('user_id', session.user.id)
          .maybeSingle()
        if (!active) return
        if (staffMembershipError) {
          setAccessResult({
            userId: session.user.id,
            status: 'error',
            error: 'Staff task access is not set up yet. Ask the workspace owner to apply the task-management database migration.',
          })
          return
        }
        staffTitle = typeof staffMembership?.staff_title === 'string' ? staffMembership.staff_title : null
        staffName = typeof staffMembership?.staff_name === 'string' ? staffMembership.staff_name : null
      }
      const requestedClientProjectId = new URLSearchParams(window.location.search).get('projectId')
      let hasRequestedClientAccess = false
      if (organizationRole === 'owner' && requestedClientProjectId) {
        const { data: requestedAccess, error: requestedAccessError } = await client
          .from('client_user_access')
          .select('project_id')
          .eq('organization_id', SAGACT_ORGANIZATION_ID)
          .eq('user_id', session.user.id)
          .eq('project_id', requestedClientProjectId)
          .maybeSingle()
        if (!active) return
        if (requestedAccessError) {
          setAccessResult({ userId: session.user.id, status: 'error', error: 'Could not verify your client project access. Try again.' })
          return
        }
        hasRequestedClientAccess = Boolean(requestedAccess)
      }

      const membershipRoute = resolveWorkspaceAccessRoute(
        organizationRole,
        hasRequestedClientAccess,
        organizationRole === 'owner' && Boolean(requestedClientProjectId),
        staffTitle === 'liaison_officer'
          || staffTitle === 'engineer'
          || staffTitle === 'architect',
      )
      if (organizationRole !== null) {
        setAccessResult({
          userId: session.user.id,
          status: membershipRoute,
          staffName: staffName ?? undefined,
          staffTitle: staffTitle ?? undefined,
          error: membershipRoute === 'denied' ? 'This account is not assigned an enabled workspace role.' : undefined,
        })
        return
      }

      const { data: clientAccess, error: clientAccessError } = await client
        .from('client_user_access')
        .select('project_id')
        .eq('organization_id', SAGACT_ORGANIZATION_ID)
        .eq('user_id', session.user.id)
        .limit(1)

      if (!active) return
      setAccessResult({
        userId: session.user.id,
        status: clientAccessError ? 'error' : resolveWorkspaceAccessRoute(null, Boolean(clientAccess?.length)),
        error: clientAccessError ? 'Could not verify your client access. Try again.' : undefined,
      })
    }

    void verifyAccess().catch(() => {
      if (active) setAccessResult({ userId: session.user.id, status: 'error', error: 'Could not verify your workspace access. Try again.' })
    })

    return () => {
      active = false
    }
  }, [session])

  if (!isSupabaseConfigured || !supabase) {
    return <SignInScreen configurationMissing />
  }

  if (!sessionReady) {
    return <AuthLoading message={session ? 'Verifying workspace access' : 'Checking your session'} />
  }

  if (passwordRecoveryFailed) {
    return <PasswordRecoveryScreen
      sessionAvailable={false}
      onCancel={() => {
        window.history.replaceState(null, '', clearPasswordRecoveryCallback())
        setPasswordRecoveryFailed(false)
      }}
    />
  }

  if (!session) {
    if (requiresPasswordRecovery) {
      return <PasswordRecoveryScreen
        sessionAvailable={false}
        onCancel={() => {
          window.history.replaceState(null, '', clearPasswordRecoveryCallback())
          setRequiresPasswordRecovery(false)
        }}
      />
    }
    return <SignInScreen initialError={sessionError} />
  }

  const currentAccess = accessResult?.userId === session.user.id ? accessResult : null
  if (!currentAccess) {
    return <AuthLoading message="Verifying workspace access" />
  }

  if (currentAccess.status === 'client' || currentAccess.status === 'staff') {
    if (requiresPasswordRecovery) {
      return <PasswordRecoveryScreen
        sessionAvailable
        onComplete={() => {
          window.history.replaceState(null, '', clearPasswordRecoveryCallback())
          setRequiresPasswordRecovery(false)
        }}
        onCancel={() => {
          window.history.replaceState(null, '', clearPasswordRecoveryCallback())
          setRequiresPasswordRecovery(false)
        }}
      />
    }
    if (requiresPasswordSetup) {
      return <PasswordSetupScreen
        onComplete={() => {
          window.history.replaceState(null, '', clearPasswordSetupCallback())
          setRequiresPasswordSetup(false)
        }}
      />
    }
    if (currentAccess.status === 'staff') {
      return <StaffTaskApp
        userId={session.user.id}
        displayName={currentAccess.staffName ?? (typeof session.user.user_metadata.full_name === 'string' ? session.user.user_metadata.full_name : '')}
        staffTitle={currentAccess.staffTitle ?? ''}
      />
    }
    const firstName = session.user.user_metadata.first_name
    return <ClientPortalApp userId={session.user.id} firstName={typeof firstName === 'string' ? firstName : ''} />
  }
  if (currentAccess.status !== 'owner') return <AccessDenied error={currentAccess.error ?? ''} />

  return children
}

function SignInScreen({ configurationMissing = false, initialError = '' }: { configurationMissing?: boolean; initialError?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError)
  const [message, setMessage] = useState('')
  const [forgotPassword, setForgotPassword] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || configurationMissing) return

    setError('')
    setMessage('')
    setIsSubmitting(true)
    try {
      if (forgotPassword) {
        const trimmedEmail = email.trim()
        if (!trimmedEmail) {
          setError('Enter your email address to receive a password reset link.')
          return
        }

        const { error: resetError } = await supabase.auth.resetPasswordForEmail(trimmedEmail, {
          redirectTo: `${window.location.origin}/`,
        })
        if (resetError) throw resetError
        setMessage(`Password reset link sent to ${trimmedEmail}. Check your inbox.`)
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (signInError) throw signInError
      }
    } catch {
      setError(forgotPassword
        ? 'Could not send a password reset link. Check the email address and try again.'
        : 'The email or password is incorrect. Check your details and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <AuthLayout>
    <section className="auth-panel" aria-labelledby="auth-title">
      <AuthCardBrand />
      <div className="auth-heading">
        <h1 id="auth-title">{forgotPassword ? 'Reset your password' : 'Welcome back'}</h1>
        <p>{forgotPassword ? 'Enter your email address and we’ll send you a reset link.' : 'Log in to your account.'}</p>
      </div>

      {configurationMissing ? <div className="auth-notice" role="status"><CircleAlert size={17} /><span>Supabase isn’t configured. Add the project URL and public key to <code>.env.local</code>, then restart the dev server.</span></div> : <>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">
            <span>Email address</span>
            <span className="auth-field-control"><Mail size={16} aria-hidden="true" /><input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Email address" required /></span>
          </label>
          {!forgotPassword && <label className="auth-field">
            <span>Password</span>
            <span className="auth-field-control"><LockKeyhole size={16} aria-hidden="true" /><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" required /></span>
          </label>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-success" role="status">{message}</p>}
          <div className="auth-account-actions">
            <button className="auth-mode-toggle" type="button" onClick={() => {
              setForgotPassword((current) => !current)
              setPassword('')
              setError('')
              setMessage('')
            }}>
              {forgotPassword ? 'Back to sign in' : 'Forgot password?'}
            </button>
          </div>
          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? forgotPassword ? 'Sending reset link…' : 'Signing in…'
              : forgotPassword ? 'Send reset link' : 'Sign in'}
            {!isSubmitting && (forgotPassword ? <Mail size={16} /> : <ArrowRight size={16} />)}
          </button>
        </form>
      </>}
      {configurationMissing && <div className="auth-dev-mode">Development mode</div>}
    </section>
  </AuthLayout>
}

function PasswordSetupScreen({ onComplete }: { onComplete: () => void }) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase) return
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.')
      return
    }

    if (!firstName.trim() || !lastName.trim()) {
      setError('Enter your first and last name.')
      return
    }
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password,
        data: {
          first_name: firstName.trim(),
          last_name: lastName.trim(),
        },
      })
      if (updateError) throw updateError
      onComplete()
    } catch (setupError) {
      const details = setupError instanceof Error ? ` ${setupError.message}` : ''
      setError(`Could not save your password. The invitation link may have expired; ask your workspace owner to resend it.${details}`)
    } finally {
      setIsSubmitting(false)
    }
  }

  return <AuthLayout>
    <section className="auth-panel" aria-labelledby="password-setup-title">
      <AuthCardBrand />
      <div className="auth-heading">
        <h1 id="password-setup-title">Create your password</h1>
      </div>
      <form className="auth-form auth-account-form" onSubmit={(event) => { void handleSubmit(event) }}>
        <label className="auth-field"><span>First name</span><span className="auth-field-control"><UserRound size={16} aria-hidden="true" /><input type="text" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></span></label>
        <label className="auth-field"><span>Last name</span><span className="auth-field-control"><UserRound size={16} aria-hidden="true" /><input type="text" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required /></span></label>
        <label className="auth-field"><span>Password</span><span className="auth-field-control"><LockKeyhole size={16} aria-hidden="true" /><input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></span></label>
        <label className="auth-field"><span>Confirm password</span><span className="auth-field-control"><LockKeyhole size={16} aria-hidden="true" /><input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></span></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Creating account…' : 'Create account'}{!isSubmitting && <ArrowRight size={16} />}
        </button>
      </form>
    </section>
  </AuthLayout>
}

function PasswordRecoveryScreen({ sessionAvailable, onComplete, onCancel }: {
  sessionAvailable: boolean
  onComplete?: () => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !sessionAvailable) return
    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.')
      return
    }
    if (password !== confirmation) {
      setError('The passwords do not match.')
      return
    }

    setError('')
    setIsSubmitting(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      onComplete?.()
    } catch {
      setError('Could not reset your password. The reset link may have expired or already been used. Request a new link and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <AuthLayout>
    <section className="auth-panel" aria-labelledby="password-recovery-title">
      <AuthCardBrand />
      <div className="auth-heading">
        <h1 id="password-recovery-title">{sessionAvailable ? 'Reset your password' : 'Password reset link unavailable'}</h1>
        <p>{sessionAvailable
          ? 'Choose a new password for your account.'
          : 'This password reset link is invalid, expired, or already used. Request a new link to continue.'}</p>
      </div>
      {sessionAvailable ? <form className="auth-form" onSubmit={(event) => { void handleSubmit(event) }}>
        <label className="auth-field">New password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label className="auth-field">Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving password…' : 'Set new password'}{!isSubmitting && <ArrowRight size={16} />}
        </button>
        <button className="auth-mode-toggle" type="button" onClick={onCancel}>Cancel password reset</button>
      </form> : <button className="button button-secondary auth-submit" type="button" onClick={onCancel}>Return to sign in</button>}
    </section>
  </AuthLayout>
}

function AuthLayout({ children }: { children: ReactNode }) {
  return <main className="auth-screen">
    <aside className="auth-story">
      <div className="auth-story-copy">
        <h2>Accessible Architecture for every Juan</h2>
        <span className="auth-story-rule" />
      </div>
    </aside>
    <section className="auth-content">
      {children}
      <footer className="auth-footer">SAGACT <span>·</span> Project workspace</footer>
    </section>
  </main>
}

function AuthCardBrand() {
  return <div className="auth-brand auth-card-brand"><span className="auth-brand-mark"><img src="/sagact-mark.svg" alt="" /></span><span className="auth-brand-name">SAGACT<span>.</span></span><span className="auth-brand-caption">Project Workspace</span></div>
}

function AuthLoading({ message }: { message: string }) {
  return <main className="workspace-loading" role="status" aria-live="polite"><span className="loading-brand">SAGACT<span>.</span></span><span className="loading-spinner"><LockKeyhole size={24} /></span><strong>{message}</strong><span className="loading-progress"><span /></span></main>
}

function AccessDenied({ error }: { error: string }) {
  return <AuthLayout><section className="auth-panel access-panel"><AuthCardBrand /><div className="auth-heading"><h1>Project access required</h1><p>{error || 'This account is not linked to a shared client project. Ask your project contact to restore access or send a new invitation.'}</p></div><button className="button button-secondary auth-submit" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={15} />Sign out</button></section></AuthLayout>
}