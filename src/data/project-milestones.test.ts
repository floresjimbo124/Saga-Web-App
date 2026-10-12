import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
  createSignedUrl: vi.fn(),
}))
vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: {
    from: mocks.from,
    storage: { from: () => ({
      upload: mocks.upload,
      remove: mocks.remove,
      createSignedUrl: mocks.createSignedUrl,
    }) },
  },
}))

import {
  createProjectMilestone,
  createProjectMilestonePhotoUrl,
  deleteProjectMilestone,
  deleteProjectMilestonePhoto,
  updateProjectMilestone,
  uploadProjectMilestonePhoto,
  validateProjectMilestonePhoto,
} from './project-milestones'

const calls: { method: string; args: unknown[] }[] = []

function queryFor(error: { message: string } | null = null, data: unknown = null) {
  const query = {
    insert: (...args: unknown[]) => { calls.push({ method: 'insert', args }); return query },
    update: (...args: unknown[]) => { calls.push({ method: 'update', args }); return query },
    delete: (...args: unknown[]) => { calls.push({ method: 'delete', args }); return query },
    select: (...args: unknown[]) => { calls.push({ method: 'select', args }); return query },
    eq: (...args: unknown[]) => { calls.push({ method: 'eq', args }); return query },
    then: (resolve: (result: { error: typeof error }) => unknown, reject?: (reason: unknown) => unknown) =>
      Promise.resolve({ error }).then(resolve, reject),
    maybeSingle: () => Promise.resolve({ data, error }),
  }
  return query
}

beforeEach(() => {
  calls.length = 0
  mocks.from.mockImplementation(() => queryFor(null, { id: 'milestone-1' }))
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
  mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://example.com/photo.jpg' }, error: null })
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

  it('validates milestone photo formats and file sizes', () => {
    validateProjectMilestonePhoto(new File(['image'], 'site.jpg', { type: 'image/jpeg' }))
    expect(() => validateProjectMilestonePhoto(new File(['text'], 'notes.txt', { type: 'text/plain' })))
      .toThrow('Choose a JPG, PNG, or WebP image.')
    expect(() => validateProjectMilestonePhoto(new File([''], 'empty.png', { type: 'image/png' })))
      .toThrow('The selected image is empty.')
    expect(() => validateProjectMilestonePhoto(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })))
      .toThrow('Milestone photos must be 10 MB or smaller.')
  })

  it('uploads a completed milestone photo to project-scoped storage and records its path', async () => {
    await expect(uploadProjectMilestonePhoto(
      'project-1',
      'milestone-1',
      new File(['image'], 'site.jpg', { type: 'image/jpeg' }),
      null,
    )).resolves.toMatch(/^org-sagact\/project-1\/milestones\/milestone-1\/.+\.jpg$/)

    expect(mocks.upload).toHaveBeenCalledWith(expect.stringMatching(/^org-sagact\/project-1\/milestones\/milestone-1\/.+\.jpg$/), expect.any(File), {
      cacheControl: '3600',
      contentType: 'image/jpeg',
      upsert: false,
    })
    expect(calls).toContainEqual({
      method: 'update',
      args: [{ photo_storage_path: expect.stringMatching(/^org-sagact\/project-1\/milestones\/milestone-1\/.+\.jpg$/) }],
    })
    expect(calls).toContainEqual({ method: 'eq', args: ['status', 'complete'] })
  })

  it('removes a photo reference before deleting the stored image', async () => {
    await deleteProjectMilestonePhoto('project-1', 'milestone-1', 'org-sagact/project-1/milestones/milestone-1/photo.jpg')

    expect(calls).toContainEqual({ method: 'update', args: [{ photo_storage_path: null }] })
    expect(mocks.remove).toHaveBeenCalledWith(['org-sagact/project-1/milestones/milestone-1/photo.jpg'])
  })

  it('creates a signed URL for private milestone photos', async () => {
    await expect(createProjectMilestonePhotoUrl('org-sagact/project-1/milestones/milestone-1/photo.jpg'))
      .resolves.toBe('https://example.com/photo.jpg')
  })
})
