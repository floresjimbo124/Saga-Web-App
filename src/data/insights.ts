import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export type BillingReadiness = {
  progressPercent: number
  contractValue: number
  billableCeiling: number
  billableEarned: number
  coveredAmount: number
  readyAmount: number
  progressNeededPercent: number | null
}

type ReadinessRow = {
  progress_percent: number | string
  contract_value: number | string
  billable_ceiling: number | string
  billable_earned: number | string
  covered_amount: number | string
  ready_amount: number | string
  progress_needed_percent: number | string | null
}

/** Same calculation the server uses when issuing a progress billing. */
export async function loadBillingReadiness(projectId: string): Promise<BillingReadiness | null> {
  if (!supabase) return null
  const { data, error } = await supabase.rpc('get_billing_readiness', { p_project_id: projectId })
  if (error) throw new Error(error.message)
  const row = (data as ReadinessRow[] | null)?.[0]
  if (!row) return null
  return {
    progressPercent: Number(row.progress_percent),
    contractValue: Number(row.contract_value),
    billableCeiling: Number(row.billable_ceiling),
    billableEarned: Number(row.billable_earned),
    coveredAmount: Number(row.covered_amount),
    readyAmount: Number(row.ready_amount),
    progressNeededPercent: row.progress_needed_percent === null ? null : Number(row.progress_needed_percent),
  }
}

/** Loads billing readiness and reloads whenever `refreshKey` changes. */
export function useBillingReadiness(projectId: string, refreshKey: unknown) {
  const [readiness, setReadiness] = useState<BillingReadiness | null>(null)
  useEffect(() => {
    let active = true
    loadBillingReadiness(projectId)
      .then((result) => { if (active) setReadiness(result) })
      .catch((error: unknown) => console.error('Could not load billing readiness.', error))
    return () => { active = false }
  }, [projectId, refreshKey])
  return readiness
}

export type ActivityEntry = {
  id: number
  occurredAt: string
  actorName: string
  tableName: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  projectId: string | null
  projectName: string | null
  oldData: Record<string, unknown> | null
  newData: Record<string, unknown> | null
}

type ActivityRow = {
  id: number
  occurred_at: string
  actor_name: string
  table_name: string
  operation: ActivityEntry['operation']
  project_id: string | null
  project_name: string | null
  old_data: Record<string, unknown> | null
  new_data: Record<string, unknown> | null
}

export async function loadActivityLog(before?: string, limit = 50): Promise<ActivityEntry[]> {
  if (!supabase) return []
  const { data, error } = await supabase.rpc('get_activity_log', { p_limit: limit, p_before: before ?? null })
  if (error) throw new Error(error.message)
  return ((data as ActivityRow[] | null) ?? []).map((row) => ({
    id: row.id,
    occurredAt: row.occurred_at,
    actorName: row.actor_name,
    tableName: row.table_name,
    operation: row.operation,
    projectId: row.project_id,
    projectName: row.project_name,
    oldData: row.old_data,
    newData: row.new_data,
  }))
}

export type ClientErrorEntry = { id: number; message: string; pageUrl: string | null; occurredAt: string }

export async function loadClientErrors(limit = 20): Promise<ClientErrorEntry[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('client_error_logs').select('id, message, page_url, occurred_at').order('occurred_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({ id: row.id as number, message: row.message as string, pageUrl: row.page_url as string | null, occurredAt: row.occurred_at as string }))
}

const reported = new Set<string>()

/** Records an unexpected browser error for the owner to review. Never throws. */
export async function reportClientError(message: string, stack?: string) {
  try {
    if (!supabase) return
    const key = message.slice(0, 200)
    if (reported.has(key) || reported.size > 20) return
    reported.add(key)
    const { data } = await supabase.auth.getSession()
    if (!data.session) return
    await supabase.from('client_error_logs').insert({
      message: message.slice(0, 1000) || 'Unknown error',
      stack: stack?.slice(0, 8000) ?? null,
      page_url: window.location.href.slice(0, 1000),
      user_agent: navigator.userAgent.slice(0, 500),
    })
  } catch {
    // Reporting must never break the app.
  }
}

export function installClientErrorReporting() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (event) => {
    void reportClientError(event.message || String(event.error), event.error instanceof Error ? event.error.stack : undefined)
  })
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason
    void reportClientError(reason instanceof Error ? reason.message : String(reason), reason instanceof Error ? reason.stack : undefined)
  })
}
