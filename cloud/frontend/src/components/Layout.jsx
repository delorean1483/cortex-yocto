import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  IconLayoutDashboard, IconMap2,
  IconTool, IconBell, IconChartBar,
  IconHistory, IconUsers, IconSettings, IconLogout,
  IconSun, IconMoon, IconMenu2, IconX, IconLayoutSidebarLeftExpand,
} from '@tabler/icons-react'
import { useAuth, ROLE_CFG } from '../contexts/AuthContext.jsx'
import { currentTheme, nextTheme, applyTheme } from '../theme.js'
import BrandLogo from './BrandLogo.jsx'
import { useNavMode } from './navMode.js'

const NAV = [
  { id: '/',            label: 'Dashboard',      Icon: IconLayoutDashboard,        section: 'Overview' },
  { id: '/map',         label: 'Fleet map',       Icon: IconMap2,                   section: 'Overview' },
  { id: '/maintenance', label: 'Maintenance',      Icon: IconTool,                   section: 'Operations' },
  { id: '/alerts',      label: 'Alerts',           Icon: IconBell,                   section: 'Insights' },
  { id: '/reports',     label: 'Reports',          Icon: IconChartBar,               section: 'Insights' },
  { id: '/history',     label: 'APU history',      Icon: IconHistory,                section: 'Insights' },
  { id: '/users',       label: 'Users',            Icon: IconUsers,                  section: 'Admin' },
  { id: '/config',      label: 'System config',    Icon: IconSettings,               section: 'Admin' },
]

const SECTIONS = ['Overview', 'Operations', 'Insights', 'Admin']

// Brand, page links and sign-out. `compact` is the 64px icon rail: labels move
// into aria-label/title so every button keeps its accessible name.
function SidebarContent({ compact, theme, email, allowed, pathname, onNav, onLogout, firstRef }) {
  let first = true
  return (
    <>
      <div style={{ padding: compact ? '14px 0 10px' : '18px 18px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0, textAlign: compact ? 'center' : 'left' }}>
        {compact
          ? <img src="/favicon.svg" alt="EcoFleet" style={{ width: 36, height: 36 }} />
          : <>
              <BrandLogo theme={theme} height={48} />
              <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {email}
              </div>
            </>}
      </div>

      <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
        {SECTIONS.map((section, si) => {
          const items = NAV.filter((n) => n.section === section && allowed.includes(n.id))
          if (!items.length) return null
          return (
            <div key={section}>
              {compact
                ? si > 0 && <div aria-hidden="true" style={{ height: 1, margin: '10px 14px', background: 'var(--color-border-tertiary)' }} />
                : <div style={{ padding: '16px 16px 4px', fontSize: 12, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                    {section}
                  </div>}
              {items.map(({ id, label, Icon }) => {
                const active = pathname === id || (id !== '/' && pathname.startsWith(id))
                const ref = first ? firstRef : undefined
                first = false
                return (
                  <button key={id} ref={ref} onClick={() => onNav(id)} aria-current={active ? 'page' : undefined}
                    aria-label={compact ? label : undefined} title={compact ? label : undefined}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start', gap: 12,
                      minHeight: compact ? 44 : 40, padding: compact ? 0 : '0 12px', borderRadius: 8, margin: '1px 8px',
                      cursor: 'pointer', fontSize: 15, border: 'none', width: 'calc(100% - 16px)', textAlign: 'left',
                      background: active ? 'var(--color-background-primary)' : 'none',
                      color: active ? 'var(--accent)' : 'var(--color-text-secondary)',
                      fontWeight: active ? 600 : 400,
                      transition: 'background .1s, color .1s',
                    }}>
                    <Icon size={compact ? 21 : 19} style={{ flexShrink: 0 }} aria-hidden="true" />
                    {!compact && label}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      <button onClick={onLogout} aria-label={compact ? 'Sign out' : undefined} title={compact ? 'Sign out' : undefined}
        style={{ display: 'flex', alignItems: 'center', justifyContent: compact ? 'center' : 'flex-start', minHeight: 44, padding: compact ? 0 : '0 20px', borderTop: '0.5px solid var(--color-border-tertiary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, gap: 12, color: 'var(--color-text-tertiary)', width: '100%', flexShrink: 0 }}>
        <IconLogout size={19} aria-hidden="true" />
        {!compact && 'Sign out'}
      </button>
    </>
  )
}

export default function Layout({ children }) {
  const { user, role, setRole, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const cfg = ROLE_CFG[role]
  const mode = useNavMode()
  const phone = mode === 'drawer'

  // Theme is applied to <html> before paint by the init script in index.html;
  // this local state just tracks it so the toggle icon re-renders.
  const [theme, setTheme] = useState(() => currentTheme())
  function toggleTheme() {
    const t = nextTheme(theme)
    applyTheme(t)
    setTheme(t)
  }

  // Overlay navigation (rail "expand" or the phone drawer).
  const [open, setOpen] = useState(false)
  const openerRef = useRef(null)
  const firstLinkRef = useRef(null)
  const openNav = (e) => { openerRef.current = e.currentTarget; setOpen(true) }
  const closeNav = () => {
    setOpen(false)
    openerRef.current?.focus()
  }
  useEffect(() => { if (open) firstLinkRef.current?.focus() }, [open])
  useEffect(() => { if (mode === 'full') setOpen(false) }, [mode])

  function handleNav(path) {
    if (!cfg.nav.includes(path)) return
    setOpen(false)
    navigate(path)
  }

  const sidebar = (compact, withFirstRef) => (
    <SidebarContent compact={compact} theme={theme} email={user?.email} allowed={cfg.nav}
      pathname={pathname} onNav={handleNav} onLogout={logout} firstRef={withFirstRef ? firstLinkRef : undefined} />
  )

  const title = pathname.startsWith('/units/')
    ? 'Unit'
    : NAV.find((n) => n.id === pathname)?.label ?? NAV.find((n) => pathname.startsWith(n.id) && n.id !== '/')?.label ?? 'Dashboard'

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--color-background-primary)' }}>

      {mode !== 'drawer' && (
        <nav aria-label="Main" style={{ width: mode === 'rail' ? 64 : 232, flexShrink: 0, background: 'var(--color-background-secondary)', borderRight: '0.5px solid var(--color-border-tertiary)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {sidebar(mode === 'rail', false)}
          {mode === 'rail' && (
            <button onClick={openNav} aria-label="Expand navigation" aria-expanded={open} title="Expand navigation"
              style={{ minHeight: 44, border: 'none', borderTop: '0.5px solid var(--color-border-tertiary)', background: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', flexShrink: 0 }}>
              <IconLayoutSidebarLeftExpand size={20} aria-hidden="true" />
            </button>
          )}
        </nav>
      )}

      {open && (
        <>
          <div data-testid="nav-backdrop" onClick={closeNav}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 40 }} />
          <div role="dialog" aria-modal="true" aria-label="Navigation"
            onKeyDown={(e) => { if (e.key === 'Escape') closeNav() }}
            style={{ position: 'fixed', top: 0, bottom: 0, left: 0, width: 'min(280px, 85vw)', zIndex: 41, display: 'flex', flexDirection: 'column', background: 'var(--color-background-secondary)', borderRight: '0.5px solid var(--color-border-tertiary)', boxShadow: '0 8px 30px rgba(0,0,0,0.25)' }}>
            <button onClick={closeNav} aria-label="Close navigation" className="btn"
              style={{ position: 'absolute', top: 12, right: 12, width: 40, padding: 0 }}>
              <IconX size={18} aria-hidden="true" />
            </button>
            {sidebar(false, true)}
          </div>
        </>
      )}

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: phone ? 56 : 64, padding: phone ? '8px 16px' : '10px 24px', borderBottom: '0.5px solid var(--color-border-tertiary)', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            {phone && (
              <button onClick={openNav} className="btn" aria-label="Open navigation" aria-expanded={open}
                style={{ width: 44, minHeight: 44, padding: 0 }}>
                <IconMenu2 size={20} aria-hidden="true" />
              </button>
            )}
            <h1 style={{ margin: 0, fontSize: phone ? 18 : 20, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {title}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <button
              onClick={toggleTheme}
              className="btn"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle light/dark theme"
              style={{ padding: 0, width: 36 }}
            >
              {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </button>
            {!phone && <span className={`rbadge ${cfg.badge}`}>{cfg.lbl}</span>}
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              aria-label="View as role"
              style={{ fontSize: 14, minHeight: 36, maxWidth: phone ? 150 : undefined, border: '0.5px solid var(--color-border-secondary)', borderRadius: 8, padding: '0 10px', background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              title="Switch role (demo)"
            >
              <option value="admin">View as: Admin</option>
              <option value="fm">View as: Fleet Manager</option>
              <option value="maint">View as: Maintenance</option>
              <option value="eu">View as: End User</option>
            </select>
          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: phone ? '16px' : '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
