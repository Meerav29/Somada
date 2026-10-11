import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Sparkline, toPoints } from './Sparkline'

describe('toPoints', () => {
  it('returns null with fewer than two numeric values', () => {
    expect(toPoints([], 100, 20)).toBeNull()
    expect(toPoints([null, 5, null], 100, 20)).toBeNull()
  })

  it('spans the full width and keeps the highest value at the top', () => {
    const points = toPoints([0, 10], 100, 20)
    expect(points).toBe('0.0,18.0 100.0,2.0')
  })

  it('leaves gaps in x for null values', () => {
    const points = toPoints([1, null, 3], 100, 20)
    expect(points?.split(' ').map((p) => p.split(',')[0])).toEqual(['0.0', '100.0'])
  })
})

describe('Sparkline', () => {
  it('renders an accessible svg', () => {
    render(<Sparkline values={[1, 2, 3]} label="Steps trend" />)
    expect(screen.getByRole('img', { name: 'Steps trend' })).toBeInTheDocument()
  })

  it('says so when there is not enough data', () => {
    render(<Sparkline values={[1]} label="Sleep trend" />)
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.getByText('Sleep trend: not enough data')).toBeInTheDocument()
  })
})
