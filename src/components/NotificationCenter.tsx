import { useEffect, useRef, useState } from 'react'
import { Bell, CalendarDays, CircleAlert, X } from 'lucide-react'
import type { PortfolioProject } from '../data/portfolio'
import type { ReceivableAgingItem } from '../finance/receivables-aging'
import { buildDashboardNotifications } from '../finance/dashboard-notifications'

export function NotificationCenter({ projects, receivables, onOpenProject }: {
  projects: PortfolioProject[]
  receivables: ReceivableAgingItem[]
  onOpenProject: (projectId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const container = useRef<HTMLDivElement>(null)
  const notifications = buildDashboardNotifications(projects, receivables)

  useEffect(() => {
    if (!isOpen) return
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.document.addEventListener('pointerdown', closeOnOutsideClick)
    window.document.addEventListener('keydown', closeOnEscape)
    return () => {
      window.document.removeEventListener('pointerdown', closeOnOutsideClick)
      window.document.removeEventListener('keydown', closeOnEscape)
    }
  }, [isOpen])

  const countLabel = notifications.length === 1 ? '1 active alert' : `${notifications.length} active alerts`

  return <div className="notification-center" ref={container}>
    <button
      className={`icon-button notification-button ${notifications.length ? 'has-notifications' : ''}`}
      type="button"
      aria-label={`Notifications, ${countLabel}`}
      aria-expanded={isOpen}
      aria-controls="dashboard-notifications"
      title={countLabel}
      onClick={() => setIsOpen((open) => !open)}
    >
      <Bell size={17} />
      {notifications.length > 0 && <span className="notification-count">{notifications.length > 99 ? '99+' : notifications.length}</span>}
    </button>
    {isOpen && <section className="notification-panel" id="dashboard-notifications" aria-label="Project notifications">
      <div className="notification-panel-heading"><div><div className="section-kicker">Project alerts</div><h2>Notifications</h2></div><button type="button" className="icon-button" aria-label="Close notifications" onClick={() => setIsOpen(false)}><X size={16} /></button></div>
      {notifications.length ? <div className="notification-list">{notifications.map((notification) => <button
        type="button"
        className={`notification-row notification-${notification.priority}`}
        key={notification.id}
        onClick={() => { setIsOpen(false); onOpenProject(notification.projectId) }}
      >
        <span className="notification-icon">{notification.category === 'deadline' ? <CalendarDays size={16} /> : <CircleAlert size={16} />}</span>
        <span className="notification-copy"><strong>{notification.projectName} · {notification.title}</strong><small>{notification.detail}</small></span>
      </button>)}</div> : <div className="notification-empty"><Bell size={16} /><span>No overdue bills or approaching deadlines.</span></div>}
      <p className="notification-footnote">Alerts update with your project deadlines and unpaid issued billings.</p>
    </section>}
  </div>
}