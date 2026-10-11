export type WorkspaceAccessRoute = 'owner' | 'staff' | 'client' | 'denied'

export function resolveWorkspaceAccessRoute(
  organizationRole: string | null,
  hasClientAccess: boolean,
  preferClient = false,
  hasStaffAccess = false,
): WorkspaceAccessRoute {
  if (organizationRole === 'owner') return preferClient && hasClientAccess ? 'client' : 'owner'
  if (organizationRole === 'site_staff') return hasStaffAccess ? 'staff' : 'denied'
  if (organizationRole !== null) return 'denied'
  return hasClientAccess ? 'client' : 'denied'
}