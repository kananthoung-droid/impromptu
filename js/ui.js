// UI building blocks: icons, toasts, bottom sheets, dialogs.
import { esc } from './util.js';
import { t } from './i18n.js';

const S = (body, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${body}</svg>`;

export const ICONS = {
  back: S('<path d="m15 18-6-6 6-6"/>'),
  close: S('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  plus: S('<path d="M5 12h14"/><path d="M12 5v14"/>'),
  minus: S('<path d="M5 12h14"/>'),
  gear: S(
    '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>'
  ),
  sliders: S('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'),
  flip: S(
    '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>'
  ),
  mic: S(
    '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><path d="M12 19v3"/>'
  ),
  phone: S('<rect width="14" height="20" x="5" y="2" rx="2.5"/><path d="M12 18h.01"/>'),
  check: S('<path d="M20 6 9 17l-5-5"/>'),
  updown: S('<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>'),
  expand: S('<path d="M15 3h6v6"/><path d="M9 21H3v-6"/><path d="M21 3l-7 7"/><path d="M3 21l7-7"/>'),
  shrink: S('<path d="M4 14h6v6"/><path d="M20 10h-6V4"/><path d="M14 10l7-7"/><path d="M3 21l7-7"/>'),
  film: S(
    '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M7 3v18"/><path d="M3 7.5h4"/><path d="M3 12h18"/><path d="M3 16.5h4"/><path d="M17 3v18"/><path d="M17 7.5h4"/><path d="M17 16.5h4"/>'
  ),
  dots: S('<circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/><circle cx="5" cy="12" r="1.2"/>', 'stroke-width="2.4"'),
  share: S('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>'),
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11.04-6.86a1 1 0 0 0 0-1.72L9.5 4.28A1 1 0 0 0 8 5.14Z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect fill="currentColor" x="6" y="4.5" width="4" height="15" rx="1.4"/><rect fill="currentColor" x="14" y="4.5" width="4" height="15" rx="1.4"/></svg>',
  back10: S('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><text x="12" y="15.6" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">10</text>'),
  fwd10: S('<path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><text x="12" y="15.6" text-anchor="middle" font-size="8" font-weight="700" fill="currentColor" stroke="none" font-family="system-ui,sans-serif">10</text>'),
  trash: S(
    '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><path d="M10 11v6"/><path d="M14 11v6"/>'
  ),
  download: S('<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>'),
  video: S('<path d="m16 13 5.22 3.48a.5.5 0 0 0 .78-.42V7.87a.5.5 0 0 0-.75-.43L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>'),
  pencil: S('<path d="M21.17 6.81a1 1 0 0 0-3.99-3.99L3.84 16.17a2 2 0 0 0-.5.83l-1.32 4.35a.5.5 0 0 0 .62.62l4.35-1.32a2 2 0 0 0 .83-.5z"/><path d="m15 5 4 4"/>'),
  copy: S('<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  paste: S('<rect width="8" height="4" x="8" y="2" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>'),
  file: S('<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>'),
  eraser: S('<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/>'),
  globe: S('<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>'),
  mirror: S('<path d="M8 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3"/><path d="M12 20v2"/><path d="M12 14v2"/><path d="M12 8v2"/><path d="M12 2v2"/>'),
  cc: S('<rect width="18" height="14" x="3" y="5" rx="2"/><path d="M7 15h4"/><path d="M15 15h2"/><path d="M7 11h2"/><path d="M13 11h4"/>'),
  rotate: S('<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>'),
  retake: S('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
  top: S('<path d="m17 11-5-5-5 5"/><path d="m17 18-5-5-5 5"/>'),
  info: S('<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>'),
  shield: S('<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>'),
  disk: S('<path d="M22 12H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M6 16h.01"/><path d="M10 16h.01"/>'),
  palette: S('<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.55-2.5 5.55-5.55C21.97 6.01 17.46 2 12 2z"/>'),
  type: S('<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>'),
  iosShare: S('<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="m16 6-4-4-4 4"/><path d="M12 2v13"/>'),
  sparkle: S('<path d="M9.94 14.06 4 20"/><path d="m14 4 6 6"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.93 4.93l1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/>'),
  reset: S('<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>'),
};

export const icon = (name) => ICONS[name] || '';

// ------------------------------------------------------------------ toast

let toastEl = null;
let toastTimer = null;

export function toast(message, { action, onAction, duration = 3200, tone = 'default' } = {}) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.body.appendChild(toastEl);
  }
  clearTimeout(toastTimer);
  toastEl.dataset.tone = tone;
  toastEl.innerHTML = `<span class="toast-msg">${esc(message)}</span>${
    action ? `<button class="toast-action" type="button">${esc(action)}</button>` : ''
  }`;
  if (action) {
    toastEl.querySelector('.toast-action').onclick = () => {
      hideToast();
      onAction?.();
    };
  }
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  if (duration > 0) toastTimer = setTimeout(hideToast, duration);
}

export function hideToast() {
  clearTimeout(toastTimer);
  toastEl?.classList.remove('show');
}

// ------------------------------------------------------------------ sheets

const openSheets = [];

/**
 * Bottom sheet. `theme`: 'app' (follows app theme) | 'glass' (light frosted, over camera).
 * Returns { el, body, close }.
 */
export function openSheet({ title = '', content = '', theme = 'app', className = '', onClose, dismissible = true, swipe = true } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `sheet-wrap sheet-${theme} ${className}`;
  wrap.innerHTML = `
    <div class="sheet-backdrop"></div>
    <div class="sheet" role="dialog" aria-modal="true" ${title ? `aria-label="${esc(title)}"` : ''}>
      <div class="sheet-grab" aria-hidden="true"></div>
      ${title ? `<div class="sheet-head"><h2 class="sheet-title">${esc(title)}</h2><button class="sheet-x icon-btn sm" type="button" aria-label="${esc(t('close'))}">${ICONS.close}</button></div>` : ''}
      <div class="sheet-body"></div>
    </div>`;
  const body = wrap.querySelector('.sheet-body');
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.appendChild(content);
  document.body.appendChild(wrap);

  let closed = false;
  const close = (reason) => {
    if (closed) return;
    closed = true;
    wrap.classList.remove('open');
    const i = openSheets.indexOf(api);
    if (i >= 0) openSheets.splice(i, 1);
    setTimeout(() => wrap.remove(), 320);
    onClose?.(reason);
  };
  const api = { el: wrap, body, close, sheet: wrap.querySelector('.sheet') };
  openSheets.push(api);

  if (dismissible) wrap.querySelector('.sheet-backdrop').addEventListener('click', () => close('backdrop'));
  wrap.querySelector('.sheet-x')?.addEventListener('click', () => close('x'));

  // Drag the grab handle / header down to dismiss.
  if (dismissible && swipe) enableSwipeDown(api, close);

  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  return api;
}

function enableSwipeDown(api, close) {
  const sheet = api.sheet;
  let startY = 0;
  let dy = 0;
  let active = false;
  const start = (e) => {
    if (e.target.closest('input, select, textarea, button:not(.sheet-grab)')) return;
    const scroller = api.body;
    if (scroller.scrollTop > 0 && !e.target.closest('.sheet-grab, .sheet-head')) return;
    active = true;
    startY = e.clientY;
    dy = 0;
    sheet.style.transition = 'none';
  };
  const move = (e) => {
    if (!active) return;
    dy = Math.max(0, e.clientY - startY);
    if (dy > 4) sheet.style.transform = `translateY(${dy}px)`;
  };
  const end = () => {
    if (!active) return;
    active = false;
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (dy > 90) close('swipe');
  };
  sheet.addEventListener('pointerdown', start);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  const origClose = api.close;
  api.close = (r) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    origClose(r);
  };
}

export function closeAllSheets() {
  [...openSheets].forEach((s) => s.close('nav'));
}

export const hasOpenSheet = () => openSheets.length > 0;

// ------------------------------------------------------------------ dialogs

function dialogShell(inner, { theme = 'app' } = {}) {
  const wrap = document.createElement('div');
  wrap.className = `dialog-wrap dialog-${theme}`;
  wrap.innerHTML = `<div class="dialog-backdrop"></div><div class="dialog" role="alertdialog" aria-modal="true">${inner}</div>`;
  document.body.appendChild(wrap);
  requestAnimationFrame(() => requestAnimationFrame(() => wrap.classList.add('open')));
  const close = () => {
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
  };
  return { wrap, close };
}

export function confirmDialog({ title, message = '', ok = t('ok'), cancel = t('cancel'), danger = false, theme } = {}) {
  return new Promise((resolve) => {
    const { wrap, close } = dialogShell(
      `<h2 class="dialog-title">${esc(title)}</h2>
       ${message ? `<p class="dialog-msg">${esc(message)}</p>` : ''}
       <div class="dialog-actions">
         <button class="btn ghost" data-r="0" type="button">${esc(cancel)}</button>
         <button class="btn ${danger ? 'danger' : 'primary'}" data-r="1" type="button">${esc(ok)}</button>
       </div>`,
      { theme }
    );
    const done = (v) => {
      close();
      resolve(v);
    };
    wrap.querySelector('.dialog-backdrop').onclick = () => done(false);
    wrap.querySelectorAll('[data-r]').forEach((b) => (b.onclick = () => done(b.dataset.r === '1')));
    setTimeout(() => wrap.querySelector('[data-r="1"]')?.focus({ preventScroll: true }), 50);
  });
}

export function alertDialog({ title, message = '', ok = t('ok'), theme } = {}) {
  return new Promise((resolve) => {
    const { wrap, close } = dialogShell(
      `<h2 class="dialog-title">${esc(title)}</h2>
       ${message ? `<p class="dialog-msg">${esc(message)}</p>` : ''}
       <div class="dialog-actions single"><button class="btn primary" type="button">${esc(ok)}</button></div>`,
      { theme }
    );
    const done = () => {
      close();
      resolve();
    };
    wrap.querySelector('.dialog-backdrop').onclick = done;
    wrap.querySelector('.btn').onclick = done;
  });
}

export function promptDialog({ title, value = '', placeholder = '', ok = t('save'), cancel = t('cancel'), theme } = {}) {
  return new Promise((resolve) => {
    const { wrap, close } = dialogShell(
      `<h2 class="dialog-title">${esc(title)}</h2>
       <input class="field" type="text" value="${esc(value)}" placeholder="${esc(placeholder)}" maxlength="120" enterkeyhint="done">
       <div class="dialog-actions">
         <button class="btn ghost" data-r="0" type="button">${esc(cancel)}</button>
         <button class="btn primary" data-r="1" type="button">${esc(ok)}</button>
       </div>`,
      { theme }
    );
    const input = wrap.querySelector('input');
    const done = (v) => {
      input.blur();
      close();
      resolve(v);
    };
    wrap.querySelector('.dialog-backdrop').onclick = () => done(null);
    wrap.querySelector('[data-r="0"]').onclick = () => done(null);
    wrap.querySelector('[data-r="1"]').onclick = () => done(input.value.trim());
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      if (e.key === 'Escape') done(null);
    });
    setTimeout(() => {
      input.focus();
      input.select();
    }, 60);
  });
}

/** Simple action list in a sheet. Resolves to the chosen action's value or null. */
export function actionSheet({ title = '', actions = [], theme = 'app' } = {}) {
  return new Promise((resolve) => {
    let chosen = null;
    const list = document.createElement('div');
    list.className = 'action-list';
    list.innerHTML = actions
      .map(
        (a, i) =>
          `<button class="action-row ${a.danger ? 'danger' : ''}" data-i="${i}" type="button" ${a.disabled ? 'disabled' : ''}>
             <span class="action-ico">${a.icon ? icon(a.icon) : ''}</span>
             <span class="action-label">${esc(a.label)}${a.badge ? ` <span class="badge">${esc(a.badge)}</span>` : ''}</span>
           </button>`
      )
      .join('');
    const sh = openSheet({ title, content: list, theme, onClose: () => resolve(chosen) });
    list.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      chosen = actions[+b.dataset.i].value;
      sh.close('choose');
    });
  });
}

// ------------------------------------------------------------------ form controls (for settings)

export function rangeRow({ key, label, min, max, step, value, format = (v) => v }) {
  return `<label class="ctl ctl-range">
    <span class="ctl-top"><span class="ctl-label">${esc(label)}</span><output class="ctl-val" data-out="${key}">${esc(format(value))}</output></span>
    <input type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}">
  </label>`;
}

export function segRow({ key, label, options, value, hint = '' }) {
  return `<div class="ctl ctl-seg">
    ${label ? `<span class="ctl-label">${esc(label)}</span>` : ''}
    <div class="seg" role="radiogroup" data-key="${key}">
      ${options
        .map(
          (o) =>
            `<button type="button" role="radio" aria-checked="${String(o.value) === String(value)}" class="seg-btn ${
              String(o.value) === String(value) ? 'on' : ''
            }" data-val="${esc(o.value)}">${esc(o.label)}</button>`
        )
        .join('')}
    </div>
    ${hint ? `<p class="ctl-hint">${esc(hint)}</p>` : ''}
  </div>`;
}

export function toggleRow({ key, label, value, sub = '' }) {
  return `<label class="ctl ctl-toggle">
    <span class="ctl-text"><span class="ctl-label">${esc(label)}</span>${sub ? `<span class="ctl-sub">${esc(sub)}</span>` : ''}</span>
    <input type="checkbox" class="switch" data-key="${key}" ${value ? 'checked' : ''}>
  </label>`;
}
