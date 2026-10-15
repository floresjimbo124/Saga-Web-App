import { ArrowRight, TrendingDown, TrendingUp } from 'lucide-react'
import { calculateProfitRisk } from '../finance/profit-risk'
import { calculateCostPace } from '../finance/cost-pace'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })

export function ProjectProfitCard({ contractValue, recordedCosts, costBudget, estimatedCostToComplete, progressPercent, onOpenForecast, onOpenExpenses }: {
  contractValue: number
  recordedCosts: number
  costBudget: number | null
  estimatedCostToComplete: number | null
  progressPercent: number
  onOpenForecast: () => void
  onOpenExpenses: () => void
}) {
  const forecast = calculateProfitRisk({ contractValue, recordedCosts, costBudget, estimatedCostToComplete })
  const pace = calculateCostPace({ costBudget, recordedCosts, progressPercent })
  const isRated = forecast.projectedProfit !== null && forecast.projectedMarginPercent !== null
  const isLoss = isRated && (forecast.projectedProfit ?? 0) < 0
  const marginTone = !isRated ? 'neutral' : forecast.tone === 'green' ? 'good' : forecast.tone === 'gold' ? 'thin' : 'bad'
  const marginLabel = !isRated ? 'Not rated' : isLoss ? 'Projected loss' : marginTone === 'good' ? 'Healthy margin' : marginTone === 'thin' ? 'Thin margin' : 'At risk'

  return <section className={`surface-card project-profit-card is-${marginTone}`} aria-labelledby="project-profit-title">
    <div className="card-heading-row">
      <div><div className="section-kicker">Profit &amp; cost</div><h2 id="project-profit-title">Is this project making money?</h2></div>
      <span className={`project-profit-badge is-${marginTone}`}>{isLoss ? <TrendingDown size={14} /> : <TrendingUp size={14} />}{marginLabel}</span>
    </div>

    <div className="project-profit-body">
      <dl className="project-profit-lines">
        <div><dt>Contract value <small>incl. approved change orders</small></dt><dd>{money.format(contractValue)}</dd></div>
        <div><dt>Costs to date <small>expenses + payroll</small></dt><dd>− {money.format(recordedCosts)}</dd></div>
        <div><dt>Est. cost to complete</dt><dd>{estimatedCostToComplete === null ? <button type="button" className="text-button" onClick={onOpenForecast}>Set estimate</button> : `− ${money.format(estimatedCostToComplete)}`}</dd></div>
        <div className="is-total"><dt>Projected profit</dt><dd>{isRated ? money.format(forecast.projectedProfit ?? 0) : '—'}</dd></div>
      </dl>

      <div className="project-profit-side">
        <div className="project-profit-margin">
          <small>Projected margin</small>
          <strong>{isRated ? `${(forecast.projectedMarginPercent ?? 0).toFixed(1)}%` : '—'}</strong>
          {forecast.budgetVariance !== null && <span className={forecast.budgetVariance > 0 ? 'is-over' : ''}>{forecast.budgetVariance > 0 ? `${money.format(forecast.budgetVariance)} over budget` : `${money.format(Math.abs(forecast.budgetVariance))} under budget`}</span>}
        </div>

        <div className={`project-cost-pace is-${pace.level}`}>
          <div className="project-cost-pace-head"><small>Cost vs progress</small><b>{pace.label}</b></div>
          <div className="project-cost-pace-row"><span>Budget used</span><span className="project-cost-pace-track is-cost"><i style={{ width: `${Math.min(100, pace.budgetUsedPercent ?? 0)}%` }} /></span><em>{pace.budgetUsedPercent === null ? '—' : `${Math.round(pace.budgetUsedPercent)}%`}</em></div>
          <div className="project-cost-pace-row"><span>Work done</span><span className="project-cost-pace-track"><i style={{ width: `${pace.progressPercent}%` }} /></span><em>{Math.round(pace.progressPercent)}%</em></div>
          <p>{pace.detail}</p>
        </div>
      </div>
    </div>

    {(!isRated || recordedCosts === 0) && <div className="project-profit-setup">
      {!isRated && <button type="button" onClick={onOpenForecast}>Set cost budget &amp; estimate to complete <ArrowRight size={13} /></button>}
      {recordedCosts === 0 && <button type="button" onClick={onOpenExpenses}>No expenses recorded yet — add expenses <ArrowRight size={13} /></button>}
    </div>}
  </section>
}
