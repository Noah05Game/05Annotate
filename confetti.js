/* ============================================================================
   confetti.js — lightweight canvas confetti for celebrations.
   global Confetti.burst() / Confetti.rain(ms)
   ========================================================================== */
(function (global) {
  'use strict';
  const COLORS = ['#6d5ef8', '#22d3ee', '#ff6b9d', '#fb923c', '#34d399', '#ffd84d'];
  let canvas, ctx, parts = [], raf, w, h, dpr;

  function ensure() {
    if (canvas) return;
    canvas = U.el('canvas', { class: 'confetti-canvas', style: {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '300',
    }});
    document.body.append(canvas); ctx = canvas.getContext('2d'); resize();
    addEventListener('resize', resize);
  }
  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1);
    w = innerWidth; h = innerHeight;
    canvas.width = w * dpr; canvas.height = h * dpr; ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  function spawn(n, originX = 0.5, originY = 0.4, spread = 1) {
    if (U.Settings.get().motion === false) return;
    for (let i = 0; i < n; i++) {
      parts.push({
        x: originX * w, y: originY * h,
        vx: U.rand(-9, 9) * spread, vy: U.rand(-16, -4),
        g: U.rand(0.25, 0.45), s: U.rand(5, 11),
        rot: U.rand(0, 7), vr: U.rand(-0.3, 0.3),
        c: U.pick(COLORS), life: U.rand(80, 150), t: 0, shape: Math.random() < 0.5 ? 'r' : 'c',
      });
    }
    if (!raf) loop();
  }
  function loop() {
    ctx.clearRect(0, 0, w, h);
    parts = parts.filter(p => p.t < p.life && p.y < h + 30);
    for (const p of parts) {
      p.t++; p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr;
      const alpha = U.clamp(1 - p.t / p.life, 0, 1);
      ctx.save(); ctx.globalAlpha = alpha; ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
      if (p.shape === 'r') ctx.fillRect(-p.s/2, -p.s/2, p.s, p.s * 0.6);
      else { ctx.beginPath(); ctx.arc(0, 0, p.s/2, 0, 7); ctx.fill(); }
      ctx.restore();
    }
    if (parts.length) raf = requestAnimationFrame(loop);
    else { cancelAnimationFrame(raf); raf = null; ctx.clearRect(0, 0, w, h); }
  }

  global.Confetti = {
    burst(x = 0.5, y = 0.45) { ensure(); spawn(120, x, y, 1); },
    sides() { ensure(); spawn(60, 0, 0.5, 1.3); spawn(60, 1, 0.5, 1.3); },
    rain(ms = 2500) {
      ensure();
      const end = performance.now() + ms;
      (function shed() { spawn(14, Math.random(), -0.05, 0.6);
        if (performance.now() < end) setTimeout(shed, 180); })();
    },
  };
})(window);
