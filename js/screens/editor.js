// Script editor (one project).
import { db } from '../db.js';
import { t } from '../i18n.js';
import { settings } from '../settings.js';
import { go, goBack } from '../nav.js';
import { esc, debounce, countWords, fmtClock, estimateSeconds, uid } from '../util.js';
import { icon, actionSheet, confirmDialog, toast } from '../ui.js';

export async function mount(el, id) {
  const p = await db.getProject(id);
  if (!p) {
    go('#/', { replace: true });
    return null;
  }
  const takes = await db.listTakes(id);
  el.classList.add('editor');

  el.innerHTML = `
    <header class="topbar">
      <button class="icon-btn" data-act="back" aria-label="${esc(t('back'))}">${icon('back')}</button>
      <div class="topbar-right">
        <button class="pill-btn" data-act="takes" ${takes.length ? '' : 'hidden'} aria-label="${esc(t('takes'))}">${icon('film')}<b data-n>${takes.length}</b></button>
        <button class="icon-btn" data-act="more" aria-label="${esc(t('more'))}">${icon('dots')}</button>
        <button class="btn primary sm" data-act="done" hidden>${esc(t('done'))}</button>
      </div>
    </header>
    <div class="editor-body">
      <input class="title-input" type="text" maxlength="120" enterkeyhint="next" autocomplete="off"
        placeholder="${esc(t('untitled'))}" value="${esc(p.title || '')}" aria-label="${esc(t('title_ph'))}">
      <div class="meta" data-meta></div>
      <div class="paper">
        <textarea class="script-input" spellcheck="true" placeholder="${esc(t('script_ph'))}" aria-label="${esc(t('script_ph'))}"></textarea>
      </div>
    </div>
    <div class="cta-wrap">
      <button class="cta" data-act="record" type="button"><span class="cta-dot"></span>${esc(t('record'))}</button>
    </div>
    <input type="file" accept=".txt,.md,text/plain" hidden data-file>`;

  const titleEl = el.querySelector('.title-input');
  const textEl = el.querySelector('.script-input');
  const metaEl = el.querySelector('[data-meta]');
  const fileEl = el.querySelector('[data-file]');
  const doneBtn = el.querySelector('[data-act="done"]');
  textEl.value = p.script || '';

  const updateMeta = () => {
    const wpm = settings.get().wpm;
    const words = countWords(textEl.value);
    const secs = estimateSeconds(textEl.value, wpm);
    metaEl.textContent = words
      ? `${t('words', { n: words.toLocaleString() })} · ${t('est_read', { t: fmtClock(secs), wpm })}`
      : '';
  };
  const updateMetaSoon = debounce(updateMeta, 150);

  let dirty = false;
  const save = async () => {
    if (!dirty) return;
    dirty = false;
    p.title = titleEl.value.trim();
    p.script = textEl.value;
    p.updatedAt = Date.now();
    try {
      await db.putProject(p);
    } catch (e) {
      console.error(e);
      dirty = true;
    }
  };
  const saveSoon = debounce(save, 450);
  const markDirty = () => {
    dirty = true;
    saveSoon();
  };
  const flush = async () => {
    saveSoon.cancel();
    await save();
  };

  titleEl.addEventListener('input', markDirty);
  titleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      textEl.focus();
    }
  });
  textEl.addEventListener('input', () => {
    markDirty();
    updateMetaSoon();
  });

  const insertText = (txt) => {
    textEl.focus();
    const s = textEl.selectionStart ?? textEl.value.length;
    const e = textEl.selectionEnd ?? textEl.value.length;
    if (typeof textEl.setRangeText === 'function') textEl.setRangeText(txt, s, e, 'end');
    else textEl.value = textEl.value.slice(0, s) + txt + textEl.value.slice(e);
    markDirty();
    updateMeta();
  };

  // Keyboard handling: keep the text box above the on-screen keyboard.
  const vv = window.visualViewport;
  const onViewport = () => {
    if (!vv) return;
    const kb = Math.max(0, Math.round(window.innerHeight - vv.height));
    el.style.setProperty('--kb', kb + 'px');
    const open = kb > 120;
    el.classList.toggle('kb-open', open);
    doneBtn.hidden = !open;
    if (vv.offsetTop > 0 && open) window.scrollTo(0, 0);
  };
  vv?.addEventListener('resize', onViewport);
  vv?.addEventListener('scroll', onViewport);
  const onFocusIn = () => {
    doneBtn.hidden = false;
    setTimeout(onViewport, 300);
  };
  const onFocusOut = () =>
    setTimeout(() => {
      if (!el.contains(document.activeElement) || document.activeElement === document.body) {
        doneBtn.hidden = true;
        el.classList.remove('kb-open');
      }
    }, 120);
  el.addEventListener('focusin', onFocusIn);
  el.addEventListener('focusout', onFocusOut);

  const more = async () => {
    const choice = await actionSheet({
      title: p.title?.trim() || t('untitled'),
      actions: [
        { label: t('paste'), icon: 'paste', value: 'paste' },
        { label: t('import_txt'), icon: 'file', value: 'import' },
        { label: t('duplicate'), icon: 'copy', value: 'dup' },
        { label: t('clear_script'), icon: 'eraser', value: 'clear' },
        { label: t('delete_project'), icon: 'trash', value: 'delete', danger: true },
      ],
    });
    if (choice === 'paste') {
      try {
        const txt = await navigator.clipboard.readText();
        if (txt) insertText(txt);
      } catch {
        toast(t('paste_failed'), { duration: 5000 });
      }
    } else if (choice === 'import') {
      fileEl.value = '';
      fileEl.click();
    } else if (choice === 'dup') {
      await flush();
      const ts = Date.now();
      const copy = {
        ...p,
        id: uid(),
        title: `${p.title?.trim() || t('untitled')} (${t('copy_suffix')})`,
        createdAt: ts,
        updatedAt: ts,
        takeSeq: 0,
      };
      await db.putProject(copy);
      go(`#/p/${copy.id}`, { replace: true });
    } else if (choice === 'clear') {
      if (await confirmDialog({ title: t('clear_q'), ok: t('clear_script'), danger: true })) {
        textEl.value = '';
        markDirty();
        updateMeta();
      }
    } else if (choice === 'delete') {
      const name = p.title?.trim() || t('untitled');
      const ok = await confirmDialog({
        title: t('delete_project_q', { name }),
        message: t('delete_project_body'),
        ok: t('delete'),
        danger: true,
      });
      if (ok) {
        saveSoon.cancel();
        dirty = false;
        await db.deleteProject(p.id);
        goBack('#/');
      }
    }
  };

  fileEl.addEventListener('change', async () => {
    const f = fileEl.files?.[0];
    if (!f) return;
    try {
      const txt = await f.text();
      if (!textEl.value.trim()) {
        textEl.value = txt;
        if (!titleEl.value.trim()) titleEl.value = f.name.replace(/\.[^.]+$/, '');
        markDirty();
        updateMeta();
      } else {
        insertText((textEl.value.endsWith('\n') ? '' : '\n\n') + txt);
      }
    } catch {
      toast(t('import_failed'));
    }
  });

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'back') {
      await flush();
      goBack('#/');
    } else if (act === 'record') {
      await flush();
      go(`#/rec/${p.id}`);
    } else if (act === 'takes') {
      await flush();
      go(`#/takes/${p.id}`);
    } else if (act === 'more') {
      more();
    } else if (act === 'done') {
      document.activeElement?.blur?.();
      doneBtn.hidden = true;
      el.classList.remove('kb-open');
    }
  });

  const onHide = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);

  updateMeta();
  if (!p.script && !p.title) setTimeout(() => textEl.focus(), 350);

  return {
    onLanguage: () => {},
    async unmount() {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', flush);
      vv?.removeEventListener('resize', onViewport);
      vv?.removeEventListener('scroll', onViewport);
      await flush();
    },
  };
}
