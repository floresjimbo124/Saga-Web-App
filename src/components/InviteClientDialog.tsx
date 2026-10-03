import { useEffect, useState, type FormEvent } from 'react'
import { Mail, RefreshCw, UserRoundX, X } from 'lucide-react'
import { inviteClientToProject, loadClientAccess, resendClientInvitation, revokeClientAccess, type ClientAccessAccount } from '../data/client-access'

export function InviteClientDialog({ projectId, projectName, clientName, clientEmail, onClose }: {
  projectId: string
  projectName: string
  clientName: string
  clientEmail: string
  onClose: () => void
}) {
  const [email, setEmail] = useState(clientEmail)
  const [error, setError] = useState('')
  const [result, setResult] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [accounts, setAccounts] = useState<ClientAccessAccount[]>([])
  const [isLoadingAccounts, setIsLoadingAccounts] = useState(true)
  const [workingUserId, setWorkingUserId] = useState('')
  const [revokeCandidate, setRevokeCandidate] = useState<ClientAccessAccount | null>(null)

  const refreshAccounts = async () => {
    try {
      setAccounts(await loadClientAccess(projectId))
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load client access.')
    } finally {
      setIsLoadingAccounts(false)
    }
  }

  useEffect(() => {
    let active = true
    void loadClientAccess(projectId)
      .then((nextAccounts) => { if (active) setAccounts(nextAccounts) })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load client access.')
      })
      .finally(() => { if (active) setIsLoadingAccounts(false) })
    return () => { active = false }
  }, [projectId])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setResult('')
    setIsSubmitting(true)
    try {
      const response = await inviteClientToProject(projectId, email)
      setResult(response.invited
        ? `Invitation sent to ${email.trim()} for ${projectName}.`
        : response.emailSent
          ? `Access granted to ${email.trim()} for ${projectName}; a sign-in email was sent.`
          : response.emailError
            ? `Access granted to ${email.trim()} for ${projectName}, but the sign-in email could not be sent: ${response.emailError}`
            : `Access granted to ${email.trim()} for ${projectName}. They can sign in with their existing account.`)
      await refreshAccounts()
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Could not invite this client.')
    } finally {
      setIsSubmitting(false)
    }
  }

  const resend = async (account: ClientAccessAccount) => {
    setWorkingUserId(account.userId)
    setError('')
    setResult('')
    try {
      const response = await resendClientInvitation(projectId, account.userId)
      setResult(response.type === 'invitation'
        ? `Invitation resent to ${account.email}.`
        : `Sign-in link sent to ${account.email}.`)
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : 'Could not resend the invitation.')
    } finally {
      setWorkingUserId('')
    }
  }

  const revoke = async (account: ClientAccessAccount) => {
    setWorkingUserId(account.userId)
    setError('')
    setResult('')
    try {
      await revokeClientAccess(projectId, account.userId)
      setAccounts((current) => current.filter((item) => item.userId !== account.userId))
      setRevokeCandidate(null)
      setResult(`Access revoked for ${account.email}.`)
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke client access.')
    } finally {
      setWorkingUserId('')
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting && !workingUserId) onClose() }}>
    <section className="project-modal invite-client-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-client-title">
      <div className="modal-heading"><div><div className="section-kicker">Client access</div><h2 id="invite-client-title">Manage {clientName}</h2></div><button className="icon-button" type="button" aria-label="Close" disabled={isSubmitting || Boolean(workingUserId)} onClick={onClose}><X size={18} /></button></div>
      <p className="modal-intro">Invite a client contact to view shared billing, receipts, project status, and documents for {projectName}.</p>
      <section className="client-access-list" aria-labelledby="client-access-list-title">
        <div className="card-heading-row"><h3 id="client-access-list-title">Linked accounts</h3><span className="client-access-count">{accounts.length}</span></div>
        {isLoadingAccounts ? <p className="client-access-empty">Loading client accounts…</p> : accounts.length ? <div className="client-access-rows">{accounts.map((account) => {
          const isWorking = workingUserId === account.userId
          const isConfirmingRevoke = revokeCandidate?.userId === account.userId
          return <article className="client-access-row" key={account.userId}>
            <span className="client-access-account"><strong>{account.email}</strong><small>{account.status === 'pending' ? 'Invitation pending' : 'Access active'}</small></span>
            <span className={`status-badge ${account.status === 'pending' ? 'status-on-hold' : 'health-on-track'}`}><span />{account.status === 'pending' ? 'Pending' : 'Active'}</span>
            <div className="client-access-actions">{isConfirmingRevoke ? <><span className="client-access-confirm">Revoke access?</span><button type="button" className="text-button compact-button client-access-revoke-confirm" disabled={isWorking} onClick={() => { void revoke(account) }}>{isWorking ? 'Revoking…' : 'Confirm'}</button><button type="button" className="text-button compact-button" disabled={isWorking} onClick={() => setRevokeCandidate(null)}>Cancel</button></> : <><button type="button" className="text-button compact-button" disabled={Boolean(workingUserId)} onClick={() => { void resend(account) }}>{isWorking ? <RefreshCw size={14} /> : <Mail size={14} />}{isWorking ? 'Sending…' : account.status === 'pending' ? 'Resend' : 'Send sign-in link'}</button><button type="button" className="text-button compact-button client-access-revoke" disabled={Boolean(workingUserId)} onClick={() => setRevokeCandidate(account)}><UserRoundX size={14} />Revoke</button></>}</div>
          </article>
        })}</div> : <p className="client-access-empty">No accounts have access yet.</p>}
      </section>
      <form onSubmit={(event) => { void submit(event) }}>
        <label className="form-field">Client email<input type="email" autoFocus autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {result && <p className="document-success" role="status">{result}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={isSubmitting || Boolean(workingUserId)}>Close</button><button type="submit" className="button button-primary" disabled={isSubmitting || Boolean(workingUserId)}><Mail size={15} />{isSubmitting ? 'Sending…' : 'Send invitation'}</button></div>
      </form>
    </section>
  </div>
}