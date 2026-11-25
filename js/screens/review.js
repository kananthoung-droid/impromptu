// Takes: watch, export (Save to Photos / share), captions, mirror, delete.
import { db, memoryTakes } from '../db.js';
import { t, currentLang } from '../i18n.js';
import { go, goBack } from '../nav.js';
import {
  esc,
  fmtClock,
  fmtClock2,
  fmtBytes,
  fmtDate,
  sanitizeFilename,
  extForMime,
  downloadBlob,
  isIOS,
  uid,
  clamp,
} from '../util.js';
import { icon, openSheet, actionSheet, confirmDialog, promptDialog, toast, alertDialog } from '../ui.js';
import { toSRT, cueAt } from '../captions.js';
import { processVideo } from '../process.js';
import { baseMime } from '../media.js';

const takeLabel = (tk) => tk.name?.trim() || t('take_n', { n: tk.n || 1 });

export async function mount(el, projectId, takeId) {
  const project = await db.getProject(projectId);
  if (!project) {
    go('#/', { replace: true });
    return null;
  }
  let takes = await db.listTakes(projectId);
  for (const m of memoryTakes.values()) {
    if (m.projectId === projectId && !takes.some((x) => x.id === m.id)) takes.push(m);
  }
  takes.sort((a, b) => a.createdAt - b.createdAt);
  let current = takes.find((x) => x.id === takeId) || takes[takes.length - 1] || null;

  el.classList.add('review');
  let alive = true;
  let videoUrl = null;
  let posterUrl = null;
  let showCaptions = false;
  let hideTimer = null;
  let job = null;
  let wakeLock = null;

  const fileFor = (tk) => {
    const ext = extForMime(tk.mimeType);
    const name = `${sanitizeFilename(project.title?.trim() || t('untitled'))} - ${sanitizeFilename(takeLabel(tk))}.${ext}`;
    return new File([tk.blob], name, { type: baseMime(tk.mimeType), lastModified: tk.createdAt || Date.now() });
  };

  // ---------------------------------------------------------------- render shell

  const renderShell = () => {
    if (!current) {
      el.innerHTML = `
        <header class="topbar">
          <button class="icon-btn" data-act="back" aria-label="${esc(t('back'))}">${icon('back')}</button>
        </header>
        <section class="empty takes-empty">
          <div class="empty-art" aria-hidden="true"><span></span><span></span><span></span><i></i></div>
          <h2>${esc(t('no_takes'))}</h2>
          <p>${esc(t('no_takes_body'))}</p>
          <button class="cta" data-act="retake"><span class="cta-dot"></span>${esc(t('record'))}</button>
        </section>`;
      return;
    }
    el.innerHTML = `
      <header class="topbar">
        <button class="icon-btn" data-act="back" aria-label="${esc(t('back'))}">${icon('back')}</button>
        <div class="topbar-right">
          <button class="pill-btn" data-act="list" aria-label="${esc(t('all_takes'))}">${icon('film')}<b data-count></b></button>
          <button class="icon-btn" data-act="more" aria-label="${esc(t('more'))}">${icon('dots')}</button>
          <button class="btn primary sm export-btn" data-act="export">${esc(t('export'))}${icon('share')}</button>
        </div>
      </header>
      <div class="review-body">
        <div class="take-title"><b data-name></b><span class="sep">•</span><span data-len></span></div>
        <div class="issue" data-issue hidden></div>
        <div class="player-wrap">
          <div class="player">
            <video playsinline preload="metadata" disablepictureinpicture></video>
            <div class="cap-overlay" hidden><span></span></div>
            <div class="pl-center">
              <button class="pl-btn sm" data-act="rew" aria-label="-10s">${icon('back10')}</button>
              <button class="pl-btn" data-act="play" aria-label="Play">${icon('play')}</button>
              <button class="pl-btn sm" data-act="fwd" aria-label="+10s">${icon('fwd10')}</button>
            </div>
            <div class="pl-bottom">
              <div class="pl-track" data-track><div class="pl-fill"></div><div class="pl-knob"></div></div>
              <div class="pl-times"><span data-cur>0:00</span><span data-dur>0:00</span></div>
            </div>
            <div class="pl-error" hidden>${esc(t('playback_failed'))}</div>
          </div>
        </div>
        <div class="take-actions">
          <button class="act" data-act="captions">${icon('cc')}<span>${esc(t('captions'))}</span></button>
          <button class="act" data-act="mirror">${icon('mirror')}<span>${esc(t('mirror_video'))}</span></button>
          <button class="act" data-act="retake">${icon('retake')}<span>${esc(t('retake'))}</span></button>
          <button class="act" data-act="download">${icon('download')}<span>${esc(t('download'))}</span></button>
          <button class="act danger" data-act="delete">${icon('trash')}<span>${esc(t('delete'))}</span></button>
        </div>
        ${isIOS() ? `<p class="hint">${esc(t('share_hint_ios'))}</p>` : ''}
      </div>`;
    bindPlayer();
    setTake(current);
  };

  // ---------------------------------------------------------------- player

  let video;
  let playerEl;
  let fill;
  let knob;
  let curEl;
  let durEl;
  let capEl;
  let raf = 0;

  const dur = () => (Number.isFinite(video?.duration) && video.duration > 0 ? video.duration : current?.duration || 0);

  const paint = () => {
    if (!video) return;
    const d = dur();
    const c = video.currentTime || 0;
    const p = d ? clamp(c / d, 0, 1) : 0;
    fill.style.transform = `scaleX(${p})`;
    knob.style.left = `${p * 100}%`;
    curEl.textContent = fmtClock(c);
    durEl.textContent = fmtClock(d);
    if (showCaptions && current?.cues?.length) {
      const cue = cueAt(current.cues, c);
      capEl.hidden = !cue;
      if (cue) capEl.firstElementChild.textContent = cue.text;
    } else capEl.hidden = true;
  };

  const loop = () => {
    paint();
    if (video && !video.paused) raf = requestAnimationFrame(loop);
    else raf = 0;
  };

  const setPlayIcon = () => {
    const b = el.querySelector('[data-act="play"]');
    if (b) b.innerHTML = video.paused ? icon('play') : icon('pause');
    playerEl.classList.toggle('playing', !video.paused);
  };

  const showControls = (autoHide) => {
    playerEl.classList.remove('idle');
    clearTimeout(hideTimer);
    if (autoHide && !video.paused) hideTimer = setTimeout(() => playerEl.classList.add('idle'), 2400);
  };

  const togglePlay = () => {
    if (!video) return;
    if (video.paused) {
      if (video.ended || video.currentTime >= dur() - 0.05) video.currentTime = 0;
      video.play().catch((e) => console.warn(e));
    } else video.pause();
  };

  const seekBy = (s) => {
    if (!video) return;
    video.currentTime = clamp((video.currentTime || 0) + s, 0, Math.max(0, dur() - 0.05));
    paint();
  };

  const bindPlayer = () => {
    video = el.querySelector('video');
    playerEl = el.querySelector('.player');
    fill = el.querySelector('.pl-fill');
    knob = el.querySelector('.pl-knob');
    curEl = el.querySelector('[data-cur]');
    durEl = el.querySelector('[data-dur]');
    capEl = el.querySelector('.cap-overlay');
    video.addEventListener('play', () => {
      setPlayIcon();
      showControls(true);
      if (!raf) raf = requestAnimationFrame(loop);
    });
    video.addEventListener('pause', () => {
      setPlayIcon();
      showControls(false);
      paint();
    });
    video.addEventListener('ended', () => {
      setPlayIcon();
      showControls(false);
    });
    video.addEventListener('loadedmetadata', () => {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w && h) {
        playerEl.style.setProperty('--ar', `${w} / ${h}`);
        playerEl.classList.toggle('landscape', w > h);
      }
      paint();
    });
    video.addEventListener('timeupdate', paint);
    video.addEventListener('seeked', paint);
    video.addEventListener('error', () => {
      el.querySelector('.pl-error').hidden = false;
    });

    // Tap the picture to show/hide controls.
    playerEl.addEventListener('click', (e) => {
      if (e.target.closest('button, [data-track]')) return;
      if (playerEl.classList.contains('idle')) showControls(true);
      else togglePlay();
    });

    // Scrubbing.
    const track = el.querySelector('[data-track]');
    let scrubbing = false;
    let wasPlaying = false;
    const seekTo = (clientX) => {
      const r = track.getBoundingClientRect();
      const p = clamp((clientX - r.left) / r.width, 0, 1);
      video.currentTime = p * Math.max(0, dur() - 0.03);
      paint();
    };
    track.addEventListener('pointerdown', (e) => {
      scrubbing = true;
      wasPlaying = !video.paused;
      video.pause();
      track.setPointerCapture?.(e.pointerId);
      seekTo(e.clientX);
      showControls(false);
    });
    track.addEventListener('pointermove', (e) => scrubbing && seekTo(e.clientX));
    const end = () => {
      if (!scrubbing) return;
      scrubbing = false;
      if (wasPlaying) video.play().catch(() => {});
    };
    track.addEventListener('pointerup', end);
    track.addEventListener('pointercancel', end);
  };

  const setTake = (tk) => {
    current = tk;
    if (!tk || !video) return;
    video.pause();
    if (videoUrl) URL.revokeObjectURL(videoUrl);
    if (posterUrl) URL.revokeObjectURL(posterUrl);
    posterUrl = tk.thumb ? URL.createObjectURL(tk.thumb) : null;
    videoUrl = URL.createObjectURL(tk.blob);
    el.querySelector('.pl-error').hidden = true;
    if (posterUrl) video.poster = posterUrl;
    else video.removeAttribute('poster');
    const ar = tk.width && tk.height ? `${tk.width} / ${tk.height}` : '9 / 16';
    playerEl.style.setProperty('--ar', ar);
    playerEl.classList.toggle('landscape', !!(tk.width && tk.height && tk.width > tk.height));
    video.src = videoUrl;
    video.load();
    el.querySelector('[data-name]').textContent = takeLabel(tk);
    el.querySelector('[data-len]').textContent = fmtClock2(tk.duration);
    el.querySelector('[data-count]').textContent = String(takes.length);
    const issue = el.querySelector('[data-issue]');
    const msgs = [];
    if (memoryTakes.has(tk.id)) msgs.push(t('storage_full'));
    if (tk.issues?.includes('short')) msgs.push(t('video_issue_short'));
    if (tk.issues?.includes('rotated')) msgs.push(t('video_issue_rotated'));
    issue.hidden = !msgs.length;
    issue.textContent = msgs.join(' ');
    showControls(false);
    paint();
    history.replaceState(history.state, '', `#/takes/${project.id}/${tk.id}`);
  };

  // ---------------------------------------------------------------- actions

  const exportTake = () => {
    if (!current) return;
    const file = fileFor(current);
    let canShare = false;
    try {
      canShare = !!navigator.canShare?.({ files: [file] });
    } catch {
      canShare = false;
    }
    if (canShare) {
      // Called synchronously from the tap so iOS allows the share sheet.
      navigator.share({ files: [file], title: file.name }).catch((err) => {
        if (err?.name === 'AbortError') return;
        console.warn('share failed', err);
        downloadBlob(file, file.name);
        toast(t('share_failed'), { duration: 5000 });
      });
    } else {
      downloadBlob(file, file.name);
    }
  };

  const listSheet = () => {
    const urls = [];
    const body = document.createElement('div');
    body.className = 'take-list';
    body.innerHTML = [...takes]
      .reverse()
      .map((tk) => {
        const u = tk.thumb ? URL.createObjectURL(tk.thumb) : '';
        if (u) urls.push(u);
        return `<button class="take-row ${tk.id === current?.id ? 'on' : ''}" data-id="${esc(tk.id)}" type="button">
          <span class="take-thumb">${u ? `<img src="${u}" alt="">` : icon('video')}<i>${fmtClock(tk.duration)}</i></span>
          <span class="take-info"><b>${esc(takeLabel(tk))}</b><small>${esc(fmtDate(tk.createdAt, currentLang()))} · ${esc(
          fmtBytes(tk.size || tk.blob?.size)
        )}</small></span>
          <span class="take-check">${tk.id === current?.id ? icon('check') : ''}</span>
        </button>`;
      })
      .join('');
    const sh = openSheet({
      title: `${t('all_takes')} (${takes.length})`,
      content: body,
      onClose: () => urls.forEach((u) => URL.revokeObjectURL(u)),
    });
    body.addEventListener('click', (e) => {
      const r = e.target.closest('[data-id]');
      if (!r) return;
      const tk = takes.find((x) => x.id === r.dataset.id);
      sh.close();
      if (tk && tk.id !== current?.id) setTake(tk);
    });
  };

  const deleteTake = async () => {
    if (!current) return;
    const ok = await confirmDialog({ title: t('delete_take_q'), message: t('delete_take_body'), ok: t('delete'), danger: true });
    if (!ok) return;
    const id = current.id;
    memoryTakes.delete(id);
    await db.deleteTake(id).catch(() => {});
    const idx = takes.findIndex((x) => x.id === id);
    takes = takes.filter((x) => x.id !== id);
    current = takes[Math.min(idx, takes.length - 1)] || null;
    if (!current) {
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      videoUrl = null;
      video = null;
      renderShell();
    } else setTake(current);
  };

  const renameTake = async () => {
    if (!current) return;
    const v = await promptDialog({ title: t('rename_take'), value: current.name || '', placeholder: t('take_n', { n: current.n }) });
    if (v === null) return;
    current.name = v;
    if (!memoryTakes.has(current.id)) await db.putTake(current).catch(() => {});
    el.querySelector('[data-name]').textContent = takeLabel(current);
  };

  // --- on-device processing (mirror / rotate / captions)

  const requestWake = async () => {
    try {
      wakeLock = await navigator.wakeLock?.request('screen');
    } catch {
      /* ignore */
    }
  };

  const startProcessing = (opts, suffix) => {
    if (!current || job) return;
    const src = current;
    video?.pause();
    // processVideo must start synchronously inside the tap (iOS audio rules).
    let progressEl = null;
    try {
      job = processVideo(src.blob, {
        ...opts,
        durationHint: src.duration,
        onProgress: (p) => {
          if (progressEl) {
            progressEl.querySelector('.pbar i').style.transform = `scaleX(${p})`;
            progressEl.querySelector('[data-p]').textContent = t('processing', { p: Math.round(p * 100) });
          }
        },
      });
    } catch (e) {
      console.error(e);
      alertDialog({ title: t('processing_failed'), message: String(e?.message || e) });
      return;
    }
    requestWake();
    progressEl = document.createElement('div');
    progressEl.className = 'proc-overlay';
    progressEl.innerHTML = `<div class="proc-card">
      <span class="spinner dark"></span>
      <b data-p>${esc(t('processing', { p: 0 }))}</b>
      <div class="pbar"><i></i></div>
      <p>${esc(t('keep_open'))}</p>
      <button class="btn ghost" type="button">${esc(t('cancel'))}</button>
    </div>`;
    progressEl.querySelector('button').onclick = () => job?.cancel();
    document.body.appendChild(progressEl);

    job.promise
      .then(async (res) => {
        project.takeSeq = (project.takeSeq || 0) + 1;
        const nt = {
          id: uid(),
          projectId: project.id,
          n: project.takeSeq,
          name: `${takeLabel(src)} · ${suffix}`,
          createdAt: Date.now(),
          duration: res.duration || src.duration,
          mimeType: res.mimeType,
          size: res.blob.size,
          width: res.width,
          height: res.height,
          facing: src.facing,
          blob: res.blob,
          thumb: res.thumb || src.thumb,
          cues: opts.cues ? [] : src.cues || [],
          issues: [],
          derivedFrom: src.id,
        };
        try {
          await db.putTake(nt);
          project.updatedAt = Date.now();
          await db.putProject(project);
        } catch (e) {
          console.error(e);
          memoryTakes.set(nt.id, nt);
        }
        if (!alive) return;
        takes.push(nt);
        setTake(nt);
        toast(t('processing_done', { name: takeLabel(nt) }));
      })
      .catch((e) => {
        if (String(e?.message) === 'cancelled') return;
        console.error(e);
        if (alive) alertDialog({ title: t('processing_failed'), message: String(e?.message || e) });
      })
      .finally(() => {
        job = null;
        progressEl.remove();
        wakeLock?.release?.().catch(() => {});
        wakeLock = null;
      });
  };

  /** A sheet whose buttons start processing directly from the tap. */
  const processSheet = ({ title, desc, buttons }) => {
    const body = document.createElement('div');
    body.className = 'proc-sheet';
    body.innerHTML = `${desc ? `<p class="sheet-desc">${esc(desc)}</p>` : ''}
      <div class="sheet-buttons">${buttons
        .map((b, i) => `<button class="btn ${i === 0 ? 'primary' : 'ghost'} block" data-i="${i}" type="button">${esc(b.label)}</button>`)
        .join('')}</div>
      <p class="sheet-foot">${esc(t('keep_open'))} <span class="badge">${esc(t('beta'))}</span></p>`;
    const sh = openSheet({ title, content: body });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const spec = buttons[+b.dataset.i];
      sh.close();
      startProcessing(spec.opts, spec.suffix);
    });
  };

  const captionsSheet = () => {
    if (!current) return;
    const cues = current.cues || [];
    const body = document.createElement('div');
    body.className = 'cap-sheet';
    if (!cues.length) {
      body.innerHTML = `<p class="sheet-desc">${esc(t('captions_none'))}</p>`;
      openSheet({ title: t('captions_title'), content: body });
      return;
    }
    body.innerHTML = `
      <label class="ctl ctl-toggle"><span class="ctl-text"><span class="ctl-label">${esc(t('captions_show'))}</span></span>
        <input type="checkbox" class="switch" data-show ${showCaptions ? 'checked' : ''}></label>
      <div class="cap-preview">${cues
        .slice(0, 60)
        .map((c) => `<div><i>${fmtClock(c.start)}</i><span>${esc(c.text)}</span></div>`)
        .join('')}</div>
      <div class="sheet-buttons">
        <button class="btn primary block" data-burn type="button">${icon('video')}${esc(t('captions_burn'))}</button>
        <button class="btn ghost block" data-srt type="button">${icon('download')}${esc(t('captions_srt'))}</button>
      </div>
      <p class="sheet-foot">${esc(t('captions_note'))}</p>`;
    const sh = openSheet({ title: t('captions_title'), content: body });
    body.querySelector('[data-show]').addEventListener('change', (e) => {
      showCaptions = e.target.checked;
      paint();
    });
    body.querySelector('[data-srt]').addEventListener('click', () => {
      const name = `${sanitizeFilename(project.title?.trim() || t('untitled'))} - ${sanitizeFilename(takeLabel(current))}.srt`;
      downloadBlob(new Blob([toSRT(cues)], { type: 'application/x-subrip' }), name);
    });
    body.querySelector('[data-burn]').addEventListener('click', () => {
      sh.close();
      showCaptions = false;
      startProcessing({ cues }, t('copy_name_captions'));
    });
  };

  const moreMenu = async () => {
    if (!current) return;
    const choice = await actionSheet({
      title: takeLabel(current),
      actions: [
        { label: t('rename_take'), icon: 'pencil', value: 'rename' },
        { label: t('rotate'), icon: 'rotate', value: 'rotate', badge: t('beta') },
        { label: t('delete'), icon: 'trash', value: 'delete', danger: true },
      ],
    });
    if (choice === 'rename') renameTake();
    else if (choice === 'delete') deleteTake();
    else if (choice === 'rotate') {
      processSheet({
        title: t('rotate'),
        desc: '',
        buttons: [
          { label: '↻ 90°', opts: { rotate: 90 }, suffix: t('copy_name_rotated') },
          { label: '↺ 90°', opts: { rotate: 270 }, suffix: t('copy_name_rotated') },
        ],
      });
    }
  };

  // ---------------------------------------------------------------- events

  const onClick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    switch (b.dataset.act) {
      case 'back':
        goBack(`#/p/${project.id}`);
        break;
      case 'list':
        listSheet();
        break;
      case 'more':
        moreMenu();
        break;
      case 'export':
        exportTake();
        break;
      case 'download':
        if (current) {
          const f = fileFor(current);
          downloadBlob(f, f.name);
        }
        break;
      case 'retake':
        go(`#/rec/${project.id}`, { replace: true });
        break;
      case 'delete':
        deleteTake();
        break;
      case 'captions':
        captionsSheet();
        break;
      case 'mirror':
        processSheet({
          title: t('mirror_title'),
          desc: t('mirror_desc'),
          buttons: [{ label: t('make_copy'), opts: { mirror: true }, suffix: t('copy_name_mirror') }],
        });
        break;
      case 'play':
        togglePlay();
        break;
      case 'rew':
        seekBy(-10);
        showControls(true);
        break;
      case 'fwd':
        seekBy(10);
        showControls(true);
        break;
    }
  };

  const onKey = (e) => {
    if (e.target.closest?.('input, textarea') || !video) return;
    if (e.key === ' ' && !e.target.closest?.('button')) {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') seekBy(-5);
    else if (e.key === 'ArrowRight') seekBy(5);
  };

  el.addEventListener('click', onClick);
  window.addEventListener('keydown', onKey);
  renderShell();

  return {
    onLanguage: () => renderShell(),
    unmount() {
      alive = false;
      job?.cancel();
      cancelAnimationFrame(raf);
      clearTimeout(hideTimer);
      window.removeEventListener('keydown', onKey);
      try {
        video?.pause();
        video?.removeAttribute('src');
        video?.load();
      } catch {
        /* ignore */
      }
      if (videoUrl) URL.revokeObjectURL(videoUrl);
      if (posterUrl) URL.revokeObjectURL(posterUrl);
    },
  };
}
