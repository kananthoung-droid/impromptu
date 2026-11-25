// App + prompter settings, persisted in localStorage (small, per-device).

const KEY = 'impromptu.settings.v1';

const sysLang = (navigator.languages?.[0] || navigator.language || 'en').toLowerCase();

export const DEFAULTS = Object.freeze({
  lang: sysLang.startsWith('km') ? 'km' : 'en',
  theme: 'dark', // 'dark' | 'light'

  // Prompter
  wpm: 140, // reading speed, words per minute
  fontSize: 34, // px (scaled a little on large screens)
  lineHeight: 1.32,
  margin: 7, // % of width on each side
  font: 'serif', // 'serif' | 'sans'
  bold: false,
  align: 'left', // 'left' | 'center'
  mirrorText: false,
  focusFade: true,
  dim: 0.45, // 0..0.85 shade behind the text
  markerPos: 0.14, // reading line, fraction of screen height
  expanded: false,
  scrollMode: 'auto', // 'auto' | 'voice'
  voiceSens: 0.55, // 0..1

  // Recording
  countdown: 3, // 0 | 3 | 5 | 10
  resolution: '1080', // '720' | '1080'
  facing: 'user', // 'user' | 'environment'
  mirrorPreview: true,
  micId: '',
  micMode: 'voice', // 'voice' | 'raw'
});

const LIMITS = {
  wpm: [60, 320],
  fontSize: [18, 80],
  lineHeight: [1.05, 2],
  margin: [2, 25],
  dim: [0, 0.85],
  markerPos: [0.06, 0.5],
  voiceSens: [0, 1],
};

function sanitize(s) {
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) {
    if (!(k in s)) continue;
    const def = DEFAULTS[k];
    let v = s[k];
    if (typeof def === 'number') {
      v = Number(v);
      if (!Number.isFinite(v)) continue;
      if (LIMITS[k]) v = Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], v));
    } else if (typeof def === 'boolean') {
      v = !!v;
    } else if (typeof def === 'string') {
      v = String(v);
    }
    out[k] = v;
  }
  if (!['en', 'km'].includes(out.lang)) out.lang = DEFAULTS.lang;
  if (!['dark', 'light'].includes(out.theme)) out.theme = 'dark';
  if (!['serif', 'sans'].includes(out.font)) out.font = 'serif';
  if (!['left', 'center'].includes(out.align)) out.align = 'left';
  if (!['auto', 'voice'].includes(out.scrollMode)) out.scrollMode = 'auto';
  if (![0, 3, 5, 10].includes(out.countdown)) out.countdown = 3;
  if (!['720', '1080'].includes(out.resolution)) out.resolution = '1080';
  if (!['user', 'environment'].includes(out.facing)) out.facing = 'user';
  if (!['voice', 'raw'].includes(out.micMode)) out.micMode = 'voice';
  return out;
}

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return sanitize(JSON.parse(raw));
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS };
}

let state = load();
const subs = new Set();

export const LIMITS_UI = LIMITS;

export const settings = {
  get: () => state,
  set(patch) {
    const next = sanitize({ ...state, ...patch });
    const changed = {};
    for (const k of Object.keys(next)) if (next[k] !== state[k]) changed[k] = next[k];
    if (!Object.keys(changed).length) return;
    state = next;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* ignore */
    }
    subs.forEach((fn) => {
      try {
        fn(state, changed);
      } catch (e) {
        console.error(e);
      }
    });
  },
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

// Simple one-off flags (install banner dismissed, welcome seeded, ...)
export const flags = {
  get(name) {
    try {
      return localStorage.getItem('impromptu.flag.' + name) === '1';
    } catch {
      return false;
    }
  },
  set(name, on = true) {
    try {
      if (on) localStorage.setItem('impromptu.flag.' + name, '1');
      else localStorage.removeItem('impromptu.flag.' + name);
    } catch {
      /* ignore */
    }
  },
};
