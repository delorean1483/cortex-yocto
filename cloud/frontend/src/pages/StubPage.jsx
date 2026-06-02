import { IconMap2, IconTool, IconUsers, IconSettings, IconChartBar } from '@tabler/icons-react'

const STUBS = {
  map: {
    Icon: IconMap2,
    title: 'Fleet map',
    msg: 'Wire up a mapping provider (Mapbox GL JS or Google Maps) using GPS coordinates from the telemetry bucket. Each unit publishes lat/lng in its telemetry payload once GPS is enabled on the device.',
  },
  maintenance: {
    Icon: IconTool,
    title: 'Maintenance history',
    msg: 'Requires a DynamoDB table + Lambda endpoint to store maintenance records. Planned for Phase 2 backend work.',
  },
  users: {
    Icon: IconUsers,
    title: 'User management',
    msg: 'Requires a Cognito admin Lambda to list, create, and update users with role assignments. Planned for Phase 2 backend work.',
  },
  config: {
    Icon: IconSettings,
    title: 'System configuration',
    msg: 'Infrastructure settings managed via Terraform. Secrets (InfluxDB token, JWT secret) rotatable via AWS Secrets Manager. Alert thresholds currently defined in device firmware.',
  },
  reports: {
    Icon: IconChartBar,
    title: 'Reports',
    msg: 'Aggregate reports (runtime totals, fuel savings, MTBF) require cross-unit InfluxDB queries. Planned for Phase 2.',
  },
}

export default function StubPage({ page }) {
  const stub = STUBS[page] || STUBS.map
  const { Icon, title, msg } = stub

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
      <div className="notice" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 10, padding: '16px 18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Icon size={18} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
          <span style={{ fontWeight: 500, fontSize: 13 }}>{title}</span>
          <span className="pill p-n" style={{ marginLeft: 4 }}>Coming soon</span>
        </div>
        <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>{msg}</p>
      </div>

      {page === 'map' && (
        <div style={{ background: 'var(--color-background-secondary)', borderRadius: 'var(--border-radius-lg)', height: 240, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '0.5px solid var(--color-border-tertiary)' }}>
          <div style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
            <Icon size={40} style={{ display: 'block', margin: '0 auto 8px' }} />
            <span style={{ fontSize: 12 }}>Map canvas placeholder</span>
          </div>
        </div>
      )}
    </div>
  )
}
