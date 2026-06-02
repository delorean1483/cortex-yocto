import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { IconBolt } from '@tabler/icons-react'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'

export default function LoginPage() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]       = useState('')
  const [loading, setLoading]   = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const data = await api.login(email, password)
      login(data.token, data.refresh_token, email)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background-secondary)' }}>
      <div style={{ width: 340, background: 'var(--color-background-primary)', border: '0.5px solid var(--color-border-tertiary)', borderRadius: 12, padding: '28px 28px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <IconBolt size={20} color="#fff" />
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>EcoFleet</div>
            <div style={{ fontSize: 11, color: 'var(--color-text-tertiary)' }}>Fleet management dashboard</div>
          </div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Email</label>
            <input
              type="email" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              style={inputStyle}
            />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <label style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--color-text-secondary)' }}>Password</label>
            <input
              type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{ fontSize: 12, color: '#E24B4A', padding: '7px 10px', background: 'var(--color-background-danger)', borderRadius: 6, border: '0.5px solid var(--color-border-danger)' }}>
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn btn-amber" style={{ marginTop: 4, justifyContent: 'center', padding: '8px 0', fontSize: 13 }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

const inputStyle = {
  fontSize: 13, padding: '7px 10px',
  border: '0.5px solid var(--color-border-secondary)',
  borderRadius: 6, background: 'var(--color-background-primary)',
  color: 'var(--color-text-primary)', outline: 'none', width: '100%',
}
