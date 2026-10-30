import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import AuthCard, { AuthError, AuthNotice } from '../components/AuthCard.jsx'

export default function LoginPage() {
  // Arriving from a password reset: { notice, email }
  const { state } = useLocation()
  const [email, setEmail]       = useState(state?.email || '')
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
    <AuthCard subtitle="Fleet management dashboard">
      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {state?.notice && !error && <AuthNotice>{state.notice}</AuthNotice>}

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

        {error && <AuthError>{error}</AuthError>}

        <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>

        <Link to="/forgot-password" state={{ email }} className="text-link" style={{ alignSelf: 'center' }}>
          Forgot password?
        </Link>
      </form>
    </AuthCard>
  )
}
