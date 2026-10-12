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
  createProjectCoverPhotoUrl,
  deleteProjectCoverPhoto,
  uploadProjectCoverPhoto,
  validateProjectCoverPhoto,
} from './project-cover'

const calls: { method: string; args: unknown[] }[] = []

function queryFor(error: { message: string } | null = null, data: unknown = { id: 'project-1' }) {
  const query = {
    update: (...args: unknown[]) => { calls.push({ method: 'update', args }); return query },
    select: (...args: unknown[]) => { calls.push({ method: 'select', args }); return query },
    eq: (...args: unknown[]) => { calls.push({ method: 'eq', args }); return query },
    maybeSingle: () => Promise.resolve({ data, error }),
  }
  return query
}

beforeEach(() => {
  calls.length = 0
  mocks.from.mockImplementation(() => queryFor())
  mocks.upload.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
  mocks.createSignedUrl.mockResolvedValue({ data: { signedUrl: 'https://example.com/cover.jpg' }, error: null })
})

describe('project cover data access', () => {
  it('validates image formats and size', () => {
    validateProjectCoverPhoto(new File(['image'], 'cover.jpg', { type: 'image/jpeg' }))
    expect(() => validateProjectCoverPhoto(new File(['text'], 'notes.txt', { type: 'text/plain' })))
      .toThrow('Choose a JPG, PNG, or WebP image.')
    expect(() => validateProjectCoverPhoto(new File([''], 'empty.png', { type: 'image/png' })))
      .toThrow('The selected image is empty.')
    expect(() => validateProjectCoverPhoto(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' })))
      .toThrow('Project cover photos must be 10 MB or smaller.')
  })

  it('uploads the cover and saves its project-scoped path', async () => {
    await expect(uploadProjectCoverPhoto(
      'project-1',
      new File(['image'], 'cover.jpg', { type: 'image/jpeg' }),
      null,
    )).resolves.toMatch(/^org-sagact\/project-1\/cover\/.+\.jpg$/)

    expect(mocks.upload).toHaveBeenCalledWith(expect.stringMatching(/^org-sagact\/project-1\/cover\/.+\.jpg$/), expect.any(File), {
      cacheControl: '3600',
      contentType: 'image/jpeg',
      upsert: false,
    })
    expect(calls).toContainEqual({
      method: 'update',
      args: [{ cover_photo_storage_path: expect.stringMatching(/^org-sagact\/project-1\/cover\/.+\.jpg$/) }],
    })
    expect(calls).toContainEqual({ method: 'eq', args: ['organization_id', 'org-sagact'] })
    expect(calls).toContainEqual({ method: 'eq', args: ['id', 'project-1'] })
  })

  it('removes a replaced photo after the new cover is saved', async () => {
    await uploadProjectCoverPhoto('project-1', new File(['image'], 'cover.png', { type: 'image/png' }), 'org-sagact/project-1/cover/old.jpg')
    expect(mocks.remove).toHaveBeenCalledWith(['org-sagact/project-1/cover/old.jpg'])
  })

  it('detaches the cover before deleting its stored image', async () => {
    await deleteProjectCoverPhoto('project-1', 'org-sagact/project-1/cover/cover.jpg')
    expect(calls).toContainEqual({ method: 'update', args: [{ cover_photo_storage_path: null }] })
    expect(calls).toContainEqual({ method: 'eq', args: ['cover_photo_storage_path', 'org-sagact/project-1/cover/cover.jpg'] })
    expect(mocks.remove).toHaveBeenCalledWith(['org-sagact/project-1/cover/cover.jpg'])
  })

  it('creates a signed URL for private cover photos', async () => {
    await expect(createProjectCoverPhotoUrl('org-sagact/project-1/cover/cover.jpg'))
      .resolves.toBe('https://example.com/cover.jpg')
  })
})
