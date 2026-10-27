'use strict';

// Runs the low-battery rule for one telemetry message against the unit's stored
// state, and sends the email the rule asks for. The state write is versioned:
// only the invocation whose write wins sends, so overlapping Lambda calls for
// one unit can't email twice. Never throws: a failed alert must not fail
// ingest (a throw makes IoT retry the reading and route it to the DLQ).
//
//   io = { loadState(unit) -> { state, ver } | null,
//          saveState(unit, state, prevVer | null) -> true | false (lost the race),
//          sendAlert({ subject, text }) }

const { stepBattery, batteryEmail } = require('./battery-alert');

async function checkBattery(msg, nowMs, io, dashboardUrl) {
  try {
    const stored = await io.loadState(msg.unit);
    const { state, changed, email } = stepBattery(stored && stored.state, { v: msg.batt_v, tsMs: msg.ts }, nowMs);
    if (!changed) return { email: null };
    if (!(await io.saveState(msg.unit, state, stored ? stored.ver : null))) return { email: null };
    if (!email) return { email: null };
    await io.sendAlert(batteryEmail(email.kind, msg.unit, email.v, nowMs, dashboardUrl));
    return { email: email.kind };
  } catch (e) {
    return { email: null, error: `battery alert for ${msg.unit} failed: ${e.message}` };
  }
}

module.exports = { checkBattery };
