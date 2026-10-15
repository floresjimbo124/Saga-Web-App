export const workspaceNavigationStorageKey = 'sagact:workspace-navigation:v2'

export function clearWorkspaceNavigation(storage: Pick<Storage, 'removeItem'>) {
  storage.removeItem(workspaceNavigationStorageKey)
}

export function clearSavedWorkspaceNavigation() {
  for (const storage of [window.sessionStorage, window.localStorage]) {
    try {
      clearWorkspaceNavigation(storage)
      storage.removeItem('sagact:workspace-navigation')
    } catch (error) {
      console.warn('Could not clear the saved workspace location.', error)
    }
  }
}
