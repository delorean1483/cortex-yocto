import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { useTelemetrySeries } from '../../data/hooks.js'

const isDark = typeof window !== 'undefined'
  && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
const AXIS = '#8a8a88'
const GRID = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'
const SURFACE = isDark ? '#222224' : '#ffffff'
const BORDER = isDark ? 'rgba(255,255,255,0.13)' : 'rgba(0,0,0,0.14)'

// Each range asks the API for one averaged point per `every` bucket (60-168
// points), so a week shows as a trend rather than the newest few minutes.
const RANGES = [
  { key: '1h',  label: '1 hour',   start: '-1h',  every: '1m',  bucket: '1 minute' },
  { key: '24h', label: '24 hours', start: '-24h', every: '15m', bucket: '15 minutes' },
  { key: '7d',  label: '7 days',   start: '-7d',  every: '1h',  bucket: '1 hour' },
  { key: '30d', label: '30 days',  start: '-30d', every: '6h',  bucket: '6 hours' },
]
const MULTI_DAY = new Set(['7d', '30d'])

function hhmm(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const monthDay = (ts) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

export function tickLabel(ts, rangeKey) {
  return MULTI_DAY.has(rangeKey) ? monthDay(ts) : hhmm(ts)
}

const hasReadings = (series) =>
  (series || []).some((p) => p.batt_v != null || p.cabin_temp_f != null || p.rpm != null)

// Single-series line chart. One measure, one brand hue; the title names the
// series, so no legend (dataviz: a lone series needs none).
function Chart({ title, data, dataKey, color, unit, rangeKey }) {
  return (
    <div className="card">
      <div className="sec-hd"><span className="sec-title">{title}</span></div>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="ts" tickFormatter={(ts) => tickLabel(ts, rangeKey)}
              tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} minTickGap={40} />
            <YAxis tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} width={40}
              domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ background: SURFACE, border: `0.5px solid ${BORDER}`,
                borderRadius: 6, fontSize: 12 }}
              labelFormatter={(ts) => `${monthDay(ts)}, ${hhmm(ts)}`}
              formatter={(v) => [`${v}${unit ? ' ' + unit : ''}`, title]} />
            <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2}
              dot={false} activeDot={{ r: 4 }} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export default function TelemetryTab({ unit }) {
  const [rangeKey, setRangeKey] = useState('24h')
  const range = RANGES.find((r) => r.key === rangeKey)
  const { data: series, isLoading } = useTelemetrySeries(unit, { start: range.start, every: range.every })

  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        {RANGES.map((r) => (
          <button key={r.key} className={`btn btn-sm${rangeKey === r.key ? ' btn-primary' : ''}`}
            onClick={() => setRangeKey(r.key)}>{r.label}</button>
        ))}
      </div>

      {isLoading && <div className="skeleton" style={{ height: 180 }} />}
      {!isLoading && !hasReadings(series) && (
        <div className="notice">No readings from this unit in the last {range.label}.</div>
      )}
      {!isLoading && hasReadings(series) && (
        <>
          <div className="sec-sub">
            Each point is the average over {range.bucket}. Gaps are times the unit sent nothing.
          </div>
          <Chart title="Battery voltage" data={series} dataKey="batt_v" color="#12A5D6" unit="V" rangeKey={rangeKey} />
          <Chart title="Cabin temperature" data={series} dataKey="cabin_temp_f" color="#F26522" unit="°F" rangeKey={rangeKey} />
          <Chart title="Engine RPM" data={series} dataKey="rpm" color="#7C9E0C" rangeKey={rangeKey} />
        </>
      )}
    </>
  )
}
