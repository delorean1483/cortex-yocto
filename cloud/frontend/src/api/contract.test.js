import { describe, it, expect } from 'vitest'
import { unitStatus, statusDotClass, isStale, heaterStateLabel, fmt,
         heaterFlags, diagOutputs, connLabel, otaStatusView,
         chronological } from './contract.js'

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
