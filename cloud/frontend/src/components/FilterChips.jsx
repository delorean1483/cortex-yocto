// A row of single-select filter chips; the selected one is aria-pressed.
export default function FilterChips({ label, options, value, onChange }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map(o => (
        <button key={o.value} type="button" className="chip" aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
