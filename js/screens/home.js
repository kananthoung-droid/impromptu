// Home: "My Projects" grid.
import { db } from '../db.js';
import { t } from '../i18n.js';
import { settings, flags } from '../settings.js';
import { go } from '../nav.js';
import { esc, uid, fmtClock, estimateSeconds, isIOS, isAndroid, isStandalone } from '../util.js';
import { icon, actionSheet, confirmDialog, promptDialog } from '../ui.js';

function card(p, takes, wpm) {
  const secs = estimateSeconds(p.script || '', wpm);
  const title = p.title?.trim() || t('untitled');
  const preview = (p.script || '').trim().slice(0, 180);
  return `<button class="pcard" data-id="${esc(p.id)}" type="button">
    <span class="pcard-folder">
      <span class="pcard-tab">~${fmtClock(secs)}</span>
      <span class="pcard-body">
        <span class="pcard-title">${esc(title)}</span>
        <span class="pcard-preview">${esc(preview)}</span>
        ${takes ? `<span class="pcard-takes">${icon('film')}<b>${takes}</b></span>` : ''}
      </span>
    </span>
    <span class="pcard-name">${esc(title)}</span>
  </button>`;
}

function installCard() {
  if (isStandalone() || flags.get('installDismissed')) return '';
  let body = '';
  let button = '';
  const shareIcon = `<span class="inline-ico">${icon('iosShare')}</span>`;
  if (isIOS()) {
    const isSafari = !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(navigator.userAgent);
    body = (isSafari ? t('install_ios') : t('install_ios_other')).replace('{icon}', shareIcon);
  } else if (window.__installPrompt?.available()) {
    body = '';
    button = `<button class="btn primary sm" data-act="install">${esc(t('install_btn'))}</button>`;
  } else if (isAndroid()) {
    body = esc(t('install_android'));
  } else {
    return '';
  }
  return `<section class="install-card">
    <div class="install-ico">${icon('phone')}</div>
    <div class="install-text">
      <h2>${esc(t('install_title'))}</h2>
      ${body ? `<p>${body}</p>` : ''}
      ${button}
    </div>
    <button class="icon-btn sm ghost" data-act="dismiss-install" aria-label="${esc(t('close'))}">${icon('close')}</button>
  </section>`;
}

function emptyState() {
  return `<section class="empty">
    <div class="empty-art" aria-hidden="true">
      <span></span><span></span><span></span><i></i>
    </div>
    <h2>${esc(t('empty_title'))}</h2>
    <p>${esc(t('empty_body'))}</p>
  </section>`;
}

export async function mount(el) {
  el.classList.add('home');
  let alive = true;

  const render = async () => {
    const [projects, counts] = await Promise.all([db.listProjects(), db.takeCounts()]);
    if (!alive) return;
    const wpm = settings.get().wpm;
    el.innerHTML = `
      <div class="page">
        <header class="home-head">
          <h1 class="home-title">${esc(t('my_projects'))}</h1>
          <button class="icon-btn" data-act="settings" aria-label="${esc(t('settings'))}">${icon('gear')}</button>
        </header>
        ${installCard()}
        ${
          projects.length
            ? `<div class="pgrid">${projects.map((p) => card(p, counts.get(p.id) || 0, wpm)).join('')}</div>`
            : emptyState()
        }
      </div>
      <div class="fab-wrap">
        <button class="fab" data-act="new" type="button">${icon('plus')}<span>${esc(t('create_new'))}</span></button>
      </div>`;
  };

  const createNew = async () => {
    const ts = Date.now();
    const p = { id: uid(), title: '', script: '', createdAt: ts, updatedAt: ts, takeSeq: 0 };
    await db.putProject(p);
    go(`#/p/${p.id}`);
  };

  const projectActions = async (id) => {
    const p = await db.getProject(id);
    if (!p) return;
    const name = p.title?.trim() || t('untitled');
    const choice = await actionSheet({
      title: name,
      actions: [
        { label: t('rename'), icon: 'pencil', value: 'rename' },
        { label: t('duplicate'), icon: 'copy', value: 'dup' },
        { label: t('delete'), icon: 'trash', value: 'delete', danger: true },
      ],
    });
    if (choice === 'rename') {
      const v = await promptDialog({ title: t('rename'), value: p.title || '', placeholder: t('untitled') });
      if (v !== null) {
        p.title = v;
        p.updatedAt = Date.now();
        await db.putProject(p);
        render();
      }
    } else if (choice === 'dup') {
      const ts = Date.now();
      await db.putProject({
        ...p,
        id: uid(),
        title: `${name} (${t('copy_suffix')})`,
        createdAt: ts,
        updatedAt: ts,
        takeSeq: 0,
      });
      render();
    } else if (choice === 'delete') {
      const ok = await confirmDialog({
        title: t('delete_project_q', { name }),
        message: t('delete_project_body'),
        ok: t('delete'),
        danger: true,
      });
      if (ok) {
        await db.deleteProject(id);
        render();
      }
    }
  };

  // Long-press a card for more actions.
  let pressTimer = null;
  let longPressed = false;
  let pressXY = null;
  const onDown = (e) => {
    longPressed = false;
    clearTimeout(pressTimer);
    const c = e.target.closest('.pcard');
    if (!c || (e.button !== undefined && e.button !== 0)) return;
    pressXY = [e.clientX, e.clientY];
    pressTimer = setTimeout(() => {
      longPressed = true;
      navigator.vibrate?.(12);
      projectActions(c.dataset.id);
    }, 520);
  };
  const cancelPress = () => clearTimeout(pressTimer);

  const onClick = async (e) => {
    const b = e.target.closest('[data-act], .pcard');
    if (!b) return;
    if (b.classList.contains('pcard')) {
      if (longPressed) {
        longPressed = false;
        return;
      }
      go(`#/p/${b.dataset.id}`);
      return;
    }
    const act = b.dataset.act;
    if (act === 'new') createNew();
    else if (act === 'settings') go('#/settings');
    else if (act === 'dismiss-install') {
      flags.set('installDismissed');
      b.closest('.install-card')?.remove();
    } else if (act === 'install') {
      const ok = await window.__installPrompt?.show();
      if (ok) b.closest('.install-card')?.remove();
    }
  };

  const onContext = (e) => {
    const c = e.target.closest('.pcard');
    if (!c) return;
    e.preventDefault();
    if (longPressed) return; // the long-press timer already opened the menu
    clearTimeout(pressTimer);
    longPressed = true;
    projectActions(c.dataset.id);
  };

  const onInstallable = () => render();

  el.addEventListener('click', onClick);
  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', cancelPress);
  el.addEventListener('pointercancel', cancelPress);
  el.addEventListener('pointermove', (e) => {
    if (pressXY && Math.hypot(e.clientX - pressXY[0], e.clientY - pressXY[1]) > 8) cancelPress();
  });
  el.addEventListener('contextmenu', onContext);
  window.addEventListener('installable', onInstallable);

  await render();

  return {
    onLanguage: render,
    unmount() {
      alive = false;
      clearTimeout(pressTimer);
      window.removeEventListener('installable', onInstallable);
    },
  };
}
