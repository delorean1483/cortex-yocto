'use strict';

const { parseVersion, cmpVersion } = require('./releases-view');

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

// Validated location value (or null when cleared) -> shadow desired.location.
// Always the full object with label as "" rather than omitted: the shadow
// merges nested objects, so an omitted label would leave the old one behind.
// A clear is an explicit {assigned:false} because deleting a desired key never
// sends the device a delta. The unit uses it for its forecast and time zone.
function locationShadowDesired(value) {
  if (!value) return { assigned: false };
  return { assigned: true, lat: value.lat, lon: value.lon, label: value.label || '' };
}

// First cortex image whose agent reports reported.location back. Sending
// desired.location to an older unit would leave a standing delta that AWS
// re-sends on every telemetry publish (and which re-applies transient desired
// commands), so older / unversioned (branch-build) units are skipped.
const LOCATION_MIN_FW = '1.2.61';
function unitSupportsLocation(firmwareVersion) {
  return parseVersion(firmwareVersion) !== null && cmpVersion(firmwareVersion, LOCATION_MIN_FW) >= 0;
}

module.exports = {
  validateLocation, mergeLocations, locationShadowDesired, unitSupportsLocation,
  LOCATION_MIN_FW, DEMO_LOCATIONS, LABEL_MAX,
};
