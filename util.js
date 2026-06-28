/* ============================================================================
   util.js — shared helpers used across every page.
   Exposes a global `U` namespace (no build step, GitHub-Pages friendly).
   ========================================================================== */
(function (global) {
  'use strict';

  /* ---- DOM ------------------------------------------------------------- */
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const el = (tag, props = {}, ...kids) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
    return n;
  };

  /* ---- misc ------------------------------------------------------------ */
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const rand  = (a, b) => a + Math.random() * (b - a);
  const pick  = arr => arr[(Math.random() * arr.length) | 0];
  const uid   = (n = 6) => Array.from({ length: n }, () =>
    'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[(Math.random() * 32) | 0]).join('');
  const shuffle = arr => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const fmtTime  = s => { s = Math.max(0, Math.ceil(s)); return `${(s/60)|0}:${String(s%60).padStart(2,'0')}`; };
  const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  /* ---- query string --------------------------------------------------- */
  const qs = (k, d = '') => new URLSearchParams(location.search).get(k) || d;

  /* ---- toast ----------------------------------------------------------- */
  let toastHost;
  function toast(msg, kind = '', ms = 2600) {
    if (!toastHost) { toastHost = el('div', { class: 'toast-host', 'aria-live': 'polite' }); document.body.append(toastHost); }
    const t = el('div', { class: `toast ${kind ? 'toast--' + kind : ''}`, text: msg });
    toastHost.append(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 320); }, ms);
    return t;
  }

  /* ---- haptics (best-effort) ------------------------------------------ */
  function haptic(pattern = 12) {
    if (Settings.get().haptics === false) return;
    try { navigator.vibrate && navigator.vibrate(pattern); } catch (_) {}
  }

  /* ---- settings (persisted) ------------------------------------------- */
  const SETTINGS_KEY = '05ann.settings';
  const Settings = {
    _cache: null,
    defaults: { theme: 'dark', sound: true, music: true, haptics: true, motion: true, perf: false },
    get() {
      if (this._cache) return this._cache;
      try { this._cache = { ...this.defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
      catch (_) { this._cache = { ...this.defaults }; }
      return this._cache;
    },
    set(patch) {
      this._cache = { ...this.get(), ...patch };
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this._cache)); } catch (_) {}
      this.apply();
      return this._cache;
    },
    apply() {
      const s = this.get();
      const r = document.documentElement;
      r.dataset.theme = s.theme;
      r.dataset.motion = s.motion ? 'on' : 'off';
      r.dataset.perf = s.perf ? 'on' : 'off';
    },
  };

  /* ---- particle field (lightweight canvas) ---------------------------- */
  function particles(canvas, opts = {}) {
    if (Settings.get().perf) return { stop() {} };
    const ctx = canvas.getContext('2d');
    const count = opts.count ?? 46;
    const color = opts.color ?? 'rgba(255,255,255,.6)';
    let w, h, dpr, parts, raf, running = true;
    function resize() {
      dpr = Math.min(2, devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    function seed() {
      parts = Array.from({ length: count }, () => ({
        x: rand(0, w), y: rand(0, h), r: rand(.6, 2.6),
        vx: rand(-.12, .12), vy: rand(-.32, -.06), a: rand(.15, .7),
      }));
    }
    function frame() {
      if (!running) return;
      ctx.clearRect(0, 0, w, h);
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -4) { p.y = h + 4; p.x = rand(0, w); }
        if (p.x < -4) p.x = w + 4; if (p.x > w + 4) p.x = -4;
        ctx.globalAlpha = p.a; ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }
    resize(); seed(); frame();
    const onR = debounce(() => { resize(); seed(); }, 200);
    addEventListener('resize', onR);
    return { stop() { running = false; cancelAnimationFrame(raf); removeEventListener('resize', onR); } };
  }

  /* ---- spring number tween (for score counters) ----------------------- */
  function tweenNumber(node, from, to, ms = 900) {
    const start = performance.now();
    function step(now) {
      const t = clamp((now - start) / ms, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      node.textContent = Math.round(from + (to - from) * e).toLocaleString();
      if (t < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  Settings.apply();

  global.U = { $, $$, el, clamp, rand, pick, uid, shuffle, debounce, fmtTime,
    escapeHtml, qs, toast, haptic, Settings, particles, tweenNumber };
})(window);
