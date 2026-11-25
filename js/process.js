// Re-encode a take on the device: mirror, rotate and/or burn in captions.
// The video is played once in real time into a canvas and recorded again,
// so it takes as long as the video itself. The original take is never changed.
import { pickMimeType, baseMime } from './media.js';
import { cueAt } from './captions.js';
import { segmentText, sleep } from './util.js';

const CAPTION_FONT = `'Figtree', 'Kantumruy Pro', 'Khmer Sangam MN', 'Khmer MN', -apple-system, system-ui, sans-serif`;

function waitEvent(el, type, ms) {
  return new Promise((resolve, reject) => {
    const tmr = setTimeout(() => {
      el.removeEventListener(type, on);
      reject(new Error('timeout: ' + type));
    }, ms);
    const on = () => {
      clearTimeout(tmr);
      el.removeEventListener(type, on);
      resolve();
    };
    el.addEventListener(type, on);
  });
}

function wrapLines(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const seg of segmentText(text)) {
    const tryLine = line + seg.t;
    if (ctx.measureText(tryLine.trim()).width <= maxW || !line.trim()) {
      line = tryLine;
    } else {
      lines.push(line.trim());
      line = seg.t.trimStart();
    }
  }
  if (line.trim()) lines.push(line.trim());
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCaption(ctx, w, h, cue) {
  if (!cue) return;
  const portrait = h > w;
  const fs = Math.round(Math.min(w, h) * (portrait ? 0.058 : 0.05));
  ctx.font = `700 ${fs}px ${CAPTION_FONT}`;
  const lines = wrapLines(ctx, cue.text, w * 0.82).slice(0, 3);
  if (!lines.length) return;
  const lh = fs * 1.38;
  const padX = fs * 0.6;
  const padY = fs * 0.42;
  const boxW = Math.max(...lines.map((l) => ctx.measureText(l).width)) + padX * 2;
  const boxH = lines.length * lh + padY * 2;
  const x = (w - boxW) / 2;
  const y = h * (portrait ? 0.79 : 0.9) - boxH;
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  roundRect(ctx, x, y, boxW, boxH, fs * 0.45);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  lines.forEach((l, i) => ctx.fillText(l, w / 2, y + padY + lh * (i + 0.5)));
}

/**
 * Start processing. MUST be called synchronously inside a tap/click handler
 * (iOS only allows audio playback that starts from a user gesture).
 */
export function processVideo(blob, { mirror = false, rotate = 0, cues = null, durationHint = 0, onProgress } = {}) {
  const AC = window.AudioContext || window.webkitAudioContext;
  const ac = new AC();
  ac.resume?.().catch(() => {});

  const holder = document.createElement('div');
  holder.className = 'proc-holder';
  const video = document.createElement('video');
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  holder.appendChild(video);
  document.body.appendChild(holder);
  const url = URL.createObjectURL(blob);
  video.src = url;
  // Unlock playback while we are still inside the user gesture.
  const p = video.play();
  if (p?.catch) p.catch(() => {});
  video.pause();

  let cancelled = false;
  let rec = null;
  let loopStop = true;

  const cleanup = () => {
    loopStop = true;
    try {
      video.pause();
      video.removeAttribute('src');
      video.load();
    } catch {
      /* ignore */
    }
    URL.revokeObjectURL(url);
    holder.remove();
    ac.close?.().catch(() => {});
  };

  const run = async () => {
    if (video.readyState < 1) await waitEvent(video, 'loadedmetadata', 15000);
    await document.fonts?.load?.(`700 40px ${CAPTION_FONT}`, 'Aa ក').catch?.(() => {});
    let dur = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : durationHint;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) throw new Error('no video frames');
    const rot = (((rotate || 0) % 360) + 360) % 360;
    const swap = rot === 90 || rot === 270;
    let cw = swap ? vh : vw;
    let ch = swap ? vw : vh;
    const k = Math.min(1, 1920 / Math.max(cw, ch));
    cw = Math.round((cw * k) / 2) * 2;
    ch = Math.round((ch * k) / 2) * 2;

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    holder.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const draw = () => {
      ctx.save();
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
      ctx.translate(cw / 2, ch / 2);
      ctx.rotate((rot * Math.PI) / 180);
      if (mirror) ctx.scale(-1, 1);
      const dw = swap ? ch : cw;
      const dh = swap ? cw : ch;
      ctx.drawImage(video, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      if (cues?.length) drawCaption(ctx, cw, ch, cueAt(cues, video.currentTime));
    };

    if (video.currentTime !== 0) {
      video.currentTime = 0;
      await waitEvent(video, 'seeked', 5000).catch(() => {});
    }
    if (video.readyState < 2) await waitEvent(video, 'loadeddata', 8000).catch(() => {});
    draw();

    const vTrack = canvas.captureStream(30).getVideoTracks()[0];
    let aTracks = [];
    try {
      const src = ac.createMediaElementSource(video);
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      aTracks = dest.stream.getAudioTracks();
    } catch (e) {
      console.warn('audio routing failed', e);
    }
    const stream = new MediaStream([vTrack, ...aTracks]);
    const mimeType = pickMimeType();
    const opts = { videoBitsPerSecond: cw * ch >= 1900 * 1000 ? 8_000_000 : 5_000_000, audioBitsPerSecond: 128000 };
    if (mimeType) opts.mimeType = mimeType;
    try {
      rec = new MediaRecorder(stream, opts);
    } catch {
      rec = new MediaRecorder(stream);
    }
    const chunks = [];
    rec.ondataavailable = (e) => e.data?.size && chunks.push(e.data);
    const stopped = new Promise((r) => rec.addEventListener('stop', r, { once: true }));
    rec.start(1000);

    if (cancelled) throw new Error('cancelled');
    await video.play();

    loopStop = false;
    const step = () => {
      if (loopStop) return;
      draw();
      if (dur) onProgress?.(Math.min(0.999, video.currentTime / dur));
      if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    };
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(step);
    else requestAnimationFrame(step);
    // Captions can change between frames of a still video — refresh them too.
    const capTimer = cues?.length ? setInterval(draw, 200) : 0;
    // Small poster image for the takes list.
    let thumb = null;
    setTimeout(() => {
      try {
        const s = Math.min(1, 480 / Math.max(cw, ch));
        const tc = document.createElement('canvas');
        tc.width = Math.round(cw * s);
        tc.height = Math.round(ch * s);
        tc.getContext('2d').drawImage(canvas, 0, 0, tc.width, tc.height);
        tc.toBlob((b) => (thumb = b), 'image/jpeg', 0.74);
      } catch {
        /* ignore */
      }
    }, 450);

    await new Promise((resolve, reject) => {
      video.addEventListener('ended', resolve, { once: true });
      video.addEventListener('error', () => reject(new Error('playback error')), { once: true });
      const chk = setInterval(() => {
        if (cancelled) {
          clearInterval(chk);
          reject(new Error('cancelled'));
        }
        if (video.paused && !video.ended && !cancelled) video.play().catch(() => {});
      }, 400);
      video.addEventListener('ended', () => clearInterval(chk), { once: true });
    });
    clearInterval(capTimer);
    loopStop = true;
    draw();
    await sleep(120);
    rec.stop();
    await stopped;
    vTrack.stop();
    if (!dur) dur = video.currentTime;
    const out = new Blob(chunks, { type: baseMime(rec.mimeType || mimeType) });
    if (!out.size) throw new Error('empty output');
    onProgress?.(1);
    return { blob: out, mimeType: rec.mimeType || mimeType, width: cw, height: ch, duration: dur, thumb };
  };

  const promise = run().finally(cleanup);
  return {
    promise,
    cancel() {
      cancelled = true;
      try {
        if (rec && rec.state !== 'inactive') rec.stop();
      } catch {
        /* ignore */
      }
      try {
        video.pause();
      } catch {
        /* ignore */
      }
    },
  };
}
