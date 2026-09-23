import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'
import { chronological } from '../api/contract.js'

export function useUnits() {
  return useQuery({
    queryKey: ['units'],
    queryFn: () => api.listUnits(),
    refetchInterval: 30000,
    // Refetch immediately when the tab regains focus: the interval pauses while
    // backgrounded, so without this the freshness/"stale" state can linger for
    // a beat after the user returns to the tab.
    refetchOnWindowFocus: true,
    select: (d) => d.units || [],
  })
}

// Each poll runs an InfluxDB query for this unit, per open tab — keep it modest
// (the Dashboard polls every unit at once). Telemetry arrives every ~6s anyway.
export const LATEST_POLL_MS = 15000

export function useUnitLatest(unit) {
  return useQuery({
    queryKey: ['latest', unit],
    enabled: !!unit,
    queryFn: () => api.getLatest(unit),
    refetchInterval: LATEST_POLL_MS,
    refetchOnWindowFocus: true,
    select: (d) => d.latest,
  })
}

export function useTelemetrySeries(unit, params = {}) {
  return useQuery({
    queryKey: ['series', unit, params],
    enabled: !!unit,
    queryFn: () => api.getTelemetry(unit, params),
    select: (d) => chronological(d.telemetry),
  })
}

export function useFaults(unit) {
  return useQuery({
    queryKey: ['faults', unit],
    enabled: !!unit,
    queryFn: () => api.getFaults(unit),
    select: (d) => d.faults || [],
  })
}

export function useReleases() {
  return useQuery({
    queryKey: ['releases'],
    queryFn: () => api.getReleases(),
    staleTime: 60000,
    select: (d) => ({ releases: d.releases || [], latest: d.latest || null }),
  })
}

export function useShadow(unit) {
  return useQuery({
    queryKey: ['shadow', unit],
    enabled: !!unit,
    queryFn: () => api.getShadow(unit),
    refetchInterval: 8000,
  })
}

export function useCommand() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ unit, body }) => api.sendCommand(unit, body),
    onSuccess: (_r, { unit }) => {
      qc.invalidateQueries({ queryKey: ['latest', unit] })
      qc.invalidateQueries({ queryKey: ['shadow', unit] })
    },
  })
}

// Assigned map locations for every unit (Fleet map).
export function useLocations() {
  return useQuery({
    queryKey: ['locations'],
    queryFn: () => api.getLocations(),
    select: (d) => d.locations || [],
  })
}

export function useSetLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ unit, lat, lon, label }) => api.setLocation(unit, { lat, lon, label }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  })
}

export function useClearLocation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (unit) => api.clearLocation(unit),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['locations'] }),
  })
}

// Latest telemetry for many units in one hook (shares the ['latest', unit]
// cache and poll rate with useUnitLatest).
export function useFleetLatest(units) {
  const results = useQueries({
    queries: (units || []).map((unit) => ({
      queryKey: ['latest', unit],
      queryFn: () => api.getLatest(unit),
      refetchInterval: LATEST_POLL_MS,
      select: (d) => d.latest,
    })),
  })
  const byUnit = {}
  const pending = {}
  ;(units || []).forEach((unit, i) => {
    byUnit[unit] = results[i]?.data
    pending[unit] = !!results[i]?.isLoading
  })
  return { byUnit, pending }
}

// Writes device-shadow config (reporting interval, reboot) for one unit.
export function useSetConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ unit, config }) => api.setConfig(unit, config),
    onSuccess: (_r, { unit }) => qc.invalidateQueries({ queryKey: ['shadow', unit] }),
  })
}
