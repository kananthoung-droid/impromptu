// Shared prompter / recording settings controls (used in the camera sheet and Settings).
import { settings, LIMITS_UI } from '../settings.js';
import { t } from '../i18n.js';
import { esc } from '../util.js';
import { rangeRow, segRow, toggleRow } from '../ui.js';

const FORMAT = {
  wpm: (v) => `${v}`,
  fontSize: (v) => `${v}`,
  lineHeight: (v) => `${Number(v).toFixed(2)}×`,
  margin: (v) => `${v}%`,
  dim: (v) => `${Math.round(v * 100)}%`,
  markerPos: (v) => `${Math.round(v * 100)}%`,
  voiceSens: (v) => `${Math.round(v * 100)}%`,
};

const NUMERIC_SEG = new Set(['countdown']);

export function controlsHTML({ sections = ['scroll', 'text', 'recording'] } = {}) {
  const s = settings.get();
  const r = (key, label, step) =>
    rangeRow({ key, label, min: LIMITS_UI[key][0], max: LIMITS_UI[key][1], step, value: s[key], format: FORMAT[key] });
  const out = [];
  if (sections.includes('scroll')) {
    out.push(`<section class="ctl-group">
      <h3 class="ctl-head">${esc(t('sec_scroll'))}</h3>
      ${segRow({
        key: 'scrollMode',
        label: t('scroll_mode'),
        value: s.scrollMode,
        options: [
          { value: 'auto', label: t('mode_auto') },
          { value: 'voice', label: t('mode_voice') },
        ],
        hint: s.scrollMode === 'voice' ? t('mode_voice_hint') : t('mode_auto_hint'),
      })}
      ${r('wpm', `${t('speed')} (${t('wpm')})`, 5)}
      <div data-show-if="scrollMode=voice">${r('voiceSens', t('voice_sens'), 0.05)}</div>
    </section>`);
  }
  if (sections.includes('text')) {
    out.push(`<section class="ctl-group">
      <h3 class="ctl-head">${esc(t('sec_text'))}</h3>
      ${r('fontSize', t('text_size'), 1)}
      ${r('lineHeight', t('line_spacing'), 0.05)}
      ${r('margin', t('margins'), 1)}
      ${r('markerPos', t('reading_line'), 0.01)}
      ${r('dim', t('dim'), 0.05)}
      ${segRow({
        key: 'font',
        label: t('font'),
        value: s.font,
        options: [
          { value: 'serif', label: `${t('font_serif')}` },
          { value: 'sans', label: `${t('font_sans')}` },
        ],
      })}
      ${segRow({
        key: 'align',
        label: t('align'),
        value: s.align,
        options: [
          { value: 'left', label: t('align_left') },
          { value: 'center', label: t('align_center') },
        ],
      })}
      ${toggleRow({ key: 'bold', label: t('bold'), value: s.bold })}
      ${toggleRow({ key: 'focusFade', label: t('focus_fade'), value: s.focusFade })}
      ${toggleRow({ key: 'mirrorText', label: t('mirror_text'), value: s.mirrorText })}
    </section>`);
  }
  if (sections.includes('recording')) {
    out.push(`<section class="ctl-group">
      <h3 class="ctl-head">${esc(t('sec_recording'))}</h3>
      ${segRow({
        key: 'countdown',
        label: t('countdown'),
        value: s.countdown,
        options: [
          { value: 0, label: t('off') },
          { value: 3, label: '3s' },
          { value: 5, label: '5s' },
          { value: 10, label: '10s' },
        ],
      })}
      ${segRow({
        key: 'resolution',
        label: t('quality'),
        value: s.resolution,
        options: [
          { value: '720', label: '720p' },
          { value: '1080', label: '1080p HD' },
        ],
      })}
      ${toggleRow({ key: 'mirrorPreview', label: t('mirror_preview'), value: s.mirrorPreview })}
    </section>`);
  }
  return out.join('');
}

function refreshConditional(root) {
  const s = settings.get();
  root.querySelectorAll('[data-show-if]').forEach((n) => {
    const [k, v] = n.dataset.showIf.split('=');
    n.hidden = String(s[k]) !== v;
  });
  const hint = root.querySelector('.seg[data-key="scrollMode"] ~ .ctl-hint');
  if (hint) hint.textContent = s.scrollMode === 'voice' ? t('mode_voice_hint') : t('mode_auto_hint');
}

/** Wire up controls rendered by controlsHTML(). Returns an unbind function. */
export function bindControls(root) {
  const onInput = (e) => {
    const inp = e.target;
    if (inp.matches('input[type="range"][data-key]')) {
      const key = inp.dataset.key;
      const v = Number(inp.value);
      settings.set({ [key]: v });
      const out = root.querySelector(`[data-out="${key}"]`);
      if (out) out.textContent = (FORMAT[key] || String)(v);
    }
  };
  const onChange = (e) => {
    const inp = e.target;
    if (inp.matches('input.switch[data-key]')) settings.set({ [inp.dataset.key]: inp.checked });
  };
  const onClick = (e) => {
    const b = e.target.closest('.seg-btn');
    if (!b) return;
    const seg = b.closest('.seg[data-key]');
    if (!seg) return;
    const key = seg.dataset.key;
    const raw = b.dataset.val;
    settings.set({ [key]: NUMERIC_SEG.has(key) ? Number(raw) : raw });
    seg.querySelectorAll('.seg-btn').forEach((x) => {
      const on = x === b;
      x.classList.toggle('on', on);
      x.setAttribute('aria-checked', String(on));
    });
    refreshConditional(root);
  };
  // Keep the controls in sync if a setting changes elsewhere (e.g. speed buttons).
  const unsub = settings.subscribe((s, changed) => {
    for (const k of Object.keys(changed)) {
      const range = root.querySelector(`input[type="range"][data-key="${k}"]`);
      if (range && document.activeElement !== range) {
        range.value = s[k];
        const out = root.querySelector(`[data-out="${k}"]`);
        if (out) out.textContent = (FORMAT[k] || String)(s[k]);
      }
    }
  });
  root.addEventListener('input', onInput);
  root.addEventListener('change', onChange);
  root.addEventListener('click', onClick);
  refreshConditional(root);
  return () => {
    unsub();
    root.removeEventListener('input', onInput);
    root.removeEventListener('change', onChange);
    root.removeEventListener('click', onClick);
  };
}
