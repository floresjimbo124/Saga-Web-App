import { describe, expect, it } from 'vitest'
import { resolveClientPortalTab, resolveClientProjectSelection } from './client-project-route'

describe('resolveClientProjectSelection', () => {
  it('selects the designated project when it is available to the client', () => {
    expect(resolveClientProjectSelection(['project-1', 'project-2'], '', 'project-2')).toBe('project-2')
  })

  describe('resolveClientPortalTab', () => {
    it.each(['Overview', 'Billing & payments', 'Change orders', 'Documents'])('restores the %s tab', (tab) => {
      expect(resolveClientPortalTab(tab)).toBe(tab)
    })

    it('defaults to Overview for missing or unsupported tabs', () => {
      expect(resolveClientPortalTab(null)).toBe('Overview')
      expect(resolveClientPortalTab('Payroll')).toBe('Overview')
    })
  })

  it('keeps a manually selected project instead of reapplying the designated project', () => {
    expect(resolveClientProjectSelection(['project-1', 'project-2'], 'project-1', 'project-2')).toBe('project-1')
  })

  it('does not select a project when a designated project is unavailable', () => {
    expect(resolveClientProjectSelection(['project-1'], '', 'project-2')).toBe('')
  })

  it('keeps the current project when it remains available', () => {
    expect(resolveClientProjectSelection(['project-1', 'project-2'], 'project-1', null)).toBe('project-1')
  })

  it('returns to the project list when the selected project is no longer available', () => {
    expect(resolveClientProjectSelection(['project-1', 'project-2'], 'removed-project', null)).toBe('')
  })
})
