// In-app confirmation modal for write actions (no browser confirm()/alert()).
export default function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onCancel, pending }) {
  if (!open) return null
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 380, width: '90%' }}>
        <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-sm" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className={`btn btn-sm ${danger ? 'btn-red' : 'btn-primary'}`} onClick={onConfirm} disabled={pending}>
            {pending ? 'Sending…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
