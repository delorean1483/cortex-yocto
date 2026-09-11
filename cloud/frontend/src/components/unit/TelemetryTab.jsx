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

const RANGES = [{ label: 'Recent', n: 60 }, { label: 'Extended', n: 240 }]

function hhmm(ts) {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// Single-series line chart. One measure, one brand hue; the title names the
// series, so no legend (dataviz: a lone series needs none).
function Chart({ title, data, dataKey, color, unit }) {
  return (
    <div className="card">
      <div className="sec-hd"><span className="sec-title">{title}</span></div>
      <div style={{ width: '100%', height: 180 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: -8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="ts" tickFormatter={hhmm} tick={{ fill: AXIS, fontSize: 10 }}
              stroke={GRID} minTickGap={40} />
            <YAxis tick={{ fill: AXIS, fontSize: 10 }} stroke={GRID} width={40}
              domain={['auto', 'auto']} />
            <Tooltip
              contentStyle={{ background: SURFACE, border: `0.5px solid ${BORDER}`,
                borderRadius: 6, fontSize: 12 }}
              labelFormatter={(ts) => hhmm(ts)}
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
  const [n, setN] = useState(60)
  const { data: series, isLoading } = useTelemetrySeries(unit, { limit: String(n) })

  return (
    <>
      <div style={{ display: 'flex', gap: 6 }}>
        {RANGES.map((r) => (
          <button key={r.n} className={`btn btn-sm${n === r.n ? ' btn-primary' : ''}`}
            onClick={() => setN(r.n)}>{r.label}</button>
        ))}
      </div>

      {isLoading && <div className="skeleton" style={{ height: 180 }} />}
      {!isLoading && (!series || series.length === 0) && (
        <div className="notice">No telemetry history for this unit yet.</div>
      )}
      {!isLoading && series && series.length > 0 && (
        <>
          <Chart title="Battery voltage" data={series} dataKey="batt_v" color="#12A5D6" unit="V" />
          <Chart title="Cabin temperature" data={series} dataKey="cabin_temp_f" color="#F26522" unit="°F" />
          <Chart title="Engine RPM" data={series} dataKey="rpm" color="#7C9E0C" />
        </>
      )}
    </>
  )
}
