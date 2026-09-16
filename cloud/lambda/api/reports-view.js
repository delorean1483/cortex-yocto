'use strict';

// Pure reports aggregator: raw InfluxDB rows -> { totals, operators }.
// No I/O. Field names per cloud/CONTRACT.md.

// Estimated fuel savings of running the APU instead of idling the main engine.
// A heavy-truck main engine idles ~0.8 gal/hr; the APU consumes ~0.2 gal/hr;
// at ~$4/gal that is ~$2.40 saved per APU runtime hour. Documented estimate,
// not a metered value.
const APU_SAVINGS_USD_PER_HR = 2.40;

// engineHrsFirstRows: [{ unit, _value }] — first engine_hrs per unit in window.
// engineHrsLastRows:  [{ unit, _value }] — last  engine_hrs per unit in window.
// faultRows:          [{ unit, _value }] — fault-event count per unit in window.
//
// engine_hrs is a cumulative lifetime counter, so runtime accrued during the
// selected window is (last - first) per unit, summed across the fleet. A
// negative delta (a rare counter reset, e.g. after a reflash) clamps to 0.
function buildReports({ engineHrsFirstRows = [], engineHrsLastRows = [], faultRows = [] }) {
  const firstByUnit = new Map(
    engineHrsFirstRows.map((r) => [r.unit, Number(r._value) || 0])
  );
  const runtime = engineHrsLastRows.reduce((s, r) => {
    const last  = Number(r._value) || 0;
    const first = firstByUnit.has(r.unit) ? firstByUnit.get(r.unit) : last;
    return s + Math.max(0, last - first);
  }, 0);
  const faults  = faultRows.reduce((s, r) => s + (Number(r._value) || 0), 0);
  const mtbf    = faults > 0 ? runtime / faults : runtime;
  return {
    totals: {
      runtime_hrs: Math.round(runtime),
      fuel_saved_usd: Math.round(runtime * APU_SAVINGS_USD_PER_HR),
      mtbf_hrs: Math.round(mtbf),
      fault_events: faults,
    },
    // Operator identity is not present in device telemetry, so no operator
    // activity is available from real data. (The dev mock supplies demo rows.)
    operators: [],
  };
}

module.exports = { buildReports, APU_SAVINGS_USD_PER_HR };
