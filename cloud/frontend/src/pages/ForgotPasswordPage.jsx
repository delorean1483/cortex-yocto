import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import AuthCard, { AuthError, AuthNotice } from '../components/AuthCard.jsx'
import { passwordProblem, PASSWORD_HINT } from '../api/password.js'

// Two steps: email -> Cognito emails a code -> code + new password -> sign in.
export default function ForgotPasswordPage() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const [step, setStep]         = useState('email')   // 'email' | 'code'
  const [email, setEmail]       = useState(state?.email || '')
  const [code, setCode]         = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm]   = useState('')
  const [error, setError]       = useState('')
  const [resent, setResent]     = useState(false)
  const [loading, setLoading]   = useState(false)

  async function sendCode(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.forgotPassword(email.trim())
      setStep('code')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function resendCode() {
    setError('')
    setResent(false)
    try {
      await api.forgotPassword(email.trim())
      setResent(true)
    } catch (err) {
      setError(err.message)
    }
  }

  async function resetPassword(e) {
    e.preventDefault()
    setError('')
    setResent(false)
    const problem = passwordProblem(password)
    if (problem) return setError(problem)
    if (password !== confirm) return setError("The two passwords don't match.")
    setLoading(true)
    try {
      await api.resetPassword({ email: email.trim(), code: code.trim(), password })
      navigate('/login', {
        replace: true,
        state: { notice: 'Password changed. Sign in with your new password.', email: email.trim() },
      })
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  const backLink = (
    <Link to="/login" className="text-link" style={{ alignSelf: 'center' }}>Back to sign in</Link>
  )

  if (step === 'email') {
    return (
      <AuthCard subtitle="Reset your password">
        <form onSubmit={sendCode} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
            Enter the email you sign in with and we'll email you a code to set a new password.
          </div>
          <div className="field">
            <label htmlFor="fp-email">Email</label>
            <input
              id="fp-email" className="control" style={{ minHeight: 44 }}
              type="email" required autoFocus autoComplete="username"
              value={email} onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </div>

          {error && <AuthError>{error}</AuthError>}

          <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }}>
            {loading ? 'Sending…' : 'Email me a code'}
          </button>
          {backLink}
        </form>
      </AuthCard>
    )
  }

  return (
    <AuthCard subtitle="Reset your password">
      <form onSubmit={resetPassword} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
          If <strong>{email.trim()}</strong> has an account, a 6-digit code is on its way
          from no-reply@verificationemail.com. It can take a minute; check spam too.
        </div>
        <div className="field">
          <label htmlFor="fp-code">Code</label>
          <input
            id="fp-code" className="control" style={{ minHeight: 44 }}
            required autoFocus inputMode="numeric" autoComplete="one-time-code"
            value={code} onChange={e => setCode(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="fp-password">New password</label>
          <input
            id="fp-password" className="control" style={{ minHeight: 44 }}
            type="password" required autoComplete="new-password"
            value={password} onChange={e => setPassword(e.target.value)}
          />
          <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 4 }}>{PASSWORD_HINT}</div>
        </div>
        <div className="field">
          <label htmlFor="fp-confirm">Confirm new password</label>
          <input
            id="fp-confirm" className="control" style={{ minHeight: 44 }}
            type="password" required autoComplete="new-password"
            value={confirm} onChange={e => setConfirm(e.target.value)}
          />
        </div>

        {error && <AuthError>{error}</AuthError>}
        {resent && !error && <AuthNotice>New code sent.</AuthNotice>}

        <button type="submit" disabled={loading} className="btn btn-primary btn-lg" style={{ width: '100%', justifyContent: 'center' }}>
          {loading ? 'Saving…' : 'Set new password'}
        </button>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <button type="button" className="text-link" onClick={resendCode}>Send a new code</button>
          <button type="button" className="text-link" onClick={() => { setStep('email'); setError(''); setResent(false) }}>
            Use a different email
          </button>
        </div>
        {backLink}
      </form>
    </AuthCard>
  )
}
