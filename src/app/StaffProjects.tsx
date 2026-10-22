import { useCallback, useEffect, useState } from 'react'
import { CalendarDays, ChevronRight, FolderKanban, Lock } from 'lucide-react'
import { loadPortfolio, type PortfolioPayment, type PortfolioProject } from '../data/portfolio'
import type { ReceivableAgingItem } from '../finance/receivables-aging'
import { EmptyArt, SkeletonRows } from '../components/Motion'
import { ProjectDetail } from './ProjectDetail'
import { ProjectPermissionsContext } from './project-permissions'
import { projectDate, type ProjectDetailTab } from './project-shared'

/**
 * Projects page for assigned staff (liaison officer, engineer): the projects the owner assigned
 * to them, opened in the owner's project view with editing switched off. The database only
 * returns assigned projects and rejects edits, so this screen just mirrors those rules.
 */
export function StaffProjects() {
  const [projects, setProjects] = useState<PortfolioProject[]>([])
  const [payments, setPayments] = useState<PortfolioPayment[]>([])
  const [receivables, setReceivables] = useState<ReceivableAgingItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<ProjectDetailTab>('Overview')

  const refresh = useCallback(async (showLoading = true) => {
    if (showLoading) setIsLoading(true)
    try {
      const portfolio = await loadPortfolio()
      setProjects(portfolio.projects)
      setPayments(portfolio.payments)
      setReceivables(portfolio.receivables)
      setError('')
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load your projects.')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const selected = projects.find((project) => project.id === selectedId) ?? null

  if (selected) {
    return <ProjectPermissionsContext.Provider value={{ canEdit: false }}>
      <p className="staff-project-note" role="note"><Lock size={14} aria-hidden="true" />You can view everything and add new records. Editing and deleting stay with the owner.</p>
      <ProjectDetail
        project={selected}
        tab={tab}
        setTab={setTab}
        payments={payments.filter((payment) => payment.projectId === selected.id)}
        receivables={receivables.filter((item) => item.projectId === selected.id)}
        onBack={() => { setSelectedId(null); setTab('Overview') }}
        onSetup={() => undefined}
        onChanged={() => { void refresh(false) }}
        onProjectStateChange={async () => undefined}
      />
    </ProjectPermissionsContext.Provider>
  }

  return <section className="staff-projects">
    <div className="page-heading">
      <div><div className="eyebrow"><span className="eyebrow-rule" />Team workspace</div><h1>Projects</h1><p className="act-intro">Projects the owner has given you access to.</p></div>
    </div>
    {error && <p className="form-error" role="alert">{error} <button type="button" className="text-button" onClick={() => { void refresh() }}>Retry</button></p>}
    {isLoading ? <SkeletonRows rows={3} label="Loading projects" />
      : projects.length ? <div className="staff-project-list">{projects.map((project) => <button type="button" key={project.id} className="staff-project-card" onClick={() => { setSelectedId(project.id); setTab('Overview') }}>
        <span className="staff-project-icon" aria-hidden="true"><FolderKanban size={18} /></span>
        <span className="staff-project-copy">
          <strong>{project.name}</strong>
          <small>{project.client}{project.location ? ` · ${project.location}` : ''}</small>
          <span className="staff-project-progress"><span><i style={{ width: `${Math.min(100, project.progress)}%` }} /></span><b>{project.progress}%</b></span>
        </span>
        <span className="staff-project-deadline"><CalendarDays size={14} aria-hidden="true" />{project.deadline ? projectDate(project.deadline) : 'No target date'}</span>
        <ChevronRight size={16} className="staff-project-chevron" aria-hidden="true" />
      </button>)}</div>
        : <div className="pr-empty"><EmptyArt kind="blueprint" /><strong>No projects yet</strong><p>When the owner gives you access to a project, it will appear here.</p></div>}
  </section>
}
