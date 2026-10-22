import { SAGACT_ORGANIZATION_ID, supabase } from '../lib/supabase'

export type ProjectStaffAccess = { projectId: string; userId: string }

/** Which staff members can open which projects (owners see all rows, staff see their own). */
export async function loadProjectStaffAccess(): Promise<ProjectStaffAccess[]> {
  if (!supabase) return []
  const { data, error } = await supabase.from('project_staff_access')
    .select('project_id, user_id')
    .eq('organization_id', SAGACT_ORGANIZATION_ID)
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({ projectId: row.project_id as string, userId: row.user_id as string }))
}

/** Owner only: replace the set of projects a liaison officer or engineer can open. */
export async function setProjectStaffAccess(userId: string, projectIds: string[]) {
  if (!supabase) throw new Error('Supabase is not configured.')
  const { error } = await supabase.rpc('set_project_staff_access', { p_user_id: userId, p_project_ids: projectIds })
  if (error) throw new Error(error.message)
}
