export const CLIENT_PORTAL_TABS = ['Overview', 'Billing & payments', 'Change orders', 'Documents'] as const
export type ClientPortalTab = typeof CLIENT_PORTAL_TABS[number]

export function resolveClientProjectSelection(projectIds: string[], currentId: string, requestedId: string | null) {
  if (projectIds.includes(currentId)) return currentId
  if (requestedId && projectIds.includes(requestedId)) return requestedId
  return ''
}

export function resolveClientPortalTab(requestedTab: string | null): ClientPortalTab {
  return CLIENT_PORTAL_TABS.find((tab) => tab === requestedTab) ?? 'Overview'
}
