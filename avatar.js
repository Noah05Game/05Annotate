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
    function pos(e) {
      const r = canvas.getBoundingClientRect();
      const p = e.touches ? e.touches[0] : e;
      return { x: (p.clientX - r.left) / r.width * SIZE, y: (p.clientY - r.top) / r.height * SIZE };
    }

    /* ---- drawing ------------------------------------------------------ */
    function strokeTo(p) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = state.size;
      ctx.strokeStyle = state.tool === 'eraser' ? '#f4f4fb' : state.color;
      const segs = [[state.last, p]];
      if (state.mirror) segs.push([mir(state.last), mir(p)]);
      for (const [a, b] of segs) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      state.last = p;
    }
    const mir = p => ({ x: SIZE - p.x, y: p.y });

    function down(e) {
      e.preventDefault();
      Sound.tap && Sound.tap();
      const p = pos(e);
      if (state.tool === 'fill') { floodFill(p, state.color); snapshot(); return; }
      state.drawing = true; state.last = p;
      // dot on tap
      ctx.fillStyle = state.tool === 'eraser' ? '#f4f4fb' : state.color;
      dot(p); if (state.mirror) dot(mir(p));
    }
    function dot(p) { ctx.beginPath(); ctx.arc(p.x, p.y, state.size / 2, 0, 7); ctx.fill(); }
    function move(e) { if (!state.drawing) return; e.preventDefault(); strokeTo(pos(e)); }
    function up() { if (!state.drawing) return; state.drawing = false; snapshot(); }

    canvas.addEventListener('mousedown', down); canvas.addEventListener('mousemove', move);
    addEventListener('mouseup', up);
    canvas.addEventListener('touchstart', down, { passive: false });
    canvas.addEventListener('touchmove', move, { passive: false });
    addEventListener('touchend', up);

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

    /* ---- randomize ---------------------------------------------------- */
    function randomize() {
      // background
      ctx.fillStyle = U.pick(['#ffe4ef','#e0f2fe','#fef3c7','#dcfce7','#ede9fe','#f4f4fb']);
      ctx.fillRect(0, 0, SIZE, SIZE);
      // face blob
      const cx = SIZE / 2, cy = SIZE / 2 + U.rand(-10, 10);
      ctx.fillStyle = U.pick(['#fcd9b0','#f1c27d','#e0ac69','#c68642','#8d5524','#ffe0bd']);
      blob(cx, cy, U.rand(80, 100));
      // eyes
      ctx.fillStyle = '#1c1c28';
      const ey = cy - 18, ex = U.rand(26, 40);
      eye(cx - ex, ey); eye(cx + ex, ey);
      // mouth
      ctx.strokeStyle = '#1c1c28'; ctx.lineWidth = 6; ctx.lineCap = 'round';
      ctx.beginPath();
      const smile = U.rand(0, 1) > 0.3;
      ctx.arc(cx, cy + (smile ? 18 : 40), 26, smile ? 0.15 * Math.PI : 1.15 * Math.PI, smile ? 0.85 * Math.PI : 1.85 * Math.PI);
      ctx.stroke();
      // hair / hat accent
      ctx.fillStyle = U.pick(PALETTE);
      ctx.beginPath(); ctx.arc(cx, cy - 70, U.rand(70, 92), Math.PI, 0); ctx.fill();
      snapshot(); U.haptic(14); Sound.pop && Sound.pop();
      function blob(x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); }
      function eye(x, y) { ctx.beginPath(); ctx.arc(x, y, U.rand(6, 11), 0, 7); ctx.fill(); }
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
      destroy() { removeEventListener('mouseup', up); removeEventListener('touchend', up); wrap.remove(); },
    };
  }

  global.Avatar = { mount };
})(window);
