// The demo controls are for whoever is running the demo, not for every visitor of a
// hosted build. `?demo=1` turns them on, `?demo=0` off. The choice is remembered for the
// tab, so it survives navigation inside the app (which drops the query string) and the
// panel's own reload, but never leaks to someone opening the bare link.

const KEY = 'ppx.demoPanel'

export function demoPanelEnabled(search = window.location.search): boolean {
  try {
    const value = new URLSearchParams(search).get('demo')
    if (value !== null) {
      const on = value !== '0' && value !== 'false'
      sessionStorage.setItem(KEY, String(on))
      return on
    }
    return sessionStorage.getItem(KEY) === 'true'
  } catch {
    // Private mode or blocked storage: fall back to this page load's query alone.
    return /(?:^|[?&])demo=(?!0|false)/.test(search)
  }
}
