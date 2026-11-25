// Tiny history-based router helpers (hash URLs work on any static host).

let renderFn = null;

export function setRenderer(fn) {
  renderFn = fn;
}

const depth = () => (history.state && typeof history.state.d === 'number' ? history.state.d : 0);

/** Navigate to a hash route, e.g. go('#/p/abc'). */
export function go(hash, { replace = false } = {}) {
  if (replace) history.replaceState({ d: depth() }, '', hash);
  else history.pushState({ d: depth() + 1 }, '', hash);
  renderFn?.(true);
}

/** Go back if we came from inside the app, otherwise jump to the fallback route. */
export function goBack(fallback = '#/') {
  if (depth() > 0) history.back();
  else go(fallback, { replace: true });
}
