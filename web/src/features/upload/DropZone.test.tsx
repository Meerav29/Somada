import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { DropZone } from './DropZone'

const zip = () => new File(['x'], 'export.zip', { type: 'application/zip' })

describe('DropZone', () => {
  it('has a labelled file input that accepts zip and xml', () => {
    render(<DropZone onFile={() => {}} />)
    const input = screen.getByLabelText(/choose your export/i)
    expect(input).toHaveAttribute('type', 'file')
    expect(input).toHaveAttribute('accept', expect.stringContaining('.zip'))
    expect(input).toHaveAttribute('accept', expect.stringContaining('.xml'))
  })

  it('passes a chosen file to onFile', async () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} />)
    const file = zip()
    await userEvent.upload(screen.getByLabelText(/choose your export/i), file)
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('passes a dropped file to onFile', () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} />)
    const file = zip()
    fireEvent.drop(screen.getByText(/choose your export/i).closest('label') as HTMLElement, {
      dataTransfer: { files: [file] },
    })
    expect(onFile).toHaveBeenCalledWith(file)
  })

  it('ignores drops and disables the input when disabled', () => {
    const onFile = vi.fn()
    render(<DropZone onFile={onFile} disabled />)
    expect(screen.getByLabelText(/choose your export/i)).toBeDisabled()
    fireEvent.drop(screen.getByText(/choose your export/i).closest('label') as HTMLElement, {
      dataTransfer: { files: [zip()] },
    })
    expect(onFile).not.toHaveBeenCalled()
  })

  it('states that nothing is sent until Save', () => {
    render(<DropZone onFile={() => {}} />)
    expect(screen.getByText(/nothing is sent until you press save/i)).toBeInTheDocument()
  })
})
