import { useEffect, useRef, useState } from 'react'
import { Camera, Crop, Trash2 } from 'lucide-react'
import { createProjectCoverPhotoUrl, deleteProjectCoverPhoto, uploadProjectCoverPhoto, validateProjectCoverPhoto } from '../data/project-cover'
import { ProjectCoverCropDialog } from '../components/ProjectCoverCropDialog'
import { useToast } from '../components/toast-context'


export function ProjectDetailCover({ projectId, projectName, storagePath, onChanged, readOnly = false }: { projectId: string; projectName: string; storagePath: string | null; onChanged: () => void; readOnly?: boolean }) {
  const { showToast } = useToast()
  const [loadedPhoto, setLoadedPhoto] = useState<{ storagePath: string; url: string } | null>(null)
  const [error, setError] = useState('')
  const [isWorking, setIsWorking] = useState(false)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const photoUrl = loadedPhoto?.storagePath === storagePath ? loadedPhoto.url : ''

  useEffect(() => {
    let active = true
    if (storagePath) {
      void createProjectCoverPhotoUrl(storagePath)
        .then((url) => { if (active) setLoadedPhoto({ storagePath, url }) })
        .catch((photoLoadError: unknown) => {
          console.error('Could not load the project cover photo.', photoLoadError)
          if (active) setError(photoLoadError instanceof Error ? photoLoadError.message : 'Could not load the project cover photo.')
        })
    }
    return () => { active = false }
  }, [storagePath])

  const uploadCover = async (file: File) => {
    setError('')
    setIsWorking(true)
    try {
      const newPath = await uploadProjectCoverPhoto(projectId, file, storagePath)
      setLoadedPhoto({ storagePath: newPath, url: await createProjectCoverPhotoUrl(newPath) })
      showToast(
        storagePath ? 'Project cover photo updated.' : 'Project cover photo added.',
        storagePath ? 'update' : 'create',
      )
      onChanged()
      setCropFile(null)
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Could not update the project cover photo.')
    } finally {
      if (photoInput.current) photoInput.current.value = ''
      setIsWorking(false)
    }
  }

  const adjustCover = async () => {
    if (!photoUrl || isWorking) return
    setError('')
    setIsWorking(true)
    try {
      const response = await fetch(photoUrl)
      if (!response.ok) throw new Error('Could not load the current project photo for cropping.')
      const blob = await response.blob()
      const extension = storagePath?.split('.').pop() ?? 'jpg'
      setCropFile(new File([blob], `project-cover.${extension}`, { type: blob.type }))
    } catch (adjustError) {
      setError(adjustError instanceof Error ? adjustError.message : 'Could not open the crop editor.')
    } finally {
      setIsWorking(false)
    }
  }

  const removeCover = async () => {
    if (!storagePath || isWorking) return
    setError('')
    setIsWorking(true)
    try {
      await deleteProjectCoverPhoto(projectId, storagePath)
      setLoadedPhoto(null)
      showToast('Project cover photo removed.', 'delete')
      onChanged()
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : 'Could not remove the project cover photo.')
    } finally {
      setIsWorking(false)
    }
  }

  return <div className={`project-detail-cover${photoUrl ? ' has-photo' : ''}`}>
    {photoUrl
      ? <img src={photoUrl} alt={`${projectName} project cover`} />
      : <div className="project-detail-cover-empty is-blueprint">
        <svg className="cover-blueprint" viewBox="0 0 480 220" preserveAspectRatio="xMidYMax meet" aria-hidden="true">
          <g fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
            <path d="M40 200h400" />
            <path d="M90 200V96l80-50 80 50v104" />
            <path d="M70 108l100-66 100 66" />
            <rect x="112" y="128" width="34" height="30" /><path d="M129 128v30M112 143h34" />
            <rect x="194" y="128" width="34" height="30" /><path d="M211 128v30M194 143h34" />
            <path d="M150 200v-38h40v38" />
            <path d="M250 200V122h130v78" /><path d="M250 122l20-22h90l20 22" />
            <rect x="272" y="140" width="36" height="28" /><rect x="324" y="140" width="36" height="28" />
            <path d="M290 140v28M342 140v28" />
          </g>
          <g fill="none" stroke="currentColor" strokeWidth=".8" strokeDasharray="4 4" opacity=".7">
            <path d="M90 214h160M90 210v8M250 210v8M262 40v150M256 40h12" />
          </g>
        </svg>
        {!readOnly && <span className="cover-blueprint-copy"><Camera size={18} /><strong>Add a project photo</strong><span>JPG, PNG, or WebP · Up to 10 MB</span></span>}
      </div>}
    {!readOnly && photoUrl && <button type="button" className="project-detail-cover-adjust" aria-label="Adjust project photo crop" title="Adjust photo crop" disabled={isWorking} onClick={() => { void adjustCover() }}><Crop size={14} />Adjust crop</button>}
    {!readOnly && <label className="project-detail-cover-upload">
      <Camera size={14} />{isWorking ? 'Saving…' : storagePath ? 'Change photo' : 'Upload photo'}
      <input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Upload cover photo for ${projectName}`} disabled={isWorking} onChange={(event) => {
        const file = event.currentTarget.files?.[0]
        if (!file) return
        try {
          validateProjectCoverPhoto(file)
          setError('')
          setCropFile(file)
        } catch (validationError) {
          setError(validationError instanceof Error ? validationError.message : 'Could not use the selected project photo.')
          event.currentTarget.value = ''
        }
      }} />
    </label>}
    {storagePath && <button type="button" className="project-detail-cover-remove" aria-label="Remove project cover photo" title="Remove project cover photo" disabled={isWorking} onClick={() => { void removeCover() }}><Trash2 size={14} /></button>}
    {error && <p className="project-detail-cover-error" role="alert">{error}</p>}
    {cropFile && <ProjectCoverCropDialog file={cropFile} saving={isWorking} error={error} onCancel={() => { if (!isWorking) { setCropFile(null); setError('') } }} onSave={(file) => { void uploadCover(file) }} />}
  </div>
}

