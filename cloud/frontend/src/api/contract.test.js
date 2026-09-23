import { describe, it, expect } from 'vitest'
import { unitStatus, statusDotClass, isStale, heaterStateLabel, fmt,
         heaterFlags, diagOutputs, connLabel, otaStatusView,
         chronological, ageText, modeLabel, unitView, byAttention,
         activeFaults, faultInfo, reportView } from './contract.js'

describe('otaStatusView', () => {
  it('hidden when idle/empty/null', () => {
    expect(otaStatusView('idle').show).toBe(false)
    expect(otaStatusView('').show).toBe(false)
    expect(otaStatusView(null).show).toBe(false)
  })
  it('failure is shown red (p-a)', () => {
    const v = otaStatusView('failed: download 9.9.9')
    expect(v.show).toBe(true)
    expect(v.cls).toBe('p-a')
    expect(v.label).toBe('failed: download 9.9.9')
  })
  it('in-progress and success are green (p-g)', () => {
    expect(otaStatusView('downloading 1.2.49').cls).toBe('p-g')
    expect(otaStatusView('installing 1.2.49').cls).toBe('p-g')
    expect(otaStatusView('success 1.2.49').cls).toBe('p-g')
  })
})

describe('unitStatus', () => {
  it('off when no telemetry', () => expect(unitStatus(null)).toBe('off'))
  it('err when error_n set', () => expect(unitStatus({ error_n: 32, batt_v: 13, oil_ok: true })).toBe('err'))
  it('warn on low battery', () => expect(unitStatus({ error_n: 0, batt_v: 11.4, oil_ok: true })).toBe('warn'))
  it('warn on oil not ok', () => expect(unitStatus({ error_n: 0, batt_v: 13, oil_ok: false })).toBe('warn'))
  it('ok otherwise', () => expect(unitStatus({ error_n: 0, batt_v: 12.7, oil_ok: true })).toBe('ok'))
})

describe('statusDotClass', () => {
  it('maps', () => {
    expect(statusDotClass('ok')).toBe('s-on')
    expect(statusDotClass('warn')).toBe('s-warn')
    expect(statusDotClass('err')).toBe('s-err')
    expect(statusDotClass('off')).toBe('s-off')
  })
})

describe('isStale', () => {
  it('fresh is not stale', () => expect(isStale({ ts: Date.now() })).toBe(false))
  it('old is stale', () => expect(isStale({ ts: Date.now() - 120000 })).toBe(true))
  it('missing ts is stale', () => expect(isStale({})).toBe(true))
})

describe('heaterStateLabel', () => {
  it('titlecases', () => expect(heaterStateLabel('preheat')).toBe('Preheat'))
  it('handles unknown', () => expect(heaterStateLabel('')).toBe('Unknown'))
})

describe('fmt', () => {
  it('volts', () => expect(fmt.volts(12.64)).toBe('12.6 V'))
  it('dash on null', () => expect(fmt.volts(null)).toBe('—'))
  it('tempF', () => expect(fmt.tempF(96.1)).toBe('96°F'))
  it('pct', () => expect(fmt.pct(40)).toBe('40%'))
})

describe('heaterFlags', () => {
  it('decodes xport-fault (0x10) as on, comms as off', () => {
    const f = heaterFlags(0x10)
    expect(f.find((b) => b.key === 'xport_fault').on).toBe(true)
    expect(f.find((b) => b.key === 'comms_fault').on).toBe(false)
  })
  it('decodes cooldown (0x2)', () => {
    expect(heaterFlags(0x2).find((b) => b.key === 'cooldown').on).toBe(true)
  })
})

describe('diagOutputs', () => {
  it('bit 6 set -> that output on, others off', () => {
    const outs = diagOutputs(1 << 6)
    expect(outs).toHaveLength(7)
    expect(outs[6].on).toBe(true)
    expect(outs[0].on).toBe(false)
  })
})

describe('connLabel', () => {
  it('no data', () => expect(connLabel(null).text).toBe('no data'))
  it('live when fresh', () => expect(connLabel({ ts: Date.now() }).text).toBe('live'))
  it('stale when old', () => expect(connLabel({ ts: Date.now() - 120000 }).text).toBe('stale'))
})

import { heaterCmdSeq, heaterDesiredPending } from './contract.js'

describe('heaterCmdSeq', () => {
  it('reads reported.heater_desired_seq', () => {
    expect(heaterCmdSeq({ reported: { heater_desired_seq: 7 } })).toBe(7)
  })
  it('defaults to 0', () => {
    expect(heaterCmdSeq(null)).toBe(0)
    expect(heaterCmdSeq({ reported: {} })).toBe(0)
  })
})

describe('heaterDesiredPending', () => {
  it('true when desired.heater present', () => {
    expect(heaterDesiredPending({ desired: { heater: { on: 1 } } })).toBe(true)
  })
  it('false when absent', () => {
    expect(heaterDesiredPending({ desired: {} })).toBe(false)
    expect(heaterDesiredPending(null)).toBe(false)
  })
})

import { apuVersionLabel, apuFlashStateLabel } from './contract.js'

describe('apuVersionLabel', () => {
  // The STM32 reg 2 (apu_fw_version) is encoded major*10000 + minor*100 + patch.
  it('decodes the encoded register int', () => {
    expect(apuVersionLabel(10101)).toBe('1.1.1')   // v1.1.1
    expect(apuVersionLabel(10240)).toBe('1.2.40')  // v1.2.40
    expect(apuVersionLabel(20000)).toBe('2.0.0')
  })
  it('passes an already-human semver string through', () => {
    expect(apuVersionLabel('1.1.1')).toBe('1.1.1')
  })
  it('dashes null/0/NaN', () => {
    expect(apuVersionLabel(null)).toBe('—')
    expect(apuVersionLabel(0)).toBe('—')
    expect(apuVersionLabel(undefined)).toBe('—')
    expect(apuVersionLabel('nope')).toBe('—')
  })
})

describe('apuFlashStateLabel', () => {
  it('labels the known states', () => {
    expect(apuFlashStateLabel('idle').text).toBe('Idle')
    expect(apuFlashStateLabel('flashing').text).toBe('Flashing…')
    expect(apuFlashStateLabel('verifying').text).toBe('Verifying…')
    expect(apuFlashStateLabel('done').text).toBe('Done')
    expect(apuFlashStateLabel('failed').text).toBe('Failed')
  })
  it('flags in-progress vs terminal', () => {
    expect(apuFlashStateLabel('flashing').busy).toBe(true)
    expect(apuFlashStateLabel('verifying').busy).toBe(true)
    expect(apuFlashStateLabel('done').busy).toBe(false)
    expect(apuFlashStateLabel('failed').failed).toBe(true)
  })
  it('defaults empty/unknown to Idle', () => {
    expect(apuFlashStateLabel(null).text).toBe('Idle')
    expect(apuFlashStateLabel('weird').text).toBe('Idle')
  })
})

describe('chronological', () => {
  it('orders a newest-first series oldest-first for time-axis charts', () => {
    const out = chronological([{ ts: 3 }, { ts: 1 }, { ts: 2 }])
    expect(out.map((p) => p.ts)).toEqual([1, 2, 3])
  })
  it('does not mutate the input', () => {
    const src = [{ ts: 2 }, { ts: 1 }]
    chronological(src)
    expect(src.map((p) => p.ts)).toEqual([2, 1])
  })
  it('tolerates null', () => expect(chronological(null)).toEqual([]))
})

describe('fmt.counter', () => {
  it('plain count', () => expect(fmt.counter(42)).toBe('42'))
  it('flags a saturated uint16 counter', () => expect(fmt.counter(65535)).toBe('65535+'))
  it('dash on null', () => expect(fmt.counter(null)).toBe('—'))
})

describe('ageText', () => {
  it('seconds', () => expect(ageText(14000)).toBe('14s ago'))
  it('under 5s reads as just now', () => expect(ageText(2000)).toBe('just now'))
  it('minutes', () => expect(ageText(4 * 60000 + 5000)).toBe('4 min ago'))
  it('hours and minutes', () => expect(ageText((2 * 60 + 14) * 60000)).toBe('2 h 14 min ago'))
  it('whole hours', () => expect(ageText(3 * 3600000)).toBe('3 h ago'))
  it('days', () => expect(ageText(50 * 3600000)).toBe('2 d ago'))
  it('dash on null', () => expect(ageText(null)).toBe('—'))
})

describe('modeLabel', () => {
  it('prefers an active control mode', () => expect(modeLabel({ mode: 'engine', control_status: 'climate' })).toBe('Climate'))
  it('battery', () => expect(modeLabel({ mode: 'battery', control_status: 'idle' })).toBe('Battery charge'))
  it('off', () => expect(modeLabel({ mode: 'off', control_status: 'off' })).toBe('Off'))
  it('unknown strings are title-cased', () => expect(modeLabel({ mode: 'engine', control_status: 'idle' })).toBe('Engine'))
  it('dash when missing', () => expect(modeLabel(null)).toBe('—'))
})

describe('unitView', () => {
  const NOW = 1_000_000_000
  const base = { ts: NOW - 6000, error: 'none', error_n: 0, batt_v: 13.2, oil_ok: true,
    mode: 'off', control_status: 'off', engine_status: 'off', rpm: 0 }

  it('no telemetry -> off / No data', () => {
    const v = unitView(undefined, NOW)
    expect(v.tone).toBe('off'); expect(v.status).toBe('No data'); expect(v.attention).toBe(false)
  })
  it('healthy and idle -> ok / Standby', () => {
    const v = unitView(base, NOW)
    expect(v).toMatchObject({ tone: 'ok', status: 'Standby', headline: 'APU off', seen: 'Reported 6s ago', attention: false, stale: false })
  })
  it('a program selected but engine off keeps the mode in the headline', () => {
    expect(unitView({ ...base, mode: 'battery', control_status: 'battery' }, NOW).headline).toBe('Battery charge · engine off')
  })
  it('engine running -> Running', () => {
    const v = unitView({ ...base, mode: 'engine', control_status: 'climate', engine_status: 'running', rpm: 2450 }, NOW)
    expect(v).toMatchObject({ tone: 'ok', status: 'Running', headline: 'Climate · engine running' })
  })
  it('fault -> err with the fault text as headline', () => {
    const v = unitView({ ...base, error: 'Low oil pressure', error_n: 1 }, NOW)
    expect(v).toMatchObject({ tone: 'err', status: 'Fault', headline: 'Low oil pressure', attention: true })
  })
  it('low battery -> warn', () => {
    const v = unitView({ ...base, batt_v: 11.6 }, NOW)
    expect(v).toMatchObject({ tone: 'warn', status: 'Warning', headline: 'Low battery · 11.6 V', attention: true })
  })
  it('low oil -> warn', () => {
    expect(unitView({ ...base, oil_ok: false }, NOW)).toMatchObject({ tone: 'warn', headline: 'Low oil pressure' })
  })
  it('stale outranks a fault: the values are old', () => {
    const v = unitView({ ...base, ts: NOW - (2 * 60 + 14) * 60000, error: 'Low oil pressure', error_n: 1 }, NOW)
    expect(v).toMatchObject({ tone: 'off', status: 'Offline', stale: true, attention: true,
      headline: 'Not reporting · last known values', seen: 'Last report 2 h 14 min ago' })
  })
})

describe('byAttention', () => {
  it('orders fault, warning, offline, then healthy; stable within a tone', () => {
    const rows = [
      { id: 'a', view: { tone: 'ok' } }, { id: 'b', view: { tone: 'off' } },
      { id: 'c', view: { tone: 'err' } }, { id: 'd', view: { tone: 'warn' } },
      { id: 'e', view: { tone: 'ok' } }, { id: 'f', view: undefined },
    ]
    expect([...rows].sort(byAttention).map((r) => r.id)).toEqual(['c', 'd', 'b', 'a', 'e', 'f'])
  })
})

describe('faultInfo', () => {
  it('names a known code and its severity', () => {
    expect(faultInfo({ fault: '0x0020' })).toMatchObject({ name: 'Low oil pressure', tone: 'err', severity: 'Critical' })
    expect(faultInfo({ fault: '0x0001' })).toMatchObject({ name: 'DC under-voltage', tone: 'warn', severity: 'Warning' })
  })
  it('prefers the description the device sent', () => {
    expect(faultInfo({ fault: '0x0020', description: 'Oil pressure switch open' }).name).toBe('Oil pressure switch open')
  })
  it('unknown codes fall back to the hex code as a warning', () => {
    expect(faultInfo({ fault: '0x4000' })).toMatchObject({ name: 'Fault 0x4000', tone: 'warn' })
  })
})

describe('activeFaults', () => {
  const ev = (min, fault, state = 'active') => ({ ts: 1_000_000_000 - min * 60000, fault, state })
  it('a fault with no later clear is active', () => {
    expect(activeFaults([ev(4, '0x0020')]).map((f) => f.fault)).toEqual(['0x0020'])
  })
  it('an all-clear (0x0000) resolves everything before it', () => {
    expect(activeFaults([ev(1, '0x0000', 'cleared'), ev(30, '0x0020')])).toEqual([])
  })
  it('faults after the last all-clear are active; older ones are not', () => {
    const out = activeFaults([ev(2, '0x0004'), ev(10, '0x0000', 'cleared'), ev(60, '0x0020')])
    expect(out.map((f) => f.fault)).toEqual(['0x0004'])
  })
  it('a clear for one code leaves other faults active', () => {
    const out = activeFaults([ev(1, '0x0020', 'cleared'), ev(5, '0x0020'), ev(6, '0x0004')])
    expect(out.map((f) => f.fault)).toEqual(['0x0004'])
  })
  it('repeats of the same code collapse to the newest event', () => {
    const out = activeFaults([ev(1, '0x0020'), ev(3, '0x0020')])
    expect(out).toHaveLength(1)
    expect(out[0].ts).toBe(1_000_000_000 - 60000)
  })
  it('order of the input does not matter', () => {
    expect(activeFaults([ev(60, '0x0020'), ev(10, '0x0000', 'cleared'), ev(2, '0x0004')]).map((f) => f.fault)).toEqual(['0x0004'])
  })
})

describe('reportView', () => {
  it('zero runtime is called out instead of presented as a result', () => {
    const v = reportView({ runtime_hrs: 0, fuel_saved_usd: 0, mtbf_hrs: 0, fault_events: 0 })
    expect(v.zeroRuntime).toBe(true)
  })
  it('MTBF reads "No faults" when there were none', () => {
    const v = reportView({ runtime_hrs: 120, fuel_saved_usd: 288, mtbf_hrs: 120, fault_events: 0 })
    expect(v.cards.find((c) => c.key === 'mtbf').value).toBe('No faults')
    expect(v.zeroRuntime).toBe(false)
  })
  it('formats runtime, savings and MTBF with captions', () => {
    const v = reportView({ runtime_hrs: 1240, fuel_saved_usd: 2976, mtbf_hrs: 310, fault_events: 4 })
    const by = Object.fromEntries(v.cards.map((c) => [c.key, c]))
    expect(by.runtime).toMatchObject({ value: '1,240', unit: 'h' })
    expect(by.savings.value).toBe('$2,976')
    expect(by.savings.caption).toMatch(/\$2\.40 per APU runtime hour/)
    expect(by.mtbf).toMatchObject({ value: '310', unit: 'h' })
    expect(by.faults.value).toBe('4')
  })
  it('missing totals -> dashes, not zeros', () => {
    const v = reportView(undefined)
    expect(v.cards.every((c) => c.value === '—')).toBe(true)
    expect(v.zeroRuntime).toBe(false)
  })
})
