import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadReadClientBillingNotificationIds, saveReadClientBillingNotificationIds } from './client-billing-notifications'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('client billing notification read state', () => {
  it('persists read notifications separately for each client', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    })

    saveReadClientBillingNotificationIds('client-a', ['billing-1', 'billing-1'])
    saveReadClientBillingNotificationIds('client-b', ['billing-2'])

    expect(loadReadClientBillingNotificationIds('client-a')).toEqual(['billing-1'])
    expect(loadReadClientBillingNotificationIds('client-b')).toEqual(['billing-2'])
    expect([...values.keys()]).toContain('sagact:notifications:read:client:client-a')
  })

  it('rejects malformed saved state', () => {
    vi.stubGlobal('window', {
      localStorage: {
        getItem: () => '{"billing-1":true}',
      },
    })

    expect(() => loadReadClientBillingNotificationIds('client-a')).toThrow('Saved notification state is invalid.')
  })
})
