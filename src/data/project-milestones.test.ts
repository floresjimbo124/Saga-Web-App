import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: { from: mocks.from },
}))

import { createProjectMilestone, deleteProjectMilestone, updateProjectMilestone } from './project-milestones'

const calls: { method: string; args: unknown[] }[] = []

function queryFor(error: { message: string } | null = null) {
  const query = {
    insert: (...args: unknown[]) => { calls.push({ method: 'insert', args }); return query },
    update: (...args: unknown[]) => { calls.push({ method: 'update', args }); return query },
    delete: (...args: unknown[]) => { calls.push({ method: 'delete', args }); return query },
    eq: (...args: unknown[]) => { calls.push({ method: 'eq', args }); return query },
    then: (resolve: (result: { error: typeof error }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ error }).then(resolve, reject),
  }
  return query
}

beforeEach(() => {
  calls.length = 0
  mocks.from.mockImplementation(() => queryFor())
})

describe('project milestone data access', () => {
  const input = {
    projectId: 'project-1',
    name: 'Foundation complete',
    startDate: '2026-10-01',
    plannedDate: '2026-10-12',
    actualDate: null,
    completionPercent: 40,
    status: 'pending' as const,
    clientVisible: true,
  }

  it('creates milestones scoped to the organization and project', async () => {
    await createProjectMilestone(input)

    expect(calls).toContainEqual({
      method: 'insert',
      args: [{
        organization_id: 'org-sagact',
        project_id: 'project-1',
        name: 'Foundation complete',
        start_date: '2026-10-01',
        planned_date: '2026-10-12',
        actual_date: null,
        completion_percent: 40,
        status: 'pending',
        client_visible: true,
      }],
    })
  })

  it('updates and deletes only the selected project milestone', async () => {
    await updateProjectMilestone('milestone-1', { ...input, status: 'complete', actualDate: '2026-10-13' })
    await deleteProjectMilestone('project-1', 'milestone-1')

    expect(calls).toContainEqual({ method: 'eq', args: ['organization_id', 'org-sagact'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['project_id', 'project-1'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['id', 'milestone-1'] })
  })

  it('rejects blank names and invalid dates before sending a database request', async () => {
    await expect(createProjectMilestone({ ...input, name: '  ' })).rejects.toThrow('Enter a milestone name.')
    await expect(createProjectMilestone({ ...input, plannedDate: '10/12/2026' })).rejects.toThrow('End date must be a valid date.')
    await expect(createProjectMilestone({ ...input, startDate: '2026-10-13' })).rejects.toThrow('End date cannot be before the start date.')
    await expect(createProjectMilestone({ ...input, completionPercent: 101 })).rejects.toThrow('Milestone completion must be a whole number from 0 to 100.')
    await expect(createProjectMilestone({ ...input, completionPercent: 35.5 })).rejects.toThrow('Milestone completion must be a whole number from 0 to 100.')
    expect(calls).toHaveLength(0)
  })

  it('surfaces database errors', async () => {
    mocks.from.mockImplementation(() => queryFor({ message: 'permission denied' }))

    await expect(createProjectMilestone(input)).rejects.toThrow('permission denied')
  })
})
