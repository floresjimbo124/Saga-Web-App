import { describe, expect, it, vi } from 'vitest'
import { clearSavedWorkspaceNavigation, clearWorkspaceNavigation, workspaceNavigationStorageKey } from './workspace-navigation'

describe('clearWorkspaceNavigation', () => {
  it('removes the saved location without affecting other tab state', () => {
    const values = new Map([
      [workspaceNavigationStorageKey, '{"view":"portfolio","selectedId":"project-1","projectTab":"Payments"}'],
      ['other-tab-state', 'keep'],
    ])
    const storage = {
      removeItem: (key: string) => values.delete(key),
    }

    clearWorkspaceNavigation(storage)

    expect(values.has(workspaceNavigationStorageKey)).toBe(false)
    expect(values.get('other-tab-state')).toBe('keep')
  })

  it('clears both current and legacy saved locations from tab and persistent storage', () => {
    const createStorage = () => {
      const values = new Map([
        [workspaceNavigationStorageKey, '{"view":"portfolio","selectedId":"project-1"}'],
        ['sagact:workspace-navigation', '{"view":"portfolio","selectedId":"project-1"}'],
      ])
      return {
        values,
        removeItem: (key: string) => values.delete(key),
      }
    }
    const sessionStorage = createStorage()
    const localStorage = createStorage()
    vi.stubGlobal('window', { sessionStorage, localStorage })

    try {
      clearSavedWorkspaceNavigation()

      expect(sessionStorage.values.size).toBe(0)
      expect(localStorage.values.size).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
