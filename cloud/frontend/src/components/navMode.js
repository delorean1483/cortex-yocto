import { useEffect, useState } from 'react'

// Sidebar presentation by viewport width:
//   full   ≥ 1200px  — labelled sidebar
//   rail   768–1199  — 64px icon rail (tablets, small laptops)
//   drawer < 768     — hidden; opened from the top bar's menu button (phones)
export const RAIL_MIN = 768
export const FULL_MIN = 1200

export function navMode(width) {
  if (width >= FULL_MIN) return 'full'
  if (width >= RAIL_MIN) return 'rail'
  return 'drawer'
}

export function useNavMode() {
  const read = () => navMode(typeof window === 'undefined' ? FULL_MIN : window.innerWidth)
  const [mode, setMode] = useState(read)
  useEffect(() => {
    const onResize = () => setMode(read())
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return mode
}
