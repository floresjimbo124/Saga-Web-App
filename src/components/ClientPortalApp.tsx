import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDownLeft, Bell, CircleAlert, Download, Eye, FileText, LogOut, MapPin, RefreshCw, X } from 'lucide-react'
import { loadClientPortalProjects, type ClientPortalProject } from '../data/client-portal'
import { downloadBillingPdf, openBillingPdf } from '../lib/billing-pdf'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from '../lib/payment-receipt-pdf'
import { supabase } from '../lib/supabase'
import { resolveClientProjectSelection } from '../auth/client-project-route'
import { calculateClientProjectReceivables } from '../finance/client-project-receivables'
import { calculateReceivablesAging } from '../finance/receivables-aging'
import { loadReadClientBillingNotificationIds, saveReadClientBillingNotificationIds } from '../auth/client-billing-notifications'
import { getRetentionDueDate, isRetentionDue } from '../finance/retention-due'

type PortalTab = 'Billing & payments' | 'Documents'
type ClientBillingNotification = {
  kind: 'billing' | 'down-payment' | 'retention'
  id: string
  projectId: string
  projectName: string
  amount: number
  billingNumber?: number
  issuedAt?: string | null
  createdAt?: string
  dueAt?: string | null
  overdueAmount: number
  daysOverdue: number
}

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 2 })
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

function formatDate(value: string | null) {
  if (!value) return 'Date not set'
  const date = new Date(value.length === 10 ? `${value}T12:00:00` : value)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}

function todayLocal() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function ClientPortalApp({ userId, firstName }: { userId: string; firstName: string }) {
  const requestedProjectId = useMemo(() => new URLSearchParams(window.location.search).get('projectId'), [])
  const [projects, setProjects] = useState<ClientPortalProject[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<PortalTab>('Billing & payments')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [downloadingDocument, setDownloadingDocument] = useState('')
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false)
  const [readNotificationState, setReadNotificationState] = useState(() => {
    try {
      return { ids: new Set(loadReadClientBillingNotificationIds(userId)), error: '' }
    } catch (loadError) {
      return {
        ids: new Set<string>(),
        error: loadError instanceof Error ? loadError.message : 'Could not load notification read status.',
      }
    }
  })
  const notificationContainer = useRef<HTMLDivElement>(null)

  const loadProjects = async () => {
    setIsLoading(true)
    setError('')
    try {
      const nextProjects = await loadClientPortalProjects()
      setProjects(nextProjects)
      setSelectedId((current) => resolveClientProjectSelection(
        nextProjects.map((project) => project.id),
        current,
        requestedProjectId,
      ))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your projects.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    const refreshProjects = () => {
      void loadClientPortalProjects()
        .then((nextProjects) => {
          if (!active) return
          setProjects(nextProjects)
          setSelectedId((current) => resolveClientProjectSelection(
            nextProjects.map((item) => item.id),
            current,
            requestedProjectId,
          ))
        })
        .catch((loadError: unknown) => {
          if (!active) return
          setError(loadError instanceof Error ? loadError.message : 'Could not load your projects.')
        })
    }
    void loadClientPortalProjects()
      .then((nextProjects) => {
        if (!active) return
        setProjects(nextProjects)
        setSelectedId((current) => resolveClientProjectSelection(
          nextProjects.map((project) => project.id),
          current,
          requestedProjectId,
        ))
      })
      .catch((loadError: unknown) => {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load your projects.')
      })
      .finally(() => {
        if (active) setIsLoading(false)
      })
    const refreshInterval = window.setInterval(refreshProjects, 30_000)
    return () => {
      active = false
      window.clearInterval(refreshInterval)
    }
  }, [requestedProjectId])

  useEffect(() => {
    if (!isNotificationsOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!notificationContainer.current?.contains(event.target as Node)) setIsNotificationsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNotificationsOpen(false)
    }
    window.document.addEventListener('pointerdown', closeOnOutsideClick)
    window.document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.document.removeEventListener('pointerdown', closeOnOutsideClick)
      window.document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isNotificationsOpen])

  const project = projects.find((item) => item.id === selectedId)
  const issuedTotal = project?.billings.reduce((total, billing) => total + billing.amount, 0) ?? 0
  const paymentTotal = project?.payments.reduce((total, payment) => total + payment.amount, 0) ?? 0
  const outstandingBillings = useMemo(() => calculateClientProjectReceivables(projects), [projects])
  const overdueBillings = outstandingBillings.filter((billing) => billing.daysOverdue > 0)
  const dueRetention = projects.flatMap((item) => {
    const dueAt = getRetentionDueDate(item.completedAt)
    return dueAt && (item.status === 'completed' || item.status === 'closed')
      && item.retentionAmount > 0 && isRetentionDue(item.completedAt, todayLocal())
      ? [{ project: item, dueAt }]
      : []
  })
  const projectOutstandingItems = outstandingBillings.filter((item) => item.projectId === project?.id)
  const projectRetentionDue = dueRetention.find((item) => item.project.id === project?.id)?.project.retentionAmount ?? 0
  const outstandingTotal = projectOutstandingItems.reduce((total, billing) => total + billing.outstandingAmount, 0)
    + projectRetentionDue
  const overdueByBillingId = new Map(overdueBillings.map((billing) => [billing.id, billing]))
  const downPaymentNotifications: ClientBillingNotification[] = outstandingBillings.flatMap((receivable) => {
    if (receivable.kind !== 'down-payment' || receivable.outstandingAmount <= 0) return []
    return [{
      kind: 'down-payment',
      id: receivable.id,
      projectId: receivable.projectId,
      projectName: receivable.projectName,
      amount: receivable.outstandingAmount,
      overdueAmount: 0,
      daysOverdue: 0,
    }]
  })
  const billingNotifications: ClientBillingNotification[] = projects.flatMap((item) => item.billings.map((billing) => {
    const overdue = overdueByBillingId.get(billing.id)
    return {
      kind: 'billing' as const,
      id: billing.id,
      projectId: item.id,
      projectName: item.name,
      billingNumber: billing.number,
      amount: billing.amount,
      issuedAt: billing.issuedAt,
      createdAt: billing.createdAt,
      dueAt: billing.dueAt,
      overdueAmount: overdue?.outstandingAmount ?? 0,
      daysOverdue: overdue?.daysOverdue ?? 0,
    }
  }))
  const retentionNotifications: ClientBillingNotification[] = dueRetention.map(({ project: item, dueAt }) => {
    const [aging] = calculateReceivablesAging([{
      id: `retention:${item.id}`,
      projectId: item.id,
      projectName: item.name,
      clientName: item.clientName,
      billingNumber: 0,
      amount: item.retentionAmount,
      issuedAt: dueAt,
      createdAt: dueAt,
      dueAt,
      kind: 'retention',
    }], [], [], todayLocal())
    return {
      kind: 'retention',
      id: `retention:${item.id}`,
      projectId: item.id,
      projectName: item.name,
      amount: item.retentionAmount,
      dueAt,
      overdueAmount: item.retentionAmount,
      daysOverdue: aging?.daysOverdue ?? 0,
    }
  })
  const notifications = [...billingNotifications, ...downPaymentNotifications, ...retentionNotifications]
  const notificationCount = notifications.filter((notification) => !readNotificationState.ids.has(notification.id)).length

  const openBillingNotification = async (notification: ClientBillingNotification) => {
    const readIds = new Set(readNotificationState.ids)
    readIds.add(notification.id)
    setReadNotificationState({ ids: readIds, error: '' })
    try {
      saveReadClientBillingNotificationIds(userId, [...readIds])
    } catch (saveError) {
      setReadNotificationState({
        ids: readIds,
        error: saveError instanceof Error ? `Could not save notification read status: ${saveError.message}` : 'Could not save notification read status.',
      })
    }

    const notificationProject = projects.find((item) => item.id === notification.projectId)
    if (!notificationProject) {
      setReadNotificationState((current) => ({ ...current, error: 'Could not find the billing for this notification.' }))
      return
    }

    setSelectedId(notification.projectId)
    setTab('Billing & payments')
    if (notification.kind !== 'billing') {
      setIsNotificationsOpen(false)
      return
    }

    const billing = notificationProject.billings.find((item) => item.id === notification.id)
    if (!billing) {
      setReadNotificationState((current) => ({ ...current, error: 'Could not find the billing for this notification.' }))
      return
    }

    try {
      await openBillingPdf({
        projectName: notificationProject.name,
        clientName: notificationProject.clientName,
        location: notificationProject.location,
        billingNumber: billing.number,
        amount: billing.amount,
        progressPercent: billing.progress,
        issuedAt: billing.issuedAt ?? billing.createdAt,
        dueAt: billing.dueAt,
      })
      setIsNotificationsOpen(false)
    } catch (openError) {
      setReadNotificationState((current) => ({
        ...current,
        error: openError instanceof Error ? openError.message : 'Could not open the billing PDF.',
      }))
    }
  }

  const openDocument = async (document: ClientPortalProject['documents'][number], download = false) => {
    if (!supabase) return
    setDownloadingDocument(document.id)
    setDocumentError('')
    try {
      const { data, error: storageError } = await supabase.storage
        .from('project-documents')
        .createSignedUrl(document.storagePath, 60, download ? { download: document.fileName } : undefined)
      if (storageError) throw new Error(storageError.message)
      const link = window.document.createElement('a')
      link.href = data.signedUrl
      if (download) {
        link.download = document.fileName
      } else {
        link.target = '_blank'
        link.rel = 'noopener noreferrer'
      }
      link.click()
    } catch {
      setDocumentError(`Could not ${download ? 'download' : 'open'} this shared document. Please try again.`)
    } finally {
      setDownloadingDocument('')
    }
  }

  return <main className="client-portal-shell">
    <header className="client-portal-topbar">
      <a className="client-portal-brand" href="/" aria-label="SAGACT client portal home"><span><img src="/sagact-mark.svg" alt="" /></span>SAGACT<span>.</span></a>
      <div className="client-portal-topbar-right">
        <span className="client-portal-client-name">Hi, {firstName || 'Client'}</span>
        <div className="notification-center" ref={notificationContainer}>
          <button
            className={`icon-button notification-button ${notificationCount ? 'has-notifications' : ''}`}
            type="button"
            aria-label={notificationCount ? `Notifications, ${notificationCount} active` : 'Notifications'}
            aria-expanded={isNotificationsOpen}
            aria-controls="client-billing-notifications"
            title="Notifications"
            onClick={() => setIsNotificationsOpen((open) => !open)}
          >
            <Bell size={17} />
            {notificationCount > 0 && <span className="notification-count">{notificationCount > 99 ? '99+' : notificationCount}</span>}
          </button>
          {isNotificationsOpen && <section className="notification-panel" id="client-billing-notifications" aria-label="Notifications">
            <div className="notification-panel-heading"><h2>Notifications</h2><button type="button" className="icon-button" aria-label="Close notifications" onClick={() => setIsNotificationsOpen(false)}><X size={16} /></button></div>
            {readNotificationState.error && <p className="form-error" role="alert">{readNotificationState.error}</p>}
            {notifications.length ? <div className="notification-list">
              {notifications.map((billing) => {
                const isRead = readNotificationState.ids.has(billing.id)
                return <button
                type="button"
                className={`notification-row ${billing.daysOverdue ? 'notification-urgent' : ''} ${isRead ? 'notification-read' : ''}`}
                key={billing.id}
                onClick={() => { void openBillingNotification(billing) }}
              >
                <span className="notification-icon">{billing.kind === 'retention' || billing.daysOverdue ? <CircleAlert size={16} /> : <FileText size={16} />}</span>
                <span className="notification-copy">
                  <strong>{billing.kind === 'retention'
                    ? `${billing.projectName} · Retention release due`
                    : billing.kind === 'down-payment'
                      ? `${billing.projectName} · Contract down payment due`
                      : `${billing.projectName} · Progress billing #${billing.billingNumber} issued`}</strong>
                  <small>{billing.kind === 'retention'
                    ? `${money.format(billing.amount)} · due ${formatDate(billing.dueAt ?? null)}${billing.daysOverdue ? ` · ${billing.daysOverdue} days overdue` : ''}`
                    : billing.kind === 'down-payment'
                      ? `${money.format(billing.amount)} outstanding · Contractual down payment`
                      : `${billing.daysOverdue ? `${money.format(billing.overdueAmount)} outstanding · ${billing.daysOverdue} days overdue · ` : ''}${money.format(billing.amount)} · ${formatDate(billing.issuedAt ?? billing.createdAt ?? null)}`}</small>
                </span>
              </button>
              })}
            </div> : <div className="notification-empty"><Bell size={16} /><span>No notifications right now.</span></div>}
          </section>}
        </div>
        <button className="client-sign-out" type="button" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={15} />Sign out</button>
      </div>
    </header>
    <div className="client-portal-content">
      {isLoading ? <div className="client-portal-loading" role="status"><RefreshCw size={18} />Loading your projects</div> : error ? <div className="sample-banner" role="alert">{error}<button className="text-button" onClick={() => { void loadProjects() }}>Retry</button></div> : !project ? <section className="client-portal-empty"><div className="section-kicker">Client access</div><h1>No projects shared yet</h1><p>There are no projects assigned to your account. Contact your project team if you think this is a mistake.</p></section> : <>
        {projects.length > 1 && <nav className="client-project-switcher" aria-label="Your projects">{projects.map((item) => <button key={item.id} type="button" className={item.id === project.id ? 'is-selected' : ''} onClick={() => { setSelectedId(item.id); setTab('Billing & payments') }}>{item.name}</button>)}</nav>}
        <section className="client-project-heading">
          <div><div className="client-project-location"><MapPin size={14} />{project.location}</div><h1>{project.name}</h1></div>
          <span className={`client-project-status status-${project.status}`}>{project.status.replaceAll('_', ' ')}</span>
        </section>
        <section className="client-progress-band" aria-label="Project progress">
          <div className="client-progress-heading"><div><div className="section-kicker">Work progress</div><strong>{project.progress}%</strong></div><span>Last updated {formatDate(project.updatedAt)}</span></div>
          <div className="client-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }} /></div>
          <div className="client-progress-summary"><span>Contract price <strong>{money.format(project.contractPrice)}</strong></span><span>Issued billings <strong>{money.format(issuedTotal)}</strong></span><span>Payments recorded <strong>{money.format(paymentTotal)}</strong></span><span className="client-progress-balance">Due balance <strong>{money.format(outstandingTotal)}</strong></span></div>
        </section>
        <nav className="client-portal-tabs" aria-label="Project information">{(['Billing & payments', 'Documents'] as PortalTab[]).map((item) => <button type="button" key={item} className={tab === item ? 'is-selected' : ''} onClick={() => setTab(item)}>{item}</button>)}</nav>
        {tab === 'Billing & payments' && <div className="client-finance-grid">
          <section className="client-portal-section"><div className="section-kicker">Issued to your project</div><h2>Billings</h2>{project.billings.length || project.downPaymentAmount > 0 ? <div className="client-record-list">{project.downPaymentAmount > 0 && <div className="client-finance-row"><span className="client-record-icon"><FileText size={16} /></span><span><strong>Contract down payment</strong><small>Contractual down payment</small></span><strong className="client-record-amount">{money.format(projectOutstandingItems.find((item) => item.id === `down-payment:${project.id}`)?.outstandingAmount ?? 0)}</strong></div>}{project.billings.map((billing) => <div className="client-finance-row" key={billing.id}><span className="client-record-icon"><FileText size={16} /></span><span><strong>Billing #{billing.number}</strong><small>{formatDate(billing.issuedAt)} · {billing.progress}% complete{billing.dueAt ? ` · due ${formatDate(billing.dueAt)}` : ''}</small></span><strong className="client-record-amount">{money.format(billing.amount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview billing ${billing.number}`} title="Preview billing PDF" onClick={() => { void openBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingNumber: billing.number, amount: billing.amount, progressPercent: billing.progress, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label={`Download billing ${billing.number}`} title="Download billing PDF" onClick={() => { void downloadBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingNumber: billing.number, amount: billing.amount, progressPercent: billing.progress, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }) }}><Download size={15} /></button></div></div>)}</div> : <p className="client-empty-note">No billings have been issued yet.</p>}</section>
          <section className="client-portal-section"><div className="section-kicker">Recorded payments</div><h2>Payment history</h2>{project.payments.length ? <div className="client-record-list">{project.payments.map((payment) => <div className="client-finance-row" key={payment.id}><span className="client-record-icon"><ArrowDownLeft size={16} /></span><span><strong>{payment.receiptNumber || 'Payment received'}</strong><small>{formatDate(payment.receivedAt)} · {payment.paymentMode.replaceAll('_', ' ')} · {payment.reference || payment.payerName}</small></span><strong className="client-record-amount">{money.format(payment.amount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview receipt ${payment.receiptNumber}`} title="Preview payment receipt" onClick={() => { void openPaymentReceiptPdf({ projectName: project.name, payerName: payment.payerName, receiptNumber: payment.receiptNumber, amount: payment.amount, paymentType: payment.paymentType, paymentMode: payment.paymentMode, reference: payment.reference }) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label={`Download receipt ${payment.receiptNumber}`} title="Download payment receipt" onClick={() => { void downloadPaymentReceiptPdf({ projectName: project.name, payerName: payment.payerName, receiptNumber: payment.receiptNumber, amount: payment.amount, paymentType: payment.paymentType, paymentMode: payment.paymentMode, reference: payment.reference }) }}><Download size={15} /></button></div></div>)}</div> : <p className="client-empty-note">No payments have been recorded yet.</p>}</section>
        </div>}
        {tab === 'Documents' && <section className="client-portal-section client-documents-section"><div className="section-kicker">Shared project files</div><h2>Documents</h2>{documentError && <p className="form-error" role="alert">{documentError}</p>}{project.documents.length ? <div className="client-record-list">{project.documents.map((document) => <div className="client-finance-row" key={document.id}><span className="client-record-icon"><FileText size={16} /></span><span><strong>{document.fileName}</strong><small>{document.documentType.replaceAll('_', ' ')} · shared {formatDate(document.createdAt)}</small></span><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`View ${document.fileName}`} title="View document" disabled={downloadingDocument === document.id} onClick={() => { void openDocument(document) }}>{downloadingDocument === document.id ? <RefreshCw size={15} /> : <Eye size={15} />}</button><button type="button" className="client-download-button" aria-label={`Download ${document.fileName}`} title="Download document" disabled={downloadingDocument === document.id} onClick={() => { void openDocument(document, true) }}><Download size={15} /></button></div></div>)}</div> : <p className="client-empty-note">No documents have been shared yet.</p>}</section>}
      </>}
    </div>
  </main>
}