import { useEffect, useMemo, useRef, useState, type FormEvent, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownLeft, ArrowLeft, Bell, Check, ChevronRight, Circle, CircleAlert, Clock3, Download, Eye, FileText, FolderKanban, House, ImagePlus, KeyRound, LogOut, MapPin, Minus, Plus, RefreshCw, UserRound, X } from 'lucide-react'
import { loadClientPortalProjects, type ClientPortalProject } from '../data/client-portal'
import { downloadBillingPdf, openBillingPdf } from '../lib/billing-pdf'
import { downloadPaymentReceiptPdf, openPaymentReceiptPdf } from '../lib/payment-receipt-pdf'
import { supabase } from '../lib/supabase'
import { resolveClientPortalTab, resolveClientProjectSelection, type ClientPortalTab } from '../auth/client-project-route'
import { calculateClientProjectReceivables } from '../finance/client-project-receivables'
import { calculateReceivablesAging } from '../finance/receivables-aging'
import { loadReadClientBillingNotificationIds, saveReadClientBillingNotificationIds } from '../auth/client-billing-notifications'
import { getRetentionDueDate, isRetentionDue } from '../finance/retention-due'
import { formatBillingNumber } from '../lib/billing-number'
import { formatChangeOrderNumber } from '../lib/change-order-number'
import { respondToProjectChangeOrder } from '../data/change-orders'
import { createProjectMilestonePhotoUrl } from '../data/project-milestones'
import { useToast } from './toast-context'

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

function milestoneStatusLabel(status: ClientPortalProject['milestones'][number]['status']) {
  if (status === 'in_progress') return 'In progress'
  return status === 'complete' ? 'Complete' : status === 'blocked' ? 'Blocked' : 'Upcoming'
}

function isMilestoneOverdue(milestone: ClientPortalProject['milestones'][number]) {
  return milestone.status !== 'complete'
    && milestone.status !== 'blocked'
    && Boolean(milestone.plannedDate && milestone.plannedDate < todayLocal())
}

function MilestoneStatusIcon({ status }: { status: ClientPortalProject['milestones'][number]['status'] }) {
  if (status === 'complete') return <Check size={15} aria-hidden="true" />
  if (status === 'in_progress') return <Clock3 size={15} aria-hidden="true" />
  if (status === 'blocked') return <CircleAlert size={15} aria-hidden="true" />
  return <Circle size={15} aria-hidden="true" />
}

function ClientMilestonePhoto({ milestoneName, storagePath }: { milestoneName: string; storagePath: string }) {
  const [photoUrl, setPhotoUrl] = useState('')
  const [error, setError] = useState('')
  const [isPreviewOpen, setIsPreviewOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const pinchStart = useRef<{ distance: number; zoom: number } | null>(null)

  useEffect(() => {
    let active = true
    void createProjectMilestonePhotoUrl(storagePath)
      .then((url) => { if (active) setPhotoUrl(url) })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load the milestone photo.')
      })
    return () => { active = false }
  }, [storagePath])

  useEffect(() => {
    if (!isPreviewOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsPreviewOpen(false)
      if (event.key === '+' || event.key === '=') setZoom((current) => Math.min(4, current + 0.5))
      if (event.key === '-') setZoom((current) => Math.max(1, current - 0.5))
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isPreviewOpen])

  const closePreview = () => {
    setIsPreviewOpen(false)
    setZoom(1)
    pinchStart.current = null
  }

  const handlePhotoTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2) return
    const [first, second] = [event.touches[0], event.touches[1]]
    pinchStart.current = {
      distance: Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY),
      zoom,
    }
  }

  const handlePhotoTouchMove = (event: TouchEvent<HTMLDivElement>) => {
    if (event.touches.length !== 2 || !pinchStart.current) return
    const [first, second] = [event.touches[0], event.touches[1]]
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    setZoom(Math.min(4, Math.max(1, pinchStart.current.zoom * distance / Math.max(1, pinchStart.current.distance))))
  }

  if (error) return <small className="client-milestone-photo-error" role="alert">{error}</small>
  if (!photoUrl) return <small className="client-milestone-photo-loading" role="status">Loading milestone photo…</small>
  return <>
    <button className="client-milestone-photo-button" type="button" aria-label={`View ${milestoneName} photo`} onClick={() => { setZoom(1); setIsPreviewOpen(true) }}>
      <img className="client-milestone-photo" src={photoUrl} alt={`${milestoneName} completion`} loading="lazy" />
    </button>
    {isPreviewOpen && createPortal(<div className="client-photo-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePreview() }}>
      <section className="client-photo-lightbox-dialog" role="dialog" aria-modal="true" aria-label={`${milestoneName} milestone photo`}>
        <div className="client-photo-lightbox-actions">
          <button className="client-photo-lightbox-zoom" type="button" aria-label="Zoom out" title="Zoom out" disabled={zoom <= 1} onClick={() => setZoom((current) => Math.max(1, current - 0.5))}><Minus size={16} /></button>
          <button className="client-photo-lightbox-zoom" type="button" aria-label="Zoom in" title="Zoom in" disabled={zoom >= 4} onClick={() => setZoom((current) => Math.min(4, current + 0.5))}><Plus size={16} /></button>
          <button type="button" aria-label="Close photo" title="Close photo" onClick={closePreview}><X size={17} /></button>
        </div>
        <div
          className="client-photo-lightbox-image-area"
          onTouchStart={handlePhotoTouchStart}
          onTouchMove={handlePhotoTouchMove}
          onTouchEnd={(event) => { if (event.touches.length < 2) pinchStart.current = null }}
          onTouchCancel={() => { pinchStart.current = null }}
        >
          <img
            src={photoUrl}
            alt={`${milestoneName} completion`}
            style={zoom === 1 ? undefined : { width: `${zoom * 100}%`, maxWidth: 'none', maxHeight: 'none' }}
          />
        </div>
      </section>
    </div>, document.body)}
  </>
}

export function ClientPortalApp({ userId, firstName }: { userId: string; firstName: string }) {
  const { showToast } = useToast()
  const [requestedProjectId, setRequestedProjectId] = useState(() => new URLSearchParams(window.location.search).get('projectId'))
  const [tab, setTab] = useState<ClientPortalTab>(() => resolveClientPortalTab(new URLSearchParams(window.location.search).get('tab')))
  const [mobilePage, setMobilePage] = useState<'home' | 'profile'>(() => new URLSearchParams(window.location.search).get('clientPage') === 'profile' ? 'profile' : 'home')
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('')
  const [profilePhotoError, setProfilePhotoError] = useState('')
  const [isUploadingProfilePhoto, setIsUploadingProfilePhoto] = useState(false)
  const [isPasswordDialogOpen, setIsPasswordDialogOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordConfirmation, setPasswordConfirmation] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false)
  const [passwordUpdated, setPasswordUpdated] = useState(false)
  const [projects, setProjects] = useState<ClientPortalProject[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [changeOrderError, setChangeOrderError] = useState('')
  const [respondingToChangeOrder, setRespondingToChangeOrder] = useState('')
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
  const profilePhotoInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let active = true
    const loadProfilePhoto = async () => {
      if (!supabase) return
      const { data, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      const profilePath = data.user.user_metadata.profile_picture_path
      if (profilePath !== `${userId}/profile-picture`) return
      const { data: signedPhoto, error: photoError } = await supabase.storage
        .from('client-profile-photos')
        .createSignedUrl(profilePath, 60 * 60)
      if (photoError) throw photoError
      if (active) setProfilePhotoUrl(signedPhoto.signedUrl)
    }
    void loadProfilePhoto().catch((loadError: unknown) => {
      if (active) setProfilePhotoError(loadError instanceof Error ? `Could not load your profile picture: ${loadError.message}` : 'Could not load your profile picture.')
    })
    return () => { active = false }
  }, [userId])

  const uploadProfilePhoto = async (file: File) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp']
    if (!allowedTypes.includes(file.type)) {
      setProfilePhotoError('Choose a JPG, PNG, or WebP image.')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setProfilePhotoError('Profile pictures must be 5 MB or smaller.')
      return
    }
    if (!supabase) {
      setProfilePhotoError('Profile picture uploads are unavailable because authentication is not configured.')
      return
    }

    setProfilePhotoError('')
    setIsUploadingProfilePhoto(true)
    try {
      const profilePath = `${userId}/profile-picture`
      const { error: uploadError } = await supabase.storage
        .from('client-profile-photos')
        .upload(profilePath, file, { upsert: true, contentType: file.type, cacheControl: '3600' })
      if (uploadError) throw uploadError
      const { error: metadataError } = await supabase.auth.updateUser({ data: { profile_picture_path: profilePath } })
      if (metadataError) throw metadataError
      const { data: signedPhoto, error: photoError } = await supabase.storage
        .from('client-profile-photos')
        .createSignedUrl(profilePath, 60 * 60)
      if (photoError) throw photoError
      setProfilePhotoUrl(signedPhoto.signedUrl)
    } catch (uploadError) {
      setProfilePhotoError(uploadError instanceof Error ? `Could not save your profile picture: ${uploadError.message}` : 'Could not save your profile picture.')
    } finally {
      setIsUploadingProfilePhoto(false)
      if (profilePhotoInput.current) profilePhotoInput.current.value = ''
    }
  }

  const closePasswordDialog = () => {
    if (isUpdatingPassword) return
    setIsPasswordDialogOpen(false)
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
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setPasswordUpdated(true)
    } catch (updateError) {
      const message = updateError instanceof Error ? updateError.message : 'An unexpected error occurred.'
      setPasswordError(`Could not update your password: ${message}`)
    } finally {
      setIsUpdatingPassword(false)
    }
  }

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
  const projectId = project?.id
  useEffect(() => {
    if (isLoading || error) return
    const url = new URL(window.location.href)
    if (mobilePage === 'profile') url.searchParams.set('clientPage', 'profile')
    else url.searchParams.delete('clientPage')
    if (projectId) {
      url.searchParams.set('projectId', projectId)
      url.searchParams.set('tab', tab)
    } else {
      url.searchParams.delete('projectId')
      url.searchParams.delete('tab')
    }
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
  }, [error, isLoading, mobilePage, projectId, tab])

  const returnToProjectList = () => {
    setSelectedId('')
    setRequestedProjectId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('projectId')
    url.searchParams.delete('tab')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    setTab('Overview')
  }
  const issuedTotal = project?.billings.reduce((total, billing) => total + billing.amount, 0) ?? 0
  const paymentTotal = project?.payments.reduce((total, payment) => total + payment.amount, 0) ?? 0
  const approvedChangeOrderTotal = project?.changeOrders
    .filter((changeOrder) => changeOrder.status === 'approved')
    .reduce((total, changeOrder) => total + changeOrder.amount, 0) ?? 0
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

  const markAllNotificationsRead = () => {
    const readIds = new Set(readNotificationState.ids)
    for (const notification of notifications) readIds.add(notification.id)
    setReadNotificationState({ ids: readIds, error: '' })
    try {
      saveReadClientBillingNotificationIds(userId, [...readIds])
    } catch (saveError) {
      setReadNotificationState({
        ids: readIds,
        error: saveError instanceof Error ? `Could not save notification read status: ${saveError.message}` : 'Could not save notification read status.',
      })
    }
  }

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

  const respondToChangeOrder = async (changeOrderId: string, approved: boolean) => {
    setChangeOrderError('')
    setRespondingToChangeOrder(changeOrderId)
    try {
      await respondToProjectChangeOrder(changeOrderId, approved)
      showToast(approved ? 'Change order approved.' : 'Change order declined.', 'update')
      await loadProjects()
    } catch (responseError) {
      setChangeOrderError(responseError instanceof Error ? responseError.message : 'Could not submit your change-order decision.')
    } finally {
      setRespondingToChangeOrder('')
    }
  }

  return <main className="client-portal-shell">
    <aside className="client-desktop-sidebar" aria-label="Client portal navigation">
      <a className="client-sidebar-brand" href="/" aria-label="SAGACT client portal home"><span><img src="/sagact-mark.svg" alt="" /></span><span>SAGACT<span>.</span></span></a>
      <div className="client-sidebar-section-label">Projects</div>
      <nav className="client-sidebar-nav" aria-label="Your projects">
        <button type="button" className={`client-sidebar-nav-item${!project ? ' is-active' : ''}`} onClick={returnToProjectList}>
          <FolderKanban size={17} /><span>All projects</span>
        </button>
        {projects.map((item) => <button type="button" key={item.id} className={`client-sidebar-nav-item client-sidebar-project-item${project?.id === item.id ? ' is-active' : ''}`} onClick={() => { setSelectedId(item.id); setTab('Overview') }}>
          <span className="client-sidebar-project-dot" aria-hidden="true" />
          <span>{item.name}</span>
        </button>)}
      </nav>
    </aside>
    <div className="client-portal-main">
    <header className={`client-portal-topbar${project && mobilePage === 'home' ? ' has-project' : ''}`}>
      <a className="client-portal-brand" href="/" aria-label="SAGACT client portal home"><span><img src="/sagact-mark.svg" alt="" /></span>SAGACT<span>.</span></a>
      {project && <div className="client-project-mobile-header">
        <button type="button" onClick={returnToProjectList} aria-label="Back to projects"><ArrowLeft size={19} /></button>
        <strong>Project Details</strong>
      </div>}
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
            <div className="notification-panel-heading"><h2>Notifications</h2><div className="notification-panel-actions">{notificationCount > 0 && <button type="button" className="text-button notification-mark-all" onClick={markAllNotificationsRead}>Mark all as read</button>}<button type="button" className="icon-button" aria-label="Close notifications" onClick={() => setIsNotificationsOpen(false)}><X size={16} /></button></div></div>
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
                      : `${billing.projectName} · Progress billing${billing.billingNumber === undefined ? '' : ` #${formatBillingNumber(billing.billingNumber)}`} issued`}</strong>
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
    <div className={`client-portal-content${project && mobilePage === 'home' ? ' has-client-project' : ''}`}>
      {mobilePage === 'profile' ? <section className="client-mobile-profile" aria-labelledby="client-mobile-profile-title">
        {isPasswordDialogOpen && createPortal(<div className="modal-backdrop mobile-password-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closePasswordDialog() }}>
          <section className="project-modal mobile-password-dialog" role="dialog" aria-modal="true" aria-labelledby="client-password-title">
            <div className="modal-heading">
              <div><h2 id="client-password-title">Change Password</h2></div>
              <button className="icon-button" type="button" onClick={closePasswordDialog} aria-label="Close" disabled={isUpdatingPassword}><X size={18} /></button>
            </div>
            {passwordUpdated
              ? <div className="mobile-password-success" role="status">
                <p>Your password has been updated.</p>
                <div className="modal-actions"><button type="button" className="button button-primary" onClick={closePasswordDialog}>Done</button></div>
              </div>
              : <>
                <p className="modal-intro">Choose a new password for your account. Use at least 8 characters.</p>
                <form onSubmit={(event) => { void updatePassword(event) }}>
                  <label className="form-field">New password<input type="password" autoComplete="new-password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
                  <label className="form-field">Confirm new password<input type="password" autoComplete="new-password" minLength={8} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} required /></label>
                  {passwordError && <p className="form-error" role="alert">{passwordError}</p>}
                  <div className="modal-actions">
                    <button type="button" className="button button-secondary" onClick={closePasswordDialog} disabled={isUpdatingPassword}>Cancel</button>
                    <button type="submit" className="button button-primary" disabled={isUpdatingPassword}>{isUpdatingPassword ? 'Updating…' : 'Update password'}</button>
                  </div>
                </form>
              </>}
          </section>
        </div>, document.body)}
        <h1 id="client-mobile-profile-title">Profile</h1>
        <div className="client-mobile-profile-card">
          <span className="client-mobile-profile-avatar">
            {profilePhotoUrl ? <img src={profilePhotoUrl} alt="" /> : firstName.trim().charAt(0).toUpperCase() || <UserRound size={20} />}
          </span>
          <input ref={profilePhotoInput} className="client-profile-photo-input" type="file" accept="image/jpeg,image/png,image/webp" aria-label="Choose profile picture" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadProfilePhoto(file) }} />
          <span><strong>{firstName || 'Client'}</strong><small>Client portal account</small></span>
        </div>
        {profilePhotoError && <p className="form-error" role="alert">{profilePhotoError}</p>}
        <button className={`client-change-profile-picture${isUploadingProfilePhoto ? ' is-uploading' : ''}`} type="button" disabled={isUploadingProfilePhoto} onClick={() => profilePhotoInput.current?.click()}>
          {isUploadingProfilePhoto ? <RefreshCw size={15} /> : <ImagePlus size={15} />}
          {isUploadingProfilePhoto ? 'Uploading picture…' : 'Change profile picture'}
        </button>
        <button className="client-mobile-profile-setting" type="button" onClick={() => { setPasswordError(''); setPasswordUpdated(false); setIsPasswordDialogOpen(true) }}>
          <KeyRound size={16} />Change password
        </button>
        <button className="client-mobile-profile-sign-out" type="button" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={17} />Sign out</button>
      </section> : isLoading ? <div className="client-portal-loading" role="status"><RefreshCw size={18} />Loading your projects</div> : error ? <div className="sample-banner" role="alert">{error}<button className="text-button" onClick={() => { void loadProjects() }}>Retry</button></div> : !projects.length ? <section className="client-portal-empty"><div className="section-kicker">Client access</div><h1>No projects shared yet</h1><p>There are no projects assigned to your account. Contact your project team if you think this is a mistake.</p>      </section> : !project ? <section className="client-project-home client-project-page-arrive">
        <div className="client-project-home-heading">
          <div><h1>Your projects</h1><p>Select a project to view progress, milestones, billings, and shared documents.</p></div>
          <span>{projects.length} project{projects.length === 1 ? '' : 's'}</span>
        </div>
        <div className="client-project-home-list">
          {projects.map((item) => <button className="client-project-home-card" type="button" key={item.id} onClick={() => { setSelectedId(item.id); setTab('Overview') }} aria-label={`Open ${item.name}`}>
            <span className="client-project-home-card-heading">
              <span className="client-project-home-icon"><FolderKanban size={18} /></span>
              <span className="client-project-home-copy"><strong>{item.name}</strong><small><MapPin size={12} />{item.location}</small></span>
              <ChevronRight className="client-project-home-arrow" size={18} />
            </span>
            <span className="client-project-home-meta"><span className={`client-project-status status-${item.status}`}>{item.status.replaceAll('_', ' ')}</span><small>{item.progress}% complete</small></span>
            <span className="client-project-home-progress"><span style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }} /></span>
            <span className="client-project-home-footer"><small>Contract price</small><strong>{money.format(item.contractPrice)}</strong></span>
          </button>)}
        </div>
      </section> : <>
        <button type="button" className="client-projects-back" onClick={returnToProjectList}><ArrowLeft size={15} />All projects</button>
        {projects.length > 1 && <nav className="client-project-switcher" aria-label="Your projects">{projects.map((item) => <button key={item.id} type="button" className={item.id === project.id ? 'is-selected' : ''} onClick={() => { setSelectedId(item.id); setTab('Overview') }}>{item.name}</button>)}</nav>}
        <section className="client-project-detail-hero client-project-page-arrive">
          <div className="client-project-detail-cover" aria-hidden="true"><FolderKanban size={29} /><span>Project overview</span></div>
          <div className="client-project-detail-body">
            <section className="client-project-heading">
              <div><h1>{project.name}</h1><div className="client-project-location"><MapPin size={14} />{project.location}</div></div>
              <span className={`client-project-status status-${project.status}`}>{project.status.replaceAll('_', ' ')}</span>
            </section>
            <section className="client-progress-band" aria-label="Project progress">
              <div className="client-progress-heading"><div><strong>{project.progress}%</strong></div></div>
              <div className="client-progress-track"><span style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }} /></div>
              <div className="client-progress-summary"><span>Contract price <strong>{money.format(project.contractPrice)}</strong></span><span className="client-progress-change-orders">Change order total <strong>{money.format(approvedChangeOrderTotal)}</strong></span><span>Issued billings <strong>{money.format(issuedTotal)}</strong></span><span>Payments recorded <strong>{money.format(paymentTotal)}</strong></span><span className="client-progress-balance">Due balance <strong>{money.format(outstandingTotal)}</strong></span></div>
            </section>
          </div>
        </section>
        <nav className="client-portal-tabs client-project-page-arrive" aria-label="Project information">{(['Overview', 'Billing & payments', 'Change orders', 'Documents'] as ClientPortalTab[]).map((item) => <button type="button" key={item} className={tab === item ? 'is-selected' : ''} onClick={() => setTab(item)}>{item}{item === 'Change orders' && project.changeOrders.some((order) => order.status === 'pending_approval') ? ' · Review' : ''}</button>)}</nav>
        <div key={tab} className="client-tab-transition">
        {tab === 'Overview' && <section className="client-project-timeline" aria-labelledby="client-project-timeline-title">
          <h2 id="client-project-timeline-title">Project status timeline</h2>
          {project.milestones.length ? <ol className="client-milestone-list">
            {project.milestones.map((milestone) => (
              <li className={`client-milestone client-milestone-${milestone.status} ${isMilestoneOverdue(milestone) ? 'client-milestone-overdue' : ''}`} key={milestone.id}>
                <span className="client-milestone-marker"><MilestoneStatusIcon status={milestone.status} /></span>
                <span className="client-milestone-copy">
                  <strong>{milestone.name}</strong>
                  <small>{isMilestoneOverdue(milestone) ? 'Overdue' : milestoneStatusLabel(milestone.status)}</small>
                  <span className="client-milestone-progress">
                    <span className="client-milestone-progress-track" role="progressbar" aria-label={`${milestone.name} completion`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={milestone.completionPercent}>
                      <span style={{ width: `${milestone.completionPercent}%` }} />
                    </span>
                    <small>{milestone.completionPercent}% complete</small>
                  </span>
                </span>
                <span className="client-milestone-date">
                  {milestone.status === 'complete' && milestone.actualDate
                    ? `Completed ${formatDate(milestone.actualDate)}`
                    : milestone.plannedDate
                      ? `Target ${formatDate(milestone.plannedDate)}`
                      : 'Date not set'}
                </span>
                {milestone.status === 'complete' && milestone.photoStoragePath && <ClientMilestonePhoto milestoneName={milestone.name} storagePath={milestone.photoStoragePath} />}
              </li>
            ))}
          </ol> : <p className="client-empty-note">No project milestones have been shared yet.</p>}
        </section>}
        {tab === 'Billing & payments' && <div className="client-finance-grid">
          <section className="client-portal-section"><h2>Billings</h2>{project.billings.length || project.downPaymentAmount > 0 ? <div className="client-record-list">{project.downPaymentAmount > 0 && <div className="client-finance-row"><span className="client-record-icon"><FileText size={16} /></span><span><strong>Contract down payment</strong><small>Contractual down payment</small></span><strong className="client-record-amount">{money.format(projectOutstandingItems.find((item) => item.id === `down-payment:${project.id}`)?.outstandingAmount ?? 0)}</strong></div>}{project.billings.map((billing) => <div className="client-finance-row" key={billing.id}><span className="client-record-icon"><FileText size={16} /></span><span><strong>Billing #{formatBillingNumber(billing.number)}</strong><small>{formatDate(billing.issuedAt)} · {billing.progress}% complete{billing.dueAt ? ` · due ${formatDate(billing.dueAt)}` : ''}</small></span><strong className="client-record-amount">{money.format(billing.amount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview billing ${formatBillingNumber(billing.number)}`} title="Preview billing PDF" onClick={() => { void openBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingNumber: billing.number, amount: billing.amount, progressPercent: billing.progress, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label={`Download billing ${formatBillingNumber(billing.number)}`} title="Download billing PDF" onClick={() => { void downloadBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingNumber: billing.number, amount: billing.amount, progressPercent: billing.progress, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }) }}><Download size={15} /></button></div></div>)}</div> : <p className="client-empty-note">No billings have been issued yet.</p>}</section>
          <section className="client-portal-section"><h2>Payment history</h2>{project.payments.length ? <div className="client-record-list client-payment-history-list" role="region" aria-label="Payment history" tabIndex={0}>{project.payments.map((payment) => <div className="client-finance-row" key={payment.id}><span className="client-record-icon"><ArrowDownLeft size={16} /></span><span><strong>{payment.receiptNumber || 'Payment received'}</strong><small>{formatDate(payment.receivedAt)} · {payment.paymentMode.replaceAll('_', ' ')} · {payment.reference || payment.payerName}</small></span><strong className="client-record-amount">{money.format(payment.amount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview receipt ${payment.receiptNumber}`} title="Preview payment receipt" onClick={() => { void openPaymentReceiptPdf({ projectName: project.name, payerName: payment.payerName, receiptNumber: payment.receiptNumber, amount: payment.amount, receivedDate: payment.receivedAt, paymentType: payment.paymentType, paymentMode: payment.paymentMode, reference: payment.reference }) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label={`Download receipt ${payment.receiptNumber}`} title="Download payment receipt" onClick={() => { void downloadPaymentReceiptPdf({ projectName: project.name, payerName: payment.payerName, receiptNumber: payment.receiptNumber, amount: payment.amount, receivedDate: payment.receivedAt, paymentType: payment.paymentType, paymentMode: payment.paymentMode, reference: payment.reference }) }}><Download size={15} /></button></div></div>)}</div> : <p className="client-empty-note">No payments have been recorded yet.</p>}</section>
        </div>}
        {tab === 'Change orders' && <section className={`client-portal-section client-change-orders-section${project.changeOrders.length ? '' : ' is-empty'}`}>
          <h2>Change orders</h2>
          {project.changeOrders.length > 0 && <p className="client-empty-note">View or download the change-order PDF. Approving records your sign-off; reject it if changes are needed.</p>}
          {changeOrderError && <p className="form-error" role="alert">{changeOrderError}</p>}
          {documentError && <p className="form-error" role="alert">{documentError}</p>}
          {project.changeOrders.length > 0
            ? <div className="client-record-list">{project.changeOrders.map((order) => {
              const pdfStoragePath = order.pdfStoragePath
              return <article className="client-change-order-row" key={order.id}>
                <div className="client-change-order-copy">
                  <strong>{formatChangeOrderNumber(project.prefix, order.orderNumber)} · {order.title}</strong>
                  <small>{order.status === 'pending_approval' ? 'Waiting for your decision' : 'Approved'} · {formatDate(order.createdAt)}</small>
                </div>
                <strong className="client-record-amount">{money.format(order.amount)}</strong>
                {pdfStoragePath && <div className="client-download-actions">
                  <button type="button" className="client-download-button" aria-label={`View change order ${formatChangeOrderNumber(project.prefix, order.orderNumber)} PDF`} title="View change-order PDF" disabled={downloadingDocument === order.id} onClick={() => { void openDocument({ id: order.id, fileName: `${formatChangeOrderNumber(project.prefix, order.orderNumber)}.pdf`, storagePath: pdfStoragePath, createdAt: order.createdAt, documentType: 'change order' }) }}>{downloadingDocument === order.id ? <RefreshCw size={15} /> : <Eye size={15} />}</button>
                  <button type="button" className="client-download-button" aria-label={`Download change order ${formatChangeOrderNumber(project.prefix, order.orderNumber)} PDF`} title="Download change-order PDF" disabled={downloadingDocument === order.id} onClick={() => { void openDocument({ id: order.id, fileName: `${formatChangeOrderNumber(project.prefix, order.orderNumber)}.pdf`, storagePath: pdfStoragePath, createdAt: order.createdAt, documentType: 'change order' }, true) }}><Download size={15} /></button>
                </div>}
                {order.status === 'pending_approval' && <div className="client-change-order-actions">
                  <button type="button" className="button button-secondary" onClick={() => { void respondToChangeOrder(order.id, false) }} disabled={respondingToChangeOrder !== ''}>Reject</button>
                  <button type="button" className="button button-primary" onClick={() => { void respondToChangeOrder(order.id, true) }} disabled={respondingToChangeOrder !== ''}>{respondingToChangeOrder === order.id ? 'Submitting…' : 'Approve & sign off'}</button>
                </div>}
              </article>
            })}</div>
            : <div className="client-change-order-empty">No change orders at this time.</div>}
        </section>}
        {tab === 'Documents' && <section className={`client-portal-section client-documents-section${project.documents.length ? '' : ' is-empty'}`}>
          <h2>Documents</h2>
          {documentError && <p className="form-error" role="alert">{documentError}</p>}
          {project.documents.length > 0
            ? <div className="client-record-list">{project.documents.map((document) => (
              <div className="client-finance-row" key={document.id}>
                <span className="client-record-icon"><FileText size={16} /></span>
                <span><strong>{document.fileName}</strong><small>{document.documentType.replaceAll('_', ' ')} · shared {formatDate(document.createdAt)}</small></span>
                <div className="client-download-actions">
                  <button type="button" className="client-download-button" aria-label={`View ${document.fileName}`} title="View document" disabled={downloadingDocument === document.id} onClick={() => { void openDocument(document) }}>{downloadingDocument === document.id ? <RefreshCw size={15} /> : <Eye size={15} />}</button>
                  <button type="button" className="client-download-button" aria-label={`Download ${document.fileName}`} title="Download document" disabled={downloadingDocument === document.id} onClick={() => { void openDocument(document, true) }}><Download size={15} /></button>
                </div>
              </div>
            ))}</div>
            : <div className="client-change-order-empty">No documents at this time.</div>}
        </section>}
        </div>
      </>}
    </div>
    <nav className="client-mobile-bottom-nav" aria-label="Client quick navigation">
      <button type="button" className={mobilePage === 'home' ? 'is-active' : ''} aria-current={mobilePage === 'home' ? 'page' : undefined} onClick={() => { setMobilePage('home'); returnToProjectList(); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
        {mobilePage === 'home' ? <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z" /></svg> : <House size={17} />}
        <span>Home</span>
      </button>
      <button type="button" className={mobilePage === 'profile' ? 'is-active' : ''} aria-current={mobilePage === 'profile' ? 'page' : undefined} onClick={() => { setMobilePage('profile'); setIsNotificationsOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>
        {mobilePage === 'profile' ? <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-5.1 0-9 2.7-9 6v2h18v-2c0-3.3-3.9-6-9-6Z" /></svg> : <UserRound size={17} />}
        <span>Profile</span>
      </button>
    </nav>
    </div>
  </main>
}