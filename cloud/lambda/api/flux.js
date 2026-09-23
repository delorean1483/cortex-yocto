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

module.exports = { latestFlux, telemetryFlux, unitsFlux, faultsFlux, clampLimit, UNITS_LOOKBACK, RELATIVE_RANGE };
