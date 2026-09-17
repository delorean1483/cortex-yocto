// Light/dark theme: an explicit choice (persisted in localStorage) wins;
// otherwise follow the OS preference. The theme is applied as `data-theme` on
// <html> — see the no-flash init script in index.html and the CSS in
// index.css. Only resolveInitialTheme/nextTheme are pure (unit-tested); the
// rest touch document/localStorage and are guarded so a blocked store or a
// non-DOM context never throws.

const STORAGE_KEY = 'eco_theme'

// stored (from localStorage, may be null/invalid) + the OS preference ->
// the theme to apply. A valid stored choice wins; anything else falls back
// to the system preference.
export function resolveInitialTheme(stored, systemPrefersDark) {
  if (stored === 'light' || stored === 'dark') return stored
  return systemPrefersDark ? 'dark' : 'light'
}

export function nextTheme(current) {
  return current === 'dark' ? 'light' : 'dark'
}

export function getStoredTheme() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

// The theme currently applied to <html> (set by the init script in
// index.html), defaulting to 'light' if unreadable.
export function currentTheme() {
  try {
    return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
  } catch { return 'light' }
}

// Apply a theme now and remember it as the user's explicit choice.
export function applyTheme(theme) {
  try { document.documentElement.dataset.theme = theme } catch { /* non-DOM */ }
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* store blocked */ }
}
