import { byAttention } from './contract.js'

// Strict decimal parser for hand-typed coordinates: "32.77", "-96.8".
// Returns null for blanks, words or comma decimals ("32,77") rather than guessing.
export function parseCoord(str) {
  const s = String(str ?? '').trim()
  if (!/^-?\d{1,3}(\.\d+)?$/.test(s)) return null
  return Number(s)
}

export const LABEL_MAX = 60

// Location editor fields -> { ok, value, errors } (mirrors the API's rules).
export function validateLatLon(latStr, lonStr, label) {
  const errors = {}
  const lat = parseCoord(latStr)
  const lon = parseCoord(lonStr)
  if (lat == null || lat < -90 || lat > 90) errors.lat = 'Latitude must be a number from -90 to 90'
  if (lon == null || lon < -180 || lon > 180) errors.lon = 'Longitude must be a number from -180 to 180'
  const t = String(label ?? '').trim()
  if (t.length > LABEL_MAX) errors.label = `Label must be ${LABEL_MAX} characters or fewer`
  const ok = Object.keys(errors).length === 0
  return ok ? { ok, value: { lat, lon, label: t || null }, errors } : { ok, errors }
}

// Map side-list order: placed units first, then "Not placed yet"; each group
// fault-first (same comparator as the Dashboard).
export function orderMapRows(rows) {
  const placed = rows.filter((r) => r.location).sort(byAttention)
  const unplaced = rows.filter((r) => !r.location).sort(byAttention)
  return { placed, unplaced }
}
