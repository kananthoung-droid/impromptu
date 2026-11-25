// Captions timed from the prompter: while recording we log how far the script
// had scrolled; a word is "spoken" when its line reached the reading line.
import { hasKhmer } from './util.js';

const SENTENCE_END = /[.!?។៕…]["'”’)\]]*\s*$/;
const SOFT_BREAK = /[,;:—–]\s*$/;

/**
 * @param {Array<[number, number]>} log  [[ms, progress], ...] in recording time
 * @param {Array<{text, after, p}>} words word list with progress positions
 * @param {number} durationSec
 * @returns {Array<{start:number, end:number, text:string}>} seconds
 */
export function buildCaptions(log, words, durationSec) {
  if (!log?.length || !words?.length) return [];
  // Running maximum of progress over time.
  const times = [];
  const maxP = [];
  let m = -1;
  for (const [ms, p] of log) {
    m = Math.max(m, p);
    times.push(ms / 1000);
    maxP.push(m);
  }
  const reach = (p) => {
    // First time the running max reached p (binary search, then interpolate).
    let lo = 0;
    let hi = maxP.length - 1;
    if (maxP[hi] < p - 1e-6) return null;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (maxP[mid] >= p) hi = mid;
      else lo = mid + 1;
    }
    if (lo === 0) return times[0];
    const p0 = maxP[lo - 1];
    const p1 = maxP[lo];
    const t0 = times[lo - 1];
    const t1 = times[lo];
    return p1 > p0 ? t0 + ((p - p0) / (p1 - p0)) * (t1 - t0) : t1;
  };

  const timed = [];
  for (const w of words) {
    const tt = reach(Math.max(0, w.p));
    if (tt === null) break;
    timed.push({ ...w, t: tt });
  }
  if (!timed.length) return [];

  // Group words into short readable cues.
  const cues = [];
  let cur = null;
  const flush = () => {
    if (cur && cur.text.trim()) cues.push(cur);
    cur = null;
  };
  for (let i = 0; i < timed.length; i++) {
    const w = timed[i];
    if (!cur) cur = { start: w.t, text: '', words: 0, chars: 0, km: false };
    const piece = w.text + (w.after || '');
    cur.text += piece.replace(/\n+/g, ' ');
    cur.words++;
    cur.chars += w.text.length;
    cur.km = cur.km || hasKhmer(w.text);
    const maxChars = cur.km ? 26 : 38;
    const next = timed[i + 1];
    const gap = next ? next.t - w.t : 0;
    const endSentence = SENTENCE_END.test(piece) || /\n/.test(w.after || '');
    if (
      !next ||
      endSentence ||
      cur.chars >= maxChars ||
      cur.words >= (cur.km ? 9 : 8) ||
      gap > 1.6 ||
      (SOFT_BREAK.test(piece) && cur.chars >= maxChars * 0.55)
    ) {
      flush();
    }
  }
  flush();

  const dur = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Infinity;
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    const next = cues[i + 1];
    let end = next ? next.start : c.start + Math.max(1.2, c.words * 0.42);
    end = Math.min(end, c.start + 6.5, dur);
    if (end - c.start < 0.6) end = Math.min(c.start + 0.6, next ? next.start : dur);
    c.end = Math.max(end, c.start + 0.2);
    c.text = c.text.replace(/\s+/g, ' ').trim();
    delete c.words;
    delete c.chars;
    delete c.km;
  }
  return cues.filter((c) => c.start < dur);
}

const ts = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  const p = (n, l = 2) => String(n).padStart(l, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(r, 3)}`;
};

export function toSRT(cues) {
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}

export function cueAt(cues, timeSec) {
  if (!cues?.length) return null;
  let lo = 0;
  let hi = cues.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const c = cues[mid];
    if (timeSec < c.start) hi = mid - 1;
    else if (timeSec >= c.end) lo = mid + 1;
    else return c;
  }
  return null;
}
