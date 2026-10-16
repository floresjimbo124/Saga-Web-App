import { type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { FileText, X } from 'lucide-react'
import { MoneyInput } from '../components/MoneyInput'
import { parseMoneyInput } from '../lib/money-input'
import { setupMoney, type Project } from './project-shared'


export type ProjectSetupDialogProps = {
  project: Project
  client: string
  setClient: (value: string) => void
  contract: string
  setContract: (value: string) => void
  discount: string
  setDiscount: (value: string) => void
  startDate: string
  setStartDate: (value: string) => void
  deadline: string
  setDeadline: (value: string) => void
  downPayment: string
  setDownPayment: (value: string) => void
  retentionRate: string
  setRetentionRate: (value: string) => void
  retentionMethod: 'final_schedule' | 'per_billing'
  setRetentionMethod: (value: 'final_schedule' | 'per_billing') => void
  error: string
  saving: boolean
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
  onClose: () => void
}

export function ProjectSetupDialog({ project, client, setClient, contract, setContract, discount, setDiscount, startDate, setStartDate, deadline, setDeadline, downPayment, setDownPayment, retentionRate, setRetentionRate, retentionMethod, setRetentionMethod, error, saving, onSubmit, onClose }: ProjectSetupDialogProps) {
  const setupContractValue = parseMoneyInput(contract)
  const setupDiscountValue = parseMoneyInput(discount)
  const setupNet = Math.max(0, (Number.isFinite(setupContractValue) ? setupContractValue : 0) - (Number.isFinite(setupDiscountValue) ? setupDiscountValue : 0))
  return createPortal(<div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="project-modal setup-dialog" role="dialog" aria-modal="true" aria-labelledby="setup-project-title"><div className="modal-heading"><div><div className="section-kicker">Project financial setup</div><h2 id="setup-project-title">{project.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close" disabled={saving}><X size={18} /></button></div><form onSubmit={onSubmit} className="setup-form">
      <fieldset className="setup-group"><legend>Client</legend>
        <label className="form-field">Client name<input autoFocus value={client} onChange={(event) => setClient(event.target.value)} placeholder="Enter the actual client name" minLength={2} required /></label>
      </fieldset>
      <fieldset className="setup-group"><legend>Contract</legend>
        <div className="form-row"><label className="form-field">Contract amount<MoneyInput min="0.01" step="0.01" value={contract} onChange={setContract} placeholder="0.00" required /></label><label className="form-field">Special discount<MoneyInput min="0" step="0.01" value={discount} onChange={setDiscount} required /></label></div>
        <p className="setup-preview"><span>Net contract</span><strong>{setupMoney.format(setupNet)}</strong></p>
      </fieldset>
      <fieldset className="setup-group"><legend>Schedule</legend>
        <div className="form-row"><label className="form-field">Start date<input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label><label className="form-field">Target date<input type="date" value={deadline} min={startDate || undefined} onChange={(event) => setDeadline(event.target.value)} /></label></div>
        {startDate && deadline && deadline > startDate && <p className="setup-preview"><span>Duration</span><strong>{Math.round((new Date(`${deadline}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86_400_000)} calendar days</strong></p>}
      </fieldset>
      <fieldset className="setup-group"><legend>Payment terms</legend>
        <div className="form-row"><label className="form-field">Down payment<span className="setup-suffix-input"><input type="number" min="0" max="100" step="0.5" value={downPayment} onChange={(event) => setDownPayment(event.target.value)} required /><span>%</span></span></label>
          <div className="form-field"><span>Retention rate</span><div className="setup-segment" role="radiogroup" aria-label="Retention rate">{[{ value: '5', label: '5%', hint: 'Default' }, { value: '10', label: '10%', hint: 'Client request' }].map((option) => <button key={option.value} type="button" role="radio" aria-checked={retentionRate === option.value} className={retentionRate === option.value ? 'is-selected' : ''} onClick={() => setRetentionRate(option.value)}><strong>{option.label}</strong><small>{option.hint}</small></button>)}</div></div></div>
        {setupNet > 0 && Number.isFinite(Number(downPayment)) && <p className="setup-preview"><span>Down payment amount</span><strong>{setupMoney.format(setupNet * Number(downPayment) / 100)}</strong></p>}
        <div className="form-field"><span>Retention method</span><div className="setup-choice" role="radiogroup" aria-label="Retention method">
          <button type="button" role="radio" aria-checked={retentionMethod === 'final_schedule'} className={retentionMethod === 'final_schedule' ? 'is-selected' : ''} onClick={() => setRetentionMethod('final_schedule')}><strong>Final payment schedule</strong><small>Collected once at the end</small></button>
          <button type="button" role="radio" aria-checked={retentionMethod === 'per_billing'} className={retentionMethod === 'per_billing' ? 'is-selected' : ''} onClick={() => setRetentionMethod('per_billing')}><strong>Deduct from each billing</strong><small>Held back from every progress billing</small></button>
        </div></div>
      </fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" className="button button-primary" disabled={saving} aria-busy={saving}><FileText size={15} />{saving ? 'Saving…' : 'Save contract setup'}</button></div></form></section></div>, document.body)
}

