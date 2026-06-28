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

    /* ambient generative lo-fi bed — toggled by the host main screen */
    musicToggle(on) {
      musicOn = on ?? !musicOn;
      const c = ac();
      if (musicOn) {
        buildMusicBus(c);
        musicGain.gain.cancelScheduledValues(c.currentTime);
        musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), c.currentTime);
        musicGain.gain.linearRampToValueAtTime(0.7, c.currentTime + 2.2);  // gentle fade-in
        if (!musicTimer) scheduleMusic();
      } else {
        musicGain.gain.cancelScheduledValues(c.currentTime);
        musicGain.gain.setValueAtTime(musicGain.gain.value, c.currentTime);
        musicGain.gain.linearRampToValueAtTime(0.0001, c.currentTime + 1.3); // fade-out
        clearInterval(musicTimer); musicTimer = null;
      }
      return musicOn;
    },
  };

  /* ==========================================================================
     MUSIC ENGINE — a warm, loopable lo-fi bed:
       • detuned 3-osc pad on a ii–V–I-ish progression (Cmaj7 Am7 Dm7 G7)
       • soft sine bass, half notes
       • sparse bell arpeggio (chord tones, 2 octaves up) into a dreamy delay
     Everything is scheduled ahead of time against the AudioContext clock via a
     lookahead loop, so timing stays tight even if the tab throttles timers.
     ======================================================================== */
  const BPM = 72, BEAT = 60 / BPM, BAR = BEAT * 4;
  const PROG = [
    { pad: [48, 52, 55, 59], bass: 36 },   // Cmaj7
    { pad: [45, 48, 52, 55], bass: 33 },   // Am7
    { pad: [50, 53, 57, 60], bass: 38 },   // Dm7
    { pad: [43, 47, 50, 53], bass: 31 },   // G7
  ];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  let mBus = null, mFilter = null, mDelay = null, mBar = 0, mNextBar = 0;

  function buildMusicBus(c) {
    if (mBus) return;
    // soft compressor to glue the layers and stop transient peaks clipping
    mBus = c.createDynamicsCompressor();
    mBus.threshold.value = -20; mBus.knee.value = 26; mBus.ratio.value = 3;
    mBus.attack.value = 0.01; mBus.release.value = 0.3;
    mBus.connect(musicGain);

    // warm lowpass with a very slow sweep for movement
    mFilter = c.createBiquadFilter();
    mFilter.type = 'lowpass'; mFilter.frequency.value = 1500; mFilter.Q.value = 0.7;
    const lfo = c.createOscillator(), lfoGain = c.createGain();
    lfo.frequency.value = 0.05; lfoGain.gain.value = 600;
    lfo.connect(lfoGain); lfoGain.connect(mFilter.frequency); lfo.start();
    mFilter.connect(mBus);

    // dreamy feedback delay for the bells
    mDelay = c.createDelay(2.0); mDelay.delayTime.value = BEAT * 0.75;
    const fb = c.createGain(); fb.gain.value = 0.34;
    const wet = c.createGain(); wet.gain.value = 0.3;
    mDelay.connect(fb); fb.connect(mDelay);
    mDelay.connect(wet); wet.connect(mBus);
  }

  function padVoice(c, t, freq, dur) {
    [[0, 'triangle', 0.05], [-7, 'sine', 0.04], [7, 'sine', 0.04]].forEach(([cents, type, vol]) => {
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.value = freq; o.detune.value = cents;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.9);          // slow swell
      g.gain.setValueAtTime(vol, t + dur - 1.1);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);        // long release
      o.connect(g); g.connect(mFilter); o.start(t); o.stop(t + dur + 0.05);
    });
  }
  function bassVoice(c, t, freq, dur) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = freq;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.34, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.16, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(mFilter); o.start(t); o.stop(t + dur + 0.05);
  }
  function bellVoice(c, t, freq) {
    const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o2.type = 'sine';
    o.frequency.value = freq; o2.frequency.value = freq * 2; o2.detune.value = 5;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.15);
    o.connect(g); o2.connect(g);
    g.connect(mFilter); g.connect(mDelay);                        // dry + echo
    o.start(t); o2.start(t); o.stop(t + 1.25); o2.stop(t + 1.25);
  }

  function scheduleMusic() {
    const c = ac();
    buildMusicBus(c);
    mBar = 0; mNextBar = c.currentTime + 0.15;
    musicTimer = setInterval(() => {
      if (!musicOn) return;
      const now = c.currentTime;
      while (mNextBar < now + 0.6) {                 // schedule ~0.6s ahead
        const chord = PROG[mBar % PROG.length];
        const t0 = mNextBar;
        chord.pad.forEach(m => padVoice(c, t0, mtof(m), BAR + 0.4));
        bassVoice(c, t0, mtof(chord.bass), BEAT * 2);
        bassVoice(c, t0 + BEAT * 2, mtof(chord.bass), BEAT * 2);
        const pool = chord.pad.map(m => m + 24).concat(chord.pad.slice(1).map(m => m + 12));
        for (let s = 0; s < 8; s++) {
          if (Math.random() < 0.4) {
            const m = pool[(Math.random() * pool.length) | 0];
            bellVoice(c, t0 + s * (BEAT / 2) + Math.random() * 0.02, mtof(m));
          }
        }
        mBar++; mNextBar += BAR;
      }
    }, 60);
  }

  global.Sound = Sound;
})(window);
