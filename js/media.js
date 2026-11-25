// Camera / microphone access, recording, audio level metering.
import { clamp, nextVideoFrame, isIOS } from './util.js';

export function mediaSupport() {
  return {
    secure: window.isSecureContext !== false,
    getUserMedia: !!navigator.mediaDevices?.getUserMedia,
    recorder: typeof window.MediaRecorder === 'function',
  };
}

// H.264 High first (best quality on iPhone), then other MP4 flavours, then WebM.
const MIME_CANDIDATES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4d0028,mp4a.40.2',
  'video/mp4;codecs=avc1.42e01f,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const ok = (m) => {
    try {
      return MediaRecorder.isTypeSupported(m);
    } catch {
      return false;
    }
  };
  // Plain "video/mp4" is H.264 in Safari, but VP9 in builds without H.264
  // (VP9-in-MP4 won't open in many apps) — there WebM is the honest choice.
  const ua = navigator.userAgent;
  const webkit = isIOS() || (/Safari\//.test(ua) && !/Chrome|Chromium|Edg|OPR|Firefox/.test(ua));
  const plainMp4IsVp9 = !webkit && (ok('video/mp4;codecs=vp9') || ok('video/mp4;codecs=vp09.00.10.08'));
  for (const m of MIME_CANDIDATES) {
    if (m === 'video/mp4' && plainMp4IsVp9) continue;
    if (ok(m)) return m;
  }
  return '';
}

export const baseMime = (m) => String(m || 'video/mp4').split(';')[0].trim() || 'video/mp4';

// ------------------------------------------------------------------ camera

export class Camera {
  constructor(video) {
    this.video = video;
    this.stream = null;
    this.noAudio = false;
    this.facing = 'user';
    this.onEnded = null;
    this._endedHandler = () => this.onEnded?.();
  }

  get active() {
    return !!this.stream && this.stream.getVideoTracks().some((t) => t.readyState === 'live');
  }

  async start({ facing = 'user', resolution = '1080', micId = '', micMode = 'voice' } = {}) {
    this.stop();
    // Ask for LANDSCAPE numbers even in portrait: iOS then delivers an upright
    // portrait stream (asking for portrait numbers can record sideways on iOS 26).
    const [w, h] = resolution === '720' ? [1280, 720] : [1920, 1080];
    const processing = micMode !== 'raw';
    const audio = {
      echoCancellation: processing,
      noiseSuppression: processing,
      autoGainControl: processing,
    };
    if (micId) audio.deviceId = { exact: micId };
    const video = { facingMode: facing, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: 30 } };

    let stream;
    this.noAudio = false;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video, audio });
    } catch (e) {
      if (e?.name === 'NotAllowedError' || e?.name === 'SecurityError') throw e;
      try {
        // Relax: the saved microphone may be gone, or constraints too strict.
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing }, audio: true });
      } catch (e2) {
        if (e2?.name === 'NotFoundError' || e2?.name === 'OverconstrainedError') {
          // No microphone at all: record video only.
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing } });
          this.noAudio = true;
        } else {
          throw e2;
        }
      }
    }
    this.stream = stream;
    this.facing = facing;
    stream.getVideoTracks().forEach((t) => t.addEventListener('ended', this._endedHandler));

    const v = this.video;
    v.muted = true;
    v.playsInline = true;
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    v.srcObject = stream;
    try {
      await v.play();
    } catch {
      /* autoplay of muted inline video is allowed; ignore odd rejections */
    }
    await nextVideoFrame(v, 3000);
    return stream;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach((t) => {
        t.removeEventListener('ended', this._endedHandler);
        try {
          t.stop();
        } catch {
          /* ignore */
        }
      });
    }
    this.stream = null;
    if (this.video) {
      try {
        this.video.pause();
      } catch {
        /* ignore */
      }
      this.video.srcObject = null;
    }
  }

  get size() {
    return { width: this.video.videoWidth || 0, height: this.video.videoHeight || 0 };
  }

  get micLabel() {
    return this.stream?.getAudioTracks()[0]?.label || '';
  }

  get micDeviceId() {
    return this.stream?.getAudioTracks()[0]?.getSettings?.().deviceId || '';
  }

  static async listMics() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      const seen = new Set();
      return devs
        .filter((d) => d.kind === 'audioinput' && d.deviceId && !['default', 'communications'].includes(d.deviceId))
        .filter((d) => (seen.has(d.deviceId) ? false : seen.add(d.deviceId)))
        .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${i + 1}` }));
    } catch {
      return [];
    }
  }

  static async countCameras() {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices();
      return devs.filter((d) => d.kind === 'videoinput').length;
    } catch {
      return 1;
    }
  }
}

export function describeMediaError(e) {
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') return 'denied';
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return 'notfound';
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return 'busy';
  return 'error';
}

// ------------------------------------------------------------------ recorder

export class Recorder {
  constructor(stream, { mimeType = pickMimeType(), videoBitsPerSecond, audioBitsPerSecond = 128000 } = {}) {
    this.stream = stream;
    this.requestedMime = mimeType;
    this.vbps = videoBitsPerSecond;
    this.abps = audioBitsPerSecond;
    this.chunks = [];
    this.bytes = 0;
    this.seq = 0;
    this.rec = null;
    this.onerror = null;
    this.ondata = null; // (seq, blob) => void — if set, pieces go there instead of memory
    this.startedAt = 0;
  }

  /** Starts recording. Resolves when the recorder reports it has started. */
  start() {
    this.chunks = [];
    this.bytes = 0;
    this.seq = 0;
    const opts = {};
    if (this.requestedMime) opts.mimeType = this.requestedMime;
    if (this.vbps) opts.videoBitsPerSecond = this.vbps;
    if (this.abps) opts.audioBitsPerSecond = this.abps;
    try {
      this.rec = new MediaRecorder(this.stream, opts);
    } catch {
      this.rec = new MediaRecorder(this.stream);
    }
    this.rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.bytes += e.data.size;
        const seq = this.seq++;
        if (this.ondata) this.ondata(seq, e.data);
        else this.chunks.push(e.data);
      }
    };
    this.rec.onerror = (e) => this.onerror?.(e?.error || e);
    const started = new Promise((resolve) => {
      this.rec.onstart = () => resolve(true);
      setTimeout(() => resolve(this.rec?.state === 'recording'), 2500);
    });
    // A 1 s timeslice keeps data flowing in small pieces (less memory risk on long takes).
    this.rec.start(1000);
    this.startedAt = performance.now();
    return started;
  }

  get state() {
    return this.rec?.state || 'inactive';
  }

  get mimeType() {
    return this.rec?.mimeType || this.requestedMime || 'video/mp4';
  }

  get canPause() {
    return typeof this.rec?.pause === 'function';
  }

  pause() {
    if (this.rec?.state === 'recording') this.rec.pause();
  }

  resume() {
    if (this.rec?.state === 'paused') this.rec.resume();
  }

  /** Stops and resolves with the finished Blob (only the in-memory pieces when `ondata` is used). */
  stop() {
    return new Promise((resolve) => {
      const r = this.rec;
      const finish = () => resolve(new Blob(this.chunks, { type: baseMime(this.mimeType) }));
      if (!r || r.state === 'inactive') return finish();
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        finish();
      };
      r.addEventListener('stop', () => setTimeout(once, 0), { once: true });
      setTimeout(once, 5000); // safety net
      try {
        r.stop();
      } catch {
        once();
      }
    });
  }
}

/** JPEG thumbnail of the current camera frame (not mirrored, like the recording). */
export function captureFrame(video, maxSide = 480) {
  return new Promise((resolve) => {
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh) return resolve(null);
    const s = Math.min(1, maxSide / Math.max(vw, vh));
    const c = document.createElement('canvas');
    c.width = Math.round(vw * s);
    c.height = Math.round(vh * s);
    try {
      c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
      c.toBlob((b) => resolve(b), 'image/jpeg', 0.74);
    } catch {
      resolve(null);
    }
  });
}

/** Reads duration and size of a recorded blob. Resolves null if it can't be read. */
export function probeVideo(blob, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    const url = URL.createObjectURL(blob);
    let settled = false;
    const done = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        v.removeAttribute('src');
        v.load();
      } catch {
        /* ignore */
      }
      URL.revokeObjectURL(url);
      resolve(val);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    v.onerror = () => done(null);
    v.onloadedmetadata = () => {
      const read = () => done({ duration: Number.isFinite(v.duration) ? v.duration : NaN, width: v.videoWidth, height: v.videoHeight });
      if (Number.isFinite(v.duration)) return read();
      // WebM from MediaRecorder has no duration; seeking far forces the browser to compute it.
      v.ondurationchange = () => Number.isFinite(v.duration) && read();
      try {
        v.currentTime = 1e7;
      } catch {
        read();
      }
      setTimeout(read, 1500);
    };
    v.src = url;
  });
}

// ------------------------------------------------------------------ audio level

export class AudioMeter {
  constructor(stream) {
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.src = this.ctx.createMediaStreamSource(stream);
    this.an = this.ctx.createAnalyser();
    this.an.fftSize = 1024;
    this.an.smoothingTimeConstant = 0;
    // Route through a silent gain to the destination so every browser keeps processing.
    this.mute = this.ctx.createGain();
    this.mute.gain.value = 0;
    this.src.connect(this.an);
    this.an.connect(this.mute);
    this.mute.connect(this.ctx.destination);
    this.f32 = typeof this.an.getFloatTimeDomainData === 'function' ? new Float32Array(this.an.fftSize) : null;
    this.u8 = this.f32 ? null : new Uint8Array(this.an.fftSize);
    this._db = -100;
    this._at = 0;
  }

  resume() {
    if (this.ctx.state !== 'running') return this.ctx.resume().catch(() => {});
    return Promise.resolve();
  }

  get running() {
    return this.ctx.state === 'running';
  }

  /** Current level in dBFS (cached per animation frame). */
  db() {
    const t = performance.now();
    if (t - this._at < 8) return this._db;
    this._at = t;
    let sum = 0;
    const n = this.an.fftSize;
    if (this.f32) {
      this.an.getFloatTimeDomainData(this.f32);
      for (let i = 0; i < n; i++) sum += this.f32[i] * this.f32[i];
    } else {
      this.an.getByteTimeDomainData(this.u8);
      for (let i = 0; i < n; i++) {
        const v = (this.u8[i] - 128) / 128;
        sum += v * v;
      }
    }
    this._db = 20 * Math.log10(Math.sqrt(sum / n) + 1e-9);
    return this._db;
  }

  /** 0..1 for level bars. */
  level() {
    return clamp((this.db() + 62) / 50, 0, 1);
  }

  dispose() {
    try {
      this.src.disconnect();
      this.an.disconnect();
      this.mute.disconnect();
    } catch {
      /* ignore */
    }
    this.ctx.close?.().catch(() => {});
  }
}

/** Voice activity → smooth 0..1 factor for voice-controlled scrolling. */
export class VoiceGate {
  constructor(meter) {
    this.meter = meter;
    this.floor = -60;
    this.hold = 0;
    this.factor = 0;
    this.active = false;
  }

  update(dt, sensitivity = 0.55) {
    const db = this.meter.db();
    // Noise floor follows quiet moments quickly and loud moments slowly.
    if (db < this.floor) this.floor += (db - this.floor) * Math.min(1, dt * 8);
    else this.floor += Math.min(db - this.floor, (this.active ? 0.35 : 2) * dt);
    this.floor = clamp(this.floor, -85, -30);
    const margin = 19 - sensitivity * 12; // 19 dB (low) .. 7 dB (high)
    const threshold = Math.max(this.floor + margin, -60 + (1 - sensitivity) * 8);
    if (db > threshold) this.hold = 0.7;
    else this.hold -= dt;
    this.active = this.hold > 0;
    const target = this.active ? 1 : 0;
    const tau = target > this.factor ? 0.1 : 0.32;
    this.factor += (target - this.factor) * (1 - Math.exp(-dt / tau));
    if (this.factor < 0.01) this.factor = 0;
    return this.factor;
  }
}
