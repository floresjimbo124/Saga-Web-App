import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type TouchEvent } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownLeft, ArrowLeft, Bell, FolderOpen, LayoutGrid, Wallet, FilePen, Check, ChevronRight, Circle, CircleAlert, Clock3, Download, Eye, FileText, FolderKanban, House, ImagePlus, KeyRound, LogOut, MapPin, Minus, Plus, RefreshCw, UserRound, X } from 'lucide-react'
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
import { formatPaymentType } from '../lib/payment-type'
import { respondToProjectChangeOrder } from '../data/change-orders'
import { createProjectCoverPhotoUrl } from '../data/project-cover'
import { createProjectMilestonePhotoUrl } from '../data/project-milestones'
import { useToast } from './toast-context'

type ClientBillingNotification = {
  kind: 'billing' | 'retention'
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

type ClientActivityNotification = {
  kind: 'change-order' | 'payment' | 'milestone'
  id: string
  projectId: string
  title: string
  detail: string
  date: string
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

function ClientProjectCover({ storagePath, projectName, variant }: { storagePath: string | null; projectName: string; variant: 'card' | 'detail' | 'thumb' }) {
  const [loadedPhoto, setLoadedPhoto] = useState<{ storagePath: string; url: string } | null>(null)
  const [failedStoragePath, setFailedStoragePath] = useState<string | null>(null)
  const photoUrl = loadedPhoto?.storagePath === storagePath ? loadedPhoto.url : ''
  const isDetail = variant === 'detail'
  const className = isDetail ? 'client-project-detail-cover' : variant === 'thumb' ? 'client-sidebar-thumb' : 'client-project-home-cover'

  useEffect(() => {
    let active = true
    if (!storagePath) return () => { active = false }
    void createProjectCoverPhotoUrl(storagePath)
      .then((url) => { if (active) setLoadedPhoto({ storagePath, url }) })
      .catch((error: unknown) => {
        console.error('Could not load the client project cover photo.', error)
        if (active) setFailedStoragePath(storagePath)
      })
    return () => { active = false }
  }, [storagePath])

  return <div className={className}>
    {photoUrl && failedStoragePath !== storagePath
      ? <img src={photoUrl} alt={`${projectName} project cover`} onError={() => setFailedStoragePath(storagePath)} />
      : variant === 'thumb' ? <span>{projectName.slice(0, 1)}</span> : <><FolderKanban size={isDetail ? 29 : 18} aria-hidden="true" /><span>{isDetail ? 'Project overview' : projectName.slice(0, 1)}</span></>}
  </div>
}

function ClientLatestUpdatePhoto({ storagePath, milestoneName }: { storagePath: string; milestoneName: string }) {
  const [loadedPhoto, setLoadedPhoto] = useState<{ storagePath: string; url: string } | null>(null)

  useEffect(() => {
    let active = true
    void createProjectMilestonePhotoUrl(storagePath)
      .then((url) => { if (active) setLoadedPhoto({ storagePath, url }) })
      .catch((error: unknown) => console.error('Could not load the latest milestone photo.', error))
    return () => { active = false }
  }, [storagePath])

  const photoUrl = loadedPhoto?.storagePath === storagePath ? loadedPhoto.url : ''
  return <span className="client-project-home-update-photo">{photoUrl && <img src={photoUrl} alt={`${milestoneName} site photo`} />}</span>
}

type ClientDueItem = {
  id: string
  projectId: string
  kind?: string
  billingNumber: number
  outstandingAmount: number
  daysOverdue: number
  dueAt: string | null
}

const wholePeso = (value: number) => money.format(value).replace(/\.00$/, '')

function getClientProjectSummary(item: ClientPortalProject, receivables: readonly ClientDueItem[]) {
  const progress = Math.min(100, Math.max(0, item.progress))
  const paid = item.payments.reduce((sum, payment) => sum + payment.amount, 0)
  const changeOrderTotal = item.changeOrders.filter((order) => order.status === 'approved').reduce((sum, order) => sum + order.amount, 0)
  const totalContract = item.contractPrice + changeOrderTotal
  const paidPercent = totalContract > 0 ? Math.min(100, Math.round((paid / totalContract) * 100)) : 0
  const completedMilestones = item.milestones.filter((milestone) => milestone.status === 'complete').length
  const nextMilestone = item.milestones.find((milestone) => milestone.status !== 'complete')
  const latestPhotoMilestone = item.milestones
    .filter((milestone) => milestone.status === 'complete' && milestone.photoStoragePath)
    .sort((a, b) => (b.actualDate ?? '').localeCompare(a.actualDate ?? ''))[0]
  const dueNow = receivables
    .filter((billing) => billing.projectId === item.id && billing.outstandingAmount > 0)
    .sort((a, b) => b.daysOverdue - a.daysOverdue || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))[0]
  const dueOrder = dueNow?.kind === 'change-order' ? item.changeOrders.find((entry) => `change-order:${entry.id}` === dueNow.id) : undefined
  const dueLabel = !dueNow ? '' : dueNow.kind === 'retention' ? 'Retention release' : dueNow.kind === 'down-payment' ? 'Down payment' : dueNow.kind === 'change-order'
    ? dueOrder ? `Change order #${dueOrder.orderNumber}${dueOrder.title ? ` – ${dueOrder.title}` : ''}` : 'Change order'
    : `Progress billing #${formatBillingNumber(dueNow.billingNumber)}`
  const pendingChangeOrders = item.changeOrders.filter((order) => order.status === 'pending_approval')
  return { progress, paid, changeOrderTotal, totalContract, paidPercent, completedMilestones, nextMilestone, latestPhotoMilestone, dueNow, dueLabel, pendingChangeOrders }
}

type ClientProjectSummary = ReturnType<typeof getClientProjectSummary>

function ClientDueBanner({ summary, onOpen }: { summary: ClientProjectSummary; onOpen: () => void }) {
  const { dueNow, dueLabel } = summary
  if (!dueNow) return null
  return <span className={`client-project-home-due${dueNow.daysOverdue > 0 ? ' is-overdue' : ''}`} onClick={(event) => { event.stopPropagation(); onOpen() }}>
    <span><small>{dueNow.daysOverdue > 0 ? `Overdue · ${dueNow.daysOverdue} day${dueNow.daysOverdue === 1 ? '' : 's'}` : 'Payment due'}</small><strong>{dueLabel}</strong></span>
    <span><strong>{money.format(dueNow.outstandingAmount)}</strong><small>{dueNow.dueAt ? `Due ${formatDate(dueNow.dueAt)} · ` : ''}View billing ›</small></span>
  </span>
}

function ClientMoneyTiles({ summary }: { summary: ClientProjectSummary }) {
  const { changeOrderTotal, totalContract, paid, paidPercent } = summary
  return <>
    <span className="client-project-home-stats">
      <span><small>{changeOrderTotal > 0 ? 'Total contract' : 'Contract price'}</small><strong>{wholePeso(totalContract)}</strong>{changeOrderTotal > 0 && <small>+{wholePeso(changeOrderTotal)} change orders</small>}</span>
      <span><small>Paid to date</small><strong>{wholePeso(paid)}</strong></span>
      <span><small>Remaining</small><strong>{wholePeso(Math.max(0, totalContract - paid))}</strong></span>
    </span>
    <span className="client-project-home-paid">
      <span className="client-project-home-progress is-paid"><span style={{ width: `${paidPercent}%` }} /></span>
      <small>{paidPercent}% of total contract paid</small>
      <small className="client-money-compact"><b>{wholePeso(paid)}</b> paid of {wholePeso(totalContract)} · {paidPercent}%</small>
    </span>
  </>
}

const clientStatusLabels: Record<string, string> = {
  planning: 'Planning stage',
  active: 'Under construction',
  on_hold: 'On hold',
  completed: 'Completed',
  closed: 'Turned over',
}

const clientStages = [
  { key: 'planning', label: 'Planning' },
  { key: 'active', label: 'Construction' },
  { key: 'completed', label: 'Completed' },
  { key: 'closed', label: 'Turnover' },
]

function clientStatusLabel(status: string) {
  return clientStatusLabels[status] ?? status.replaceAll('_', ' ').replace(/^\w/, (letter) => letter.toUpperCase())
}

function ClientStageStepper({ status }: { status: string }) {
  const current = Math.max(0, clientStages.findIndex((stage) => stage.key === (status === 'on_hold' ? 'active' : status)))
  return <ol className="client-stage-stepper" aria-label="Project stage">
    {clientStages.map((stage, index) => <li key={stage.key} className={index < current ? 'is-done' : index === current ? `is-current${status === 'on_hold' ? ' is-on-hold' : ''}` : ''} aria-current={index === current ? 'step' : undefined}>
      <span>{index < current ? <Check size={12} aria-hidden="true" /> : index + 1}</span>
      <small>{stage.label}{index === current && status === 'on_hold' ? ' · on hold' : ''}</small>
    </li>)}
  </ol>
}

function ClientPayStatus({ amount, outstanding, daysOverdue }: { amount: number; outstanding: number; daysOverdue: number }) {
  const [label, tone] = outstanding <= 0 ? ['Paid', 'paid'] : daysOverdue > 0 ? ['Overdue', 'overdue'] : outstanding < amount ? ['Partially paid', 'partial'] : ['Due', 'due']
  return <span className={`client-pay-status is-${tone}`}>{label}</span>
}

function documentKind(fileName: string) {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (['jpg', 'jpeg', 'png', 'webp', 'heic'].includes(extension)) return 'IMG'
  if (['dwg', 'dxf'].includes(extension)) return 'CAD'
  if (['xls', 'xlsx', 'csv'].includes(extension)) return 'XLS'
  if (['doc', 'docx'].includes(extension)) return 'DOC'
  return extension === 'pdf' ? 'PDF' : 'FILE'
}

function formatRelativeDays(value: string) {
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return formatDate(value)
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
  const [showAllUpcoming, setShowAllUpcoming] = useState(false)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountMenu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isAccountMenuOpen) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !accountMenu.current?.contains(event.target as Node)) setIsAccountMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [isAccountMenuOpen])
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
  const [billingPdfError, setBillingPdfError] = useState('')
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
    setMobilePage('home')
    setSelectedId('')
    setRequestedProjectId(null)
    const url = new URL(window.location.href)
    url.searchParams.delete('projectId')
    url.searchParams.delete('tab')
    window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
    setTab('Overview')
  }
  const changeOrderReceiptLabel = (contractId: string | null) => {
    if (!project || !contractId) return undefined
    const order = project.changeOrders.find((changeOrder) => changeOrder.contractId === contractId)
    return order ? `${formatChangeOrderNumber(project.prefix, order.orderNumber)} · ${order.title}` : undefined
  }
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
  const downPaymentReceivable = projectOutstandingItems.find((item) => item.kind === 'down-payment')
  const downPaymentPercent = project && project.contractPrice > 0
    ? Math.round(project.downPaymentAmount / project.contractPrice * 10_000) / 100
    : undefined
  const clientDueItems: ClientDueItem[] = [
    ...outstandingBillings,
    ...dueRetention.map(({ project: item, dueAt }) => {
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
      return { id: `retention:${item.id}`, projectId: item.id, kind: 'retention', billingNumber: 0, outstandingAmount: item.retentionAmount, daysOverdue: aging?.daysOverdue ?? 0, dueAt }
    }),
  ]
  const projectSummary = project ? getClientProjectSummary(project, clientDueItems) : null
  const overdueByBillingId = new Map(overdueBillings.map((billing) => [billing.id, billing]))
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
  const notifications = [...billingNotifications, ...retentionNotifications]
  const recentCutoff = Date.now() - 30 * 86_400_000
  const activityNotifications: ClientActivityNotification[] = projects.flatMap((item) => [
    ...item.changeOrders.filter((order) => order.status === 'pending_approval').map((order) => ({
      kind: 'change-order' as const,
      id: `change-order-review:${order.id}`,
      projectId: item.id,
      title: `${item.name} · Change order #${order.orderNumber} needs your approval`,
      detail: `${order.title} · ${money.format(order.amount)}`,
      date: order.createdAt,
    })),
    ...item.payments.filter((payment) => new Date(payment.receivedAt).getTime() >= recentCutoff).map((payment) => ({
      kind: 'payment' as const,
      id: `payment:${payment.id}`,
      projectId: item.id,
      title: `${item.name} · Payment received`,
      detail: `${money.format(payment.amount)} · ${formatPaymentType(payment.paymentType)}${payment.receiptNumber ? ` · ${payment.receiptNumber}` : ''}`,
      date: payment.receivedAt,
    })),
    ...item.milestones.filter((milestone) => milestone.status === 'complete' && milestone.actualDate && new Date(milestone.actualDate).getTime() >= recentCutoff).map((milestone) => ({
      kind: 'milestone' as const,
      id: `milestone:${milestone.id}`,
      projectId: item.id,
      title: `${item.name} · ${milestone.name} completed`,
      detail: milestone.photoStoragePath ? 'New site photo added' : 'Milestone completed',
      date: milestone.actualDate ?? '',
    })),
  ])
  const notificationCount = [...notifications, ...activityNotifications].filter((notification) => !readNotificationState.ids.has(notification.id)).length

  const markAllNotificationsRead = () => {
    const readIds = new Set(readNotificationState.ids)
    for (const notification of [...notifications, ...activityNotifications]) readIds.add(notification.id)
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

  const openActivityNotification = (notification: ClientActivityNotification) => {
    const readIds = new Set(readNotificationState.ids)
    readIds.add(notification.id)
    setReadNotificationState({ ids: readIds, error: '' })
    try {
      saveReadClientBillingNotificationIds(userId, [...readIds])
    } catch (saveError) {
      setReadNotificationState({ ids: readIds, error: saveError instanceof Error ? `Could not save notification read status: ${saveError.message}` : 'Could not save notification read status.' })
    }
    setMobilePage('home')
    setSelectedId(notification.projectId)
    setTab(notification.kind === 'change-order' ? 'Change orders' : notification.kind === 'payment' ? 'Billing & payments' : 'Overview')
    setIsNotificationsOpen(false)
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
        {projects.map((item) => <button type="button" key={item.id} className={`client-sidebar-nav-item client-sidebar-project-item${project?.id === item.id && mobilePage === 'home' ? ' is-active' : ''}`} onClick={() => { setMobilePage('home'); setSelectedId(item.id); setTab('Overview') }}>
          <ClientProjectCover storagePath={item.coverPhotoStoragePath} projectName={item.name} variant="thumb" />
          <span className="client-sidebar-project-copy">
            <span>{item.name}</span>
            <span className="client-sidebar-project-progress"><span style={{ width: `${Math.min(100, Math.max(0, item.progress))}%` }} /></span>
            <small>{clientStatusLabel(item.status)} · {Math.min(100, Math.max(0, item.progress))}%</small>
          </span>
        </button>)}
      </nav>
      <div className="client-sidebar-footer">
        {projects.some((item) => item.changeOrders.some((order) => order.status === 'pending_approval')) && <button type="button" className="client-sidebar-alert" onClick={() => { const item = projects.find((entry) => entry.changeOrders.some((order) => order.status === 'pending_approval')); if (item) { setMobilePage('home'); setSelectedId(item.id); setTab('Change orders') } }}>
          <CircleAlert size={15} aria-hidden="true" /><span><strong>Action needed</strong><small>A change order is waiting for your approval</small></span>
        </button>}
        <button type="button" className="client-sidebar-account" onClick={() => setMobilePage('profile')}>
          <span className="client-account-avatar">{profilePhotoUrl ? <img src={profilePhotoUrl} alt="" /> : firstName.trim().charAt(0).toUpperCase() || <UserRound size={15} />}</span>
          <span><strong>{firstName || 'Client'}</strong><small>View profile</small></span>
          <ChevronRight size={15} aria-hidden="true" />
        </button>
      </div>
    </aside>
    <div className="client-portal-main">
    <header className={`client-portal-topbar${project && mobilePage === 'home' ? ' has-project' : ''}`}>
      <a className="client-portal-brand" href="/" aria-label="SAGACT client portal home"><span><img src="/sagact-mark.svg" alt="" /></span>SAGACT<span>.</span></a>
      {project && <div className="client-project-mobile-header">
        <button type="button" onClick={returnToProjectList} aria-label="Back to projects"><ArrowLeft size={19} /></button>
        <strong>Project Details</strong>
      </div>}
      <nav className="client-breadcrumb" aria-label="Breadcrumb">
        {project && mobilePage === 'home'
          ? <><button type="button" onClick={returnToProjectList}>All projects</button><ChevronRight size={14} aria-hidden="true" /><span aria-current="page">{project.name}</span>{tab !== 'Overview' && <><ChevronRight size={14} aria-hidden="true" /><span>{tab}</span></>}</>
          : <span aria-current="page">{mobilePage === 'profile' ? 'Profile' : 'All projects'}</span>}
      </nav>
      <div className="client-portal-topbar-right">
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
            {(() => {
              type Row = { id: string; date: string; tone: string; icon: ReactNode; title: string; detail: string; status?: ReactNode; open: () => void }
              const rows: Row[] = [
                ...notifications.map((billing): Row => {
                  const due = clientDueItems.find((entry) => entry.id === billing.id)
                  const isPaid = billing.kind === 'billing' && (!due || due.outstandingAmount <= 0)
                  return {
                    id: billing.id,
                    date: billing.kind === 'retention' ? billing.dueAt ?? '' : billing.issuedAt ?? billing.createdAt ?? '',
                    tone: billing.daysOverdue ? 'urgent' : billing.kind === 'retention' ? 'warning' : 'billing',
                    icon: billing.kind === 'retention' || billing.daysOverdue ? <CircleAlert size={16} /> : <FileText size={16} />,
                    title: billing.kind === 'retention'
                      ? `${billing.projectName} · Retention release due`
                      : `${billing.projectName} · Progress billing${billing.billingNumber === undefined ? '' : ` #${formatBillingNumber(billing.billingNumber)}`} issued`,
                    detail: billing.kind === 'retention'
                      ? `${money.format(billing.amount)} · due ${formatDate(billing.dueAt ?? null)}`
                      : `${money.format(billing.amount)}${billing.dueAt ? ` · due ${formatDate(billing.dueAt)}` : ''}`,
                    status: billing.daysOverdue
                      ? <span className="client-pay-status is-overdue">{billing.daysOverdue} days overdue</span>
                      : billing.kind === 'billing' ? <span className={`client-pay-status ${isPaid ? 'is-paid' : 'is-due'}`}>{isPaid ? 'Paid' : 'Unpaid'}</span> : undefined,
                    open: () => { void openBillingNotification(billing) },
                  }
                }),
                ...activityNotifications.map((activity): Row => ({
                  id: activity.id,
                  date: activity.date,
                  tone: activity.kind === 'change-order' ? 'warning' : activity.kind,
                  icon: activity.kind === 'change-order' ? <FilePen size={16} /> : activity.kind === 'payment' ? <ArrowDownLeft size={16} /> : <Check size={16} />,
                  title: activity.title,
                  detail: activity.detail,
                  status: activity.kind === 'change-order' ? <span className="client-pay-status is-due">Action needed</span> : undefined,
                  open: () => openActivityNotification(activity),
                })),
              ].sort((a, b) => b.date.localeCompare(a.date))
              if (!rows.length) return <div className="notification-empty"><Bell size={16} /><span>No notifications right now.</span></div>
              const unread = rows.filter((row) => !readNotificationState.ids.has(row.id))
              const read = rows.filter((row) => readNotificationState.ids.has(row.id))
              const renderRow = (row: Row) => <button type="button" key={row.id} className={`notification-row client-notification-row is-${row.tone}${readNotificationState.ids.has(row.id) ? ' notification-read' : ''}`} onClick={row.open}>
                <span className="notification-icon">{row.icon}</span>
                <span className="notification-copy">
                  <strong>{row.title}</strong>
                  <small>{row.detail}</small>
                  <span className="client-notification-meta">{row.status}<em>{row.date ? formatRelativeDays(row.date) : ''}</em></span>
                </span>
                {!readNotificationState.ids.has(row.id) && <i className="client-notification-dot" aria-label="Unread" />}
              </button>
              return <div className="notification-list client-notification-list">
                {unread.length > 0 && <><h3 className="client-notification-group">New</h3>{unread.map(renderRow)}</>}
                {read.length > 0 && <><h3 className="client-notification-group">Earlier</h3>{read.map(renderRow)}</>}
              </div>
            })()}
          </section>}
        </div>
        <div className="client-account" ref={accountMenu}>
          <button type="button" className="client-account-button" aria-haspopup="menu" aria-expanded={isAccountMenuOpen} onClick={() => setIsAccountMenuOpen((open) => !open)}>
            <span className="client-account-avatar">{profilePhotoUrl ? <img src={profilePhotoUrl} alt="" /> : firstName.trim().charAt(0).toUpperCase() || <UserRound size={15} />}</span>
            <span className="client-account-name">{firstName || 'Client'}</span>
            <ChevronRight className="client-account-caret" size={14} aria-hidden="true" />
          </button>
          {isAccountMenuOpen && <div className="client-account-menu" role="menu">
            <div className="client-account-menu-head"><strong>{firstName || 'Client'}</strong><small>Client portal account</small></div>
            <button type="button" role="menuitem" onClick={() => { setIsAccountMenuOpen(false); setMobilePage('profile') }}><UserRound size={15} />Profile &amp; password</button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => { void supabase?.auth.signOut() }}><LogOut size={15} />Sign out</button>
          </div>}
        </div>
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
      </section> : isLoading ? <section className="client-project-home client-project-skeleton" role="status" aria-label="Loading your projects">
        <div className="client-project-home-heading"><div><span className="skeleton-line is-title" /><span className="skeleton-line is-subtitle" /></div></div>
        <div className="client-project-home-list is-single">
          <div className="client-project-home-card" aria-hidden="true">
            <span className="skeleton-block is-cover" />
            <span className="client-project-home-body">
              <span className="skeleton-line is-name" />
              <span className="skeleton-line is-short" />
              <span className="skeleton-line is-bar" />
              <span className="skeleton-block is-row" />
              <span className="client-project-home-stats"><span className="skeleton-block is-tile" /><span className="skeleton-block is-tile" /><span className="skeleton-block is-tile" /></span>
            </span>
          </div>
        </div>
      </section> : error ? <div className="sample-banner" role="alert">{error}<button className="text-button" onClick={() => { void loadProjects() }}>Retry</button></div> : !projects.length ? <section className="client-portal-empty client-project-page-arrive">
        <span className="client-portal-empty-icon"><FolderKanban size={28} aria-hidden="true" /></span>
        <h1>Welcome{firstName ? `, ${firstName}` : ''}!</h1>
        <p>Your project isn't shared with your account yet. Once your project team sets it up, you'll see its progress, milestones, billings and documents here.</p>
        <ul className="client-portal-empty-steps">
          <li><Check size={14} aria-hidden="true" />Your account is ready</li>
          <li><Clock3 size={14} aria-hidden="true" />Waiting for your project team to share your project</li>
        </ul>
        <button type="button" className="button button-secondary" onClick={() => { void loadProjects() }}><RefreshCw size={15} />Check again</button>
        <small>Been waiting a while? Contact your project team and ask them to share the project with this email.</small>
      </section> : !project ? <section className="client-project-home client-project-page-arrive">
        <div className="client-project-home-heading">
          <div>
            <h1>{new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening'}, {firstName || 'there'}</h1>
            <p>{projects.length === 1
              ? (() => {
                const only = projects[0]
                const next = only.milestones.find((milestone) => milestone.status !== 'complete')
                return `${only.name} is ${Math.min(100, Math.max(0, only.progress))}% complete${next ? `. Next milestone: ${next.name}${next.plannedDate ? ` on ${formatDate(next.plannedDate)}` : ''}` : ''}.`
              })()
              : 'Select a project to view progress, milestones, billings, and shared documents.'}</p>
          </div>
          {projects.length > 1 && <span>{projects.length} projects</span>}
        </div>
        {projects.flatMap((item) => item.changeOrders.filter((order) => order.status === 'pending_approval').map((order) => <section className="client-approval-card" key={order.id}>
          <span className="client-approval-icon"><CircleAlert size={20} aria-hidden="true" /></span>
          <span className="client-approval-copy">
            <small>Needs your approval · {item.name}</small>
            <strong>Change order #{order.orderNumber}{order.title ? ` – ${order.title}` : ''}</strong>
            <span>{money.format(order.amount)} · submitted {formatDate(order.createdAt)}</span>
          </span>
          <button type="button" className="button button-primary" onClick={() => { setSelectedId(item.id); setTab('Change orders') }}>Review</button>
        </section>))}
        <div className={`client-project-home-list${projects.length === 1 ? ' is-single' : ''}`}>
          {projects.map((item) => {
            const summary = getClientProjectSummary(item, clientDueItems)
            const { progress, completedMilestones, nextMilestone, latestPhotoMilestone } = summary
            return <button className="client-project-home-card" type="button" key={item.id} onClick={() => { setSelectedId(item.id); setTab('Overview') }} aria-label={`Open ${item.name}`}>
              <span className="client-project-home-media">
                <ClientProjectCover storagePath={item.coverPhotoStoragePath} projectName={item.name} variant="card" />
                <span className={`client-status-chip status-${item.status}`}><i aria-hidden="true" />{clientStatusLabel(item.status)}</span>
              </span>
              <span className="client-project-home-body">
                <span className="client-project-home-card-heading">
                  <span className="client-project-home-copy"><strong>{item.name}</strong><small><MapPin size={12} />{item.location}</small></span>
                  <ChevronRight className="client-project-home-arrow" size={18} />
                </span>
                <span className="client-project-home-progress-block">
                  <span className="client-project-home-meta"><small>Construction progress</small><strong>{progress}%</strong></span>
                  <span className="client-project-home-progress"><span style={{ width: `${progress}%` }} /></span>
                  {item.milestones.length > 0 && <small className="client-project-home-milestone">
                    <span>{nextMilestone ? <>Next: <b>{nextMilestone.name}</b>{nextMilestone.plannedDate ? ` · ${formatDate(nextMilestone.plannedDate)}` : ''}</> : 'All milestones complete'}</span>
                    <span className="client-project-home-milestone-count">{completedMilestones}/{item.milestones.length} milestones</span>
                  </small>}
                </span>
                {latestPhotoMilestone?.photoStoragePath && <span className="client-project-home-update">
                  <ClientLatestUpdatePhoto storagePath={latestPhotoMilestone.photoStoragePath} milestoneName={latestPhotoMilestone.name} />
                  <span><small>Latest site update</small><strong>{latestPhotoMilestone.name}</strong><small>Project updated {formatRelativeDays(item.updatedAt)}</small></span>
                </span>}
                <ClientDueBanner summary={summary} onOpen={() => { setSelectedId(item.id); setTab('Billing & payments') }} />
                <ClientMoneyTiles summary={summary} />
              </span>
            </button>
          })}
        </div>
      </section> : <>
        <button type="button" className="client-projects-back" onClick={returnToProjectList}><ArrowLeft size={15} />All projects</button>
        {projects.length > 1 && <nav className="client-project-switcher" aria-label="Your projects">{projects.map((item) => <button key={item.id} type="button" className={item.id === project.id ? 'is-selected' : ''} onClick={() => { setSelectedId(item.id); setTab('Overview') }}>{item.name}</button>)}</nav>}
        <section className="client-project-detail-hero client-project-page-arrive">
          <ClientProjectCover storagePath={project.coverPhotoStoragePath} projectName={project.name} variant="detail" />
          <div className="client-project-detail-overlay">
            <div><span className={`client-status-chip status-${project.status}`}><i aria-hidden="true" />{clientStatusLabel(project.status)}</span><h1>{project.name}</h1><div className="client-project-location"><MapPin size={14} />{project.location}</div></div>
          </div>
        </section>
        <nav className="client-portal-tabs client-project-page-arrive" aria-label="Project information">{(['Overview', 'Billing & payments', 'Change orders', 'Documents'] as ClientPortalTab[]).map((item) => {
          const badge = item === 'Change orders' ? projectSummary?.pendingChangeOrders.length ?? 0 : item === 'Billing & payments' ? projectOutstandingItems.filter((entry) => entry.outstandingAmount > 0).length : 0
          const TabIcon = item === 'Overview' ? LayoutGrid : item === 'Billing & payments' ? Wallet : item === 'Change orders' ? FilePen : FolderOpen
          return <button type="button" key={item} className={tab === item ? 'is-selected' : ''} onClick={() => setTab(item)}><TabIcon size={15} aria-hidden="true" />{item}{badge > 0 && <span className="client-tab-badge" aria-label={`${badge} need attention`}>{badge}</span>}</button>
        })}</nav>
        <div key={tab} className="client-tab-transition">
        {tab === 'Overview' && <>
          {projectSummary && <section className="client-detail-summary-card" aria-label="Project summary">
            <ClientStageStepper status={project.status} />
            <div className="client-detail-summary-progress">
              <small>Construction progress</small>
              <strong className="client-detail-summary-figure">{projectSummary.progress}%</strong>
              <span className="client-project-home-progress"><span style={{ width: `${projectSummary.progress}%` }} /></span>
              {project.milestones.length > 0 && <p>
                {projectSummary.nextMilestone ? <>Next: <b>{projectSummary.nextMilestone.name}</b>{projectSummary.nextMilestone.plannedDate ? ` · ${formatDate(projectSummary.nextMilestone.plannedDate)}` : ''}</> : 'All milestones complete'}
                <span>{projectSummary.completedMilestones} of {project.milestones.length} milestones done</span>
              </p>}
            </div>
            <div className="client-detail-summary-money">
              <small>Payments</small>
              <strong className="client-detail-summary-figure">{wholePeso(projectSummary.paid)} <span>paid of {wholePeso(projectSummary.totalContract)}</span></strong>
              <span className="client-project-home-progress is-paid"><span style={{ width: `${projectSummary.paidPercent}%` }} /></span>
              <p>
                <span>{projectSummary.paidPercent}% paid · <b>{wholePeso(Math.max(0, projectSummary.totalContract - projectSummary.paid))}</b> remaining</span>
                {projectSummary.changeOrderTotal > 0 && <span>Includes {wholePeso(projectSummary.changeOrderTotal)} in change orders</span>}
              </p>
              {projectSummary.dueNow && <div className={`client-detail-due${projectSummary.dueNow.daysOverdue > 0 ? ' is-overdue' : ''}`}>
                <span>
                  <small>{projectSummary.dueNow.daysOverdue > 0 ? `Overdue · ${projectSummary.dueNow.daysOverdue} day${projectSummary.dueNow.daysOverdue === 1 ? '' : 's'}` : projectSummary.dueNow.dueAt ? `Due ${formatDate(projectSummary.dueNow.dueAt)}` : 'Payment due'}</small>
                  <strong>{money.format(projectSummary.dueNow.outstandingAmount)}</strong>
                  <em>{projectSummary.dueLabel}</em>
                </span>
                <button type="button" className="button button-primary" onClick={() => setTab('Billing & payments')}>View billing</button>
              </div>}
            </div>
          </section>}
          {projectSummary?.pendingChangeOrders.map((order) => <section className="client-approval-card" key={order.id}>
            <span className="client-approval-icon"><CircleAlert size={20} aria-hidden="true" /></span>
            <span className="client-approval-copy">
              <small>Needs your approval</small>
              <strong>Change order #{order.orderNumber}{order.title ? ` – ${order.title}` : ''}</strong>
              <span>{money.format(order.amount)} · submitted {formatDate(order.createdAt)}</span>
            </span>
            <button type="button" className="button button-primary" onClick={() => setTab('Change orders')}>Review</button>
          </section>)}
          {(() => {
            const completed = project.milestones
              .filter((milestone) => milestone.status === 'complete')
              .sort((a, b) => (a.actualDate ?? '').localeCompare(b.actualDate ?? ''))
            const upcoming = project.milestones.filter((milestone) => milestone.status !== 'complete')
            const visibleUpcoming = showAllUpcoming ? upcoming : upcoming.slice(0, 3)
            const newestFirst = completed.map((milestone, index) => ({ milestone, number: index + 1 })).reverse()
            return <>
              {completed.length > 0 && <section className="client-build-journey" aria-labelledby="client-build-journey-title">
                <span className="client-section-eyebrow">Progress photos</span>
                <h2 id="client-build-journey-title">Build journey</h2>
                <p className="client-build-journey-intro">{completed.length} milestone{completed.length === 1 ? '' : 's'} completed · newest first{completed.length > 2 ? ' · scroll for more' : ''}</p>
                <ol className="client-journey-list is-carousel">
                  {newestFirst.map(({ milestone, number: index }) => <li key={milestone.id} className="client-journey-item">
                    <div className={`client-journey-body${milestone.photoStoragePath ? ' has-photo' : ''}`}>
                      {milestone.photoStoragePath && <div className="client-journey-photo"><ClientMilestonePhoto milestoneName={milestone.name} storagePath={milestone.photoStoragePath} /></div>}
                      <div className="client-journey-copy">
                        <small>Milestone {index} · {milestone.actualDate ? formatDate(milestone.actualDate) : 'Completed'}</small>
                        <strong>{milestone.name}</strong>
                        <span className="client-journey-done"><Check size={12} aria-hidden="true" />Completed</span>
                        {!milestone.photoStoragePath && <span className="client-journey-no-photo">No photo shared for this milestone</span>}
                      </div>
                    </div>
                  </li>)}
                </ol>
              </section>}
              <section className="client-project-timeline" aria-labelledby="client-project-timeline-title">
                <span className="client-section-eyebrow">Schedule</span>
                <h2 id="client-project-timeline-title">{completed.length ? 'Up next' : 'Project status timeline'}</h2>
                {upcoming.length ? <ol className="client-milestone-list">
                  {visibleUpcoming.map((milestone) => (
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
                      <span className="client-milestone-date">{milestone.plannedDate ? `Target ${formatDate(milestone.plannedDate)}` : 'Date not set'}</span>
                    </li>
                  ))}
                </ol> : null}
                {upcoming.length > 3 && <button type="button" className="client-show-more" onClick={() => setShowAllUpcoming((value) => !value)}>{showAllUpcoming ? 'Show less' : `Show all ${upcoming.length} upcoming milestones`}</button>}
                {!upcoming.length && <p className="client-empty-note">{project.milestones.length ? 'All milestones are complete.' : 'No project milestones have been shared yet.'}</p>}
              </section>
            </>
          })()}
        </>}
        {tab === 'Billing & payments' && (() => {
          const changeOrderContractIds = new Set(project.changeOrders.filter((order) => order.status === 'approved' && order.contractId).map((order) => order.contractId))
          const ocpValue = project.contractPrice
          const ocpBilled = project.downPaymentAmount + project.billings.filter((billing) => !changeOrderContractIds.has(billing.contractId)).reduce((sum, billing) => sum + billing.amount, 0)
          const ocpPaid = project.payments.filter((payment) => !changeOrderContractIds.has(payment.contractId)).reduce((sum, payment) => sum + payment.amount, 0)
          const coValue = project.changeOrders.filter((order) => order.status === 'approved').reduce((sum, order) => sum + order.amount, 0)
          const coBilled = project.changeOrders.filter((order) => order.status === 'approved' && order.contractId).reduce((sum, order) => sum + order.amount, 0)
          const coPaid = project.payments.filter((payment) => changeOrderContractIds.has(payment.contractId)).reduce((sum, payment) => sum + payment.amount, 0)
          const groups = [
            { key: 'ocp', title: 'Original contract price', caption: 'OCP', value: ocpValue, billed: ocpBilled, paid: ocpPaid },
            { key: 'co', title: 'Change orders', caption: `${project.changeOrders.filter((order) => order.status === 'approved').length} approved`, value: coValue, billed: coBilled, paid: coPaid },
          ]
          return <section className="client-billing-summary" aria-label="Billing and payments summary">
            {groups.map((group) => {
              const balance = Math.max(0, group.billed - group.paid)
              const paidPercent = group.billed > 0 ? Math.min(100, Math.round(group.paid / group.billed * 100)) : 0
              return <article className="client-billing-summary-card" key={group.key}>
                <header><span><small>{group.caption}</small><strong>{group.title}</strong></span><b>{wholePeso(group.value)}</b></header>
                <dl>
                  <div><dt>Total billed</dt><dd>{wholePeso(group.billed)}</dd></div>
                  <div><dt>Total paid</dt><dd className="is-paid">{wholePeso(group.paid)}</dd></div>
                  {group.paid > group.billed
                    ? <div><dt>Advance / credit</dt><dd className="is-paid">{wholePeso(group.paid - group.billed)}</dd></div>
                    : <div><dt>Balance</dt><dd className={balance > 0 ? 'is-due' : ''}>{wholePeso(balance)}</dd></div>}
                </dl>
                <span className="client-project-home-progress is-paid"><span style={{ width: `${paidPercent}%` }} /></span>
                <small>{group.billed > 0 ? `${paidPercent}% of billed amount paid` : 'Nothing billed yet'}</small>
              </article>
            })}
            <article className="client-billing-summary-total">
              <span><small>Total billed</small><strong>{wholePeso(ocpBilled + coBilled)}</strong></span>
              <span><small>Total paid</small><strong>{wholePeso(ocpPaid + coPaid)}</strong></span>
              <span><small>Total balance</small><strong>{wholePeso(Math.max(0, ocpBilled - ocpPaid) + Math.max(0, coBilled - coPaid))}</strong></span>
            </article>
          </section>
        })()}
        {tab === 'Billing & payments' && <div className="client-finance-grid">
          <section className="client-portal-section"><h2>Billings</h2>{project.billings.length || project.downPaymentAmount > 0 ? <div className="client-record-list">
            {billingPdfError && <p className="form-error" role="alert">{billingPdfError}</p>}
            {documentError && <p className="form-error" role="alert">{documentError}</p>}
            {project.downPaymentAmount > 0 && <div className="client-finance-row"><span className="client-record-icon"><FileText size={16} /></span><span><strong>Contract down payment <ClientPayStatus amount={project.downPaymentAmount} outstanding={downPaymentReceivable?.outstandingAmount ?? 0} daysOverdue={downPaymentReceivable?.daysOverdue ?? 0} /></strong><small>{downPaymentPercent === undefined ? 'Part of contract' : `${downPaymentPercent}% of contract`}{downPaymentReceivable?.outstandingAmount ? ` · ${money.format(downPaymentReceivable.outstandingAmount)} outstanding` : ''}</small></span><strong className="client-record-amount">{money.format(project.downPaymentAmount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label="Preview contract down-payment billing" title="Preview down-payment billing PDF" onClick={() => { setBillingPdfError(''); void openBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingType: 'down-payment', amount: project.downPaymentAmount, downPaymentPercent, progressPercent: 0, issuedAt: project.createdAt, dueAt: null }).catch((pdfError: unknown) => setBillingPdfError(pdfError instanceof Error ? pdfError.message : 'Could not preview the down-payment billing PDF.')) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label="Download contract down-payment billing" title="Download down-payment billing PDF" onClick={() => { setBillingPdfError(''); void downloadBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingType: 'down-payment', amount: project.downPaymentAmount, downPaymentPercent, progressPercent: 0, issuedAt: project.createdAt, dueAt: null }).catch((pdfError: unknown) => setBillingPdfError(pdfError instanceof Error ? pdfError.message : 'Could not download the down-payment billing PDF.')) }}><Download size={15} /></button></div></div>}
            {project.changeOrders.filter((order) => order.status === 'approved' && order.contractId).map((order) => {
              const receivable = projectOutstandingItems.find((item) => item.id === `change-order:${order.id}`)
              const fileName = `${formatChangeOrderNumber(project.prefix, order.orderNumber)}.pdf`
              const changeOrderDocument = order.pdfStoragePath ? {
                id: order.id,
                fileName,
                storagePath: order.pdfStoragePath,
                createdAt: order.createdAt,
                documentType: 'change order',
              } : null
              return <div className="client-finance-row" key={`change-order:${order.id}`}><span className="client-record-icon"><FileText size={16} /></span><span><strong>Change order · {formatChangeOrderNumber(project.prefix, order.orderNumber)} <ClientPayStatus amount={order.amount} outstanding={receivable?.outstandingAmount ?? 0} daysOverdue={receivable?.daysOverdue ?? 0} /></strong><small>{order.title}{receivable?.outstandingAmount ? ` · ${money.format(receivable.outstandingAmount)} outstanding` : ''}</small></span><strong className="client-record-amount">{money.format(order.amount)}</strong>{changeOrderDocument && <div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview change order ${formatChangeOrderNumber(project.prefix, order.orderNumber)} PDF`} title="Preview change-order PDF" disabled={downloadingDocument === order.id} onClick={() => { void openDocument(changeOrderDocument) }}>{downloadingDocument === order.id ? <RefreshCw size={15} /> : <Eye size={15} />}</button><button type="button" className="client-download-button" aria-label={`Download change order ${formatChangeOrderNumber(project.prefix, order.orderNumber)} PDF`} title="Download change-order PDF" disabled={downloadingDocument === order.id} onClick={() => { void openDocument(changeOrderDocument, true) }}><Download size={15} /></button></div>}</div>
            })}
            {project.billings.map((billing) => { const receivable = projectOutstandingItems.find((item) => item.id === billing.id); return <div className="client-finance-row" key={billing.id}><span className="client-record-icon"><FileText size={16} /></span><span><strong>Billing #{formatBillingNumber(billing.number)} <ClientPayStatus amount={billing.amount} outstanding={receivable?.outstandingAmount ?? 0} daysOverdue={receivable?.daysOverdue ?? 0} /></strong><small>{formatDate(billing.issuedAt)} · {billing.progress}% complete{billing.dueAt ? ` · due ${formatDate(billing.dueAt)}` : ''}</small></span><strong className="client-record-amount">{money.format(billing.amount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview billing ${formatBillingNumber(billing.number)}`} title="Preview billing PDF" onClick={() => { void openBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingNumber: billing.number, amount: billing.amount, progressPercent: billing.progress, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label={`Download billing ${formatBillingNumber(billing.number)}`} title="Download billing PDF" onClick={() => { void downloadBillingPdf({ projectName: project.name, clientName: project.clientName, location: project.location, billingNumber: billing.number, amount: billing.amount, progressPercent: billing.progress, issuedAt: billing.issuedAt ?? new Date().toISOString(), dueAt: billing.dueAt }) }}><Download size={15} /></button></div></div> })}
          </div> : <p className="client-empty-note">No billings have been issued yet.</p>}</section>
          <section className="client-portal-section"><h2>Payment history</h2>{project.payments.length > 0 && (() => {
            const total = project.payments.reduce((sum, payment) => sum + payment.amount, 0)
            const latest = [...project.payments].sort((x, y) => y.receivedAt.localeCompare(x.receivedAt))[0]
            const byType = Object.entries(project.payments.reduce<Record<string, { amount: number; count: number }>>((groups, payment) => {
              const entry = groups[payment.paymentType] ?? { amount: 0, count: 0 }
              groups[payment.paymentType] = { amount: entry.amount + payment.amount, count: entry.count + 1 }
              return groups
            }, {})).sort(([, x], [, y]) => y.amount - x.amount)
            return <div className="client-payment-summary">
              <div className="client-payment-summary-head">
                <span><small>Total received</small><strong>{wholePeso(total)}</strong></span>
                <span><small>Payments</small><strong>{project.payments.length}</strong></span>
                <span><small>Last payment</small><strong>{formatDate(latest.receivedAt)}</strong><em>{wholePeso(latest.amount)}</em></span>
              </div>
              <ul className="client-payment-summary-types">
                {byType.map(([type, entry]) => <li key={type}>
                  <span><i style={{ width: `${total > 0 ? Math.max(3, Math.round(entry.amount / total * 100)) : 0}%` }} /></span>
                  <small>{formatPaymentType(type as Parameters<typeof formatPaymentType>[0])} · {entry.count}</small>
                  <b>{wholePeso(entry.amount)}</b>
                </li>)}
              </ul>
            </div>
          })()}{project.payments.length ? <div className="client-record-list client-payment-history-list" role="region" aria-label="Payment history" tabIndex={0}>{project.payments.map((payment) => {
            const receiptDetails = {
              projectName: project.name,
              payerName: payment.payerName,
              receiptNumber: payment.receiptNumber,
              amount: payment.amount,
              receivedDate: payment.receivedAt,
              paymentType: payment.paymentType,
              changeOrderLabel: payment.paymentType === 'change_order' ? changeOrderReceiptLabel(payment.contractId) : undefined,
              billingAllocations: project.allocations
                .filter((allocation) => allocation.paymentId === payment.id)
                .flatMap((allocation) => {
                  const billing = project.billings.find((item) => item.id === allocation.billingId)
                  return billing ? [{ billingNumber: formatBillingNumber(billing.number) }] : []
                }),
              paymentMode: payment.paymentMode,
              reference: payment.reference,
            }
            return <div className="client-finance-row" key={payment.id}><span className="client-record-icon"><ArrowDownLeft size={16} /></span><span><strong>{payment.receiptNumber || 'Payment received'}</strong><small>{formatDate(payment.receivedAt)} · {formatPaymentType(payment.paymentType)} · {payment.reference || payment.payerName}</small></span><strong className="client-record-amount">{money.format(payment.amount)}</strong><div className="client-download-actions"><button type="button" className="client-download-button" aria-label={`Preview receipt ${payment.receiptNumber}`} title="Preview payment receipt" onClick={() => { void openPaymentReceiptPdf(receiptDetails) }}><Eye size={15} /></button><button type="button" className="client-download-button" aria-label={`Download receipt ${payment.receiptNumber}`} title="Download payment receipt" onClick={() => { void downloadPaymentReceiptPdf(receiptDetails) }}><Download size={15} /></button></div></div>
          })}</div> : <p className="client-empty-note">No payments have been recorded yet.</p>}</section>
        </div>}
        {tab === 'Change orders' && <section className={`client-portal-section client-change-orders-section${project.changeOrders.length ? '' : ' is-empty'}`}>
          <h2>Change orders</h2>
          {project.changeOrders.some((order) => order.status === 'approved') && <p className="client-change-order-total">
            <b>{project.changeOrders.filter((order) => order.status === 'approved').length} approved</b> · {wholePeso(project.changeOrders.filter((order) => order.status === 'approved').reduce((sum, order) => sum + order.amount, 0))} added to your contract
          </p>}
          {project.changeOrders.some((order) => order.status === 'pending_approval') && <p className="client-empty-note">Review the change-order PDF before deciding. Approving records your sign-off; reject it if changes are needed.</p>}
          {changeOrderError && <p className="form-error" role="alert">{changeOrderError}</p>}
          {documentError && <p className="form-error" role="alert">{documentError}</p>}
          {project.changeOrders.length > 0
            ? <div className="client-change-order-cards">{[...project.changeOrders].sort((a, b) => Number(b.status === 'pending_approval') - Number(a.status === 'pending_approval') || b.orderNumber - a.orderNumber).map((order) => {
              const pdfStoragePath = order.pdfStoragePath
              return <article className={`client-change-order-row${order.status === 'pending_approval' ? ' is-pending' : ''}`} key={order.id}>
                <div className="client-change-order-copy">
                  <span className="client-change-order-tags">
                    <span className={`client-pay-status ${order.status === 'pending_approval' ? 'is-due' : 'is-approved'}`}>{order.status === 'pending_approval' ? 'Needs your approval' : 'Approved'}</span>
                    {order.status === 'approved' && (() => {
                      const receivable = projectOutstandingItems.find((item) => item.id === `change-order:${order.id}`)
                      return <ClientPayStatus amount={order.amount} outstanding={receivable?.outstandingAmount ?? 0} daysOverdue={receivable?.daysOverdue ?? 0} />
                    })()}
                  </span>
                  <strong>{formatChangeOrderNumber(project.prefix, order.orderNumber)} · {order.title}</strong>
                  {order.description && <p>{order.description}</p>}
                  <small>{order.status === 'pending_approval' ? `Submitted ${formatDate(order.createdAt)}` : `Approved ${formatDate(order.approvedAt || order.createdAt)}`}</small>
                </div>
                <span className="client-change-order-amount">
                  <strong className="client-record-amount">{money.format(order.amount)}</strong>
                  {order.status === 'approved' && (() => {
                    const outstanding = projectOutstandingItems.find((item) => item.id === `change-order:${order.id}`)?.outstandingAmount ?? 0
                    return outstanding > 0 ? <small>{money.format(outstanding)} outstanding</small> : null
                  })()}
                </span>
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
            ? <div className="client-document-groups">{Object.entries(project.documents.reduce<Record<string, typeof project.documents>>((groups, document) => {
              const key = document.documentType.replaceAll('_', ' ') || 'other'
              groups[key] = [...(groups[key] ?? []), document]
              return groups
            }, {})).sort(([a], [b]) => a.localeCompare(b)).map(([group, documents]) => <div className="client-document-group" key={group}>
              <h3>{group}<span>{documents.length}</span></h3>
              <div className="client-record-list">{[...documents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((document) => (
              <div className="client-finance-row" key={document.id}>
                <span className={`client-file-badge is-${documentKind(document.fileName).toLowerCase()}`}>{documentKind(document.fileName)}</span>
                <span><strong>{document.fileName}{Date.now() - new Date(document.createdAt).getTime() < 7 * 86_400_000 && <span className="client-new-tag">New</span>}</strong><small>Shared {formatDate(document.createdAt)}</small></span>
                <div className="client-download-actions">
                  <button type="button" className="client-download-button" aria-label={`View ${document.fileName}`} title="View document" disabled={downloadingDocument === document.id} onClick={() => { void openDocument(document) }}>{downloadingDocument === document.id ? <RefreshCw size={15} /> : <Eye size={15} />}</button>
                  <button type="button" className="client-download-button" aria-label={`Download ${document.fileName}`} title="Download document" disabled={downloadingDocument === document.id} onClick={() => { void openDocument(document, true) }}><Download size={15} /></button>
                </div>
              </div>
            ))}</div>
            </div>)}</div>
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