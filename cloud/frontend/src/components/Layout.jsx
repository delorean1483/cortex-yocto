import { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  IconLayoutDashboard, IconMap2,
  IconTool, IconBell, IconChartBar,
  IconHistory, IconUsers, IconSettings, IconLogout, IconChevronDown,
  IconSun, IconMoon,
} from '@tabler/icons-react'
import { useAuth, ROLE_CFG } from '../contexts/AuthContext.jsx'
import { currentTheme, nextTheme, applyTheme } from '../theme.js'
import BrandLogo from './BrandLogo.jsx'

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

export default function Layout({ children }) {
  const { user, role, setRole, logout } = useAuth()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const cfg = ROLE_CFG[role]

  // Theme is applied to <html> before paint by the init script in index.html;
  // this local state just tracks it so the toggle icon re-renders.
  const [theme, setTheme] = useState(() => currentTheme())
  function toggleTheme() {
    const t = nextTheme(theme)
    applyTheme(t)
    setTheme(t)
  }

  function handleNav(path) {
    if (!cfg.nav.includes(path)) return
    navigate(path)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--color-background-primary)' }}>

      {/* Sidebar */}
      <nav aria-label="Main" style={{ width: 232, flexShrink: 0, background: 'var(--color-background-secondary)', borderRight: '0.5px solid var(--color-border-tertiary)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Brand */}
        <div style={{ padding: '18px 18px 14px', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0 }}>
          <BrandLogo theme={theme} height={48} />
          <div style={{ fontSize: 13, color: 'var(--color-text-tertiary)', marginTop: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {user?.email}
          </div>
        </div>

        {/* Nav */}
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 12 }}>
          {SECTIONS.map(section => {
            const items = NAV.filter(n => n.section === section)
            const visible = items.filter(n => cfg.nav.includes(n.id))
            if (!visible.length) return null
            return (
              <div key={section}>
                <div style={{ padding: '16px 16px 4px', fontSize: 12, fontWeight: 600, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                  {section}
                </div>
                {items.map(({ id, label, Icon }) => {
                  const allowed = cfg.nav.includes(id)
                  const active = pathname === id || (id !== '/' && pathname.startsWith(id))
                  if (!allowed) return null
                  return (
                    <button key={id} onClick={() => handleNav(id)} aria-current={active ? 'page' : undefined} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      minHeight: 40, padding: '0 12px', borderRadius: 8, margin: '1px 8px',
                      cursor: 'pointer', fontSize: 15, border: 'none', width: 'calc(100% - 16px)', textAlign: 'left',
                      background: active ? 'var(--color-background-primary)' : 'none',
                      color: active ? 'var(--accent)' : 'var(--color-text-secondary)',
                      fontWeight: active ? 600 : 400,
                      transition: 'background .1s, color .1s',
                    }}>
                      <Icon size={19} style={{ flexShrink: 0 }} />
                      {label}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Logout */}
        <button onClick={logout} style={{ display: 'flex', alignItems: 'center', minHeight: 44, padding: '0 20px', borderTop: '0.5px solid var(--color-border-tertiary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 15, gap: 12, color: 'var(--color-text-tertiary)', width: '100%', flexShrink: 0 }}>
          <IconLogout size={19} />
          Sign out
        </button>
      </nav>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 64, padding: '10px 24px', borderBottom: '0.5px solid var(--color-border-tertiary)', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 20, fontWeight: 600 }}>
            {pathname.startsWith('/units/')
              ? 'Unit'
              : NAV.find(n => n.id === pathname)?.label ?? NAV.find(n => pathname.startsWith(n.id) && n.id !== '/')?.label ?? 'Dashboard'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={toggleTheme}
              className="btn"
              title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              aria-label="Toggle light/dark theme"
              style={{ padding: 0, width: 36 }}
            >
              {theme === 'dark' ? <IconSun size={18} /> : <IconMoon size={18} />}
            </button>
            <span className={`rbadge ${cfg.badge}`}>{cfg.lbl}</span>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              aria-label="View as role"
              style={{ fontSize: 14, minHeight: 36, border: '0.5px solid var(--color-border-secondary)', borderRadius: 8, padding: '0 10px', background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
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
        <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
