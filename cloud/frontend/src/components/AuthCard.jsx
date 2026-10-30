import { IconAlertCircle, IconCircleCheck } from '@tabler/icons-react'
import BrandLogo from './BrandLogo.jsx'

// Centered card for the signed-out pages (sign in, forgot password).
export default function AuthCard({ subtitle, children }) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-background-secondary)' }}>
      <div style={{ width: 400, maxWidth: 'calc(100vw - 32px)', background: 'var(--color-background-primary)', border: '1px solid var(--color-border-secondary)', borderRadius: 14, padding: '36px 36px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          <BrandLogo height={60} />
          <div style={{ fontSize: 15, color: 'var(--color-text-secondary)' }}>{subtitle}</div>
        </div>
        {children}
      </div>
    </div>
  )
}

const noteStyle = { display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, padding: '10px 12px', borderRadius: 8 }

export function AuthError({ children }) {
  return (
    <div role="alert" style={{ ...noteStyle, color: 'var(--err)', background: 'var(--err-soft)' }}>
      <IconAlertCircle size={18} stroke={1.75} style={{ flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  )
}

export function AuthNotice({ children }) {
  return (
    <div role="status" style={{ ...noteStyle, color: 'var(--ok)', background: 'var(--ok-soft)' }}>
      <IconCircleCheck size={18} stroke={1.75} style={{ flexShrink: 0 }} />
      <span>{children}</span>
    </div>
  )
}
