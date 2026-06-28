/* ============================================================================
   avatar.js — the avatar creator used on the join flow.
   A self-contained painting surface with pencil / eraser / fill bucket /
   undo / redo / clear / colour picker / brush sizes / mirror / randomize.
   Exports a compact PNG data-URL (128px) for sending over PeerJS.
   global Avatar.mount(container, opts) -> { exportPNG, randomize, destroy }
   ========================================================================== */
(function (global) {
  'use strict';

  const SIZE = 288;            // logical canvas px (square)
  const EXPORT = 128;          // downscaled export size
  const PALETTE = ['#1c1c28','#ffffff','#ff6b9d','#fb923c','#ffd84d','#34d399',
                   '#22d3ee','#6d5ef8','#a855f7','#ef4444','#f9a8d4','#8b5e34'];
  const BRUSHES = [4, 10, 20, 34];

  function mount(container, opts = {}) {
    const state = { color: '#6d5ef8', size: 10, tool: 'pencil', mirror: false, drawing: false, last: null };
    const undo = []; const redo = [];

    const wrap = U.el('div', { class: 'avatar-studio' });
    const stage = U.el('div', { class: 'avatar-stage' });
    const canvas = U.el('canvas', { class: 'avatar-canvas', width: SIZE, height: SIZE, 'aria-label': 'Avatar drawing area' });
    const mirrorGuide = U.el('div', { class: 'avatar-mirror-guide hidden' });
    stage.append(canvas, mirrorGuide);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // checker + base fill
    function reset() {
      ctx.fillStyle = '#f4f4fb'; ctx.fillRect(0, 0, SIZE, SIZE);
      snapshot(true);
    }

    /* ---- history ------------------------------------------------------ */
    function snapshot(initial) {
      try {
        if (!initial) redo.length = 0;
        undo.push(ctx.getImageData(0, 0, SIZE, SIZE));
        if (undo.length > 40) undo.shift();
        syncButtons();
      } catch (_) {}
    }
    function doUndo() { if (undo.length < 2) return; redo.push(undo.pop()); ctx.putImageData(undo[undo.length - 1], 0, 0); syncButtons(); U.haptic(8); }
    function doRedo() { if (!redo.length) return; const img = redo.pop(); ctx.putImageData(img, 0, 0); undo.push(img); syncButtons(); U.haptic(8); }
    function syncButtons() {
      btnUndo.disabled = undo.length < 2; btnRedo.disabled = !redo.length;
    }

    /* ---- coordinates -------------------------------------------------- */
    const BG = '#f4f4fb';
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * SIZE, y: (e.clientY - r.top) / r.height * SIZE };
    }

    /* ---- drawing (smoothed via quadratic midpoints) ------------------- */
    const mir = p => ({ x: SIZE - p.x, y: p.y });
    function drawSeg(from, ctrl, to) {
      ctx.beginPath(); ctx.moveTo(from.x, from.y);
      ctx.quadraticCurveTo(ctrl.x, ctrl.y, to.x, to.y); ctx.stroke();
    }
    function strokeTo(p) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = state.size;
      ctx.strokeStyle = state.tool === 'eraser' ? BG : state.color;
      const mid = { x: (state.last.x + p.x) / 2, y: (state.last.y + p.y) / 2 };
      drawSeg(state.lastMid, state.last, mid);
      if (state.mirror) drawSeg(mir(state.lastMid), mir(state.last), mir(mid));
      state.last = p; state.lastMid = mid;
    }

    function down(e) {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
      Sound.tap && Sound.tap();
      const p = pos(e);
      if (state.tool === 'fill') { floodFill(p, state.color); snapshot(); return; }
      state.drawing = true; state.last = p; state.lastMid = p;
      ctx.fillStyle = state.tool === 'eraser' ? BG : state.color;
      dot(p); if (state.mirror) dot(mir(p));
    }
    function dot(p) { ctx.beginPath(); ctx.arc(p.x, p.y, state.size / 2, 0, 7); ctx.fill(); }
    function move(e) { if (!state.drawing) return; e.preventDefault(); strokeTo(pos(e)); }
    function up() { if (!state.drawing) return; state.drawing = false; snapshot(); }

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);

    /* ---- flood fill (scanline) ---------------------------------------- */
    function floodFill(p, hex) {
      const x0 = p.x | 0, y0 = p.y | 0;
      if (x0 < 0 || y0 < 0 || x0 >= SIZE || y0 >= SIZE) return;
      const img = ctx.getImageData(0, 0, SIZE, SIZE); const d = img.data;
      const idx = (x, y) => (y * SIZE + x) * 4;
      const target = d.slice(idx(x0, y0), idx(x0, y0) + 4);
      const fill = hexRGBA(hex);
      if (sameColor(target, fill, 0)) return;
      const stack = [[x0, y0]];
      while (stack.length) {
        const [x, y] = stack.pop();
        let nx = x;
        while (nx >= 0 && matches(nx, y)) nx--; nx++;
        let up = false, dn = false;
        while (nx < SIZE && matches(nx, y)) {
          setPx(nx, y);
          if (y > 0) { if (matches(nx, y - 1)) { if (!up) { stack.push([nx, y - 1]); up = true; } } else up = false; }
          if (y < SIZE - 1) { if (matches(nx, y + 1)) { if (!dn) { stack.push([nx, y + 1]); dn = true; } } else dn = false; }
          nx++;
        }
      }
      ctx.putImageData(img, 0, 0);
      function matches(x, y) { const i = idx(x, y); return sameColor(d.subarray(i, i + 4), target, 36); }
      function setPx(x, y) { const i = idx(x, y); d[i]=fill[0]; d[i+1]=fill[1]; d[i+2]=fill[2]; d[i+3]=255; }
    }
    function hexRGBA(h) { const n = parseInt(h.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255, 255]; }
    function sameColor(a, b, tol) { return Math.abs(a[0]-b[0])<=tol && Math.abs(a[1]-b[1])<=tol && Math.abs(a[2]-b[2])<=tol && Math.abs(a[3]-b[3])<=tol; }

    /* ---- randomize — generates a varied, characterful avatar ---------- */
    const SKINS = ['#ffe0bd','#fcd9b0','#f1c27d','#e0ac69','#c68642','#8d5524','#a86b3c','#ffcd94'];
    const HAIRS = ['#1c1c28','#3a2a1a','#6b4423','#b5651d','#d9a441','#e8e6e3','#9b59b6','#e84393','#2d6cdf','#16a34a','#ef4444'];
    const BGS = [['#ffe4ef','#ffc2dd'],['#e0f2fe','#bae6fd'],['#fef3c7','#fde68a'],['#dcfce7','#bbf7d0'],
                 ['#ede9fe','#ddd6fe'],['#fae8ff','#f5d0fe'],['#e0e7ff','#c7d2fe'],['#fff1e6','#ffd9b3']];

    function randomize() {
      const R = U.rand, P = U.pick;
      const cx = SIZE / 2, cy = SIZE / 2 + R(-6, 8);

      // 1. gradient background
      const bg = P(BGS);
      const grad = ctx.createLinearGradient(0, 0, 0, SIZE);
      grad.addColorStop(0, bg[0]); grad.addColorStop(1, bg[1]);
      ctx.fillStyle = grad; ctx.fillRect(0, 0, SIZE, SIZE);

      const skin = P(SKINS), hair = P(HAIRS);
      const faceR = R(78, 96);
      const longHair = Math.random() < 0.45;

      // 2. back hair (behind head) for long styles
      if (longHair) { ctx.fillStyle = hair; roundBlob(cx, cy + 16, faceR + R(10, 22), faceR + R(26, 46)); }

      // 3. neck + face
      ctx.fillStyle = shade(skin, -14);
      ctx.fillRect(cx - 16, cy + faceR - 14, 32, 40);
      ctx.fillStyle = skin;
      const shape = P(['round','oval','square']);
      if (shape === 'round') circle(cx, cy, faceR);
      else if (shape === 'oval') roundBlob(cx, cy, faceR * 0.86, faceR * 1.06);
      else roundRect(cx - faceR, cy - faceR, faceR * 2, faceR * 2, faceR * 0.42);

      // 4. ears
      ctx.fillStyle = skin;
      circle(cx - faceR + 4, cy + 6, 12); circle(cx + faceR - 4, cy + 6, 12);

      // 5. top hair
      ctx.fillStyle = hair;
      const style = P(['short','spike','bun','bald','side','curly']);
      const top = cy - faceR;
      if (style === 'short')      arcHair(cx, cy - 8, faceR + 4, Math.PI, 0);
      else if (style === 'side')  { arcHair(cx, cy - 8, faceR + 4, Math.PI, 0); ctx.fillRect(cx - faceR - 2, top + 6, faceR, 30); }
      else if (style === 'spike') { for (let i = -3; i <= 3; i++){ const x = cx + i * (faceR/3.2); ctx.beginPath(); ctx.moveTo(x - 14, top + 26); ctx.lineTo(x, top - R(8,26)); ctx.lineTo(x + 14, top + 26); ctx.closePath(); ctx.fill(); } arcHair(cx, cy - 8, faceR + 2, Math.PI, 0); }
      else if (style === 'curly') { for (let i = -3; i <= 3; i++) circle(cx + i * (faceR/3), top + 10, R(16, 22)); }
      else if (style === 'bun')   { arcHair(cx, cy - 8, faceR + 2, Math.PI, 0); circle(cx, top - 6, 20); }
      // 'bald' draws nothing on top

      // 6. eyebrows
      ctx.strokeStyle = shade(hair, -10); ctx.lineWidth = 5; ctx.lineCap = 'round';
      const ey = cy - 16, ex = R(28, 38), browLift = R(20, 28);
      [-1, 1].forEach(s => { ctx.beginPath(); ctx.moveTo(cx + s*ex - 12, ey - browLift); ctx.quadraticCurveTo(cx + s*ex, ey - browLift - R(3,8), cx + s*ex + 12, ey - browLift); ctx.stroke(); });

      // 7. eyes with catchlight
      const eyeR = R(11, 15);
      [-1, 1].forEach(s => {
        const x = cx + s*ex;
        ctx.fillStyle = '#fff'; circle(x, ey, eyeR);
        ctx.fillStyle = P(['#2d2d3a','#3a2a1a','#2d6cdf','#16a34a','#8d5524']);
        circle(x + R(-2,2), ey + 1, eyeR * 0.56);
        ctx.fillStyle = '#fff'; circle(x - 2, ey - 2, eyeR * 0.2);
      });

      // 8. nose
      ctx.strokeStyle = shade(skin, -34); ctx.lineWidth = 4; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(cx, ey + 10); ctx.lineTo(cx - R(2,6), ey + 26); ctx.lineTo(cx + 4, ey + 28); ctx.stroke();

      // 9. mouth (varied)
      ctx.strokeStyle = '#b14b5e'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      const my = cy + R(30, 42), m = P(['smile','grin','smirk','flat','open']);
      ctx.beginPath();
      if (m === 'smile') ctx.arc(cx, my - 8, 24, 0.15*Math.PI, 0.85*Math.PI);
      else if (m === 'grin') { ctx.arc(cx, my - 12, 28, 0.1*Math.PI, 0.9*Math.PI); ctx.stroke(); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, my - 12, 28, 0.18*Math.PI, 0.82*Math.PI); ctx.fill(); ctx.beginPath(); }
      else if (m === 'smirk') { ctx.moveTo(cx - 18, my); ctx.quadraticCurveTo(cx + 6, my + 10, cx + 20, my - 6); }
      else if (m === 'open') { ctx.fillStyle = '#b14b5e'; ctx.beginPath(); ctx.ellipse(cx, my, 14, 11, 0, 0, 7); ctx.fill(); ctx.beginPath(); }
      else { ctx.moveTo(cx - 16, my); ctx.lineTo(cx + 16, my); }
      ctx.stroke();

      // 10. fun extras
      if (Math.random() < 0.4) { ctx.fillStyle = 'rgba(255,120,150,.4)'; circle(cx - ex - 6, cy + 14, 10); circle(cx + ex + 6, cy + 14, 10); } // blush
      if (Math.random() < 0.3) { // glasses
        ctx.strokeStyle = '#222'; ctx.lineWidth = 4;
        ctx.strokeRect(cx - ex - 16, ey - 14, 30, 28); ctx.strokeRect(cx + ex - 14, ey - 14, 30, 28);
        ctx.beginPath(); ctx.moveTo(cx - ex + 14, ey); ctx.lineTo(cx + ex - 14, ey); ctx.stroke();
      }
      if (Math.random() < 0.25) { ctx.fillStyle = shade(skin,-30); for (let i=0;i<6;i++) circle(cx + R(-30,30), cy + R(-2,18), 1.6); } // freckles

      snapshot(); U.haptic(14); Sound.pop && Sound.pop();

      function circle(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
      function roundBlob(x, y, rx, ry) { ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, 7); ctx.fill(); }
      function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath(); ctx.fill(); }
      function arcHair(x, y, r, a0, a1) { ctx.beginPath(); ctx.arc(x, y, r, a0, a1); ctx.fill(); }
    }
    function shade(hex, amt) {
      const n = parseInt(hex.slice(1), 16);
      const r = U.clamp((n>>16&255)+amt,0,255), g = U.clamp((n>>8&255)+amt,0,255), b = U.clamp((n&255)+amt,0,255);
      return `rgb(${r|0},${g|0},${b|0})`;
    }

    /* ---- toolbar UI --------------------------------------------------- */
    const colorRow = U.el('div', { class: 'avatar-colors' },
      PALETTE.map(c => U.el('button', {
        class: 'swatch' + (c === state.color ? ' on' : ''), style: { background: c },
        'aria-label': 'Colour ' + c, type: 'button',
        onclick() { state.color = c; if (state.tool === 'eraser' || state.tool === 'fill') setTool('pencil'); U.$$('.swatch', colorRow).forEach(s => s.classList.remove('on')); this.classList.add('on'); }
      })),
      (() => { const w = U.el('label', { class: 'swatch swatch--custom', title: 'Custom colour' });
        const inp = U.el('input', { type: 'color', value: state.color, onchange() { state.color = this.value; U.$$('.swatch', colorRow).forEach(s => s.classList.remove('on')); } });
        w.append(inp); return w; })()
    );

    const brushRow = U.el('div', { class: 'avatar-brushes' },
      BRUSHES.map(b => U.el('button', {
        class: 'brushbtn' + (b === state.size ? ' on' : ''), type: 'button', 'aria-label': 'Brush ' + b,
        onclick() { state.size = b; U.$$('.brushbtn', brushRow).forEach(x => x.classList.remove('on')); this.classList.add('on'); },
      }, U.el('span', { class: 'brushdot', style: { width: Math.min(26, b) + 'px', height: Math.min(26, b) + 'px' } })))
    );

    function setTool(t) {
      state.tool = t;
      U.$$('.toolbtn', wrap).forEach(b => b.classList.toggle('on', b.dataset.tool === t));
    }
    const toolBtn = (tool, label, svg) => U.el('button', {
      class: 'toolbtn' + (tool === state.tool ? ' on' : ''), type: 'button', 'data-tool': tool,
      'aria-label': label, title: label, html: svg, onclick() { setTool(tool); U.haptic(8); },
    });

    const ICON = {
      pencil: '✏️', eraser: '🩹', fill: '🪣',
    };
    const btnUndo = U.el('button', { class: 'toolbtn', type: 'button', 'aria-label': 'Undo', title: 'Undo', text: '↶', onclick: doUndo });
    const btnRedo = U.el('button', { class: 'toolbtn', type: 'button', 'aria-label': 'Redo', title: 'Redo', text: '↷', onclick: doRedo });
    const btnClear = U.el('button', { class: 'toolbtn', type: 'button', 'aria-label': 'Clear', title: 'Clear', text: '🗑️', onclick() { reset(); U.haptic(20); } });
    const btnMirror = U.el('button', { class: 'toolbtn', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Mirror mode', title: 'Mirror', text: '🪞',
      onclick() { state.mirror = !state.mirror; this.classList.toggle('on', state.mirror); this.setAttribute('aria-pressed', state.mirror); mirrorGuide.classList.toggle('hidden', !state.mirror); } });
    const btnRand = U.el('button', { class: 'toolbtn', type: 'button', 'aria-label': 'Randomize avatar', title: 'Randomize', text: '🎲', onclick: randomize });

    const toolRow = U.el('div', { class: 'avatar-tools' },
      toolBtn('pencil', 'Pencil', ICON.pencil),
      toolBtn('eraser', 'Eraser', ICON.eraser),
      toolBtn('fill', 'Fill bucket', ICON.fill),
      btnMirror, btnRand, btnUndo, btnRedo, btnClear);

    wrap.append(stage, colorRow, U.el('div', { class: 'avatar-controls' }, brushRow, toolRow));
    container.append(wrap);
    reset();

    /* ---- export ------------------------------------------------------- */
    function exportPNG() {
      const out = document.createElement('canvas'); out.width = out.height = EXPORT;
      const octx = out.getContext('2d');
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(canvas, 0, 0, EXPORT, EXPORT);
      return out.toDataURL('image/png');
    }

    return {
      exportPNG, randomize,
      destroy() { wrap.remove(); },
    };
  }

  global.Avatar = { mount };
})(window);
