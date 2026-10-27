'use strict';

// Pure folder: seriesFlux() partial rows -> one point per bucket, oldest first.
// Each row is one series' sum or count for one field in one bucket; adding them
// per bucket and dividing gives the true mean across every series of the field.

const { durationSeconds, SERIES_FIELDS } = require('./flux');

const round2 = (x) => Math.round(x * 100) / 100;

// Buckets are aligned to the epoch like aggregateWindow's windows (UTC), and
// labelled by their start. The first one is partial: it starts before the range.
function bucketMeans(rows, start, every, nowMs) {
  const everyMs = durationSeconds(every) * 1000;
  const bucketOf = (ms) => Math.floor(ms / everyMs) * everyMs;
  const first = bucketOf(nowMs - durationSeconds(start.slice(1)) * 1000);

  const acc = new Map(); // bucket start -> { field: { sum, count } }
  for (const r of rows) {
    if (!SERIES_FIELDS.includes(r._field)) continue;
    const b = bucketOf(Date.parse(r._time));
    if (!acc.has(b)) acc.set(b, {});
    const f = (acc.get(b)[r._field] ??= { sum: 0, count: 0 });
    f[r.agg] += Number(r._value);
  }

  const out = [];
  for (let b = first; b <= nowMs; b += everyMs) {
    const point = { ts: b };
    for (const field of SERIES_FIELDS) {
      const f = acc.get(b)?.[field];
      point[field] = f && f.count > 0 ? round2(f.sum / f.count) : null;
    }
    out.push(point);
  }
  return out;
}

module.exports = { bucketMeans };
