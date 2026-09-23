// In-app confirmation modal for write actions (no browser confirm()/alert()).
export default function ConfirmDialog({ open, title, body, confirmLabel = 'Confirm', danger, onConfirm, onCancel, pending }) {
  if (!open) return null
  return (
    <div onClick={onCancel} style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50,
    }}>
      <div onClick={(e) => e.stopPropagation()} className="card" role="dialog" aria-modal="true"
        aria-labelledby="confirm-title" style={{ maxWidth: 420, width: '90%', padding: '20px 22px' }}>
        <div id="confirm-title" style={{ fontWeight: 600, fontSize: 17, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: 15, color: 'var(--color-text-secondary)', marginBottom: 20, lineHeight: 1.5 }}>{body}</div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel} disabled={pending}>Cancel</button>
          <button className={`btn ${danger ? 'btn-red' : 'btn-primary'}`} onClick={onConfirm} disabled={pending}>
            {pending ? 'Sending…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
