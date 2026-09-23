// Labelled unit dropdown shared by the per-unit pages (Alerts, Maintenance,
// APU history). `units` are { unit, demo } objects from /fleet/units.
export default function UnitPicker({ units, value, onChange, id = 'unit-picker' }) {
  return (
    <div className="field field-inline">
      <label htmlFor={id}>Unit</label>
      <select id={id} className="control" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {!value && <option value="">Select a unit</option>}
        {units.map((u) => <option key={u.unit} value={u.unit}>{u.unit}{u.demo ? ' (demo)' : ''}</option>)}
      </select>
    </div>
  )
}
