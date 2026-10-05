import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

export type ProjectMilestoneStatus = 'pending' | 'in_progress' | 'complete' | 'blocked'

export type ProjectMilestone = {
  id: string
  name: string
  plannedDate: string | null
  actualDate: string | null
  status: ProjectMilestoneStatus
  clientVisible: boolean
}

export type SaveProjectMilestoneInput = {
  projectId: string
  name: string
  plannedDate: string | null
  actualDate: string | null
  status: ProjectMilestoneStatus
  clientVisible: boolean
}

function requireSupabase() {
  if (!supabase) throw new Error('Supabase is not configured.')
  return supabase
}

function validateMilestone(input: SaveProjectMilestoneInput) {
  if (!input.name.trim()) throw new Error('Enter a milestone name.')
  for (const [label, date] of [['Planned date', input.plannedDate], ['Actual date', input.actualDate]] as const) {
    if (date === null) continue
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
      throw new Error(`${label} must be a valid date.`)
    }
  }
}

export async function createProjectMilestone(input: SaveProjectMilestoneInput) {
  validateMilestone(input)
  const { error } = await requireSupabase().from('project_milestones').insert({
    organization_id: SAGACT_ORGANIZATION_ID,
    project_id: input.projectId,
    name: input.name.trim(),
    planned_date: input.plannedDate,
    actual_date: input.actualDate,
    status: input.status,
    client_visible: input.clientVisible,
  })
  if (error) throw new Error(error.message)
}

export async function updateProjectMilestone(milestoneId: string, input: SaveProjectMilestoneInput) {
  validateMilestone(input)
  const { error } = await requireSupabase().from('project_milestones')
    .update({
      name: input.name.trim(),
      planned_date: input.plannedDate,
      actual_date: input.actualDate,
      status: input.status,
      client_visible: input.clientVisible,
    })
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', input.projectId)
    .eq('id', milestoneId)
  if (error) throw new Error(error.message)
}

export async function deleteProjectMilestone(projectId: string, milestoneId: string) {
  const { error } = await requireSupabase().from('project_milestones')
    .delete()
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
    .eq('project_id', projectId)
    .eq('id', milestoneId)
  if (error) throw new Error(error.message)
}
