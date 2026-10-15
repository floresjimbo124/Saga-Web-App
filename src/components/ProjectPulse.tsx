import { AlertTriangle, ArrowRight, CalendarClock, CheckCircle2, Coins, Wallet } from 'lucide-react'
import type { ProjectMilestone } from '../data/project-milestones'
import { calculateCostPace } from '../finance/cost-pace'

type Tone = 'good' | 'warn' | 'bad' | 'muted'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })
const DAY = 86_400_000

function dayStart(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`).getTime()
}

export type PulseTab = 'Milestones' | 'Change orders' | 'Billings' | 'Payments' | 'Expenses' | 'Forecast'

/** At-a-glance schedule, budget and cash status plus the next things to act on. */
export function ProjectPulse({ progress, startDate, deadline, isClosed, milestones, costBudget, recordedCosts, outstanding, pendingChangeOrders, onOpenTab }: {
  progress: number
  startDate: string | null
  deadline: string | null
  isClosed: boolean
  milestones: ProjectMilestone[]
  costBudget: number | null
  recordedCosts: number
  outstanding: number
  pendingChangeOrders: number
  onOpenTab: (tab: PulseTab) => void
}) {
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const todayTime = dayStart(todayKey)

  // Schedule: work done vs time used.
  let schedule: { tone: Tone; value: string; detail: string }
  if (isClosed) {
    schedule = { tone: 'good', value: 'Closed', detail: 'Project is no longer active' }
  } else if (!startDate || !deadline || dayStart(deadline) <= dayStart(startDate)) {
    schedule = { tone: 'muted', value: 'No target date', detail: 'Set start and target dates to track pace' }
  } else {
    const total = (dayStart(deadline) - dayStart(startDate)) / DAY
    const used = Math.min(100, Math.max(0, (todayTime - dayStart(startDate)) / DAY / total * 100))
    const daysLeft = Math.round((dayStart(deadline) - todayTime) / DAY)
    const gap = used - progress
    const left = daysLeft >= 0 ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left` : `${Math.abs(daysLeft)} day${daysLeft === -1 ? '' : 's'} past target`
    schedule = daysLeft < 0 && progress < 100
      ? { tone: 'bad', value: 'Past target', detail: `${Math.round(progress)}% done · ${left}` }
      : gap > 20
        ? { tone: 'bad', value: 'Behind', detail: `${Math.round(progress)}% done · ${Math.round(used)}% of time used · ${left}` }
        : gap > 8
          ? { tone: 'warn', value: 'Slightly behind', detail: `${Math.round(progress)}% done · ${Math.round(used)}% of time used · ${left}` }
          : { tone: 'good', value: 'On track', detail: `${Math.round(progress)}% done · ${Math.round(used)}% of time used · ${left}` }
  }

  // Budget: spending vs work done.
  const pace = calculateCostPace({ costBudget, recordedCosts, progressPercent: progress })
  const budget: { tone: Tone; value: string; detail: string } = pace.level === 'not-rated'
    ? { tone: 'warn', value: 'No budget set', detail: recordedCosts > 0 ? `${money.format(recordedCosts)} spent so far` : 'No costs recorded yet' }
    : { tone: pace.level === 'overspending' ? 'bad' : pace.level === 'watch' ? 'warn' : 'good', value: pace.label, detail: pace.detail }

  // Cash: what the client still owes.
  const cash: { tone: Tone; value: string; detail: string } = outstanding > 0
    ? { tone: 'warn', value: money.format(outstanding), detail: 'Outstanding from the client' }
    : { tone: 'good', value: 'Fully collected', detail: 'Nothing outstanding right now' }

  const overdue = milestones.filter((milestone) => milestone.plannedDate && milestone.plannedDate < todayKey && milestone.completionPercent < 100 && milestone.status !== 'complete')
  const todos: { key: string; tone: Tone; text: string; action: string; tab: PulseTab }[] = []
  if (overdue.length) todos.push({ key: 'overdue', tone: 'bad', text: `${overdue.length} milestone${overdue.length === 1 ? ' is' : 's are'} past the end date`, action: 'Review', tab: 'Milestones' })
  if (outstanding > 0) todos.push({ key: 'collect', tone: 'warn', text: `Follow up ${money.format(outstanding)} outstanding`, action: 'Billings', tab: 'Billings' })
  if (pendingChangeOrders > 0) todos.push({ key: 'co', tone: 'warn', text: `${pendingChangeOrders} change order${pendingChangeOrders === 1 ? '' : 's'} awaiting client sign-off`, action: 'View', tab: 'Change orders' })
  if (costBudget === null || costBudget <= 0) todos.push({ key: 'budget', tone: 'warn', text: 'Set a cost budget so profit can be tracked', action: 'Set budget', tab: 'Forecast' })
  if (recordedCosts <= 0 && progress > 0) todos.push({ key: 'costs', tone: 'warn', text: `${Math.round(progress)}% done but no costs recorded`, action: 'Add expenses', tab: 'Expenses' })

  const tiles = [
    { key: 'schedule', label: 'Schedule', icon: <CalendarClock size={16} />, ...schedule },
    { key: 'budget', label: 'Budget', icon: <Coins size={16} />, ...budget },
    { key: 'cash', label: 'Cash', icon: <Wallet size={16} />, ...cash },
  ]

  return <section className="pulse" aria-label="Project status at a glance">
    <div className="pulse-strip">
      {tiles.map((tile) => <div key={tile.key} className={`pulse-tile is-${tile.tone}`}>
        <span className="pulse-label">{tile.icon}{tile.label}</span>
        <strong>{tile.value}</strong>
        <small>{tile.detail}</small>
      </div>)}
    </div>
    <div className="pulse-todo">
      <h3>{todos.length ? `Needs attention · ${todos.length}` : 'Needs attention'}</h3>
      {todos.length
        ? <ul>{todos.map((todo) => <li key={todo.key} className={`is-${todo.tone}`}>
          <AlertTriangle size={15} aria-hidden="true" />
          <span>{todo.text}</span>
          <button type="button" onClick={() => onOpenTab(todo.tab)}>{todo.action}<ArrowRight size={13} /></button>
        </li>)}</ul>
        : <p className="pulse-clear"><CheckCircle2 size={16} />All clear — nothing needs action right now.</p>}
    </div>
  </section>
}
