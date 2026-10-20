import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const deleteUser = vi.fn(() => Promise.resolve({}))
const updateUser = vi.fn(() => Promise.resolve({}))
vi.mock('../api/client.js', () => ({
  api: {
    listUsers: () => Promise.resolve({
      users: [
        { email: 'tech@ecofleet.io', role: 'maint', status: 'CONFIRMED' },
        { email: 'me@ecofleet.io', role: 'admin', status: 'CONFIRMED' },
        { email: 'mgr@fleet1.com', role: 'fm', fleet: 'FLEET-001', status: 'invited' },
        { email: 'odd@fleet1.com', role: 'superadmin', fleet: '—', status: 'active' },
      ],
    }),
    deleteUser: (...a) => deleteUser(...a),
    createUser: vi.fn(),
    updateUser: (...a) => updateUser(...a),
  },
}))
vi.mock('../contexts/AuthContext.jsx', () => ({
  useAuth: () => ({ role: 'admin', user: { email: 'me@ecofleet.io' } }),
  ROLE_CFG: {
    admin: { lbl: 'Admin', badge: 'rb-admin' }, fm: { lbl: 'FM', badge: 'rb-fm' },
    maint: { lbl: 'Maint', badge: 'rb-maint' }, eu: { lbl: 'EU', badge: 'rb-eu' },
  },
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

describe('UsersPage table', () => {
  beforeEach(() => updateUser.mockClear())

  it('maps statuses and falls back to the raw role', async () => {
    render(<UsersPage />)
    await screen.findByText('mgr@fleet1.com')
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0)
    expect(screen.getByText('Pending')).toBeTruthy()
    expect(screen.getByText('superadmin')).toBeTruthy()
  })

  it('has no inline role select; Change role opens a dialog and confirms', async () => {
    render(<UsersPage />)
    await screen.findByText('mgr@fleet1.com')
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Change role for mgr@fleet1.com' }))
    const sel = await screen.findByLabelText('New role')
    expect(sel.value).toBe('fm')
    fireEvent.change(sel, { target: { value: 'maint' } })
    fireEvent.click(screen.getByRole('button', { name: 'Change role' }))
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('mgr@fleet1.com', { role: 'maint' }))
  })

  it("current user's row has no actions and shows (you)", async () => {
    render(<UsersPage />)
    await screen.findByText('mgr@fleet1.com')
    expect(screen.getByText('(you)')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Delete me@ecofleet.io' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Change role for me@ecofleet.io' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete mgr@fleet1.com' })).toBeTruthy()
  })

  it('search narrows rows and role chips filter by role', async () => {
    render(<UsersPage />)
    await screen.findByText('mgr@fleet1.com')
    fireEvent.change(screen.getByLabelText('Filter by email'), { target: { value: 'tech' } })
    expect(screen.queryByText('mgr@fleet1.com')).toBeNull()
    expect(screen.getByText('tech@ecofleet.io')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Filter by email'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'FM' }))
    expect(screen.getByText('mgr@fleet1.com')).toBeTruthy()
    expect(screen.queryByText('tech@ecofleet.io')).toBeNull()
  })
})
