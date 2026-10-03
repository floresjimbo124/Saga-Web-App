import { useState, type FormEvent } from 'react'
import { Mail, X } from 'lucide-react'
import { inviteClientToProject } from '../data/client-access'

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

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setResult('')
    setIsSubmitting(true)
    try {
      const response = await inviteClientToProject(projectId, email)
      setResult(response.invited
        ? `Invitation sent to ${email.trim()}.`
        : `${email.trim()} already has an account and can now access this client's projects.`)
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Could not invite this client.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !isSubmitting) onClose() }}>
    <section className="project-modal invite-client-dialog" role="dialog" aria-modal="true" aria-labelledby="invite-client-title">
      <div className="modal-heading"><div><div className="section-kicker">Client access</div><h2 id="invite-client-title">Invite {clientName}</h2></div><button className="icon-button" type="button" aria-label="Close" disabled={isSubmitting} onClick={onClose}><X size={18} /></button></div>
      <p className="modal-intro">Invite a client contact to view shared project information for {clientName}. Client access applies to all projects linked to this client record, including {projectName}.</p>
      <form onSubmit={(event) => { void submit(event) }}>
        <label className="form-field">Client email<input type="email" autoFocus autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" required /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        {result && <p className="document-success" role="status">{result}</p>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={isSubmitting}>Close</button><button type="submit" className="button button-primary" disabled={isSubmitting}><Mail size={15} />{isSubmitting ? 'Sending…' : 'Send invitation'}</button></div>
      </form>
    </section>
  </div>
}