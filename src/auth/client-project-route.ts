export function resolveClientProjectSelection(projectIds: string[], currentId: string, requestedId: string | null) {
  if (requestedId && projectIds.includes(requestedId)) return requestedId
  if (projectIds.includes(currentId)) return currentId
  return projectIds[0] ?? ''
}
