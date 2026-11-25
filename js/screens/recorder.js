// Camera + teleprompter + recording.
import { db, requestPersistentStorage, memoryTakes } from '../db.js';
import { t } from '../i18n.js';
import { settings } from '../settings.js';
import { go, goBack } from '../nav.js';
import { esc, fmtClock, clamp, isIOS, isStandalone, uid, vibrate } from '../util.js';
import { icon, openSheet, toast, alertDialog, closeAllSheets, hasOpenSheet } from '../ui.js';
import { Prompter } from '../prompter.js';
import {
  Camera,
  Recorder,
  AudioMeter,
  VoiceGate,
  mediaSupport,
  pickMimeType,
  baseMime,
  describeMediaError,
  captureFrame,
  probeVideo,
} from '../media.js';
import { buildCaptions } from '../captions.js';
import { ChunkSink } from '../chunks.js';
import { controlsHTML, bindControls } from './controls.js';

const WPM_STEP = 10;

export async function mount(el, projectId) {
  const project = await db.getProject(projectId);
  if (!project) {
    go('#/', { replace: true });
    return null;
  }
  el.classList.add('rec');
  document.documentElement.classList.add('on-camera');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const prevThemeColor = themeMeta?.getAttribute('content');
  themeMeta?.setAttribute('content', '#000000');

  el.innerHTML = `
    <video class="cam" playsinline muted autoplay></video>
    <div class="pr-host"></div>

    <div class="rec-top">
      <button class="glass-btn" data-act="back" aria-label="${esc(t('back'))}">${icon('back')}</button>
      <button class="glass-btn" data-act="edit" aria-label="${esc(t('edit_script'))}">${icon('pencil')}</button>
      <span class="flex"></span>
      <button class="glass-pill mic-pill" data-act="mic" aria-label="${esc(t('input'))}">${icon('phone')}<span class="mic-name"></span></button>
    </div>

    <div class="rec-side">
      <button class="glass-btn" data-act="expand" aria-label="${esc(t('expand'))}">${icon('expand')}</button>
      <button class="glass-btn" data-act="top" aria-label="${esc(t('restart_top'))}">${icon('top')}</button>
    </div>

    <div class="chips">
      <div class="chip voice-chip" hidden><span class="vdot"></span><span>${esc(t('voice_scroll'))}</span></div>
      <div class="chip end-chip" hidden>${esc(t('end_of_script'))}</div>
      <div class="chip paused-chip" hidden>${esc(t('scroll_paused'))}</div>
    </div>

    <div class="rec-bottom">
      <div class="rec-pillrow">
        <button class="glass-btn sm speed-btn" data-act="slower" aria-label="−">${icon('minus')}</button>
        <button class="glass-pill speed-pill" data-act="settings"><b data-wpm></b><span>${esc(t('wpm'))}</span></button>
        <div class="glass-pill timer-pill"><span class="tdot"></span><span data-time>0:00</span></div>
        <button class="glass-btn sm speed-btn" data-act="faster" aria-label="+">${icon('plus')}</button>
      </div>
      <div class="rec-bar">
        <div class="bar-slot left">
          <button class="bar-btn" data-act="settings" aria-label="${esc(t('prompter_settings'))}">${icon('sliders')}</button>
        </div>
        <div class="bar-slot mid">
          <button class="rec-btn" data-act="record" aria-label="${esc(t('record'))}"><span class="rec-inner"></span><span class="rec-spin"></span></button>
        </div>
        <div class="bar-slot right">
          <button class="bar-btn flip-btn" data-act="flip" aria-label="${esc(t('flip'))}">${icon('flip')}</button>
          <button class="bar-btn pause-btn" data-act="pause" aria-label="${esc(t('pause'))}">${icon('pause')}</button>
        </div>
      </div>
    </div>

    <div class="countdown" hidden>
      <div class="cd-ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg><span class="cd-num"></span></div>
      <div class="cd-hint">${esc(t('tap_to_cancel'))}</div>
    </div>

    <div class="rec-overlay" hidden></div>`;

  const video = el.querySelector('.cam');
  const host = el.querySelector('.pr-host');
  const micName = el.querySelector('.mic-name');
  const wpmEl = el.querySelector('[data-wpm]');
  const timeEl = el.querySelector('[data-time]');
  const overlay = el.querySelector('.rec-overlay');
  const voiceChip = el.querySelector('.voice-chip');
  const endChip = el.querySelector('.end-chip');
  const pausedChip = el.querySelector('.paused-chip');
  const cdEl = el.querySelector('.countdown');
  const cdNum = el.querySelector('.cd-num');
  const pauseBtn = el.querySelector('.pause-btn');
  const expandBtn = el.querySelector('[data-act="expand"]');

  let alive = true;
  let state = 'starting';
  const cam = new Camera(video);
  let meter = null;
  let gate = null;
  let recorder = null;
  let sink = null;
  let thumbPromise = null;
  let recStartWall = 0;
  let elapsedBefore = 0; // seconds accumulated before the current running segment
  let segStart = 0;
  let wakeLock = null;
  let countdownCancel = null;
  let micSheet = null;
  let stopping = null;

  // ---------------------------------------------------------------- prompter

  const prompter = new Prompter(host, {
    onTap: () => {
      if (state === 'recording' || state === 'ready') {
        prompter.toggle();
        updateChips();
      }
    },
    onEnd: () => updateChips(),
    onUserScroll: () => updateChips(),
  });
  prompter.applySettings(settings.get());
  prompter.setText(project.script || '', t('empty_script_hint'));

  const applyMirror = () => {
    const s = settings.get();
    video.classList.toggle('mirrored', cam.facing === 'user' && s.mirrorPreview);
  };

  const updateSpeedUI = () => {
    wpmEl.textContent = settings.get().wpm;
  };

  const updateExpandUI = () => {
    const ex = settings.get().expanded;
    expandBtn.innerHTML = ex ? icon('shrink') : icon('expand');
    expandBtn.setAttribute('aria-label', ex ? t('collapse') : t('expand'));
  };

  const updateChips = () => {
    const s = settings.get();
    voiceChip.hidden = s.scrollMode !== 'voice' || state === 'starting' || state === 'error';
    endChip.hidden = !(prompter.ended && prompter.maxScroll > 0);
    pausedChip.hidden = !(state === 'recording' && !prompter.playing && !prompter.ended && prompter.maxScroll > 0);
  };

  const unsubSettings = settings.subscribe((s, changed) => {
    prompter.applySettings(s);
    if ('wpm' in changed) prompter.setSpeed(s.wpm);
    if ('mirrorPreview' in changed) applyMirror();
    if ('scrollMode' in changed) {
      if (s.scrollMode === 'voice') ensureMeter();
      else prompter.setVoiceFactor(1);
    }
    if ('resolution' in changed && state === 'ready') startCamera();
    if ('expanded' in changed) updateExpandUI();
    updateSpeedUI();
    updateChips();
  });

  // ---------------------------------------------------------------- state

  const setState = (s) => {
    state = s;
    el.dataset.state = s;
    pauseBtn.innerHTML = s === 'paused' ? icon('play') : icon('pause');
    pauseBtn.setAttribute('aria-label', s === 'paused' ? t('resume') : t('pause'));
    updateChips();
  };

  const showOverlay = (html) => {
    overlay.innerHTML = html;
    overlay.hidden = !html;
  };

  const showError = (kind, err) => {
    if (err) console.warn('camera error', err);
    setState('error');
    let msg = t('cam_error');
    let title = t('cam_error');
    if (kind === 'denied') {
      title = t('perm_title');
      msg = isIOS() ? t('perm_denied_ios') : t('perm_denied_generic');
    } else if (kind === 'notfound') msg = t('cam_notfound');
    else if (kind === 'busy') msg = t('cam_busy');
    else if (kind === 'insecure') msg = t('cam_insecure');
    else if (kind === 'unsupported') msg = t('cam_unsupported');
    else if (err?.message) msg = `${t('cam_error')} (${err.name || ''} ${err.message})`;
    showOverlay(`<div class="ov-card">
      <div class="ov-ico">${icon('video')}</div>
      <h2>${esc(title)}</h2>
      <p>${esc(msg)}</p>
      <div class="ov-actions">
        <button class="btn ghost light" data-act="back">${esc(t('back'))}</button>
        <button class="btn primary light" data-act="retry">${esc(t('retry'))}</button>
      </div>
    </div>`);
  };

  // ---------------------------------------------------------------- camera

  const disposeMeter = () => {
    meter?.dispose();
    meter = null;
    gate = null;
  };

  const ensureMeter = () => {
    if (meter || !cam.stream || cam.noAudio) return meter;
    try {
      meter = new AudioMeter(cam.stream);
      gate = new VoiceGate(meter);
    } catch (e) {
      console.warn('audio meter unavailable', e);
      meter = null;
    }
    return meter;
  };

  const resumeAudio = () => meter?.resume();

  const updateMicName = () => {
    const label = cam.noAudio ? '—' : cam.micLabel || t('same_as_system');
    micName.textContent = label.replace(/\s*\(.*?\)\s*$/, '') || t('same_as_system');
  };

  let starting = null;
  const startCamera = () => {
    if (starting) return starting;
    starting = (async () => {
      setState('starting');
      showOverlay(`<div class="ov-loading"><span class="spinner"></span><p>${esc(t('camera_starting'))}</p></div>`);
      const sup = mediaSupport();
      if (!sup.secure) return showError('insecure');
      if (!sup.getUserMedia || !sup.recorder) return showError('unsupported');
      disposeMeter();
      try {
        const s = settings.get();
        await cam.start({ facing: s.facing, resolution: s.resolution, micId: s.micId, micMode: s.micMode });
        if (!alive) {
          cam.stop();
          return;
        }
        applyMirror();
        updateMicName();
        if (settings.get().scrollMode === 'voice' || micSheet) ensureMeter();
        showOverlay('');
        setState('ready');
        requestWakeLock();
      } catch (e) {
        if (alive) showError(describeMediaError(e), e);
      }
    })().finally(() => {
      starting = null;
    });
    return starting;
  };

  cam.onEnded = () => {
    if (!alive) return;
    if (state === 'recording' || state === 'paused') {
      stopAndSave({ interrupted: true });
    } else if (state === 'ready') {
      startCamera();
    }
  };

  // ---------------------------------------------------------------- wake lock

  const requestWakeLock = async () => {
    try {
      if (!wakeLock && 'wakeLock' in navigator && document.visibilityState === 'visible') {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener?.('release', () => (wakeLock = null));
      }
    } catch {
      /* not allowed right now */
    }
  };
  const releaseWakeLock = () => {
    wakeLock?.release?.().catch(() => {});
    wakeLock = null;
  };

  // ---------------------------------------------------------------- timer

  const elapsed = () => elapsedBefore + (state === 'recording' && segStart ? (performance.now() - segStart) / 1000 : 0);

  // ---------------------------------------------------------------- recording

  const runCountdown = (n) =>
    new Promise((resolve) => {
      setState('countdown');
      let left = n;
      const ring = el.querySelector('.cd-ring');
      const show = () => {
        cdNum.textContent = left;
        ring.classList.remove('tick');
        void ring.offsetWidth;
        ring.classList.add('tick');
      };
      cdEl.hidden = false;
      show();
      const iv = setInterval(() => {
        left--;
        if (left <= 0) finish(true);
        else {
          show();
          vibrate(8);
        }
      }, 1000);
      const finish = (ok) => {
        clearInterval(iv);
        cdEl.hidden = true;
        countdownCancel = null;
        if (!ok && alive) setState('ready');
        resolve(ok && alive);
      };
      countdownCancel = () => finish(false);
    });

  const startRecording = async () => {
    if (state !== 'ready') return;
    resumeAudio();
    requestWakeLock();
    closeAllSheets();
    prompter.pause(); // stop any rehearsal scrolling during the countdown
    const s = settings.get();
    if (s.countdown > 0) {
      const ok = await runCountdown(s.countdown);
      if (!ok) return;
    }
    if (!cam.active) {
      await startCamera();
      if (state !== 'ready') return;
    }
    if (prompter.ended || prompter.progress >= 0.999) prompter.reset();

    thumbPromise = captureFrame(video);
    const mimeType = pickMimeType();
    recorder = new Recorder(cam.stream, {
      mimeType,
      videoBitsPerSecond: s.resolution === '720' ? 3_500_000 : 6_000_000,
    });
    recorder.onerror = (err) => {
      console.error('recorder error', err);
      if (state === 'recording' || state === 'paused') stopAndSave({ error: true });
    };
    // Every second the new piece of video goes straight to storage (crash-safe, low memory).
    const rid = uid();
    sink = new ChunkSink(rid, {
      projectId: project.id,
      mimeType,
      width: cam.size.width,
      height: cam.size.height,
      facing: cam.facing,
    });
    const mySink = sink;
    recorder.ondata = (seq, blob) => mySink.add(seq, blob, elapsed());
    thumbPromise.then((th) => th && db.patchRec(rid, { thumb: th }).catch(() => {}));
    let startedPromise;
    try {
      startedPromise = recorder.start();
    } catch (e) {
      console.error(e);
      recorder = null;
      sink?.discard();
      sink = null;
      setState('ready');
      alertDialog({ title: t('rec_failed'), message: String(e?.message || e), theme: 'glass' });
      return;
    }
    db.patchRec(rid, { mimeType: recorder.mimeType }).catch(() => {});
    recStartWall = Date.now();
    elapsedBefore = 0;
    segStart = performance.now();
    setState('recording');
    vibrate(15);
    prompter.startLog();
    prompter.sample(0);
    prompter.setVoiceFactor(s.scrollMode === 'voice' ? 0 : 1);
    prompter.play();
    pauseBtn.hidden = !recorder.canPause;

    const ok = await startedPromise;
    if (!ok && recorder && recorder.state === 'inactive' && state === 'recording') {
      // The recorder never started (seen in iPhone Home Screen apps after relaunch).
      prompter.pause();
      prompter.stopLog();
      recorder = null;
      sink?.discard();
      sink = null;
      setState('ready');
      alertDialog({
        title: t('rec_failed'),
        message: isIOS() && isStandalone() ? t('rec_empty_ios') : t('rec_not_started'),
        theme: 'glass',
      });
    }
  };

  const pauseRecording = () => {
    if (state !== 'recording' || !recorder) return;
    try {
      recorder.pause();
    } catch (e) {
      console.warn(e);
      return;
    }
    elapsedBefore = elapsed();
    segStart = 0;
    prompter.pause();
    setState('paused');
  };

  const resumeRecording = () => {
    if (state !== 'paused' || !recorder) return;
    try {
      recorder.resume();
    } catch (e) {
      console.warn(e);
      return;
    }
    segStart = performance.now();
    setState('recording');
    prompter.play();
  };

  /** Stop the recording and store it. Resolves with the saved take (or null). */
  const stopAndSave = ({ interrupted = false, error = false, navigate = true } = {}) => {
    if (stopping) return stopping;
    if (!(state === 'recording' || state === 'paused') || !recorder) return Promise.resolve(null);
    stopping = (async () => {
      const duration = elapsed();
      setState('saving');
      showOverlay(`<div class="ov-loading"><span class="spinner"></span><p>${esc(t('saving_take'))}</p></div>`);
      prompter.pause();
      const log = prompter.stopLog();
      const rec = recorder;
      const recSink = sink;
      recorder = null;
      sink = null;
      const memBlob = await rec.stop();
      const mimeType = rec.mimeType;
      const camSize = cam.size;
      const blob = recSink ? await recSink.assemble(baseMime(mimeType)) : memBlob;

      if (!blob.size) {
        recSink?.discard();
        showOverlay('');
        if (alive) {
          setState(cam.active ? 'ready' : 'starting');
          if (!cam.active) startCamera();
          alertDialog({
            title: t('rec_failed'),
            message: isIOS() && isStandalone() ? t('rec_empty_ios') : t('rec_not_started'),
            theme: 'glass',
          });
        }
        return null;
      }

      const thumb = await Promise.race([thumbPromise, new Promise((r) => setTimeout(() => r(null), 1500))]);
      let cues = [];
      try {
        cues = buildCaptions(log, prompter.wordPositions(), duration);
      } catch (e) {
        console.warn('captions failed', e);
      }
      project.takeSeq = (project.takeSeq || 0) + 1;
      const take = {
        // Same id as the crash-recovery record, so a saved take is never recovered twice.
        id: recSink?.rid || uid(),
        projectId: project.id,
        n: project.takeSeq,
        name: '',
        createdAt: recStartWall || Date.now(),
        duration,
        mimeType,
        size: blob.size,
        width: camSize.width,
        height: camSize.height,
        facing: cam.facing,
        blob,
        thumb,
        cues,
        issues: [],
      };

      // Quick sanity check of the file (catches known iOS recording bugs).
      const meta = await probeVideo(blob, 2500);
      if (meta) {
        if (Number.isFinite(meta.duration) && meta.duration > 0) {
          if (duration > 8 && meta.duration < duration * 0.7) take.issues.push('short');
          take.duration = meta.duration;
        }
        if (meta.width && meta.height) {
          if (camSize.width && camSize.height && camSize.height > camSize.width !== meta.height > meta.width) {
            take.issues.push('rotated');
          }
          take.width = meta.width;
          take.height = meta.height;
        }
      }

      let saved = true;
      try {
        await db.putTake(take);
        project.updatedAt = Date.now();
        await db.putProject(project);
        // The finished take is stored — the crash-recovery pieces are no longer needed.
        recSink?.discard();
        requestPersistentStorage();
      } catch (e) {
        // Keep the pieces on disk (they are recovered on next launch) and the take in memory.
        console.error('save failed', e);
        saved = false;
        memoryTakes.set(take.id, take);
      }
      releaseWakeLock();
      if (!saved) toast(t('storage_full'), { duration: 8000, tone: 'warn' });
      else if (interrupted) toast(t('rec_interrupted'), { duration: 6000 });
      else if (error) toast(t('rec_failed'), { duration: 6000, tone: 'warn' });
      if (navigate && alive) go(`#/takes/${project.id}/${take.id}`, { replace: true });
      return take;
    })().finally(() => {
      stopping = null;
    });
    return stopping;
  };

  // ---------------------------------------------------------------- sheets

  const openSettingsSheet = () => {
    if (state !== 'ready' && state !== 'error' && state !== 'starting') return;
    const body = document.createElement('div');
    body.className = 'ctl-wrap';
    body.innerHTML = controlsHTML();
    const unbind = bindControls(body);
    openSheet({ title: t('prompter_settings'), content: body, theme: 'glass', className: 'settings-sheet', onClose: unbind });
  };

  const openEditSheet = () => {
    if (state !== 'ready' && state !== 'error') return;
    const body = document.createElement('div');
    body.className = 'quick-edit';
    body.innerHTML = `<textarea class="script-input glass-ta" spellcheck="true" placeholder="${esc(t('script_ph'))}"></textarea>`;
    const ta = body.querySelector('textarea');
    ta.value = project.script || '';
    openSheet({
      title: t('edit_script'),
      content: body,
      theme: 'glass',
      className: 'edit-sheet',
      onClose: async () => {
        if (ta.value !== project.script) {
          project.script = ta.value;
          project.updatedAt = Date.now();
          prompter.setText(project.script, t('empty_script_hint'));
          try {
            await db.putProject(project);
          } catch (e) {
            console.error(e);
          }
        }
      },
    });
  };

  const openMicSheet = async () => {
    if (state !== 'ready') return;
    ensureMeter();
    resumeAudio();
    const mics = await Camera.listMics();
    const s = settings.get();
    const body = document.createElement('div');
    body.className = 'mic-sheet';
    const row = (id, label, sub, sel) =>
      `<button class="mic-row ${sel ? 'on' : ''}" data-mic="${esc(id)}" type="button">
        <span class="mic-ico">${icon('mic')}</span>
        <span class="mic-txt"><span>${esc(label)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</span>
        <span class="mic-check">${sel ? icon('check') : ''}</span>
      </button>`;
    const current = cam.micLabel;
    body.innerHTML = `
      <div class="mic-head"><span class="mic-bubble">${icon('mic')}</span><b>${esc(t('input'))}</b></div>
      <div class="meter" aria-hidden="true">${'<i></i>'.repeat(20)}</div>
      <div class="mic-list">
        ${row('', t('same_as_system'), !s.micId ? current : '', !s.micId)}
        ${mics.map((m) => row(m.deviceId, m.label, '', s.micId === m.deviceId)).join('')}
      </div>
      <div class="mic-mode-label">${esc(t('mic_mode'))}</div>
      <div class="mic-modes">
        ${['voice', 'raw']
          .map(
            (m) => `<button class="mic-row ${s.micMode === m ? 'on' : ''}" data-mode="${m}" type="button">
              <span class="mic-ico">${icon(m === 'voice' ? 'mic' : 'sparkle')}</span>
              <span class="mic-txt"><span>${esc(t(m === 'voice' ? 'mic_voice' : 'mic_raw'))}</span><small>${esc(
                t(m === 'voice' ? 'mic_voice_sub' : 'mic_raw_sub')
              )}</small></span>
              <span class="mic-check">${s.micMode === m ? icon('check') : ''}</span>
            </button>`
          )
          .join('')}
      </div>`;
    const bars = Array.from(body.querySelectorAll('.meter i'));
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const lv = meter ? meter.level() : 0;
      const n = Math.round(lv * bars.length);
      bars.forEach((b, i) => b.classList.toggle('on', i < n));
    };
    raf = requestAnimationFrame(draw);
    body.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-mic]');
      const mode = e.target.closest('[data-mode]');
      if (m) {
        settings.set({ micId: m.dataset.mic });
        micSheet?.close();
        await startCamera();
      } else if (mode) {
        settings.set({ micMode: mode.dataset.mode });
        micSheet?.close();
        await startCamera();
      }
    });
    micSheet = openSheet({
      content: body,
      theme: 'glass',
      className: 'mic-sheet-wrap',
      swipe: false,
      onClose: () => {
        cancelAnimationFrame(raf);
        micSheet = null;
        if (settings.get().scrollMode !== 'voice' && state === 'ready') disposeMeter();
      },
    });
  };

  // ---------------------------------------------------------------- input

  const changeSpeed = (delta) => {
    const s = settings.get();
    settings.set({ wpm: clamp(Math.round((s.wpm + delta) / 5) * 5, 60, 320) });
  };

  const onRecordButton = () => {
    if (state === 'countdown') countdownCancel?.();
    else if (state === 'ready') startRecording();
    else if (state === 'recording' || state === 'paused') {
      // Ignore an accidental double-tap right after starting.
      if (recorder && performance.now() - recorder.startedAt < 800) return;
      stopAndSave();
    }
  };

  const onClick = async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    switch (act) {
      case 'back':
        if (state === 'recording' || state === 'paused') return;
        goBack(`#/p/${project.id}`);
        break;
      case 'retry':
        startCamera();
        break;
      case 'record':
        onRecordButton();
        break;
      case 'pause':
        if (state === 'recording') pauseRecording();
        else if (state === 'paused') resumeRecording();
        break;
      case 'flip':
        if (state !== 'ready') return;
        settings.set({ facing: settings.get().facing === 'user' ? 'environment' : 'user' });
        startCamera();
        break;
      case 'settings':
        openSettingsSheet();
        break;
      case 'edit':
        openEditSheet();
        break;
      case 'mic':
        openMicSheet();
        break;
      case 'expand':
        settings.set({ expanded: !settings.get().expanded });
        break;
      case 'top':
        prompter.reset();
        updateChips();
        break;
      case 'slower':
        changeSpeed(-WPM_STEP);
        break;
      case 'faster':
        changeSpeed(WPM_STEP);
        break;
    }
  };

  const onKey = (e) => {
    if (hasOpenSheet() || e.target.closest?.('input, textarea, select')) return;
    const k = e.key;
    const line = prompter.lineH || 40;
    if (k === ' ' || k === 'Enter') {
      if (e.target.closest?.('button')) return; // let keyboard users press buttons
      e.preventDefault();
      if (state === 'ready' || state === 'recording') {
        prompter.toggle();
        updateChips();
      }
    } else if (k === 'ArrowDown' || k === 'PageDown') {
      e.preventDefault();
      prompter.nudge(k === 'PageDown' ? line * 4 : line);
    } else if (k === 'ArrowUp' || k === 'PageUp') {
      e.preventDefault();
      prompter.nudge(k === 'PageUp' ? -line * 4 : -line);
    } else if (k === 'ArrowRight' || k === '+' || k === '=') {
      changeSpeed(WPM_STEP);
    } else if (k === 'ArrowLeft' || k === '-') {
      changeSpeed(-WPM_STEP);
    } else if (k === 'r' || k === 'R') {
      onRecordButton();
    } else if (k === 'p' || k === 'P') {
      if (state === 'recording') pauseRecording();
      else if (state === 'paused') resumeRecording();
    } else if (k === 'Escape') {
      if (state === 'countdown') countdownCancel?.();
      else if (state === 'ready' || state === 'error') goBack(`#/p/${project.id}`);
    }
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      if (state === 'countdown') countdownCancel?.();
      if (state === 'recording' || state === 'paused') stopAndSave({ interrupted: true });
    } else if (alive) {
      requestWakeLock();
      if (state === 'ready' && !cam.active) startCamera();
    }
  };

  el.addEventListener('click', onClick);
  el.addEventListener('pointerdown', resumeAudio, true);
  window.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);

  // ---------------------------------------------------------------- loop

  let raf = 0;
  let lastT = 0;
  let lastSecShown = -1;
  let lastSample = 0;
  let lastChips = 0;
  const loop = (tms) => {
    raf = requestAnimationFrame(loop);
    const dt = lastT ? Math.min(0.5, (tms - lastT) / 1000) : 0;
    lastT = tms;
    const s = settings.get();
    if (s.scrollMode === 'voice' && gate && meter?.running) {
      const f = gate.update(dt, s.voiceSens);
      prompter.setVoiceFactor(f);
      voiceChip.classList.toggle('live', gate.active);
    } else if (s.scrollMode === 'voice') {
      // No microphone level available (yet): fall back to steady scrolling.
      prompter.setVoiceFactor(1);
      voiceChip.classList.remove('live');
    }
    if (state === 'recording' || state === 'paused') {
      const e = elapsed();
      const sec = Math.floor(e);
      if (sec !== lastSecShown) {
        lastSecShown = sec;
        timeEl.textContent = fmtClock(sec);
      }
      if (state === 'recording' && tms - lastSample > 100) {
        lastSample = tms;
        prompter.sample(e * 1000);
      }
    } else if (lastSecShown !== -1) {
      lastSecShown = -1;
      timeEl.textContent = '0:00';
    }
    if (tms - lastChips > 250) {
      lastChips = tms;
      updateChips();
    }
  };
  raf = requestAnimationFrame(loop);

  // ---------------------------------------------------------------- start

  updateSpeedUI();
  updateExpandUI();
  setState('starting');
  startCamera();

  return {
    onLanguage: () => {},
    async unmount() {
      alive = false;
      countdownCancel?.();
      if (state === 'recording' || state === 'paused') {
        const take = await stopAndSave({ navigate: false });
        if (take) toast(t('rec_saved_bg'));
      } else if (stopping) {
        await stopping;
      }
      cancelAnimationFrame(raf);
      el.removeEventListener('click', onClick);
      el.removeEventListener('pointerdown', resumeAudio, true);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      unsubSettings();
      releaseWakeLock();
      prompter.destroy();
      disposeMeter();
      cam.stop();
      document.documentElement.classList.remove('on-camera');
      if (themeMeta && prevThemeColor) themeMeta.setAttribute('content', prevThemeColor);
    },
  };
}
