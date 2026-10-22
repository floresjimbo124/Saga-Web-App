import { createContext, useContext } from 'react'

/**
 * What the signed-in person may do on a project screen.
 * Owners can edit everything. Assigned staff (liaison officer, engineer) can view and add,
 * but every edit / void / delete / settings control is hidden. The database enforces the same rules.
 */
export type ProjectPermissions = { canEdit: boolean }

export const ProjectPermissionsContext = createContext<ProjectPermissions>({ canEdit: true })

export function useProjectCanEdit() {
  return useContext(ProjectPermissionsContext).canEdit
}
