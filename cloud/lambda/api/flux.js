'use strict';
// Flux for the hot read paths. Shape matters on the t3.micro InfluxDB: pivot is
// the expensive step (it materialises every field of every point in range), so
// each query shrinks the data per series BEFORE pivoting.
//
// Enum fields (mode, engine_status, control_status, error, oil_change,
// heater_state) are tags, so a unit's state changes split its data into several
// series. Every query therefore group()s after the pivot and sorts/limits on the
// merged table — otherwise sort+limit run per series and return a stale row.

const UNITS_LOOKBACK = '-7d';

// Only simple relative ranges ("-1h", "-7d") reach the query text.
const RELATIVE_RANGE = /^-\d{1,4}[smhdw]$/;

function unitLiteral(unit) {
  return String(unit).replace(/"/g, '');
}

// Most recent full snapshot: last() keeps one point per field (per series), so
// the pivot handles ~one row per field instead of a whole day of snapshots.
// All fields of a snapshot share its timestamp, so the newest pivoted row is
// the complete latest snapshot.
function latestFlux(unit) {
  return `
    from(bucket: "telemetry")
      |> range(start: -24h)
      |> filter(fn: (r) => r._measurement == "telemetry" and r.unit == "${unitLiteral(unit)}")
      |> last()
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> group()
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: 1)
  `;
}

// Newest `limit` snapshots in range, newest first. tail(n) per series is exact:
// any of the globally newest n timestamps is among its own series' newest n.
function telemetryFlux(unit, start, limit) {
  if (!RELATIVE_RANGE.test(String(start))) throw new Error(`invalid start: ${start}`);
  const n = Math.max(1, Math.floor(Number(limit)) || 1);
  return `
    from(bucket: "telemetry")
      |> range(start: ${start})
      |> filter(fn: (r) => r._measurement == "telemetry" and r.unit == "${unitLiteral(unit)}")
      |> tail(n: ${n})
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> group()
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${n})
  `;
}

// Chart history: the chart fields in `every`-sized buckets across the whole
// range, so a week reads as a trend instead of the newest few minutes. Storage
// computes a sum and a count per series per bucket (window-aggregate pushdown,
// so raw points never reach the Flux engine). Enum tags split a field into
// several series; series-view.js adds the partials up and divides, which keeps a
// bucket where the state changed weighted by points (a mean of per-series means
// would count a 6-minute engine run as half the hour).
const SERIES_FIELDS = ['batt_v', 'cabin_temp_f', 'rpm'];
const SERIES_EVERY = /^[1-9]\d{0,2}[mhd]$/;
const MAX_SERIES_POINTS = 500;
const SECONDS = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

const durationSeconds = (d) => Number(d.slice(0, -1)) * SECONDS[d.slice(-1)];

// Buckets a range/every pair produces ("-7d", "1h" -> 168).
function seriesPoints(start, every) {
  return Math.ceil(durationSeconds(String(start).slice(1)) / durationSeconds(String(every)));
}

function seriesFlux(unit, start, every) {
  if (!RELATIVE_RANGE.test(String(start))) throw new Error(`invalid start: ${start}`);
  if (!SERIES_EVERY.test(String(every))) throw new Error(`invalid every: ${every}`);
  const points = seriesPoints(start, every);
  if (points > MAX_SERIES_POINTS) {
    throw new Error(`${start} in ${every} buckets is ${points} buckets (max ${MAX_SERIES_POINTS})`);
  }
  const fields = SERIES_FIELDS.map((f) => `r._field == "${f}"`).join(' or ');
  // Each partial gets its own source: with a shared `data =` source InfluxDB
  // stops pushing the window aggregate down and streams every raw point.
  // toFloat: union() rejects a mix of int (rpm sums, counts) and float _value.
  const partial = (fn) => `from(bucket: "telemetry")
      |> range(start: ${start})
      |> filter(fn: (r) => r._measurement == "telemetry" and r.unit == "${unitLiteral(unit)}")
      |> filter(fn: (r) => ${fields})
      |> aggregateWindow(every: ${every}, fn: ${fn}, createEmpty: false, timeSrc: "_start")
      |> toFloat()
      |> set(key: "agg", value: "${fn}")`;
  return `
    union(tables: [${partial('sum')}, ${partial('count')}])
      |> keep(columns: ["_time", "_field", "_value", "agg"])
  `;
}

// Newest `limit` fault events in range, newest first (same shape as telemetry:
// trim per series before the pivot, merge, then sort/limit).
function faultsFlux(unit, start, limit) {
  if (!RELATIVE_RANGE.test(String(start))) throw new Error(`invalid start: ${start}`);
  const n = Math.max(1, Math.floor(Number(limit)) || 1);
  return `
    from(bucket: "faults")
      |> range(start: ${start})
      |> filter(fn: (r) => r._measurement == "faults" and r.unit == "${unitLiteral(unit)}")
      |> tail(n: ${n})
      |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> group()
      |> sort(columns: ["_time"], desc: true)
      |> limit(n: ${n})
  `;
}

// A ?limit= query-string value -> an integer in [1, max]; missing or
// non-numeric falls back to `fallback` (never NaN inside a Flux query).
function clampLimit(raw, fallback, max) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, 1), max);
}

// Units that reported within UNITS_LOOKBACK (a unit silent longer drops off the list).
function unitsFlux() {
  return `
    import "influxdata/influxdb/schema"
    schema.tagValues(
      bucket: "telemetry",
      tag: "unit",
      predicate: (r) => r._measurement == "telemetry",
      start: ${UNITS_LOOKBACK},
    )
  `;
}

module.exports = {
  latestFlux, telemetryFlux, seriesFlux, seriesPoints, durationSeconds, unitsFlux, faultsFlux,
  clampLimit, UNITS_LOOKBACK, RELATIVE_RANGE, SERIES_FIELDS, MAX_SERIES_POINTS,
};
