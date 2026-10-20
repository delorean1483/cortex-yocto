import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import FilterChips from './FilterChips.jsx'

describe('FilterChips', () => {
  it('marks the selected chip pressed and reports clicks', () => {
    const onChange = vi.fn()
    render(<FilterChips label="Severity" value="all" onChange={onChange}
      options={[{ value: 'all', label: 'All · 3' }, { value: 'err', label: 'Critical · 1' }]} />)
    const group = screen.getByRole('group', { name: 'Severity' })
    expect(within(group).getByRole('button', { name: 'All · 3' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(within(group).getByRole('button', { name: 'Critical · 1' }))
    expect(onChange).toHaveBeenCalledWith('err')
  })
})
