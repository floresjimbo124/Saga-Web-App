import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { Crop, X } from 'lucide-react'

const cropAspectRatio = 16 / 9
const maximumOutputWidth = 1600

type ProjectCoverCropDialogProps = {
  file: File
  saving: boolean
  error: string
  onCancel: () => void
  onSave: (file: File) => void
}

export function ProjectCoverCropDialog({ file, saving, error, onCancel, onSave }: ProjectCoverCropDialogProps) {
  const sourceUrl = useMemo(() => URL.createObjectURL(file), [file])
  const stageRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const pointerRef = useRef<{ id: number; x: number; y: number } | null>(null)
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0.5, y: 0.5 })
  const [cropError, setCropError] = useState('')

  useEffect(() => () => URL.revokeObjectURL(sourceUrl), [sourceUrl])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(([entry]) => {
      setStageSize({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  const baseScale = imageSize && stageSize.width && stageSize.height
    ? Math.max(stageSize.width / imageSize.width, stageSize.height / imageSize.height)
    : 0
  const imageWidth = imageSize ? imageSize.width * baseScale * zoom : 0
  const imageHeight = imageSize ? imageSize.height * baseScale * zoom : 0

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (saving || !stageRef.current) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const pointer = pointerRef.current
    if (!pointer || pointer.id !== event.pointerId) return
    const deltaX = event.clientX - pointer.x
    const deltaY = event.clientY - pointer.y
    pointerRef.current = { ...pointer, x: event.clientX, y: event.clientY }
    setPan((current) => ({
      x: imageWidth <= stageSize.width ? 0.5 : Math.min(1, Math.max(0, current.x - deltaX / (imageWidth - stageSize.width))),
      y: imageHeight <= stageSize.height ? 0.5 : Math.min(1, Math.max(0, current.y - deltaY / (imageHeight - stageSize.height))),
    }))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.id === event.pointerId) pointerRef.current = null
  }

  const saveCrop = async () => {
    const sourceImage = imageRef.current
    if (!imageSize || !sourceImage?.complete || !sourceImage.naturalWidth || !baseScale || !stageSize.width || !stageSize.height) return
    setCropError('')
    try {
      const sourceWidth = stageSize.width / (baseScale * zoom)
      const sourceHeight = stageSize.height / (baseScale * zoom)
      const sourceX = pan.x * (imageSize.width - sourceWidth)
      const sourceY = pan.y * (imageSize.height - sourceHeight)
      const outputWidth = Math.min(maximumOutputWidth, Math.round(sourceWidth))
      const outputHeight = Math.round(outputWidth / cropAspectRatio)
      const canvas = document.createElement('canvas')
      canvas.width = outputWidth
      canvas.height = outputHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Your browser could not prepare the cropped image.')
      context.drawImage(sourceImage, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, outputWidth, outputHeight)
      const extension = file.name.split('.').pop()?.toLowerCase()
      const outputType = extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((value) => {
          if (value) resolve(value)
          else reject(new Error('Your browser could not create the cropped image.'))
        }, outputType)
      })
      onSave(new File([blob], `project-cover.${extension === 'jpeg' ? 'jpg' : extension ?? 'jpg'}`, { type: blob.type }))
    } catch (error) {
      setCropError(error instanceof Error ? error.message : 'Could not crop this photo.')
    }
  }

  return createPortal(
    <div className="modal-backdrop project-cover-crop-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !saving) onCancel()
    }}>
      <section className="project-cover-crop-dialog" role="dialog" aria-modal="true" aria-labelledby="project-cover-crop-title">
        <div className="modal-heading">
          <div><div className="section-kicker">Project photo</div><h2 id="project-cover-crop-title">Adjust crop</h2></div>
          <button type="button" className="icon-button" onClick={onCancel} aria-label="Close crop editor" disabled={saving}><X size={18} /></button>
        </div>
        <p className="modal-intro">Drag the photo to reposition it, or use the slider to zoom. This crop will be used across project views.</p>
        <div
          ref={stageRef}
          className="project-cover-crop-stage"
          role="application"
          aria-label="Drag the photo to choose which area appears in the project cover"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <img
            ref={imageRef}
            src={sourceUrl}
            alt="Crop preview"
            draggable={false}
            onLoad={(event) => {
              setImageSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              setCropError('')
            }}
            onError={() => setCropError('The selected image could not be loaded. Please choose a different JPG, PNG, or WebP image.')}
            style={{
              width: imageWidth,
              height: imageHeight,
              left: (stageSize.width - imageWidth) * pan.x,
              top: (stageSize.height - imageHeight) * pan.y,
            }}
          />
          <span className="project-cover-crop-frame" aria-hidden="true" />
        </div>
        <label className="project-cover-crop-zoom">Zoom
          <input type="range" min="1" max="3" step="0.01" value={zoom} disabled={saving} onChange={(event) => setZoom(Number(event.target.value))} />
          <span>{Math.round(zoom * 100)}%</span>
        </label>
        {(cropError || error) && <p className="form-error" role="alert">{cropError || error}</p>}
        <div className="modal-actions">
          <button type="button" className="button button-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
          <button type="button" className="button button-primary" onClick={() => { void saveCrop() }} disabled={saving || !imageSize}>
            <Crop size={15} />{saving ? 'Saving…' : 'Save crop'}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
