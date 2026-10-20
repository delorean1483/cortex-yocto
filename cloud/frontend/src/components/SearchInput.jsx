import { IconSearch } from '@tabler/icons-react'

// Search box with a leading magnifier icon.
export default function SearchInput({ value, onChange, placeholder, width }) {
  return (
    <div className="search" style={width ? { width } : undefined}>
      <IconSearch size={16} aria-hidden="true" />
      <input type="search" className="control" value={value} placeholder={placeholder}
        aria-label={placeholder} onChange={e => onChange(e.target.value)} />
    </div>
  )
}
