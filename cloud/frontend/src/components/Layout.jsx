import { useNavigate, useLocation } from 'react-router-dom'
import {
  IconLayoutDashboard, IconMap2, IconAdjustmentsHorizontal,
  IconTool, IconDeviceDesktopDown, IconBell, IconChartBar,
  IconHistory, IconUsers, IconSettings, IconLogout, IconChevronDown,
} from '@tabler/icons-react'
import { useAuth, ROLE_CFG } from '../contexts/AuthContext.jsx'
import logo from '../assets/ecofleet_logo.svg'

const NAV = [
  { id: '/',            label: 'Dashboard',      Icon: IconLayoutDashboard,        section: 'Overview' },
  { id: '/map',         label: 'Fleet map',       Icon: IconMap2,                   section: 'Overview' },
  { id: '/remote',      label: 'Remote control',  Icon: IconAdjustmentsHorizontal,  section: 'Operations' },
  { id: '/maintenance', label: 'Maintenance',      Icon: IconTool,                   section: 'Operations' },
  { id: '/firmware',    label: 'Firmware',         Icon: IconDeviceDesktopDown,      section: 'Operations' },
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

  function handleNav(path) {
    if (!cfg.nav.includes(path)) return
    navigate(path)
  }

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--color-background-primary)' }}>

      {/* Sidebar */}
      <nav style={{ width: 172, flexShrink: 0, background: 'var(--color-background-secondary)', borderRight: '0.5px solid var(--color-border-tertiary)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Brand */}
        <div style={{ padding: '14px 14px 12px', borderBottom: '0.5px solid var(--color-border-tertiary)', flexShrink: 0 }}>
          <span className="brand-logo-wrap">
            <img src={logo} alt="EcoFleet" style={{ height: 22 }} />
          </span>
          <div style={{ fontSize: 10, color: 'var(--color-text-tertiary)', marginTop: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 144 }}>
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
                <div style={{ padding: '14px 12px 3px', fontSize: 9.5, fontWeight: 500, letterSpacing: '.09em', textTransform: 'uppercase', color: 'var(--color-text-tertiary)' }}>
                  {section}
                </div>
                {items.map(({ id, label, Icon }) => {
                  const allowed = cfg.nav.includes(id)
                  const active = pathname === id || (id !== '/' && pathname.startsWith(id))
                  if (!allowed) return null
                  return (
                    <button key={id} onClick={() => handleNav(id)} style={{
                      display: 'flex', alignItems: 'center', gap: 7,
                      padding: '7px 10px', borderRadius: 6, margin: '1px 5px',
                      cursor: 'pointer', fontSize: 12, border: 'none', width: 'calc(100% - 10px)', textAlign: 'left',
                      background: active ? 'var(--color-background-primary)' : 'none',
                      color: active ? 'var(--accent)' : 'var(--color-text-secondary)',
                      fontWeight: active ? 500 : 400,
                      transition: 'background .1s, color .1s',
                    }}>
                      <Icon size={15} style={{ flexShrink: 0, width: 16 }} />
                      {label}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>

        {/* Logout */}
        <button onClick={logout} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '10px 15px', borderTop: '0.5px solid var(--color-border-tertiary)', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--color-text-tertiary)', width: '100%', flexShrink: 0 }}>
          <IconLogout size={15} />
          Sign out
        </button>
      </nav>

      {/* Main */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Topbar */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '0.5px solid var(--color-border-tertiary)', gap: 8, flexShrink: 0 }}>
          <span style={{ fontSize: 14, fontWeight: 500 }}>
            {pathname.startsWith('/units/')
              ? 'Unit detail'
              : NAV.find(n => n.id === pathname)?.label ?? NAV.find(n => pathname.startsWith(n.id) && n.id !== '/')?.label ?? 'Dashboard'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`rbadge ${cfg.badge}`}>{cfg.lbl}</span>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              style={{ fontSize: 11, border: '0.5px solid var(--color-border-secondary)', borderRadius: 5, padding: '3px 6px', background: 'var(--color-background-secondary)', color: 'var(--color-text-secondary)', cursor: 'pointer' }}
              title="Switch role (demo)"
            >
              <option value="admin">Admin</option>
              <option value="fm">Fleet Manager</option>
              <option value="maint">Maintenance</option>
              <option value="eu">End User</option>
            </select>
          </div>
        </div>

        {/* Page content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {children}
        </div>
      </div>
    </div>
  )
}
