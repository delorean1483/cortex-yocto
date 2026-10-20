import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { IconAlertCircle } from '@tabler/icons-react'
import BrandLogo from '../components/BrandLogo.jsx'

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
      login(data.token, data.refresh_token)
      navigate('/', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background-secondary)' }}>
      <div style={{ width: 400, maxWidth: 'calc(100vw - 32px)', background: 'var(--color-background-primary)', border: '1px solid var(--color-border-secondary)', borderRadius: 14, padding: '36px 36px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <BrandLogo height={60} />
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>Fleet management dashboard</div>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="field">
            <label htmlFor="login-email">Email</label>
            <input
              id="login-email" className="control" style={{ minHeight: 44 }}
              type="email" required autoFocus
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <input
              id="login-password" className="control" style={{ minHeight: 44 }}
              type="password" required
              value={password} onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: 'var(--err)', padding: '10px 12px', background: 'var(--err-soft)', borderRadius: 8 }}>
              <IconAlertCircle size={18} stroke={1.75} style={{ flexShrink: 0 }} />
              <span>{error}</span>
            </div>
          )}

          <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}
