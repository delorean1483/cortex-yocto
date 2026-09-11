'use strict';

// Pure reports aggregator: raw InfluxDB rows -> { totals, operators }.
// No I/O. Field names per cloud/CONTRACT.md.

// Estimated fuel savings of running the APU instead of idling the main engine.
// A heavy-truck main engine idles ~0.8 gal/hr; the APU consumes ~0.2 gal/hr;
// at ~$4/gal that is ~$2.40 saved per APU runtime hour. Documented estimate,
// not a metered value.
const APU_SAVINGS_USD_PER_HR = 2.40;

// engineHrsRows: [{ unit, _value }] — last engine_hrs per unit in the window.
// faultRows:     [{ unit, _value }] — fault-event count per unit in the window.
function buildReports({ engineHrsRows = [], faultRows = [] }) {
  const runtime = engineHrsRows.reduce((s, r) => s + (Number(r._value) || 0), 0);
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
