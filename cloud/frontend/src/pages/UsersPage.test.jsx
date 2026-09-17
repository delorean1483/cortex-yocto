import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const deleteUser = vi.fn(() => Promise.resolve({}))
vi.mock('../api/client.js', () => ({
  api: {
    listUsers: () => Promise.resolve({
      users: [
        { email: 'tech@ecofleet.io', role: 'maint', status: 'CONFIRMED' },
        { email: 'me@ecofleet.io', role: 'admin', status: 'CONFIRMED' },
      ],
    }),
    deleteUser: (...a) => deleteUser(...a),
    createUser: vi.fn(),
    updateUser: vi.fn(),
  },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'admin', user: { email: 'me@ecofleet.io' } }),
  ROLE_CFG: { admin: { lbl: 'Admin' }, fm: { lbl: 'FM' }, maint: { lbl: 'Maint' }, eu: { lbl: 'EU' } },
}))

import UsersPage from './UsersPage.jsx'

describe('UsersPage delete', () => {
  beforeEach(() => deleteUser.mockClear())

  it('deletes only after the in-app confirm dialog is confirmed (no native confirm)', async () => {
    render(<UsersPage />)

    // Row delete button (aria-labelled); the current user has no delete button.
    const rowDelete = await screen.findByRole('button', { name: 'Delete tech@ecofleet.io' })
    fireEvent.click(rowDelete)

    // Dialog appears (unique body text); nothing deleted yet.
    expect(await screen.findByText(/removes their account/)).toBeTruthy()
    expect(deleteUser).not.toHaveBeenCalled()

    // Confirm fires the delete with the right email.
    fireEvent.click(screen.getByRole('button', { name: 'Delete user' }))
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('tech@ecofleet.io'))
  })

  it('cancel closes the dialog without deleting', async () => {
    render(<UsersPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Delete tech@ecofleet.io' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText(/removes their account/)).toBeNull())
    expect(deleteUser).not.toHaveBeenCalled()
  })
})
