import { lazy } from 'react'

const GUARD = 'ef-chunk-reload'

// Pages load as separate chunks. After a deploy, a tab opened on the old build
// asks for chunk hashes that no longer exist (Vercel's SPA rewrite answers with
// index.html), so the import fails. Reload once to pick up the new build; if it
// still fails after that, surface the error rather than loop.
export function loadWithReload(importer, reload = () => window.location.reload()) {
  return importer().then(
    (mod) => { sessionStorage.removeItem(GUARD); return mod },
    (err) => {
      if (sessionStorage.getItem(GUARD)) throw err
      sessionStorage.setItem(GUARD, '1')
      reload()
      return new Promise(() => {})
    },
  )
}

export function lazyPage(importer) {
  return lazy(() => loadWithReload(importer))
}
