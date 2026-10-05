import { useState, type FormEvent } from 'react'
import { Save } from 'lucide-react'
import { updateProjectCostForecast } from '../data/portfolio'
import { calculateProfitRisk } from '../finance/profit-risk'
import { MoneyInput } from './MoneyInput'
import { parseMoneyInput } from '../lib/money-input'

const money = new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP', maximumFractionDigits: 0 })

export function ProjectForecastPanel({
  projectId,
  contractValue,
  recordedCosts,
  costBudget,
  estimatedCostToComplete,
  onChanged,
}: {
  projectId: string
  contractValue: number
  recordedCosts: number
  costBudget: number | null
  estimatedCostToComplete: number | null
  onChanged: () => void
}) {
  const [budgetInput, setBudgetInput] = useState(costBudget === null ? '' : String(costBudget))
  const [estimateInput, setEstimateInput] = useState(estimatedCostToComplete === null ? '' : String(estimatedCostToComplete))
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const budget = budgetInput === '' ? null : parseMoneyInput(budgetInput)
  const estimate = estimateInput === '' ? null : parseMoneyInput(estimateInput)
  const forecast = calculateProfitRisk({
    contractValue,
    recordedCosts,
    costBudget: budget,
    estimatedCostToComplete: estimate,
  })

  const saveForecast = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (budget === null || estimate === null || !Number.isFinite(budget) || !Number.isFinite(estimate) || budget < 0 || estimate < 0) {
      setError('Enter a non-negative budget and estimated remaining cost.')
      return
    }
    setError('')
    setMessage('')
    setIsSaving(true)
    try {
      await updateProjectCostForecast({ projectId, costBudget: budget, estimatedCostToComplete: estimate })
      setMessage('Forecast saved.')
      onChanged()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the project forecast.')
    } finally {
      setIsSaving(false)
    }
  }

  return <section className="surface-card tab-content project-forecast-panel">
    <div className="card-heading-row"><div><div className="section-kicker">Cost planning</div><h2>Project profit forecast</h2></div><span className={`status-badge profit-risk-${forecast.level}`}><span />{forecast.label}</span></div>
    <p className="forecast-intro">Set the planned total cost and estimate the cost still needed to finish. Forecast profit uses approved contract value and recorded project expenses.</p>
    <form className="forecast-form" onSubmit={(event) => { void saveForecast(event) }}>
      <label className="form-field">Total project cost budget<MoneyInput min="0" step="0.01" value={budgetInput} onChange={setBudgetInput} placeholder="0.00" required /></label>
      <label className="form-field">Estimated cost to complete<MoneyInput min="0" step="0.01" value={estimateInput} onChange={setEstimateInput} placeholder="0.00" required /></label>
      <button className="button button-primary" type="submit" disabled={isSaving}><Save size={15} />{isSaving ? 'Saving…' : 'Save forecast'}</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="document-success" role="status">{message}</p>}
    <div className="forecast-summary">
      <div><span>Recorded costs</span><strong>{money.format(recordedCosts)}</strong><p>Expenses already recorded for this project.</p></div>
      <div><span>Projected final cost</span><strong>{forecast.projectedCost === null ? 'Not rated' : money.format(forecast.projectedCost)}</strong><p>Recorded costs plus your estimated cost to complete.</p></div>
      <div><span>Projected profit</span><strong>{forecast.projectedProfit === null ? 'Not rated' : money.format(forecast.projectedProfit)}</strong><p>Contract value minus projected final cost.</p></div>
      <div><span>Projected margin</span><strong>{forecast.projectedMarginPercent === null ? 'Not rated' : `${forecast.projectedMarginPercent.toFixed(1)}%`}</strong><p>Projected profit as a percentage of contract value.</p></div>
      <div><span>Budget variance</span><strong className={forecast.budgetVariance !== null && forecast.budgetVariance > 0 ? 'forecast-over-budget' : ''}>{forecast.budgetVariance === null ? 'Not rated' : forecast.budgetVariance > 0 ? `${money.format(forecast.budgetVariance)} over` : `${money.format(Math.abs(forecast.budgetVariance))} under`}</strong><p>Projected final cost compared with your total cost budget.</p></div>
    </div>
    <p className="forecast-note">Low: projected margin at least 20% and on budget. Medium: margin below 20% or up to 10% over budget. High: margin below 10% or more than 10% over budget. A complete budget and remaining-cost estimate are needed for a rating.</p>
  </section>
}