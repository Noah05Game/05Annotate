/* ============================================================================
   audio.js — synthesized SFX + ambient music. No audio files needed, so the
   whole site stays static & offline-friendly. Exposes global `Sound`.
   ========================================================================== */
(function (global) {
  'use strict';

  let ctx, master, musicGain, musicTimer, musicOn = false;

  function ac() {
    if (!ctx) {
      ctx = new (global.AudioContext || global.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0.0; musicGain.connect(master);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  const enabled = () => U.Settings.get().sound !== false;

  /* one-shot synth tone */
  function tone({ freq = 440, dur = 0.12, type = 'sine', vol = 0.5, slideTo = null, delay = 0 }) {
    if (!enabled()) return;
    const c = ac(); const t0 = c.currentTime + delay;
    const o = c.createOscillator(); const g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
  }

  const Sound = {
    unlock() { try { ac(); } catch (_) {} },

    tap()     { tone({ freq: 520, dur: 0.05, type: 'triangle', vol: 0.25 }); },
    pop()     { tone({ freq: 660, dur: 0.09, type: 'sine', vol: 0.4, slideTo: 880 }); },
    join()    { tone({ freq: 523, dur: 0.1, type: 'sine', vol: 0.4 }); tone({ freq: 784, dur: 0.12, type: 'sine', vol: 0.35, delay: 0.08 }); },
    leave()   { tone({ freq: 392, dur: 0.12, type: 'sine', vol: 0.35, slideTo: 196 }); },
    start()   { [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.4, delay: i * 0.08 })); },
    tick()    { tone({ freq: 880, dur: 0.03, type: 'square', vol: 0.12 }); },
    warn()    { tone({ freq: 330, dur: 0.18, type: 'sawtooth', vol: 0.3 }); },
    reveal()  { tone({ freq: 392, dur: 0.5, type: 'sine', vol: 0.4, slideTo: 784 }); },
    correct() { [659, 988, 1319].forEach((f, i) => tone({ freq: f, dur: 0.18, type: 'sine', vol: 0.45, delay: i * 0.07 })); },
    star()    { tone({ freq: 1175, dur: 0.1, type: 'triangle', vol: 0.3, slideTo: 1568 }); },
    win()     { [523, 659, 784, 1047, 1319].forEach((f, i) => tone({ freq: f, dur: 0.25, type: 'triangle', vol: 0.45, delay: i * 0.11 })); },
    error()   { tone({ freq: 220, dur: 0.2, type: 'sawtooth', vol: 0.3, slideTo: 160 }); },

    /* ambient generative pad — toggled by host main screen */
    musicToggle(on) {
      musicOn = on ?? !musicOn;
      const c = ac();
      if (musicOn) {
        musicGain.gain.cancelScheduledValues(c.currentTime);
        musicGain.gain.linearRampToValueAtTime(0.12, c.currentTime + 1.5);
        if (!musicTimer) scheduleMusic();
      } else {
        musicGain.gain.linearRampToValueAtTime(0.0, c.currentTime + 1.0);
        clearInterval(musicTimer); musicTimer = null;
      }
      return musicOn;
    },
  };

  /* gentle arpeggio over a slow chord — non-intrusive */
  const SCALE = [261.63, 329.63, 392.0, 523.25, 659.25, 783.99];
  function scheduleMusic() {
    let i = 0;
    musicTimer = setInterval(() => {
      if (!musicOn) return;
      const c = ac();
      const f = SCALE[i % SCALE.length] / (i % 12 < 6 ? 1 : 2);
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.5, c.currentTime + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + 2.2);
      o.connect(g); g.connect(musicGain); o.start(); o.stop(c.currentTime + 2.4);
      i++;
    }, 900);
  }

  global.Sound = Sound;
})(window);
