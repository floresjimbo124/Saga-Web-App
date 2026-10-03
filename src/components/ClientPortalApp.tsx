import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowRight, CalendarDays, Download, Eye, FileText, LogOut, MapPin, RefreshCw } from 'lucide-react'
import { loadClientPortalProjects, type ClientPortalProject } from '../data/client-portal'
import { downloadBillingPdf, openBillingPdf } from '../lib/billing-pdf'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from '../lib/payment-receipt-pdf'
import { supabase } from '../lib/supabase'

type PortalTab = 'Overview' | 'Billing & payments' | 'Documents'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

function formatDate(value: string | null) {
  if (!value) return 'Date not set'
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}

export function ClientPortalApp() {
  const [projects, setProjects] = useState<ClientPortalProject[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<PortalTab>('Overview')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [downloadingDocument, setDownloadingDocument] = useState('')

  const loadProjects = async () => {
    setIsLoading(true)
    setError('')
    try {
      const nextProjects = await loadClientPortalProjects()
      setProjects(nextProjects)
      setSelectedId((current) => nextProjects.some((project) => project.id === current) ? current : nextProjects[0]?.id ?? '')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your projects.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    void loadClientPortalProjects()
      .then((nextProjects) => {
        if (!active) return
        setProjects(nextProjects)
        setSelectedId((current) => nextProjects.some((item) => item.id === current) ? current : nextProjects[0]?.id ?? '')
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load your projects.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    return () => { active = false }
  }, [])

  const project = projects.find((item) => item.id === selectedId)
  const nextMilestone = project?.milestones.find((item) => item.status !== 'complete')
  const issuedTotal = project?.billings.reduce((total, billing) => total + billing.amount, 0) ?? 0
  const paymentTotal = project?.payments.reduce((total, payment) => total + payment.amount, 0) ?? 0

  const openDocument = async (document: ClientPortalProject['documents'][number]) => {
    if (!supabase) return
    setDownloadingDocument(document.id)
    setDocumentError('')
    try {
      const { data, error: storageError } = await supabase.storage
        .from('project-documents')
        .createSignedUrl(document.storagePath, 60)
      if (storageError) throw new Error(storageError.message)
      const link = window.document.createElement('a')
      link.href = data.signedUrl
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.click()
    } catch {
      setDocumentError('Could not open this shared document. Please try again.')
    } finally {
      setDownloadingDocument('')
    }
  }

  return <main className="client-portal-shell">
    <header className="client-portal-topbar">
      <a className="client-portal-brand" href="/" aria-label="SAGACT client portal home"><span><img src="/sagact-mark.svg" alt="" /></span>SAGACT<span>.</span></a>
      <div className="client-portal-topbar-right"><span>CLIENT PORTAL</span><button className="client-sign-out" type="button" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={15} />Sign out</button></div>
    </header>
    <div className="client-portal-content">
      {isLoading ? <div className="client-portal-loading" role="status"><RefreshCw size={18} />Loading your projects</div> : error ? <div className="sample-banner" role="alert">{error}<button className="text-button" onClick={() => { void loadProjects() }}>Retry</button></div> : !project ? <section className="client-portal-empty"><div className="section-kicker">Client access</div><h1>No projects shared yet</h1><p>There are no projects assigned to your account. Contact your project team if you think this is a mistake.</p></section> : <>
        <div className="client-portal-eyebrow"><span className="eyebrow-rule" />CLIENT WORKSPACE <span>{project.clientName}</span></div>
        {projects.length > 1 && <nav className="client-project-switcher" aria-label="Your projects">{projects.map((item) => <button key={item.id} type="button" className={item.id === project.id ? 'is-selected' : ''} onClick={() => { setSelectedId(item.id); setTab('Overview') }}>{item.name}</button>)}</nav>}
        <section className="client-project-heading">
          <div><div className="client-project-location"><MapPin size={14} />{project.location}</div><h1>{project.name}</h1></div>
          <span className={`client-project-status status-${project.status}`}>{project.status.replaceAll('_', ' ')}</span>
        </section>
        <section className="client-progress-band" aria-label="Project progress">
          <div className="client-progress-heading"><div><div className="section-kicker">Work progress</div><strong>{project.progress}%</strong></div><span>Last updated {formatDate(project.updatedAt)}</span></div>
          <div className="client-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }} /></div>
          <div className="client-progress-summary"><span>Issued billings <strong>{money.format(issuedTotal)}</strong></span><span>Payments recorded <strong>{money.format(paymentTotal)}</strong></span></div>
        </section>
        <nav className="client-portal-tabs" aria-label="Project information">{(['Overview', 'Billing & payments', 'Documents'] as PortalTab[]).map((item) => <button type="button" key={item} className={tab === item ? 'is-selected' : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>
        {tab === 'Overview' && <div className="client-overview-grid">
          <section className="client-portal-section"><div className="section-kicker">Project schedule</div><h2>Milestones</h2>{project.milestones.length ? <div className="client-record-list">{project.milestones.map((milestone) => <div className="client-record-row" key={milestone.id}><span className="client-record-icon"><CalendarDays size={16} /></span><span><strong>{milestone.name}</strong><small>{formatDate(milestone.plannedDate)} · {milestone.status.replaceAll('_', ' ')}</small></span></div>)}</div> : <p className="client-empty-note">No milestones have been shared yet.</p>}</section>
          <section className="client-portal-section"><div className="section-kicker">Project updates</div><h2>Shared with you</h2>{project.updates.length ? <div className="client-record-list">{project.updates.map((update) => <article className="client-update-row" key={update.id}><span className="client-update-progress">{update.progress}%</span><div><p>{update.summary}</p><small>{formatDate(update.createdAt)}</small></div></article>)}</div> : <p className="client-empty-note">No project updates have been shared yet.</p>}</section>
          {nextMilestone && <div className="client-next-milestone"><CalendarDays size={16} /><span>Next milestone</span><strong>{nextMilestone.name}</strong><small>{formatDate(nextMilestone.plannedDate)}</small><ArrowRight size={15} /></div>}
        </div>}
        {tab === 'Billing & payments' && <div className="client-finance-grid">
          <section className="client-portal-section"><div className="section-kicker">Issued to your project</div><h2>Billings</h2>{project.billings.length ? <div className="client-record-list">{project.billings.map((billing) => <div className="client-finance-row" key={billing.id}><span className="client-record-icon"><FileText size={16} /></span><span><strong>Billing #{billing.number}</strong><small>{formatDate(billing.issuedAt)} · {billing.progress}% complete{billing.dueAt ? ` · due ${formatDate(billing.dueAt)}` : ''}</small></span><strong className="client-record-amount">{money.format(billing.amount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview billing ${billing.number}`} title="Preview billing PDF" onClick={() => { void openBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingNumber: billing.number, amount: billing.amount, progressPercent: billing.progress, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label={`Download billing ${billing.number}`} title="Download billing PDF" onClick={() => { void downloadBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingNumber: billing.number, amount: billing.amount, progressPercent: billing.progress, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }) }}><Download size={15} /></button></div></div>)}</div> : <p className="client-empty-note">No billings have been issued yet.</p>}</section>
          <section className="client-portal-section"><div className="section-kicker">Recorded payments</div><h2>Payment history</h2>{project.payments.length ? <div className="client-record-list">{project.payments.map((payment) => <div className="client-finance-row" key={payment.id}><span className="client-record-icon"><ArrowDownLeft size={16} /></span><span><strong>{payment.receiptNumber || 'Payment received'}</strong><small>{formatDate(payment.receivedAt)} · {payment.paymentMode.replaceAll('_', ' ')} · {payment.reference || payment.payerName}</small></span><strong className="client-record-amount">{money.format(payment.amount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview receipt ${payment.receiptNumber}`} title="Preview payment receipt" onClick={() => { void openPaymentReceiptPdf({ projectName: project.name, payerName: payment.payerName, receiptNumber: payment.receiptNumber, amount: payment.amount, receivedDate: payment.receivedAt.slice(0, 10), paymentType: payment.paymentType, paymentMode: payment.paymentMode, reference: payment.reference }) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label={`Download receipt ${payment.receiptNumber}`} title="Download payment receipt" onClick={() => { void downloadPaymentReceiptPdf({ projectName: project.name, payerName: payment.payerName, receiptNumber: payment.receiptNumber, amount: payment.amount, receivedDate: payment.receivedAt.slice(0, 10), paymentType: payment.paymentType, paymentMode: payment.paymentMode, reference: payment.reference }) }}><Download size={15} /></button></div></div>)}</div> : <p className="client-empty-note">No payments have been recorded yet.</p>}</section>
        </div>}
        {tab === 'Documents' && <section className="client-portal-section client-documents-section"><div className="section-kicker">Shared project files</div><h2>Documents</h2>{documentError && <p className="form-error" role="alert">{documentError}</p>}{project.documents.length ? <div className="client-record-list">{project.documents.map((document) => <div className="client-finance-row" key={document.id}><span className="client-record-icon"><FileText size={16} /></span><span><strong>{document.fileName}</strong><small>{document.documentType.replaceAll('_', ' ')} · shared {formatDate(document.createdAt)}</small></span><button type="button" className="client-download-button" aria-label={`Open ${document.fileName}`} title="Open shared document" disabled={downloadingDocument === document.id} onClick={() => { void openDocument(document) }}>{downloadingDocument === document.id ? <RefreshCw size={15} /> : <Download size={15} />}</button></div>)}</div> : <p className="client-empty-note">No documents have been shared yet.</p>}</section>}
      </>}
    </div>
  </main>
}