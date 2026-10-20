// Labelled unit dropdown shared by the per-unit pages (Alerts, Maintenance,
// APU history). `units` are { unit, demo } objects from /fleet/units.
export const ALL_UNITS = '__all__'

export default function UnitPicker({ units, value, onChange, id = 'unit-picker', allLabel }) {
  return (
    <div className="field field-inline">
      <label htmlFor={id}>Unit</label>
      <select id={id} className="control" value={value || ''} onChange={(e) => onChange(e.target.value)}>
        {allLabel && <option value={ALL_UNITS}>{allLabel}</option>}
        {!value && <option value="">Select a unit</option>}
        {units.map((u) => <option key={u.unit} value={u.unit}>{u.unit}{u.demo ? ' (demo)' : ''}</option>)}
      </select>
    </div>
  )
}
