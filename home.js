/* ============================================================================
   home.js — homepage behaviour: settings sheet, stats peek, particles, egg.
   ========================================================================== */
(function () {
  'use strict';
  const { $, $$, el, Settings } = U;

  // host hint
  $('#joinHost').textContent = location.host || 'this site';

  // particles
  U.particles($('#particles'), { count: 40, color: 'rgba(255,255,255,.5)' });

  /* ---- settings sheet -------------------------------------------------- */
  const sheet = $('#settingsSheet'), scrim = $('#settingsScrim');
  function openSheet() { sheet.hidden = false; scrim.hidden = false; syncSettings(); Sound.tap(); }
  function closeSheet() { sheet.classList.add('out'); scrim.style.opacity = '0';
    setTimeout(() => { sheet.hidden = true; scrim.hidden = true; sheet.classList.remove('out'); scrim.style.opacity = ''; }, 220); }
  $('#settingsBtn').addEventListener('click', () => { Sound.unlock(); openSheet(); });
  $('#closeSettings').addEventListener('click', closeSheet);
  scrim.addEventListener('click', closeSheet);

  function syncSettings() {
    const s = Settings.get();
    $('#setSound').checked = s.sound; $('#setMusic').checked = s.music;
    $('#setHaptics').checked = s.haptics; $('#setMotion').checked = s.motion;
    $('#setPerf').checked = s.perf;
    $$('#themeSeg .seg__btn').forEach(b => b.classList.toggle('on', b.dataset.theme === s.theme));
  }
  $('#setSound').addEventListener('change', e => { Settings.set({ sound: e.target.checked }); if (e.target.checked) Sound.pop(); });
  $('#setMusic').addEventListener('change', e => Settings.set({ music: e.target.checked }));
  $('#setHaptics').addEventListener('change', e => { Settings.set({ haptics: e.target.checked }); U.haptic(20); });
  $('#setMotion').addEventListener('change', e => Settings.set({ motion: e.target.checked }));
  $('#setPerf').addEventListener('change', e => Settings.set({ perf: e.target.checked }));
  $$('#themeSeg .seg__btn').forEach(b => b.addEventListener('click', () => {
    Settings.set({ theme: b.dataset.theme }); syncSettings();
    document.querySelector('meta[name=theme-color]').setAttribute('content', b.dataset.theme === 'light' ? '#eef0f7' : '#07070d');
  }));
  $('#resetData').addEventListener('click', () => {
    if (confirm('Reset all local stats, achievements and history?')) { Store.reset(); U.toast('Local data cleared', 'good'); renderStats(); }
  });

  /* ---- stats peek ------------------------------------------------------ */
  function renderStats() {
    const s = Store.stats();
    if (!s.games) { $('#statsPeek').hidden = true; return; }
    $('#statsPeek').hidden = false;
    const cells = [
      ['Games', s.games], ['Wins', s.wins], ['Drawings', s.drawings],
      ['Exact guesses', s.exact], ['Best score', s.bestScore.toLocaleString()],
    ];
    $('#statsGrid').replaceChildren(...cells.map(([l, n]) =>
      el('div', { class: 'stat' }, el('div', { class: 'stat__n', text: String(n) }), el('div', { class: 'stat__l', text: l }))));
    $('#achvRow').replaceChildren(...Store.achievementsList.map(a => {
      const on = Store.isUnlocked(a.id);
      return el('div', { class: 'achv' + (on ? ' on' : ''), title: on || !a.secret ? `${a.name} — ${a.desc}` : '???', text: on || !a.secret ? a.icon : '❔' });
    }));
  }
  renderStats();

  /* ---- easter egg: tap logo 5× OR the footer dot ----------------------- */
  let taps = 0, tapTimer;
  $('#eggBtn').addEventListener('click', triggerEgg);
  $('.home__logo').addEventListener('click', e => {
    taps++; clearTimeout(tapTimer); tapTimer = setTimeout(() => taps = 0, 800);
    if (taps >= 5) { e.preventDefault(); taps = 0; triggerEgg(); }
  });
  function triggerEgg() {
    Sound.win(); Confetti.sides(); Confetti.rain(2200);
    Store.unlock('secret');
    document.documentElement.animate(
      [{ filter: 'hue-rotate(0deg)' }, { filter: 'hue-rotate(360deg)' }],
      { duration: 1600, easing: 'ease-in-out' });
    U.toast('🥚 You found the 05 spirit. Now go draw something ridiculous.', 'good', 4000);
  }

  // unlock audio on first interaction
  addEventListener('pointerdown', () => Sound.unlock(), { once: true });
})();
