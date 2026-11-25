// App bootstrap: theme, routing, service worker, first-run content.
import { settings, flags } from './settings.js';
import { t } from './i18n.js';
import { db } from './db.js';
import { setRenderer } from './nav.js';
import { closeAllSheets, toast, hideToast } from './ui.js';
import { uid, esc, isIOS, isStandalone } from './util.js';
import { recoverInterrupted } from './chunks.js';
import { probeVideo } from './media.js';
import * as home from './screens/home.js';
import * as editor from './screens/editor.js';
import * as recorder from './screens/recorder.js';
import * as review from './screens/review.js';
import * as settingsScreen from './screens/settings.js';

export const APP_VERSION = '1.0.0';
window.__APP_VERSION__ = APP_VERSION;

const app = document.getElementById('app');

// ------------------------------------------------------------------ theme & language

function applyAppearance() {
  const s = settings.get();
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  root.lang = s.lang === 'km' ? 'km' : 'en';
  root.classList.toggle('ios', isIOS());
  root.classList.toggle('standalone', isStandalone());
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', s.theme === 'light' ? '#EFE7E1' : '#0E0C0B');
}

function measureSafeArea() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)';
  document.body.appendChild(probe);
  const cs = getComputedStyle(probe);
  document.documentElement.style.setProperty('--safe-t-px', String(parseFloat(cs.paddingTop) || 0));
  document.documentElement.style.setProperty('--safe-b-px', String(parseFloat(cs.paddingBottom) || 0));
  probe.remove();
}

// ------------------------------------------------------------------ router

const routes = [
  [/^#?\/?$/, home],
  [/^#\/p\/([\w-]+)$/, editor],
  [/^#\/rec\/([\w-]+)$/, recorder],
  [/^#\/takes\/([\w-]+)(?:\/([\w-]+))?$/, review],
  [/^#\/settings$/, settingsScreen],
];

let current = null;
let renderedHash = null;
let token = 0;

async function render(force = false) {
  const hash = location.hash || '#/';
  if (!force && hash === renderedHash) return;
  renderedHash = hash;
  const my = ++token;

  let mod = home;
  let params = [];
  for (const [re, m] of routes) {
    const r = hash.match(re);
    if (r) {
      mod = m;
      params = r.slice(1).filter((x) => x !== undefined);
      break;
    }
  }

  closeAllSheets();
  hideToast();
  const prev = current;
  current = null;
  if (prev?.unmount) {
    try {
      await prev.unmount();
    } catch (e) {
      console.error(e);
    }
  }
  if (my !== token) return;

  const el = document.createElement('div');
  el.className = 'screen';
  app.replaceChildren(el);
  try {
    const handle = await mod.mount(el, ...params);
    if (my !== token) {
      handle?.unmount?.();
      return;
    }
    current = handle || null;
  } catch (e) {
    console.error(e);
    el.innerHTML = `<div class="fatal"><h2>Something went wrong</h2><p>${esc(e?.message || e)}</p><button class="btn primary" onclick="location.hash='#/';location.reload()">Home</button></div>`;
  }
}

setRenderer(render);
window.addEventListener('popstate', () => render());
window.addEventListener('hashchange', () => render());

// Re-render the current screen when language or theme changes.
settings.subscribe((s, changed) => {
  if ('theme' in changed || 'lang' in changed) applyAppearance();
  if ('lang' in changed && current?.onLanguage) current.onLanguage();
});

// ------------------------------------------------------------------ first run

async function seedWelcome() {
  if (flags.get('seeded')) return;
  try {
    const list = await db.listProjects();
    if (!list.length) {
      const nowTs = Date.now();
      await db.putProject({
        id: uid(),
        title: t('welcome_title'),
        script: t('welcome_script'),
        createdAt: nowTs,
        updatedAt: nowTs,
        takeSeq: 0,
      });
    }
    flags.set('seeded');
  } catch (e) {
    console.warn('seed failed', e);
  }
}

// Recordings cut off by a crash / killed app are rebuilt from their saved pieces.
async function recoverRecordings() {
  const n = await recoverInterrupted({
    makeTake: async (r, blob) => {
      if (await db.getTake(r.rid)) return true; // already saved normally
      let project = r.projectId ? await db.getProject(r.projectId) : null;
      if (!project) {
        const ts = Date.now();
        project = { id: uid(), title: t('recovered_project'), script: '', createdAt: ts, updatedAt: ts, takeSeq: 0 };
      }
      const meta = await probeVideo(blob, 5000);
      project.takeSeq = (project.takeSeq || 0) + 1;
      await db.putTake({
        id: r.rid,
        projectId: project.id,
        n: project.takeSeq,
        name: `${t('take_n', { n: project.takeSeq })} · ${t('recovered')}`,
        createdAt: r.startedAt || Date.now(),
        duration: (Number.isFinite(meta?.duration) && meta.duration) || r.elapsed || 0,
        mimeType: r.mimeType || blob.type,
        size: blob.size,
        width: meta?.width || r.width || 0,
        height: meta?.height || r.height || 0,
        facing: r.facing,
        blob,
        thumb: r.thumb || null,
        cues: [],
        issues: [],
      });
      project.updatedAt = Date.now();
      await db.putProject(project);
      return true;
    },
  });
  if (n > 0) {
    if (!location.hash || location.hash === '#/') await render(true);
    toast(t('recovered_toast', { n }), { duration: 7000 });
  }
}

// ------------------------------------------------------------------ PWA

let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstall = e;
  window.dispatchEvent(new Event('installable'));
});
export const installPrompt = {
  available: () => !!deferredInstall,
  async show() {
    if (!deferredInstall) return false;
    deferredInstall.prompt();
    const r = await deferredInstall.userChoice.catch(() => null);
    deferredInstall = null;
    return r?.outcome === 'accepted';
  },
};
window.__installPrompt = installPrompt;

function registerSW() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('nosw')) return;
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    // A new version took over. Don't interrupt a recording — offer a reload.
    const onCamera = /^#\/rec\//.test(location.hash);
    if (onCamera) return;
    toast(t('update_ready'), {
      action: t('reload'),
      duration: 12000,
      onAction: () => {
        reloading = true;
        location.reload();
      },
    });
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      // Check for updates when the app comes back to the foreground.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch((e) => console.warn('SW registration failed', e));
}

// ------------------------------------------------------------------ start

async function start() {
  applyAppearance();
  measureSafeArea();
  window.addEventListener('orientationchange', () => setTimeout(measureSafeArea, 300));
  window.addEventListener('resize', measureSafeArea);

  // Prevent pinch-zoom from fighting the app UI on iOS (double-tap zoom is
  // disabled with CSS touch-action: manipulation).
  document.addEventListener('gesturestart', (e) => e.preventDefault());

  await seedWelcome();
  if (!history.state || typeof history.state.d !== 'number') history.replaceState({ d: 0 }, '', location.hash || '#/');
  await render(true);
  document.documentElement.classList.add('ready');
  registerSW();
  recoverRecordings().catch((e) => console.warn('recovery', e));
}

start();
