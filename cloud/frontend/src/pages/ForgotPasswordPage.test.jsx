import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'

vi.mock('../api/client.js', () => ({
  api: { forgotPassword: vi.fn(), resetPassword: vi.fn() },
}))

import { api } from '../api/client.js'
import ForgotPasswordPage from './ForgotPasswordPage.jsx'

function LoginStub() {
  const { state } = useLocation()
  return <div>login page: {state?.notice} [{state?.email}]</div>
}

function setup(initialState) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/forgot-password', state: initialState }]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/login" element={<LoginStub />} />
      </Routes>
    </MemoryRouter>)
}

async function sendCode(email = 'a@b.co') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
  await screen.findByLabelText('Code')
}

function fillReset({ code = '123456', password = 'Abcdefgh123!', confirm = password } = {}) {
  fireEvent.change(screen.getByLabelText('Code'), { target: { value: code } })
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: password } })
  fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: confirm } })
  fireEvent.click(screen.getByRole('button', { name: 'Set new password' }))
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    api.forgotPassword.mockReset().mockResolvedValue({})
    api.resetPassword.mockReset().mockResolvedValue({})
  })

  it('emails a code, then asks for the code and a new password', async () => {
    setup()
    await sendCode('a@b.co')
    expect(api.forgotPassword).toHaveBeenCalledWith('a@b.co')
    expect(screen.getByText(/a@b\.co/)).toBeTruthy()
    expect(screen.getByLabelText('New password')).toBeTruthy()
  })

  it('starts with the email the sign-in page passed along', () => {
    setup({ email: 'c@d.co' })
    expect(screen.getByLabelText('Email').value).toBe('c@d.co')
  })

  it('a good code and password go back to sign-in with a notice and the email', async () => {
    setup()
    await sendCode('a@b.co')
    fillReset({ code: ' 123456 ', password: 'Abcdefgh123!' })
    await waitFor(() => expect(api.resetPassword)
      .toHaveBeenCalledWith({ email: 'a@b.co', code: '123456', password: 'Abcdefgh123!' }))
    expect(await screen.findByText(/login page: Password changed/)).toBeTruthy()
    expect(screen.getByText(/\[a@b\.co\]/)).toBeTruthy()
  })

  it('mismatched passwords never reach the server', async () => {
    setup()
    await sendCode()
    fillReset({ password: 'Abcdefgh123!', confirm: 'Abcdefgh123?' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/don't match/)
    expect(api.resetPassword).not.toHaveBeenCalled()
  })

  it('a password that breaks the rules says what is missing', async () => {
    setup()
    await sendCode()
    fillReset({ password: 'abcdefghijkl' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/uppercase letter/)
    expect(api.resetPassword).not.toHaveBeenCalled()
  })

  it('a wrong code shows the server message and stays on the page', async () => {
    api.resetPassword.mockRejectedValue(new Error('That code is not right.'))
    setup()
    await sendCode()
    fillReset()
    expect((await screen.findByRole('alert')).textContent).toContain('That code is not right.')
    expect(screen.getByLabelText('Code')).toBeTruthy()
  })

  it('can send a new code', async () => {
    setup()
    await sendCode('a@b.co')
    fireEvent.click(screen.getByRole('button', { name: 'Send a new code' }))
    await waitFor(() => expect(api.forgotPassword).toHaveBeenCalledTimes(2))
    expect(api.forgotPassword).toHaveBeenLastCalledWith('a@b.co')
  })

  it('a failed send shows the error and stays on the email step', async () => {
    api.forgotPassword.mockRejectedValue(new Error('Too many attempts.'))
    setup()
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Too many attempts.')
    expect(screen.queryByLabelText('Code')).toBeNull()
  })

  it('links back to sign-in', () => {
    setup()
    expect(screen.getByRole('link', { name: 'Back to sign in' }).getAttribute('href')).toBe('/login')
  })
})
