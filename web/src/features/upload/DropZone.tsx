import { useId, useState } from 'react'

export function DropZone({ onFile, disabled = false }: { onFile: (file: File) => void; disabled?: boolean }) {
  const [dragging, setDragging] = useState(false)
  const inputId = useId()

  function pick(files: ArrayLike<File> | null | undefined) {
    const file = files?.[0]
    if (file) onFile(file)
  }

  const classes = ['dropzone', dragging ? 'dragging' : '', disabled ? 'disabled' : ''].filter(Boolean).join(' ')

  return (
    <label
      htmlFor={inputId}
      className={classes}
      onDragOver={(e) => {
        e.preventDefault()
        if (!disabled) setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (!disabled) pick(e.dataTransfer.files)
      }}
    >
      <span className="dropzone-title">Choose your export</span>
      <span className="muted">or drop export.zip (or export.xml) here</span>
      <input
        id={inputId}
        type="file"
        accept=".zip,.xml,application/zip,text/xml,application/xml"
        disabled={disabled}
        onChange={(e) => {
          pick(e.target.files)
          e.target.value = ''
        }}
      />
      <span className="muted">Your file is read in your browser. Nothing is sent until you press Save.</span>
    </label>
  )
}
