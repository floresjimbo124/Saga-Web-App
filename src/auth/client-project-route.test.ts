import { describe, expect, it } from 'vitest'
import { resolveClientProjectSelection } from './client-project-route'

describe('resolveClientProjectSelection', () => {
  it('selects the designated project when it is available to the client', () => {
    expect(resolveClientProjectSelection(['project-1', 'project-2'], '', 'project-2')).toBe('project-2')
  })

  it('ignores designated projects the client cannot access', () => {
    expect(resolveClientProjectSelection(['project-1'], '', 'project-2')).toBe('project-1')
  })

  it('keeps the current project when it remains available', () => {
    expect(resolveClientProjectSelection(['project-1', 'project-2'], 'project-1', null)).toBe('project-1')
  })

  it('selects the first available project when no selection remains', () => {
    expect(resolveClientProjectSelection(['project-1', 'project-2'], 'removed-project', null)).toBe('project-1')
  })
})
