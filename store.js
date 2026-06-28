/* ============================================================================
   store.js — localStorage-backed stats, round history, achievements & packs.
   Pure client-side; survives reloads. Exposes global `Store`.
   ========================================================================== */
(function (global) {
  'use strict';

  const KEY = '05ann.data.v1';
  const ACHIEVEMENTS = [
    { id: 'first_game',  name: 'First Brush',     desc: 'Finish your first game',          icon: '🎨' },
    { id: 'sharpshoot',  name: 'Sharpshooter',    desc: 'Land an exact guess',             icon: '🎯' },
    { id: 'critic',      name: 'The Critic',      desc: 'Rate 25 drawings',                icon: '⭐' },
    { id: 'maestro',     name: 'Maestro',         desc: 'Earn 5 stars on a drawing',       icon: '👑' },
    { id: 'prolific',    name: 'Prolific',        desc: 'Submit 50 drawings',              icon: '🖌️' },
    { id: 'comedian',    name: 'Comedian',        desc: 'Get the funniest wrong guess',    icon: '🤡' },
    { id: 'champion',    name: 'Champion',        desc: 'Win a game',                      icon: '🏆' },
    { id: 'night_owl',   name: 'Night Owl',       desc: 'Play after midnight',             icon: '🦉' },
    { id: 'secret',      name: '???',             desc: 'Find the hidden thing',           icon: '🥚', secret: true },
  ];

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (_) { return {}; }
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (_) {} }

  const Store = {
    achievementsList: ACHIEVEMENTS,

    data() {
      const d = load();
      d.stats   = d.stats   || { games: 0, wins: 0, drawings: 0, guesses: 0, exact: 0, ratingsGiven: 0, bestScore: 0, starsEarned: 0 };
      d.history = d.history || [];          // recent games
      d.unlocked = d.unlocked || {};        // achievement id -> ts
      d.packs   = d.packs   || [];          // custom prompt packs
      d.profile = d.profile || {};          // last used name/avatar
      return d;
    },

    stats() { return this.data().stats; },

    bump(patch) {
      const d = this.data();
      for (const [k, v] of Object.entries(patch)) d.stats[k] = (d.stats[k] || 0) + v;
      save(d); return d.stats;
    },

    setBest(score) {
      const d = this.data();
      if (score > d.stats.bestScore) { d.stats.bestScore = score; save(d); }
    },

    /* ---- achievements ------------------------------------------------- */
    unlock(id) {
      const d = this.data();
      if (d.unlocked[id]) return false;
      d.unlocked[id] = Date.now(); save(d);
      const meta = ACHIEVEMENTS.find(a => a.id === id);
      if (meta && global.U) U.toast(`${meta.icon}  ${meta.name} unlocked`, 'good', 3200);
      return true;
    },
    isUnlocked(id) { return !!this.data().unlocked[id]; },

    /* ---- history ------------------------------------------------------ */
    pushGame(entry) {
      const d = this.data();
      d.history.unshift({ ...entry, ts: Date.now() });
      d.history = d.history.slice(0, 25);
      save(d);
    },
    history() { return this.data().history; },

    /* ---- profile (remember name + avatar) ----------------------------- */
    profile() { return this.data().profile; },
    setProfile(p) { const d = this.data(); d.profile = { ...d.profile, ...p }; save(d); },

    /* ---- custom prompt packs ------------------------------------------ */
    packs() { return this.data().packs; },
    addPack(name, prompts) {
      const d = this.data();
      d.packs.push({ id: U.uid(8), name, prompts, ts: Date.now() });
      save(d);
    },
    removePack(id) { const d = this.data(); d.packs = d.packs.filter(p => p.id !== id); save(d); },

    reset() { save({}); },
  };

  global.Store = Store;
})(window);
