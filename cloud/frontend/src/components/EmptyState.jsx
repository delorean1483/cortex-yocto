// Icon + one plain sentence + what to do next, instead of a bare "0" or "—".
export default function EmptyState({ icon: Icon, tone = 'off', title, children, action }) {
  return (
    <div className="panel">
      <div className="empty">
        {Icon && <span className={`badge badge-icon t-${tone}`}><Icon size={20} aria-hidden="true" /></span>}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="empty-title">{title}</div>
          {children && <div className="empty-sub">{children}</div>}
        </div>
        {action}
      </div>
    </div>
  )
}
