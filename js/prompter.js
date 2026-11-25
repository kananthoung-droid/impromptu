// The teleprompter: renders the script over the camera and scrolls it.
//
// Layout: the script is laid out inside .pr-content, which is moved with a
// GPU transform. The "reading line" sits at markerY (near the camera lens);
// scroll = 0 puts the first line on it, scroll = maxScroll puts the last line on it.
// Speed is expressed in words per minute: pxPerSecond = wpm/60 * maxScroll/words.

import { esc, clamp, segmentText, countWords, hasKhmer } from './util.js';

const SERIF = `'Playfair Display', 'Noto Serif Khmer', 'Khmer Sangam MN', 'Khmer MN', Georgia, 'Times New Roman', serif`;
const SANS = `'Figtree', 'Kantumruy Pro', 'Khmer Sangam MN', 'Khmer MN', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif`;

function buildHTML(text) {
  const paras = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let blank = 0;
  for (const para of paras) {
    if (!para.trim()) {
      blank++;
      continue;
    }
    html += `<p${blank && html ? ' class="gap"' : ''}>`;
    blank = 0;
    let prevKhmerWord = false;
    for (const seg of segmentText(para)) {
      if (seg.w) {
        const km = hasKhmer(seg.t);
        // Guarantee a line-break opportunity between Khmer words (no spaces in Khmer).
        if (km && prevKhmerWord) html += '​';
        html += `<span class="w">${esc(seg.t)}</span>`;
        prevKhmerWord = km;
      } else {
        html += esc(seg.t);
        prevKhmerWord = false;
      }
    }
    html += '</p>';
  }
  return html;
}

export class Prompter {
  constructor(root, { onTap, onEnd, onUserScroll } = {}) {
    this.root = root;
    this.onTap = onTap;
    this.onEnd = onEnd;
    this.onUserScroll = onUserScroll;

    root.classList.add('prompter');
    root.innerHTML = `
      <div class="pr-shade"></div>
      <div class="pr-viewport">
        <div class="pr-content"></div>
      </div>
      <div class="pr-marker pr-marker-l" aria-hidden="true"></div>
      <div class="pr-marker pr-marker-r" aria-hidden="true"></div>
      <div class="pr-empty" hidden></div>`;
    this.viewport = root.querySelector('.pr-viewport');
    this.content = root.querySelector('.pr-content');
    this.shade = root.querySelector('.pr-shade');
    this.markers = root.querySelectorAll('.pr-marker');
    this.emptyEl = root.querySelector('.pr-empty');

    this.text = '';
    this.words = 0;
    this.scroll = 0;
    this.maxScroll = 0;
    this.markerY = 100;
    this.lineH = 40;
    this.wpm = 140;
    this.playing = false;
    this.voiceFactor = 1; // multiplied into speed (voice mode)
    this.ended = false;
    this.inertia = 0;
    this.lastT = 0;
    this.drag = null;
    this.settings = null;
    this.log = null;
    this._raf = 0;
    this._lastApplied = NaN;

    this._onResize = () => this.layout();
    window.addEventListener('resize', this._onResize);
    // Web fonts (e.g. the Khmer font) can finish loading after the first layout.
    document.fonts?.addEventListener?.('loadingdone', this._onResize);
    this._ro = 'ResizeObserver' in window ? new ResizeObserver(() => this.layout()) : null;
    this._ro?.observe(root);

    this._bindGestures();
    this._tick = this._tick.bind(this);
    this._raf = requestAnimationFrame(this._tick);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    window.removeEventListener('resize', this._onResize);
    document.fonts?.removeEventListener?.('loadingdone', this._onResize);
    this._ro?.disconnect();
    this._unbindGestures?.();
  }

  // ---------------------------------------------------------------- content

  setText(text, emptyHint = '') {
    const progress = this.progress;
    this.text = String(text || '');
    this.words = countWords(this.text);
    this.content.innerHTML = buildHTML(this.text);
    this.emptyEl.hidden = !!this.text.trim();
    this.emptyEl.textContent = emptyHint;
    this.ended = false;
    if (this.settings) this.applySettings(this.settings);
    else this.layout();
    this.setProgress(progress);
    // Fonts may arrive after first layout; re-measure when they do.
    document.fonts?.ready?.then(() => this.layout());
  }

  applySettings(s) {
    this.settings = s;
    const scale = clamp(Math.min(window.innerWidth, window.innerHeight * 0.75) / 390, 0.85, 1.9);
    const fs = Math.round(s.fontSize * scale);
    const st = this.content.style;
    st.fontFamily = s.font === 'sans' ? SANS : SERIF;
    st.fontSize = fs + 'px';
    // Khmer stacks vowels and subscript letters above/below the line: give it more room.
    st.lineHeight = String(hasKhmer(this.text) ? Math.max(s.lineHeight * 1.22, 1.58) : s.lineHeight);
    st.fontWeight = s.bold ? '700' : '500';
    st.textAlign = s.align;
    st.paddingLeft = st.paddingRight = s.margin + '%';
    this.root.classList.toggle('mirror', !!s.mirrorText);
    this.root.classList.toggle('expanded', !!s.expanded);
    this.root.classList.toggle('nofocus', !s.focusFade);
    this.root.style.setProperty('--dim', String(s.dim));
    this.wpm = s.wpm;
    this.layout();
  }

  // ---------------------------------------------------------------- geometry

  layout() {
    const s = this.settings;
    if (!s) return;
    const progress = this.progress;
    const vh = window.innerHeight;
    const rootRect = this.root.getBoundingClientRect();
    const height = rootRect.height || vh * 0.5;

    // Reading line: a fixed fraction of the screen height, kept below the
    // status bar / camera island.
    const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--safe-t-px')) || 0;
    this.markerY = Math.round(Math.max(safeTop + 8, s.markerPos * vh) - rootRect.top);

    const cs = getComputedStyle(this.content);
    this.lineH = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3 || 40;

    this.content.style.paddingTop = this.markerY + 'px';
    this.content.style.paddingBottom = Math.round(height) + 'px';

    const textH = this.content.scrollHeight - this.markerY - Math.round(height);
    this.maxScroll = Math.max(0, textH - this.lineH);
    this._wordPos = null;

    // Marker arrows centred on the first line box at the reading line.
    const my = this.markerY + this.lineH / 2;
    this.markers.forEach((m) => (m.style.top = my + 'px'));
    this.emptyEl.style.top = this.markerY + 'px';

    this._applyMask(height);
    this.setProgress(progress);
  }

  _applyMask(h) {
    const m = this.markerY;
    const L = this.lineH;
    const f = this.settings?.focusFade !== false;
    const px = (v) => `${Math.round(clamp(v, 0, h))}px`;
    let g;
    if (f) {
      g = [
        `rgba(0,0,0,0) ${px(m - 1.7 * L)}`,
        `rgba(0,0,0,.28) ${px(m - 0.75 * L)}`,
        `rgba(0,0,0,1) ${px(m - 0.08 * L)}`,
        `rgba(0,0,0,1) ${px(m + 4.15 * L)}`,
        `rgba(0,0,0,.36) ${px(m + 5.4 * L)}`,
        `rgba(0,0,0,.26) ${px(h - 0.8 * L)}`,
        `rgba(0,0,0,0) ${px(h)}`,
      ];
    } else {
      g = [`rgba(0,0,0,0) ${px(m - 1.6 * L)}`, `rgba(0,0,0,1) ${px(m - 0.3 * L)}`, `rgba(0,0,0,1) ${px(h - 1.2 * L)}`, `rgba(0,0,0,0) ${px(h)}`];
    }
    const mask = `linear-gradient(to bottom, ${g.join(', ')})`;
    this.viewport.style.webkitMaskImage = mask;
    this.viewport.style.maskImage = mask;
  }

  get pxPerSecond() {
    if (!this.words || !this.maxScroll) return 0;
    return ((this.wpm / 60) * this.maxScroll) / this.words;
  }

  get progress() {
    return this.maxScroll ? clamp(this.scroll / this.maxScroll, 0, 1) : 0;
  }

  setProgress(p) {
    this.scroll = clamp((p || 0) * this.maxScroll, 0, this.maxScroll);
    this._apply(true);
  }

  /** Seconds left at the current speed. */
  get remainingSeconds() {
    const v = this.pxPerSecond;
    return v ? (this.maxScroll - this.scroll) / v : 0;
  }

  // ---------------------------------------------------------------- control

  play() {
    if (this.ended && this.scroll >= this.maxScroll - 1) return;
    this.playing = true;
    this.lastT = 0;
  }

  pause() {
    this.playing = false;
  }

  toggle() {
    this.playing ? this.pause() : this.play();
    return this.playing;
  }

  reset() {
    this.scroll = 0;
    this.ended = false;
    this.inertia = 0;
    this._apply(true);
  }

  nudge(px) {
    this.scroll = clamp(this.scroll + px, 0, this.maxScroll);
    if (this.scroll < this.maxScroll - 1) this.ended = false;
    this._apply(true);
    this.onUserScroll?.();
  }

  setSpeed(wpm) {
    this.wpm = wpm;
  }

  setVoiceFactor(f) {
    this.voiceFactor = clamp(f, 0, 1);
  }

  // Scroll log, used to time captions: [[recordingMs, progress], ...]
  startLog() {
    this.log = [];
  }

  sample(tMs) {
    if (!this.log) return;
    const p = Math.round(this.progress * 100000) / 100000;
    const last = this.log[this.log.length - 1];
    if (last && last[1] === p && tMs - last[0] < 1000) return;
    this.log.push([Math.round(tMs), p]);
  }

  stopLog() {
    const l = this.log;
    this.log = null;
    return l || [];
  }

  /** Word list with each word's progress position (0..1) for caption timing. */
  wordPositions() {
    if (this._wordPos) return this._wordPos;
    const spans = this.content.querySelectorAll('.w');
    const words = [];
    const top0 = this.markerY;
    // Group by line, then spread words across the line's duration.
    let lineTop = null;
    let line = [];
    const lines = [];
    spans.forEach((sp) => {
      const top = sp.offsetTop;
      if (lineTop === null || Math.abs(top - lineTop) > this.lineH * 0.4) {
        if (line.length) lines.push({ top: lineTop, words: line });
        lineTop = top;
        line = [];
      }
      // Text after the word up to the next word (spaces / punctuation).
      let after = '';
      let n = sp.nextSibling;
      while (n && !(n.nodeType === 1 && n.classList?.contains('w'))) {
        after += n.textContent || '';
        n = n.nextSibling;
      }
      if (!n && sp.parentElement?.nextElementSibling) after += '\n';
      line.push({ text: sp.textContent, after: after.replace(/​/g, '') });
    });
    if (line.length) lines.push({ top: lineTop, words: line });
    const max = this.maxScroll || 1;
    lines.forEach((ln, i) => {
      const p0 = (ln.top - top0) / max;
      const next = lines[i + 1];
      const p1 = next ? (next.top - top0) / max : p0 + this.lineH / max;
      ln.words.forEach((w, k) => {
        words.push({ ...w, p: p0 + ((p1 - p0) * k) / ln.words.length });
      });
    });
    this._wordPos = words;
    return words;
  }

  // ---------------------------------------------------------------- loop

  _tick(t) {
    this._raf = requestAnimationFrame(this._tick);
    // Cap the step so a long stall can't jump the text, but keep real-time
    // speed even when the browser throttles frames (low-power mode).
    const dt = this.lastT ? Math.min(0.5, (t - this.lastT) / 1000) : 0;
    this.lastT = t;
    if (this.drag) return;

    let moved = false;
    if (this.playing && dt > 0 && !this.ended) {
      const v = this.pxPerSecond * this.voiceFactor;
      if (v > 0) {
        this.scroll += v * dt;
        moved = true;
      }
    }
    if (Math.abs(this.inertia) > 5 && dt > 0) {
      this.scroll += this.inertia * dt;
      this.inertia *= Math.exp(-dt * 5.5);
      moved = true;
    } else {
      this.inertia = 0;
    }
    if (!moved) return;
    if (this.scroll >= this.maxScroll) {
      this.scroll = this.maxScroll;
      this.inertia = 0;
      if (!this.ended && this.maxScroll > 0 && this.playing) {
        this.ended = true;
        this.onEnd?.();
      }
    }
    if (this.scroll < 0) {
      this.scroll = 0;
      this.inertia = 0;
    }
    this._apply();
  }

  _apply(force = false) {
    const y = Math.round(this.scroll * 2) / 2;
    if (!force && y === this._lastApplied) return;
    this._lastApplied = y;
    this.content.style.transform = `translate3d(0, ${-y}px, 0)`;
  }

  // ---------------------------------------------------------------- gestures

  _bindGestures() {
    const vp = this.root;
    let samples = [];
    const down = (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.target.closest('button, a, input')) return;
      this.drag = { id: e.pointerId, y0: e.clientY, s0: this.scroll, moved: false, t0: performance.now() };
      samples = [[performance.now(), e.clientY]];
      this.inertia = 0;
    };
    const move = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      const dy = e.clientY - d.y0;
      if (!d.moved && Math.abs(dy) > 7) {
        d.moved = true;
        try {
          vp.setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }
      if (d.moved) {
        this.scroll = clamp(d.s0 - dy, 0, this.maxScroll);
        if (this.scroll < this.maxScroll - 1) this.ended = false;
        this._apply();
        samples.push([performance.now(), e.clientY]);
        if (samples.length > 6) samples.shift();
      }
    };
    const up = (e) => {
      const d = this.drag;
      if (!d || e.pointerId !== d.id) return;
      this.drag = null;
      this.lastT = 0;
      if (!d.moved) {
        if (e.type === 'pointerup' && performance.now() - d.t0 < 600) this.onTap?.();
        return;
      }
      const a = samples[0];
      const b = samples[samples.length - 1];
      const dtS = (b[0] - a[0]) / 1000;
      if (dtS > 0 && performance.now() - b[0] < 80) this.inertia = clamp(-(b[1] - a[1]) / dtS, -2500, 2500);
      this.onUserScroll?.();
    };
    const wheel = (e) => {
      e.preventDefault();
      this.nudge(e.deltaY);
    };
    vp.addEventListener('pointerdown', down);
    vp.addEventListener('pointermove', move);
    vp.addEventListener('pointerup', up);
    vp.addEventListener('pointercancel', up);
    vp.addEventListener('wheel', wheel, { passive: false });
    this._unbindGestures = () => {
      vp.removeEventListener('pointerdown', down);
      vp.removeEventListener('pointermove', move);
      vp.removeEventListener('pointerup', up);
      vp.removeEventListener('pointercancel', up);
      vp.removeEventListener('wheel', wheel);
    };
  }
}
