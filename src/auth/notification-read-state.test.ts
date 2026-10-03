import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadReadNotificationIds, saveReadNotificationIds } from './notification-read-state'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('notification read state', () => {
  it('stores read ids by scope and removes duplicates', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })

    saveReadNotificationIds('owner', ['deadline:project-1', 'deadline:project-1'])
    saveReadNotificationIds('client:user-1', ['billing-1'])

    expect(loadReadNotificationIds('owner')).toEqual(['deadline:project-1'])
    expect(loadReadNotificationIds('client:user-1')).toEqual(['billing-1'])
  })

  it('rejects malformed notification state', () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => '{"deadline:project-1":true}' },
    })

    expect(() => loadReadNotificationIds('owner')).toThrow('Saved notification state is invalid.')
  })
})
