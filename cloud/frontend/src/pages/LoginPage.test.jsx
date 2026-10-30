import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const state = vi.hoisted(() => ({ login: vi.fn() }))
vi.mock('../api/client.js', () => ({
  api: { login: vi.fn() },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ login: state.login }),
}))

import { api } from '../api/client.js'
import LoginPage from './LoginPage.jsx'

function setup(state) {
  return render(<MemoryRouter initialEntries={[{ pathname: '/login', state }]}><LoginPage /></MemoryRouter>)
}

describe('LoginPage', () => {
  it('shows the subtitle, labelled fields and a Sign in button', () => {
    setup()
    expect(screen.getByText('Fleet management dashboard')).toBeTruthy()
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(screen.getByLabelText('Password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy()
  })

  it('a failed sign-in shows the error in an alert', async () => {
    api.login.mockRejectedValue(new Error('Incorrect username or password.'))
    setup()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'x' } })
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Incorrect username or password.')
  })

  it('has a Forgot password? link to the reset page', () => {
    setup()
    expect(screen.getByRole('link', { name: 'Forgot password?' }).getAttribute('href')).toBe('/forgot-password')
  })

  it('after a reset, shows the notice and fills in the email', () => {
    setup({ notice: 'Password changed. Sign in with your new password.', email: 'a@b.co' })
    expect(screen.getByRole('status').textContent).toContain('Password changed.')
    expect(screen.getByLabelText('Email').value).toBe('a@b.co')
  })
})
