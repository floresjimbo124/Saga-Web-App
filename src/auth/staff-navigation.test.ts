import { describe, expect, it } from 'vitest'
import { clearSavedStaffNavigation, readStaffNavigation, saveStaffNavigation } from './staff-navigation'

function createStorage() {
  const values = new Map<string, string>()
  return {
    values,
    get length() { return values.size },
    getItem: (key: string) => values.get(key) ?? null,
    key: (index: number) => [...values.keys()][index] ?? null,
    removeItem: (key: string) => values.delete(key),
    setItem: (key: string, value: string) => values.set(key, value),
  }
}

describe('staff navigation', () => {
  it('restores and saves the selected page for the current staff user', () => {
    const storage = createStorage()

    expect(readStaffNavigation(storage, 'staff-1', true)).toBe('tasks')
    saveStaffNavigation(storage, 'staff-1', 'payroll')
    expect(readStaffNavigation(storage, 'staff-1', true)).toBe('payroll')
    expect(readStaffNavigation(storage, 'staff-2', true)).toBe('tasks')
  })

  it('does not restore payroll for staff without payroll access', () => {
    const storage = createStorage()
    saveStaffNavigation(storage, 'staff-1', 'payroll')

    expect(readStaffNavigation(storage, 'staff-1', false)).toBe('tasks')
  })

  it('clears saved staff pages without affecting unrelated tab state', () => {
    const storage = createStorage()
    saveStaffNavigation(storage, 'staff-1', 'payroll')
    storage.setItem('other-tab-state', 'keep')

    clearSavedStaffNavigation(storage)

    expect(storage.values.has('sagact:staff-navigation:v1:staff-1')).toBe(false)
    expect(storage.getItem('other-tab-state')).toBe('keep')
  })
})
