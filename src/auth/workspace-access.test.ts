import { describe, expect, it } from 'vitest'
import { resolveWorkspaceAccessRoute } from './workspace-access'

describe('resolveWorkspaceAccessRoute', () => {
  it('routes owners to the owner app', () => {
    expect(resolveWorkspaceAccessRoute('owner', false)).toBe('owner')
    expect(resolveWorkspaceAccessRoute('owner', true)).toBe('owner')
  })

  it('routes an owner through an invitation link only when assigned to that project', () => {
    expect(resolveWorkspaceAccessRoute('owner', true, true)).toBe('client')
    expect(resolveWorkspaceAccessRoute('owner', false, true)).toBe('owner')
  })

  it('does not route staff members through a client account', () => {
    expect(resolveWorkspaceAccessRoute('site_staff', true)).toBe('denied')
  })

  it('routes users without an organization role to the client portal only when linked', () => {
    expect(resolveWorkspaceAccessRoute(null, true)).toBe('client')
    expect(resolveWorkspaceAccessRoute(null, false)).toBe('denied')
  })
})