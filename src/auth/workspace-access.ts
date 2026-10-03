export type WorkspaceAccessRoute = 'owner' | 'client' | 'denied'

export function resolveWorkspaceAccessRoute(organizationRole: string | null, hasClientAccess: boolean, preferClient = false): WorkspaceAccessRoute {
  if (organizationRole === 'owner') return preferClient && hasClientAccess ? 'client' : 'owner'
  if (organizationRole !== null) return 'denied'
  return hasClientAccess ? 'client' : 'denied'
}