'use strict';
// The unit's APU-link report from its device shadow: the agent sends
// apu_link ("ok" | "down"), apu_link_since and heartbeat_ts every cycle, and
// keeps sending them while the APU controller is not answering Modbus (no
// telemetry then). The dashboard uses it to tell "unit online, APU silent"
// from "unit offline". null when the shadow carries no usable report: older
// agents never send one, so the dashboard falls back to telemetry age alone.

const LINK_STATES = new Set(['ok', 'down']);

const epochMs = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function linkView(reported) {
  if (!reported || !LINK_STATES.has(reported.apu_link)) return null;
  return {
    apu: reported.apu_link,
    since: epochMs(reported.apu_link_since),
    heartbeat_ts: epochMs(reported.heartbeat_ts),
  };
}

module.exports = { linkView };
