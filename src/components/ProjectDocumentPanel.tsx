import { useEffect, useRef, useState } from 'react'
import { Eye, FileText, RefreshCw, Share2, Trash2, Upload, X } from 'lucide-react'
import {
  createProjectDocumentUrl,
  deleteProjectDocument,
  loadProjectDocuments,
  setProjectDocumentVisibility,
  uploadProjectDocument,
  type ProjectDocument,
} from '../data/project-documents'

const documentTypes = [
  { value: 'contract', label: 'Contract' },
  { value: 'plan', label: 'Plan or drawing' },
  { value: 'billing', label: 'Billing' },
  { value: 'receipt', label: 'Receipt' },
  { value: 'other', label: 'Other' },
]
const dateFormat = new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' })

function formatDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : dateFormat.format(date)
}

export function ProjectDocumentPanel({ projectId }: { projectId: string }) {
  const [documents, setDocuments] = useState<ProjectDocument[]>([])
  const [documentType, setDocumentType] = useState('other')
  const [clientVisible, setClientVisible] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isUploading, setIsUploading] = useState(false)
  const [workingDocumentId, setWorkingDocumentId] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [pendingDelete, setPendingDelete] = useState<ProjectDocument | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  const refreshDocuments = async () => {
    setError('')
    try {
      setDocuments(await loadProjectDocuments(projectId))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load project documents.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    let active = true
    void loadProjectDocuments(projectId)
      .then((nextDocuments) => { if (active) setDocuments(nextDocuments) })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Could not load project documents.')
      })
      .finally(() => { if (active) setIsLoading(false) })
    return () => { active = false }
  }, [projectId])

  const uploadFile = async (file: File) => {
    setError('')
    setMessage('')
    setIsUploading(true)
    try {
      await uploadProjectDocument({ projectId, file, documentType, clientVisible })
      setDocumentType('other')
      setClientVisible(false)
      setMessage('Document uploaded.')
      await refreshDocuments()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not upload this document.')
    } finally {
      if (fileInput.current) fileInput.current.value = ''
      setIsUploading(false)
    }
  }

  const openDocument = async (document: ProjectDocument) => {
    setWorkingDocumentId(document.id)
    setError('')
    try {
      const url = await createProjectDocumentUrl(document.storagePath)
      const link = window.document.createElement('a')
      link.href = url
      link.target = '_blank'
      link.rel = 'noopener noreferrer'
      link.click()
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open this document.')
    } finally {
      setWorkingDocumentId('')
    }
  }

  const toggleVisibility = async (document: ProjectDocument) => {
    setWorkingDocumentId(document.id)
    setError('')
    setMessage('')
    try {
      await setProjectDocumentVisibility(projectId, document.id, !document.clientVisible)
      setDocuments((current) => current.map((item) => item.id === document.id
        ? { ...item, clientVisible: !item.clientVisible }
        : item))
      setMessage(document.clientVisible ? 'Document removed from client view.' : 'Document shared with the client.')
    } catch (visibilityError) {
      setError(visibilityError instanceof Error ? visibilityError.message : 'Could not update document sharing.')
    } finally {
      setWorkingDocumentId('')
    }
  }

  const removeDocument = async (document: ProjectDocument) => {
    setWorkingDocumentId(document.id)
    setError('')
    setMessage('')
    try {
      await deleteProjectDocument(projectId, document)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      setPendingDelete(null)
      setMessage('Document deleted.')
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete this document.')
    } finally {
      setWorkingDocumentId('')
    }
  }

  return <>
    {pendingDelete && <div className="modal-backdrop document-confirm-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !workingDocumentId) setPendingDelete(null) }}><section className="project-modal document-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-document-title" aria-describedby="delete-document-copy">
      <div className="modal-heading"><div><div className="section-kicker">Delete project file</div><h2 id="delete-document-title">Delete this document?</h2></div><button className="icon-button" type="button" aria-label="Close confirmation" disabled={Boolean(workingDocumentId)} onClick={() => setPendingDelete(null)}><X size={18} /></button></div>
      <p className="document-confirm-copy" id="delete-document-copy"><strong>{pendingDelete.fileName}</strong> will be permanently deleted. This cannot be undone.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="document-confirm-actions"><button className="button button-secondary" type="button" disabled={Boolean(workingDocumentId)} onClick={() => setPendingDelete(null)}>Cancel</button><button className="button button-danger" type="button" disabled={Boolean(workingDocumentId)} onClick={() => { void removeDocument(pendingDelete) }}>{workingDocumentId === pendingDelete.id ? <RefreshCw size={15} /> : <Trash2 size={15} />}{workingDocumentId === pendingDelete.id ? 'Deleting' : 'Delete document'}</button></div>
    </section></div>}
    <section className="surface-card tab-content document-manager">
    <div className="card-heading-row"><div><div className="section-kicker">Project files</div><h2>Documents</h2></div><span className="document-count">{documents.length}</span></div>
    <div className="document-upload-form">
      <input ref={fileInput} type="file" accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.dwg,.dxf" aria-label="Select a document to upload" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadFile(file) }} />
      <label className="form-field">Document type<select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>{documentTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      <label className="document-share-option"><input type="checkbox" checked={clientVisible} onChange={(event) => setClientVisible(event.target.checked)} /><span>Share with client</span></label>
      <button className="button button-primary document-upload-button" type="button" disabled={isUploading} onClick={() => fileInput.current?.click()}>{isUploading ? <RefreshCw size={15} /> : <Upload size={15} />}{isUploading ? 'Uploading' : 'Upload document'}</button>
    </div>
    <p className="document-upload-note">PDF, images, Office files, or CAD drawings · 50 MB max</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="document-success" role="status">{message}</p>}
    {isLoading ? <div className="empty-state">Loading documents…</div> : documents.length ? <div className="document-list">{documents.map((document) => {
      const isWorking = workingDocumentId === document.id
      return <article className="document-row" key={document.id}>
        <span className="activity-icon"><FileText size={16} /></span>
        <span className="document-copy"><strong>{document.fileName}</strong><small>{documentTypes.find((item) => item.value === document.documentType)?.label ?? document.documentType.replaceAll('_', ' ')} · added {formatDate(document.createdAt)}</small></span>
        <label className="document-visibility"><input type="checkbox" checked={document.clientVisible} disabled={isWorking} onChange={() => { void toggleVisibility(document) }} /><Share2 size={14} /><span>{document.clientVisible ? 'Shared' : 'Private'}</span></label>
        <div className="document-actions"><button className="text-button compact-button document-view-button" type="button" aria-label={`View ${document.fileName}`} title="View document" disabled={isWorking} onClick={() => { void openDocument(document) }}>{isWorking ? <RefreshCw size={15} /> : <Eye size={15} />}<span>View</span></button><button className="icon-button document-delete-button" type="button" aria-label={`Delete ${document.fileName}`} title="Delete document" disabled={isWorking} onClick={() => { setError(''); setPendingDelete(document) }}><Trash2 size={15} /></button></div>
      </article>
    })}</div> : <div className="empty-state">No documents uploaded for this project.</div>}
    </section>
  </>
}