import { useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Mail, RefreshCw, Send, UserRoundX, X } from 'lucide-react'
import { inviteClientToProject, loadClientAccess, resendClientInvitation, revokeClientAccess, type ClientAccessAccount } from '../data/client-access'
import { useToast } from './toast-context'

export function InviteClientDialog({ projectId, projectName, clientName, clientEmail, onClose }: {
  projectId: string
  projectName: string
  clientName: string
  clientEmail: string
  onClose: () => void
}) {
  const { showToast } = useToast()
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
      showToast(
        response.emailError ? 'Client access granted, but the email could not be sent.' : 'Client invitation/access updated.',
        response.invited ? 'create' : 'update',
      )
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
      showToast(response.type === 'invitation' ? 'Client invitation resent.' : 'Client sign-in link sent.')
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
      showToast('Client access revoked.', 'delete')
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke client access.')
    } finally {
      setWorkingUserId('')
    }
  }

  const busy = isSubmitting || Boolean(workingUserId)
  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose() }}>
    <section className="project-modal invite-client-dialog ic-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-client-title">
      <div className="modal-heading">
        <div><div className="section-kicker">Client access · {projectName}</div><h2 id="invite-client-title">Invite {clientName}</h2></div>
        <button className="icon-button" type="button" aria-label="Close" disabled={busy} onClick={onClose}><X size={18} /></button>
      </div>
      <p className="ic-intro">Clients can view project status, billing, receipts and shared documents. They can’t edit anything.</p>

      <form className="ic-form" onSubmit={(event) => { void submit(event) }}>
        <label htmlFor="ic-email">Email address</label>
        <div className="ic-input-row">
          <span className="ic-input"><Mail size={16} aria-hidden="true" /><input id="ic-email" type="email" autoFocus autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></span>
          <button type="submit" className="button button-primary" disabled={busy} aria-busy={isSubmitting}><Send size={15} />{isSubmitting ? 'Sending…' : 'Send invite'}</button>
        </div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {result && <p className="document-success" role="status">{result}</p>}
      </form>

      <section className="ic-people" aria-labelledby="client-access-list-title">
        <h3 id="client-access-list-title">People with access <span>{isLoadingAccounts ? '' : accounts.length}</span></h3>
        {isLoadingAccounts
          ? <div className="ic-skeleton" aria-label="Loading client accounts"><i /><i /></div>
          : accounts.length ? <div className="ic-rows">{accounts.map((account) => {
            const isWorking = workingUserId === account.userId
            const isConfirmingRevoke = revokeCandidate?.userId === account.userId
            const pending = account.status === 'pending'
            return <article className="ic-row" key={account.userId}>
              <span className="ic-avatar" aria-hidden="true">{account.email.charAt(0).toUpperCase()}</span>
              <span className="ic-account"><strong>{account.email}</strong><small className={pending ? 'is-pending' : 'is-active'}>{pending ? 'Invitation pending' : 'Has access'}</small></span>
              <div className="ic-actions">{isConfirmingRevoke
                ? <><span className="client-access-confirm">Remove access?</span><button type="button" className="text-button compact-button client-access-revoke-confirm" disabled={isWorking} onClick={() => { void revoke(account) }} aria-busy={isWorking}>{isWorking ? 'Removing…' : 'Remove'}</button><button type="button" className="text-button compact-button" disabled={isWorking} onClick={() => setRevokeCandidate(null)}>Cancel</button></>
                : <><button type="button" className="ic-icon-action" disabled={Boolean(workingUserId)} onClick={() => { void resend(account) }} title={pending ? 'Resend invitation' : 'Send sign-in link'} aria-label={pending ? `Resend invitation to ${account.email}` : `Send sign-in link to ${account.email}`}>{isWorking ? <RefreshCw size={15} /> : <Mail size={15} />}</button><button type="button" className="ic-icon-action is-danger" disabled={Boolean(workingUserId)} onClick={() => setRevokeCandidate(account)} title="Remove access" aria-label={`Remove access for ${account.email}`}><UserRoundX size={15} /></button></>}</div>
            </article>
          })}</div>
          : <p className="ic-empty">No one has access yet. Send an invite above.</p>}
      </section>
    </section>
  </div>, document.body)
}
