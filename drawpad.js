/* ============================================================================
   drawpad.js — the drawing surface used during the DRAWING phase.
   Fixed-resolution art canvas + a view canvas that shows it with zoom & pan.
   Tools: pencil, eraser, colour picker, brush sizes, undo, redo, zoom, pan.
   global DrawPad.mount(container) -> { exportPNG, clear, destroy }
   ========================================================================== */
(function (global) {
  'use strict';

  const ART = 800;                    // fixed art resolution
  const PALETTE = ['#1c1c28','#ffffff','#ef4444','#fb923c','#ffd84d','#34d399',
                   '#22d3ee','#6d5ef8','#a855f7','#ff6b9d','#8b5e34','#94a3b8'];
  const BRUSHES = [3, 7, 14, 26, 44];

  function mount(container) {
    const st = { color: '#1c1c28', size: 7, tool: 'pencil', scale: 1, ox: 0, oy: 0,
                 drawing: false, last: null, pointers: new Map(), pinchD: 0, pinchC: null };
    const undo = [], redo = [];

    // art (data) canvas
    const art = document.createElement('canvas'); art.width = art.height = ART;
    const actx = art.getContext('2d', { willReadFrequently: true });
    actx.fillStyle = '#ffffff'; actx.fillRect(0, 0, ART, ART);

    const wrap = U.el('div', { class: 'drawpad' });
    const viewport = U.el('div', { class: 'drawpad-viewport' });
    const view = U.el('canvas', { class: 'drawpad-view', 'aria-label': 'Drawing canvas' });
    viewport.append(view);
    const vctx = view.getContext('2d');

    let VW, VH, dpr;
    function fit() {
      dpr = Math.min(2, devicePixelRatio || 1);
      VW = viewport.clientWidth; VH = viewport.clientHeight;
      view.width = VW * dpr; view.height = VH * dpr; vctx.setTransform(dpr,0,0,dpr,0,0);
      // initial: fit art to viewport
      const base = Math.min(VW, VH) / ART;
      if (st._initialised !== true) { st.scale = base; st.ox = (VW - ART * base)/2; st.oy = (VH - ART * base)/2; st._initialised = true; }
      render();
    }

    function render() {
      vctx.clearRect(0, 0, VW, VH);
      vctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-2') || '#11111d';
      vctx.fillRect(0, 0, VW, VH);
      vctx.save();
      vctx.translate(st.ox, st.oy); vctx.scale(st.scale, st.scale);
      vctx.shadowColor = 'rgba(0,0,0,.4)'; vctx.shadowBlur = 30 / st.scale; vctx.shadowOffsetY = 8 / st.scale;
      vctx.drawImage(art, 0, 0);
      vctx.restore();
    }

    // view px -> art px
    function toArt(cx, cy) {
      const r = viewport.getBoundingClientRect();
      return { x: (cx - r.left - st.ox) / st.scale, y: (cy - r.top - st.oy) / st.scale };
    }

    /* ---- history ------------------------------------------------------ */
    function snapshot() { try { redo.length = 0; undo.push(actx.getImageData(0,0,ART,ART)); if (undo.length>30) undo.shift(); sync(); } catch(_){} }
    function doUndo() { if (!undo.length) return; redo.push(actx.getImageData(0,0,ART,ART)); actx.putImageData(undo.pop(),0,0); render(); sync(); U.haptic(8); }
    function doRedo() { if (!redo.length) return; undo.push(actx.getImageData(0,0,ART,ART)); actx.putImageData(redo.pop(),0,0); render(); sync(); U.haptic(8); }
    function sync() { bUndo.disabled = !undo.length; bRedo.disabled = !redo.length; }

    /* ---- drawing ------------------------------------------------------ */
    function paintDot(p) { actx.fillStyle = st.tool==='eraser'?'#ffffff':st.color; actx.beginPath(); actx.arc(p.x,p.y,st.size/2,0,7); actx.fill(); }
    function paintLine(a,b) {
      actx.strokeStyle = st.tool==='eraser'?'#ffffff':st.color;
      actx.lineWidth = st.size; actx.lineCap='round'; actx.lineJoin='round';
      actx.beginPath(); actx.moveTo(a.x,a.y); actx.lineTo(b.x,b.y); actx.stroke();
    }

    function onDown(e) {
      view.setPointerCapture?.(e.pointerId);
      st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pointers.size === 2) { beginPinch(); st.drawing = false; return; }
      if (st.tool === 'pan') { st.panning = true; st.panLast = { x: e.clientX, y: e.clientY }; return; }
      snapshot();
      st.drawing = true; st.last = toArt(e.clientX, e.clientY); paintDot(st.last); render(); Sound.tap && Sound.tap();
    }
    function onMove(e) {
      if (st.pointers.has(e.pointerId)) st.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (st.pointers.size === 2) { updatePinch(); return; }
      if (st.panning) { st.ox += e.clientX - st.panLast.x; st.oy += e.clientY - st.panLast.y; st.panLast = { x: e.clientX, y: e.clientY }; render(); return; }
      if (!st.drawing) return;
      const p = toArt(e.clientX, e.clientY); paintLine(st.last, p); st.last = p; render();
    }
    function onUp(e) {
      st.pointers.delete(e.pointerId);
      if (st.pointers.size < 2) { st.pinchD = 0; }
      st.drawing = false; st.panning = false;
    }
    view.addEventListener('pointerdown', onDown);
    view.addEventListener('pointermove', onMove);
    addEventListener('pointerup', onUp); addEventListener('pointercancel', onUp);

    /* ---- pinch zoom + two-finger pan ---------------------------------- */
    function beginPinch() {
      const pts = [...st.pointers.values()];
      st.pinchD = dist(pts[0], pts[1]);
      st.pinchC = mid(pts[0], pts[1]);
    }
    function updatePinch() {
      const pts = [...st.pointers.values()]; if (pts.length < 2) return;
      const d = dist(pts[0], pts[1]); const c = mid(pts[0], pts[1]);
      if (st.pinchD) {
        const r = viewport.getBoundingClientRect();
        const factor = d / st.pinchD;
        const ns = U.clamp(st.scale * factor, 0.2, 8);
        // zoom around pinch centre
        const fx = c.x - r.left, fy = c.y - r.top;
        st.ox = fx - (fx - st.ox) * (ns / st.scale);
        st.oy = fy - (fy - st.oy) * (ns / st.scale);
        st.scale = ns;
        // pan with centre movement
        st.ox += c.x - st.pinchC.x; st.oy += c.y - st.pinchC.y;
      }
      st.pinchD = d; st.pinchC = c; render();
    }
    const dist = (a,b) => Math.hypot(a.x-b.x, a.y-b.y);
    const mid  = (a,b) => ({ x:(a.x+b.x)/2, y:(a.y+b.y)/2 });

    function zoomBy(f) {
      const ns = U.clamp(st.scale * f, 0.2, 8);
      const cx = VW/2, cy = VH/2;
      st.ox = cx - (cx - st.ox) * (ns / st.scale);
      st.oy = cy - (cy - st.oy) * (ns / st.scale);
      st.scale = ns; render();
    }
    function resetView() { st._initialised = false; fit(); }

    /* wheel zoom for desktop */
    viewport.addEventListener('wheel', e => { e.preventDefault();
      const r = viewport.getBoundingClientRect(); const f = e.deltaY < 0 ? 1.1 : 0.9;
      const ns = U.clamp(st.scale * f, 0.2, 8); const fx = e.clientX - r.left, fy = e.clientY - r.top;
      st.ox = fx - (fx - st.ox)*(ns/st.scale); st.oy = fy - (fy - st.oy)*(ns/st.scale); st.scale = ns; render();
    }, { passive: false });

    /* ---- toolbar ------------------------------------------------------ */
    const colors = U.el('div', { class: 'pad-colors' },
      PALETTE.map(c => U.el('button', { class:'swatch'+(c===st.color?' on':''), style:{background:c}, type:'button','aria-label':'Colour '+c,
        onclick(){ st.color=c; if(st.tool!=='pencil') setTool('pencil'); U.$$('.swatch',colors).forEach(s=>s.classList.remove('on')); this.classList.add('on'); } })),
      (()=>{ const l=U.el('label',{class:'swatch swatch--custom',title:'Custom'}); const i=U.el('input',{type:'color',value:st.color,onchange(){st.color=this.value; if(st.tool!=='pencil')setTool('pencil'); U.$$('.swatch',colors).forEach(s=>s.classList.remove('on'));}}); l.append(i); return l; })()
    );
    const brushes = U.el('div', { class:'pad-brushes' },
      BRUSHES.map(b => U.el('button',{class:'brushbtn'+(b===st.size?' on':''),type:'button','aria-label':'Brush '+b,
        onclick(){ st.size=b; U.$$('.brushbtn',brushes).forEach(x=>x.classList.remove('on')); this.classList.add('on'); }},
        U.el('span',{class:'brushdot',style:{width:Math.min(22,b)+'px',height:Math.min(22,b)+'px'}}))));

    function setTool(t){ st.tool=t; U.$$('.toolbtn[data-tool]',wrap).forEach(b=>b.classList.toggle('on',b.dataset.tool===t)); viewport.style.cursor = t==='pan'?'grab':'crosshair'; }
    const tBtn=(tool,label,txt)=>U.el('button',{class:'toolbtn'+(tool===st.tool?' on':''),type:'button','data-tool':tool,'aria-label':label,title:label,text:txt,onclick(){setTool(tool);U.haptic(8);}});

    const bUndo=U.el('button',{class:'toolbtn',type:'button','aria-label':'Undo',title:'Undo',text:'↶',onclick:doUndo,disabled:true});
    const bRedo=U.el('button',{class:'toolbtn',type:'button','aria-label':'Redo',title:'Redo',text:'↷',onclick:doRedo,disabled:true});
    const bIn=U.el('button',{class:'toolbtn',type:'button','aria-label':'Zoom in',title:'Zoom in',text:'＋',onclick:()=>zoomBy(1.25)});
    const bOut=U.el('button',{class:'toolbtn',type:'button','aria-label':'Zoom out',title:'Zoom out',text:'－',onclick:()=>zoomBy(0.8)});
    const bFit=U.el('button',{class:'toolbtn',type:'button','aria-label':'Reset view',title:'Fit',text:'⊡',onclick:resetView});

    const tools = U.el('div',{class:'pad-tools'},
      tBtn('pencil','Pencil','✏️'), tBtn('eraser','Eraser','🩹'), tBtn('pan','Pan','✋'),
      bIn, bOut, bFit, bUndo, bRedo);

    wrap.append(viewport, U.el('div',{class:'pad-bar'}, colors, U.el('div',{class:'pad-bar-row'}, brushes, tools)));
    container.append(wrap);

    const ro = new ResizeObserver(() => fit()); ro.observe(viewport);
    requestAnimationFrame(fit);

    /* ---- export ------------------------------------------------------- */
    function exportPNG(px = 512) {
      const out = document.createElement('canvas'); out.width = out.height = px;
      const o = out.getContext('2d'); o.imageSmoothingQuality='high'; o.drawImage(art,0,0,px,px);
      return out.toDataURL('image/png');
    }
    function isBlank() {
      const d = actx.getImageData(0,0,ART,ART).data;
      for (let i=0;i<d.length;i+=4) if (d[i]<250||d[i+1]<250||d[i+2]<250) return false;
      return true;
    }
    function clear(){ actx.fillStyle='#ffffff'; actx.fillRect(0,0,ART,ART); undo.length=0; redo.length=0; sync(); render(); }

    return { exportPNG, isBlank, clear, destroy(){ ro.disconnect(); removeEventListener('pointerup',onUp); removeEventListener('pointercancel',onUp); wrap.remove(); } };
  }

  global.DrawPad = { mount };
})(window);
