import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, CircleAlert, LockKeyhole, LogOut, Mail } from 'lucide-react'
import { isSupabaseConfigured, SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'
import { ClientPortalApp } from '../components/ClientPortalApp'
import { resolveWorkspaceAccessRoute } from './workspace-access'
import { clearPasswordSetupCallback, hasPendingInvitePasswordSetup } from './invite-password-setup'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [requiresPasswordSetup, setRequiresPasswordSetup] = useState(hasPendingInvitePasswordSetup)
  const [sessionReady, setSessionReady] = useState(!isSupabaseConfigured)
  const [sessionError, setSessionError] = useState('')
  const [accessResult, setAccessResult] = useState<{
    userId: string
    status: 'owner' | 'client' | 'denied' | 'error'
    error?: string
  } | null>(null)

  useEffect(() => {
    if (!supabase) return

    let active = true
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setSessionReady(true)
      setSessionError('')
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
      )
      if (organizationRole !== null) {
        setAccessResult({
          userId: session.user.id,
          status: membershipRoute,
          error: membershipRoute === 'denied' ? 'Staff workspace access is not enabled in this app yet.' : undefined,
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

  if (!session) {
    return <SignInScreen initialError={sessionError} />
  }

  const currentAccess = accessResult?.userId === session.user.id ? accessResult : null
  if (!currentAccess) {
    return <AuthLoading message="Verifying workspace access" />
  }

  if (currentAccess.status !== 'owner') {
    if (currentAccess.status === 'client') {
      if (requiresPasswordSetup) {
        return <PasswordSetupScreen onComplete={() => {
          window.history.replaceState(null, '', clearPasswordSetupCallback())
          setRequiresPasswordSetup(false)
        }} />
      }
      const firstName = session.user.user_metadata.first_name
      return <ClientPortalApp userId={session.user.id} firstName={typeof firstName === 'string' ? firstName : ''} />
    }
    return <AccessDenied error={currentAccess.error ?? ''} />
  }

  return children
}

function SignInScreen({ configurationMissing = false, initialError = '' }: { configurationMissing?: boolean; initialError?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError)
  const [message, setMessage] = useState('')
  const [clientSignIn, setClientSignIn] = useState(false)
  const [clientMagicLink, setClientMagicLink] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || configurationMissing) return

    setError('')
    setMessage('')
    setIsSubmitting(true)
    try {
      if (clientSignIn && clientMagicLink) {
        const { error: signInError } = await supabase.auth.signInWithOtp({
          email: email.trim(),
          options: {
            emailRedirectTo: window.location.origin,
            shouldCreateUser: false,
          },
        })
        if (signInError) throw signInError
        setMessage(`Sign-in link sent to ${email.trim()}. Check your inbox.`)
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (signInError) throw signInError
      }
    } catch {
      setError(clientSignIn && clientMagicLink
        ? 'Could not send a sign-in link. Check the email address and try again.'
        : 'Account does not exist, or the email or password is incorrect. Check your details and try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <AuthLayout>
    <section className="auth-panel" aria-labelledby="auth-title">
      <AuthCardBrand />
      <div className="auth-heading">
        <h1 id="auth-title">{clientSignIn ? 'Client sign in' : 'Welcome back'}</h1>
        <p>{clientSignIn ? 'Access your shared project information' : 'Sign in to your SAGACT workspace'}</p>
      </div>

      {configurationMissing ? <div className="auth-notice" role="status"><CircleAlert size={17} /><span>Supabase isn’t configured. Add the project URL and public key to <code>.env.local</code>, then restart the dev server.</span></div> : <>
        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-field">Email address<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email address" required /></label>
          {(!clientSignIn || !clientMagicLink) && <label className="auth-field">Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /></label>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          {message && <p className="auth-success" role="status">{message}</p>}
          <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
            {isSubmitting ? clientSignIn && clientMagicLink ? 'Sending link…' : 'Signing in…' : clientSignIn && clientMagicLink ? 'Email me a sign-in link' : 'Sign in'}
            {!isSubmitting && (clientSignIn && clientMagicLink ? <Mail size={16} /> : <ArrowRight size={16} />)}
          </button>
        </form>
        {clientSignIn && <button className="auth-mode-toggle" type="button" onClick={() => {
          setClientMagicLink((current) => !current)
          setError('')
          setMessage('')
        }}>
          {clientMagicLink ? 'Sign in with your password' : 'Forgot your password? Email a sign-in link'}
        </button>}
        <button className="auth-mode-toggle" type="button" onClick={() => {
          setClientSignIn((current) => !current)
          setClientMagicLink(false)
          setError('')
          setMessage('')
        }}>
          {clientSignIn ? 'Workspace owner? Sign in here' : 'Client? Sign in to your project'}
        </button>
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
    } catch {
      setError('Could not save your password. The invitation link may have expired; ask your project contact to resend it.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <AuthLayout>
    <section className="auth-panel" aria-labelledby="password-setup-title">
      <AuthCardBrand />
      <div className="auth-heading">
        <h1 id="password-setup-title">Create your password</h1>
        <p>Set a password to access your shared project dashboard whenever you sign in.</p>
      </div>
      <form className="auth-form" onSubmit={(event) => { void handleSubmit(event) }}>
        <label className="auth-field">First name<input type="text" autoComplete="given-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} required /></label>
        <label className="auth-field">Last name<input type="text" autoComplete="family-name" value={lastName} onChange={(event) => setLastName(event.target.value)} required /></label>
        <label className="auth-field">Password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label className="auth-field">Confirm password<input type="password" autoComplete="new-password" minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving password…' : 'Create password'}{!isSubmitting && <ArrowRight size={16} />}
        </button>
      </form>
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
  return <div className="auth-brand auth-card-brand"><span className="auth-brand-mark"><img src="/sagact-mark.svg" alt="" /></span><span>SAGACT<span>.</span></span></div>
}

function AuthLoading({ message }: { message: string }) {
  return <main className="workspace-loading" role="status" aria-live="polite"><span className="loading-brand">SAGACT<span>.</span></span><span className="loading-spinner"><LockKeyhole size={24} /></span><strong>{message}</strong><span className="loading-progress"><span /></span></main>
}

function AccessDenied({ error }: { error: string }) {
  return <AuthLayout><section className="auth-panel access-panel"><AuthCardBrand /><div className="auth-heading"><h1>Project access required</h1><p>{error || 'This account is not linked to a shared client project. Ask your project contact to restore access or send a new invitation.'}</p></div><button className="button button-secondary auth-submit" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={15} />Sign out</button></section></AuthLayout>
}