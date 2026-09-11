import { useAuth } from '../contexts/AuthContext.jsx'
import { canWrite } from '../api/permissions.js'

// UI gating hook. Returns { allowed, reason }. The API Lambda is authoritative;
// this only shapes the UI (disable + explain).
export function useCan(action) {
  const { role } = useAuth()
  if (!canWrite(role, action)) {
    return { allowed: false, reason: `Your role (${role}) can't perform this action.` }
  }
  return { allowed: true, reason: '' }
}
