import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ExportGuide } from './ExportGuide'

describe('ExportGuide', () => {
  it('lists the export steps in order', () => {
    render(<ExportGuide />)
    const steps = screen.getAllByRole('listitem')
    expect(steps).toHaveLength(4)
    expect(steps[0]).toHaveTextContent(/Health app/)
    expect(steps[1]).toHaveTextContent(/Export All Health Data/)
    expect(steps[2]).toHaveTextContent(/Move the ZIP/)
  })

  it('tells users they do not need to unzip', () => {
    render(<ExportGuide />)
    expect(screen.getByText(/don't need to unzip/i)).toBeInTheDocument()
  })
})
