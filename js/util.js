// Small shared helpers. No dependencies.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => performance.now();

export function debounce(fn, ms) {
  let timer = null;
  let lastArgs = [];
  const d = (...args) => {
    lastArgs = args;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...lastArgs);
    }, ms);
  };
  d.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      fn(...lastArgs);
    }
  };
  d.cancel = () => {
    clearTimeout(timer);
    timer = null;
  };
  return d;
}

/** 0:05, 2:12, 1:02:03 */
export function fmtClock(sec) {
  sec = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

/** 00:11 style (used for take length) */
export function fmtClock2(sec) {
  const c = fmtClock(sec);
  return c.length === 4 ? '0' + c : c;
}

export function fmtBytes(n) {
  if (!Number.isFinite(n) || n <= 0) return '0 MB';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtDate(ts, lang) {
  try {
    return new Intl.DateTimeFormat(lang === 'km' ? 'km-KH' : undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

// ---------------------------------------------------------------- platform

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: fullscreen)').matches ||
  navigator.standalone === true;
export const isTouch = () => navigator.maxTouchPoints > 0 || 'ontouchstart' in window;

export function sanitizeFilename(s) {
  return (
    String(s || '')
      .replace(/[​-‍﻿]/g, '')
      .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'video'
  );
}

export function extForMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('mp4')) return 'mp4';
  if (m.includes('webm')) return 'webm';
  if (m.includes('quicktime')) return 'mov';
  return 'mp4';
}

// ---------------------------------------------------------------- text / words

const KHMER_RE = /[ក-៿᧠-᧿]/;
// One written Khmer cluster: base letter + subscripts (coeng) + vowel signs / diacritics.
const KHMER_CLUSTER_RE = /[ក-ឳ](?:្[ក-ឳ]|[឴-៑៓៝‌‍])*/g;

export const hasKhmer = (s) => KHMER_RE.test(s);

let _segmenter;
let _khmerDict = false;
function wordSegmenter() {
  if (_segmenter !== undefined) return _segmenter;
  try {
    _segmenter = new Intl.Segmenter('km', { granularity: 'word' });
    // Does this engine ship a Khmer dictionary (splits Khmer words without spaces)?
    // Without a dictionary the whole run comes back as one segment.
    const parts = Array.from(_segmenter.segment('សូមស្វាគមន៍មកកាន់')).filter((p) => p.isWordLike);
    _khmerDict = parts.length >= 2;
  } catch {
    _segmenter = null;
  }
  return _segmenter;
}

const LETTER_RE = /[\p{L}\p{N}]/u;
const isWordSeg = (s) => !!s.isWordLike || LETTER_RE.test(s.segment);

function khmerWordEstimate(s) {
  const clusters = (s.match(KHMER_CLUSTER_RE) || []).length;
  return Math.max(1, Math.round(clusters / 2.3));
}

/**
 * Split text into [{t, w}] where w=true marks a word. Works for English, Khmer
 * and mixed text. Khmer has no spaces, so we rely on the engine's dictionary.
 */
export function segmentText(text) {
  const seg = wordSegmenter();
  const out = [];
  if (seg) {
    for (const s of seg.segment(text)) out.push({ t: s.segment, w: isWordSeg(s) });
    return out;
  }
  // Fallback: split on whitespace.
  const re = /(\s+)/;
  for (const part of text.split(re)) {
    if (!part) continue;
    out.push({ t: part, w: !re.test(part) });
  }
  return out;
}

/** Approximate spoken word count (Khmer estimated from clusters if no dictionary). */
export function countWords(text) {
  if (!text || !text.trim()) return 0;
  const seg = wordSegmenter();
  let n = 0;
  if (seg) {
    for (const s of seg.segment(text)) {
      if (!isWordSeg(s)) continue;
      if (!_khmerDict && hasKhmer(s.segment)) n += khmerWordEstimate(s.segment);
      else n += 1;
    }
    return n;
  }
  for (const part of text.split(/\s+/)) {
    if (!part) continue;
    n += hasKhmer(part) ? khmerWordEstimate(part) : 1;
  }
  return n;
}

export const estimateSeconds = (text, wpm) => {
  const words = countWords(text);
  return words ? (words / Math.max(20, wpm)) * 60 : 0;
};

// ---------------------------------------------------------------- events

export function once(target, type, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const handler = (e) => {
      clearTimeout(timer);
      target.removeEventListener(type, handler);
      resolve(e);
    };
    target.addEventListener(type, handler);
    if (timeoutMs) {
      timer = setTimeout(() => {
        target.removeEventListener(type, handler);
        reject(new Error(`timeout waiting for ${type}`));
      }, timeoutMs);
    }
  });
}

/** Resolve after the next painted video frame (or timeout). */
export function nextVideoFrame(video, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    setTimeout(finish, timeoutMs);
    if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => finish());
    else if (video.readyState >= 2) requestAnimationFrame(() => requestAnimationFrame(finish));
    else video.addEventListener('loadeddata', () => requestAnimationFrame(finish), { once: true });
  });
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function vibrate(ms = 10) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}
