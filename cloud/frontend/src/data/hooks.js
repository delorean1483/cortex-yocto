import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client.js'

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

export function useUnitLatest(unit) {
  return useQuery({
    queryKey: ['latest', unit],
    enabled: !!unit,
    queryFn: () => api.getLatest(unit),
    refetchInterval: 5000,
    refetchOnWindowFocus: true,
    select: (d) => d.latest,
  })
}

export function useTelemetrySeries(unit, params = {}) {
  return useQuery({
    queryKey: ['series', unit, params],
    enabled: !!unit,
    queryFn: () => api.getTelemetry(unit, params),
    select: (d) => d.telemetry || [],
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
