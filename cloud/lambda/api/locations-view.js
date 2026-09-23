'use strict';

// Pure helpers for assigned unit locations (Fleet map). No I/O.
// Units have no GPS yet, so an admin assigns each unit a location.

const LABEL_MAX = 60;

// Fixed positions for demo units so the map isn't empty in demos. Never stored.
const DEMO_LOCATIONS = {
  'APU-DEMO-01': { lat: 32.7767, lon: -96.7970, label: 'Dallas, TX (demo)' },
  'APU-DEMO-02': { lat: 35.4676, lon: -97.5164, label: 'Oklahoma City, OK (demo)' },
  'APU-DEMO-03': { lat: 29.7604, lon: -95.3698, label: 'Houston, TX (demo)' },
};

const inRange = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

// PATCH body -> { ok: true, value: { lat, lon, label } } | { ok: false, error }
function validateLocation(body) {
  if (!body || typeof body !== 'object') return { ok: false, error: 'location body required' };
  if (!inRange(body.lat, -90, 90))   return { ok: false, error: 'lat must be a number between -90 and 90' };
  if (!inRange(body.lon, -180, 180)) return { ok: false, error: 'lon must be a number between -180 and 180' };
  let label = null;
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== 'string') return { ok: false, error: 'label must be a string' };
    const t = body.label.trim();
    if (t.length > LABEL_MAX) return { ok: false, error: `label must be ${LABEL_MAX} characters or fewer` };
    label = t || null;
  }
  return { ok: true, value: { lat: body.lat, lon: body.lon, label } };
}

// Stored items + enabled demo unit ids -> the GET /fleet/locations list.
function mergeLocations(items, demoUnits) {
  const stored = (items || []).map((it) => ({
    unit: it.unit,
    lat: Number(it.lat),
    lon: Number(it.lon),
    label: it.label || null,
    source: 'assigned',
    updated_by: it.updated_by || null,
    updated_at: it.updated_at != null ? Number(it.updated_at) : null,
  }));
  const demo = (demoUnits || [])
    .filter((u) => DEMO_LOCATIONS[u])
    .map((u) => ({ unit: u, ...DEMO_LOCATIONS[u], source: 'demo', updated_by: null, updated_at: null }));
  return [...stored, ...demo].sort((a, b) => a.unit.localeCompare(b.unit));
}

module.exports = { validateLocation, mergeLocations, DEMO_LOCATIONS, LABEL_MAX };
