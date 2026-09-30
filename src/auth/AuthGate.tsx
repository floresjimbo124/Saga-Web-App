import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ArrowRight, BriefcaseBusiness, CircleAlert, LockKeyhole, LogOut } from 'lucide-react'
import { isSupabaseConfigured, SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

export function AuthGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [sessionReady, setSessionReady] = useState(!isSupabaseConfigured)
  const [sessionError, setSessionError] = useState('')
  const [accessResult, setAccessResult] = useState<{
    userId: string
    status: 'owner' | 'denied' | 'error'
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

    void supabase
      .from('organization_memberships')
      .select('role')
      .eq('organization_id', SAGACT_ORGANIZATION_ID)
      .eq('user_id', session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return
        setAccessResult({
          userId: session.user.id,
          status: error ? 'error' : data?.role === 'owner' ? 'owner' : 'denied',
          error: error ? 'Could not verify your workspace access. Try again.' : undefined,
        })
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
    return <AccessDenied error={currentAccess.error ?? ''} />
  }

  return children
}

function SignInScreen({ configurationMissing = false, initialError = '' }: { configurationMissing?: boolean; initialError?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(initialError)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || configurationMissing) return

    setError('')
    setIsSubmitting(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (signInError) setError('The email or password is incorrect. Check your details and try again.')
    setIsSubmitting(false)
  }

  return <main className="auth-screen">
    <section className="auth-panel" aria-labelledby="auth-title">
      <div className="auth-brand"><span className="auth-brand-mark"><BriefcaseBusiness size={20} /></span><span>SAGACT<span>.</span></span></div>
      <div className="auth-heading">
        <div className="section-kicker">Owner workspace</div>
        <h1 id="auth-title">Welcome back.</h1>
        <p>Sign in to continue to your project portfolio.</p>
      </div>

      {configurationMissing ? <div className="auth-notice" role="status"><CircleAlert size={17} /><span>Supabase isn’t configured. Add the project URL and public key to <code>.env.local</code>, then restart the dev server.</span></div> : <form className="auth-form" onSubmit={handleSubmit}>
        <label className="auth-field">Email address<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" required /></label>
        <label className="auth-field">Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /></label>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="button button-primary auth-submit" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Signing in…' : 'Sign in'}{!isSubmitting && <ArrowRight size={16} />}
        </button>
      </form>}

      <div className="auth-security"><LockKeyhole size={14} /><span>Secure sign-in protected by Supabase Auth</span></div>
    </section>
    <footer className="auth-footer">SAGACT <span>·</span> Project workspace</footer>
  </main>
}

function AuthLoading({ message }: { message: string }) {
  return <main className="workspace-loading" role="status" aria-live="polite"><span className="loading-brand">SAGACT<span>.</span></span><span className="loading-spinner"><LockKeyhole size={24} /></span><strong>{message}</strong><span className="loading-progress"><span /></span></main>
}

function AccessDenied({ error }: { error: string }) {
  return <main className="auth-screen"><section className="auth-panel access-panel"><div className="auth-brand"><span className="auth-brand-mark"><BriefcaseBusiness size={20} /></span><span>SAGACT<span>.</span></span></div><div className="auth-heading"><div className="section-kicker">Access needed</div><h1>Workspace access required.</h1><p>{error || 'This account does not have owner access to the SAGACT workspace yet.'}</p></div><button className="button button-secondary auth-submit" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={15} />Sign out</button></section><footer className="auth-footer">SAGACT <span>·</span> Project workspace</footer></main>
}