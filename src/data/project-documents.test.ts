import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  storageFrom: vi.fn(),
  insert: vi.fn(),
  upload: vi.fn(),
  remove: vi.fn(),
}))

vi.mock('../lib/supabase', () => ({
  SAGACT_ORGANIZATION_ID: 'org-sagact',
  supabase: {
    from: mocks.from,
    storage: { from: mocks.storageFrom },
  },
}))

import { uploadProjectDocument, validateProjectDocumentFile } from './project-documents'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.from.mockReturnValue({ insert: mocks.insert })
  mocks.storageFrom.mockReturnValue({ upload: mocks.upload, remove: mocks.remove })
  mocks.upload.mockResolvedValue({ error: null })
  mocks.insert.mockResolvedValue({ error: null })
  mocks.remove.mockResolvedValue({ error: null })
})

describe('project document storage', () => {
  it('accepts supported files up to the bucket size limit', () => {
    const file = new File([new Uint8Array(1)], 'plan.DWG')
    expect(() => validateProjectDocumentFile(file)).not.toThrow()
  })

  it('rejects unsupported, empty, and oversized files', () => {
    expect(() => validateProjectDocumentFile(new File(['data'], 'script.exe'))).toThrow('Choose a PDF')
    expect(() => validateProjectDocumentFile(new File([], 'empty.pdf'))).toThrow('file is empty')
    expect(() => validateProjectDocumentFile(new File([new Uint8Array(50 * 1024 * 1024 + 1)], 'large.pdf'))).toThrow('50 MB or smaller')
  })

  it('uploads to a private storage bucket path and shares document metadata with the client', async () => {
    const file = new File(['pdf'], 'Contract File.PDF', { type: 'application/pdf' })

    await uploadProjectDocument({
      projectId: 'project-123',
      file,
      documentType: 'contract',
    })

    const [path, uploadedFile, options] = mocks.upload.mock.calls[0]
    expect(mocks.storageFrom).toHaveBeenCalledWith('project-documents')
    expect(path).toMatch(/^org-sagact\/project-123\/[0-9a-f-]+-Contract-File\.PDF$/i)
    expect(uploadedFile).toBe(file)
    expect(options).toMatchObject({ contentType: 'application/pdf', upsert: false })
    expect(mocks.from).toHaveBeenCalledWith('project_documents')
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      organization_id: 'org-sagact',
      project_id: 'project-123',
      storage_path: path,
      file_name: 'Contract File.PDF',
      document_type: 'contract',
      client_visible: true,
    }))
  })

  it('removes the stored object if saving its metadata fails', async () => {
    mocks.insert.mockResolvedValue({ error: { message: 'metadata rejected' } })
    const file = new File(['pdf'], 'contract.pdf')

    await expect(uploadProjectDocument({
      projectId: 'project-123',
      file,
      documentType: 'contract',
    })).rejects.toThrow('metadata rejected')

    expect(mocks.remove).toHaveBeenCalledWith([mocks.upload.mock.calls[0][0]])
  })
})