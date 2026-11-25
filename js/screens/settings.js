// App settings, storage, help and about.
import { db, storageEstimate } from '../db.js';
import { t } from '../i18n.js';
import { settings, DEFAULTS } from '../settings.js';
import { goBack } from '../nav.js';
import { esc, fmtBytes, isIOS, isAndroid, isStandalone } from '../util.js';
import { icon, segRow, confirmDialog, toast } from '../ui.js';
import { controlsHTML, bindControls } from './controls.js';

export async function mount(el) {
  el.classList.add('settings-screen');
  let unbind = null;
  let alive = true;

  const render = async () => {
    unbind?.();
    const s = settings.get();
    const showInstall = !isStandalone() && (isIOS() || isAndroid() || window.__installPrompt?.available());
    el.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-act="back" aria-label="${esc(t('back'))}">${icon('back')}</button>
      </header>
      <div class="page settings-page">
        <h1 class="page-title">${esc(t('settings'))}</h1>

        <section class="card-group">
          <div class="row-ico">${icon('globe')}</div>
          ${segRow({
            key: 'lang',
            label: t('language'),
            value: s.lang,
            options: [
              { value: 'en', label: 'English' },
              { value: 'km', label: 'ខ្មែរ' },
            ],
          })}
        </section>

        <section class="card-group">
          <div class="row-ico">${icon('palette')}</div>
          ${segRow({
            key: 'theme',
            label: t('appearance'),
            value: s.theme,
            options: [
              { value: 'dark', label: t('theme_dark') },
              { value: 'light', label: t('theme_light') },
            ],
          })}
        </section>

        <div class="card-group ctl-wrap" data-controls>
          ${controlsHTML()}
          <button class="btn ghost block" data-act="reset" type="button">${icon('reset')}${esc(t('reset_settings'))}</button>
        </div>

        <section class="card-group">
          <h3 class="ctl-head">${icon('disk')}${esc(t('storage'))}</h3>
          <div class="storage" data-storage><span class="spinner sm"></span></div>
          <button class="btn danger-ghost block" data-act="wipe" type="button">${icon('trash')}${esc(t('delete_all_videos'))}</button>
        </section>

        <section class="card-group help">
          <h3 class="ctl-head">${icon('info')}${esc(t('help'))}</h3>
          <ol class="steps">
            ${[1, 2, 3, 4, 5].map((i) => `<li>${esc(t('help_' + i))}</li>`).join('')}
          </ol>
          <p class="tip">${esc(t('remote_tip'))}</p>
        </section>

        ${
          showInstall
            ? `<section class="card-group">
                <h3 class="ctl-head">${icon('phone')}${esc(t('install'))}</h3>
                ${
                  isIOS()
                    ? `<p class="body-text">${t('install_ios').replace('{icon}', `<span class="inline-ico">${icon('iosShare')}</span>`)}</p>`
                    : window.__installPrompt?.available()
                    ? `<button class="btn primary block" data-act="install" type="button">${esc(t('install_btn'))}</button>`
                    : `<p class="body-text">${esc(t('install_android'))}</p>`
                }
              </section>`
            : ''
        }

        <section class="card-group about">
          <h3 class="ctl-head">${icon('shield')}${esc(t('about'))}</h3>
          <p class="body-text">${esc(t('privacy'))}</p>
          <p class="muted">Impromptu · ${esc(t('version', { v: window.__APP_VERSION__ || '1.0.0' }))}</p>
        </section>
      </div>`;
    unbind = bindControls(el.querySelector('[data-controls]'));
    loadStorage();
  };

  const loadStorage = async () => {
    const box = el.querySelector('[data-storage]');
    const [bytes, est] = await Promise.all([db.videoBytes().catch(() => 0), storageEstimate()]);
    if (!alive || !box) return;
    let html = `<p><b>${esc(t('storage_used', { used: fmtBytes(bytes) }))}</b></p>`;
    if (est?.quota) {
      const free = Math.max(0, est.quota - (est.usage || 0));
      const pct = Math.min(100, ((est.usage || 0) / est.quota) * 100);
      html += `<div class="pbar"><i style="transform:scaleX(${Math.max(0.01, pct / 100)})"></i></div>
               <p class="muted">${esc(t('storage_free', { free: fmtBytes(free) }))}</p>`;
    }
    box.innerHTML = html;
  };

  const onClick = async (e) => {
    const seg = e.target.closest('.seg[data-key="lang"] .seg-btn, .seg[data-key="theme"] .seg-btn');
    if (seg) {
      const key = seg.closest('.seg').dataset.key;
      settings.set({ [key]: seg.dataset.val });
      // A language change re-renders through onLanguage(); a theme change only needs the buttons updated.
      if (key === 'theme') render();
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') goBack('#/');
    else if (act === 'reset') {
      const keep = { lang: settings.get().lang, theme: settings.get().theme, micId: settings.get().micId };
      settings.set({ ...DEFAULTS, ...keep });
      toast(t('reset_done'));
      render();
    } else if (act === 'wipe') {
      const ok = await confirmDialog({
        title: t('delete_all_q'),
        message: t('delete_all_body'),
        ok: t('delete'),
        danger: true,
      });
      if (ok) {
        await db.deleteAllTakes();
        loadStorage();
      }
    } else if (act === 'install') {
      await window.__installPrompt?.show();
      render();
    }
  };

  el.addEventListener('click', onClick);
  await render();

  return {
    onLanguage: render,
    unmount() {
      alive = false;
      unbind?.();
    },
  };
}
