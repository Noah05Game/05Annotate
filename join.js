/* ============================================================================
   join.js — the player's phone. Three jobs:
     1. Local setup (code → name → avatar) before any network call.
     2. Connect to the Main Screen (room authority) and play.
     3. If this phone is the host, show the host control panel.
   All game rules live on the authority (main.js); this file is a thin client
   that renders whatever phase the host tells it to.
   ========================================================================== */
(function () {
  'use strict';
  const { $, $$, el, clamp, fmtTime, toast, haptic, Settings } = U;

  /* ---- local state ----------------------------------------------------- */
  const S = {
    code: '', name: '', avatar: '',
    pid: null, token: null, isHost: false,
    settings: { timer: 90, rounds: 3, ratings: true, audience: false },
    started: false,
  };
  let client = null;
  let avatarStudio = null, pad = null;
  let timer = null, deadline = 0, onExpire = null;
  let submitted = false, guessed = false, rated = false;

  const SESS_KEY = '05ann.session';

  /* ---- screens --------------------------------------------------------- */
  const ids = ['scrCode','scrName','scrAvatar','scrConnecting','scrLobby','scrDraw','scrGuess','scrRate','scrWait','scrScoresP','scrEnd'];
  const scr = {}; ids.forEach(i => scr[i] = $('#' + i));
  function show(id) { ids.forEach(i => scr[i].classList.toggle('active', i === id)); }

  /* ===================================================================== *
   *  TIMERS                                                               *
   * ===================================================================== */
  function startTimer(endsAt, label, expire) {
    deadline = endsAt; onExpire = expire || null;
    stopTimer();
    timer = setInterval(() => tick(label), 250); tick(label);
  }
  function stopTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function tick(label) {
    const left = Math.max(0, (deadline - Date.now()) / 1000);
    if (label) {
      label.textContent = fmtTime(left);
      label.classList.toggle('warn', left <= 15 && left > 5);
      label.classList.toggle('crit', left <= 5);
    }
    if (left <= 0) { stopTimer(); const fn = onExpire; onExpire = null; if (fn) fn(); }
  }

  /* ===================================================================== *
   *  SETUP FLOW                                                           *
   * ===================================================================== */
  function initSetup() {
    // prefill code from the QR link (?room=) and remembered profile
    const room = (U.qs('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (room) $('#codeInput').value = room;
    const prof = Store.profile();
    if (prof.name) $('#nameInput').value = prof.name;

    // resume a dropped session automatically
    const sess = readSession();
    if (sess && room && sess.code === room) {
      S.code = sess.code; S.name = sess.name; S.avatar = sess.avatar; S.token = sess.token;
      connect(true);
      return;
    }

    const codeInput = $('#codeInput');
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });
    $('#codeNext').addEventListener('click', () => {
      const v = codeInput.value.trim();
      if (v.length !== 6) { toast('Enter the 6-character code', 'bad'); haptic(20); return; }
      S.code = v; Sound.tap(); show('scrName'); $('#nameInput').focus();
    });
    codeInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('#codeNext').click(); });

    $('#nameBack').addEventListener('click', () => { Sound.tap(); show('scrCode'); });
    $('#nameNext').addEventListener('click', () => {
      const v = $('#nameInput').value.trim();
      if (!v) { toast('Pick a name', 'bad'); haptic(20); return; }
      S.name = v.slice(0, 16); Sound.tap(); openAvatar();
    });
    $('#nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') $('#nameNext').click(); });

    $('#avatarBack').addEventListener('click', () => { Sound.tap(); show('scrName'); });
    $('#avatarConfirm').addEventListener('click', confirmAvatar);

    show('scrCode');
    // focus code if empty, else name
    setTimeout(() => { (room ? $('#nameInput') : codeInput).focus?.(); }, 250);
  }

  function openAvatar() {
    show('scrAvatar');
    if (!avatarStudio) {
      avatarStudio = Avatar.mount($('#avatarMount'), {});
      // seed with a random face so the canvas never looks empty
      avatarStudio.randomize();
    }
  }

  function confirmAvatar() {
    S.avatar = avatarStudio.exportPNG();          // 128px data URL
    Store.setProfile({ name: S.name, avatar: S.avatar });
    Sound.start();
    connect(false);
  }

  /* ===================================================================== *
   *  CONNECTION                                                           *
   * ===================================================================== */
  function setNet(state, text) {
    const pill = $('#netpill');
    pill.hidden = false;
    pill.className = 'netpill' + (state ? ' ' + state : '');
    $('#netpillText').textContent = text;
  }

  function connect(resuming) {
    show('scrConnecting');
    $('#connTitle').textContent = resuming ? 'Reconnecting…' : 'Joining…';
    $('#connNote').textContent = resuming ? 'Picking up where you left off.' : 'Finding room ' + S.code + '.';
    setNet('warn', 'Connecting…');

    client = Net.createClient(S.code, {
      onOpen: () => {
        setNet('', 'Connected');
        client.send({ t: 'join', name: S.name, avatar: S.avatar, token: S.token || undefined });
      },
      onData: handleMessage,
      onKicked: () => { stopTimer(); clearSession(); endScreen('Removed', 'The host removed you from the room.'); },
      onError: err => { console.error(err); },
      onReconnecting: n => setNet('warn', `Reconnecting… (${n})`),
      onReconnectFailed: () => { stopTimer(); setNet('bad', 'Disconnected'); endScreen('Lost connection', 'Couldn’t reach the room. Check your signal and rejoin.'); },
    });
  }

  function endScreen(title, note) {
    $('#endTitle').textContent = title;
    $('#endNote').textContent = note;
    show('scrEnd');
  }
  $('#endRetry').addEventListener('click', () => location.reload());

  /* ---- session persistence (for graceful reconnect) ------------------- */
  function saveSession() {
    try { sessionStorage.setItem(SESS_KEY, JSON.stringify({ code: S.code, pid: S.pid, token: S.token, name: S.name, avatar: S.avatar })); } catch (_) {}
  }
  function readSession() { try { return JSON.parse(sessionStorage.getItem(SESS_KEY) || 'null'); } catch (_) { return null; } }
  function clearSession() { try { sessionStorage.removeItem(SESS_KEY); } catch (_) {} }

  /* ===================================================================== *
   *  INCOMING MESSAGES                                                    *
   * ===================================================================== */
  function handleMessage(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'accepted':   return onAccepted(m);
      case 'rejected':   return endScreen('Couldn’t join', m.reason || 'Room unavailable.');
      case 'lobby':      return onLobby(m);
      case 'settings':   S.settings = m.settings; reflectSettings(); break;
      case 'youHost':    return onYouHost();
      case 'youDraw':    return onYouDraw(m);
      case 'guessTarget':return onGuessTarget(m);
      case 'rateTarget': return onRateTarget(m);
      case 'waitOthers': return onWaitOthers(m);
      case 'phase':      return onPhase(m);
    }
  }

  function onAccepted(m) {
    S.pid = m.pid; S.token = m.token; S.isHost = m.isHost;
    saveSession();
    $('#meAvatar').src = S.avatar;
    $('#meName').textContent = S.name;
    Sound.join();
  }

  function onLobby(m) {
    S.started = m.started;
    S.isHost = (m.host === S.pid);
    if (m.settings) { S.settings = m.settings; reflectSettings(); }
    $('#meRole').textContent = S.isHost ? '👑 You’re the host' : 'You’re in';
    $('#hostPanel').hidden = !S.isHost;
    $('#lobbyHint').style.display = S.isHost ? 'none' : '';

    const list = $('#lobbyList'); list.innerHTML = '';
    m.players.forEach(p => {
      list.append(el('div', { class: `pcard${p.connected ? '' : ' disc'}${p.ready ? ' ready' : ''}` },
        p.host ? el('span', { class: 'mini-crown', text: '👑' }) : null,
        el('img', { src: p.avatar || '', alt: '' }),
        el('span', { text: p.name })));
    });

    // only flip to the lobby if we're not mid-action
    if (!S.started && !scr.scrDraw.classList.contains('active') &&
        !scr.scrGuess.classList.contains('active') && !scr.scrRate.classList.contains('active')) {
      show('scrLobby');
    }
  }

  function onYouHost() {
    S.isHost = true;
    $('#meRole').textContent = '👑 You’re the host';
    $('#hostPanel').hidden = false;
    $('#lobbyHint').style.display = 'none';
    toast('👑 You’re the host now', 'good');
    Sound.reveal();
  }

  /* ---- DRAW ----------------------------------------------------------- */
  function onYouDraw(m) {
    submitted = false;
    $('#myPrompt').textContent = m.prompt;
    show('scrDraw');
    if (pad) { pad.destroy(); pad = null; }
    $('#drawMount').innerHTML = '';
    pad = DrawPad.mount($('#drawMount'));
    haptic(12);
    startTimer(m.endsAt, $('#myDrawTimer'), () => submitDrawing(true));
  }
  function submitDrawing(auto) {
    if (submitted) return;
    submitted = true; stopTimer();
    const dataUrl = pad ? pad.exportPNG(512) : '';
    Store.bump({ drawings: 1 });
    client.send({ t: 'draw', dataUrl });
    if (auto) toast('Time! Submitted your drawing');
    Sound.pop(); haptic(16);
    waitScreen('Submitted', 'Waiting for other artists…');
  }
  $('#submitDraw').addEventListener('click', () => {
    if (pad && pad.isBlank()) { toast('Draw something first ✏️', 'bad'); haptic(20); return; }
    submitDrawing(false);
  });

  /* ---- GUESS ---------------------------------------------------------- */
  function onGuessTarget(m) {
    guessed = false;
    $('#guessFor').querySelector('span').textContent = m.drawerName;
    $('#guessImg').src = m.image || '';
    $('#guessInput').value = '';
    show('scrGuess');
    setTimeout(() => $('#guessInput').focus(), 200);
    haptic(10);
    startTimer(m.endsAt, $('#guessTimer'), () => sendGuess(true));
  }
  function sendGuess(auto) {
    if (guessed) return;
    guessed = true; stopTimer();
    const text = $('#guessInput').value.trim();
    Store.bump({ guesses: 1 });
    client.send({ t: 'guess', text });
    Sound.tap(); haptic(14);
    waitScreen(auto ? 'Locked in' : 'Guess in!', 'Waiting for other detectives…');
  }
  $('#guessSend').addEventListener('click', () => sendGuess(false));
  $('#guessInput').addEventListener('keydown', e => { if (e.key === 'Enter') sendGuess(false); });

  /* ---- RATE ----------------------------------------------------------- */
  function onRateTarget(m) {
    rated = false;
    $('#rateFor').querySelector('span').textContent = m.drawerName;
    $$('.star').forEach(s => s.classList.remove('lit'));
    $('#rateHint').textContent = 'Tap to rate';
    show('scrRate');
    haptic(10);
    startTimer(m.endsAt, null, () => { if (!rated) sendRate(3, true); });
  }
  $$('.star').forEach(star => {
    const v = +star.dataset.v;
    star.addEventListener('pointerenter', () => previewStars(v));
    star.addEventListener('click', () => sendRate(v, false));
  });
  function previewStars(v) { $$('.star').forEach(s => s.classList.toggle('lit', +s.dataset.v <= v)); }
  function sendRate(v, auto) {
    if (rated) return;
    rated = true; stopTimer();
    previewStars(v);
    Store.bump({ ratingsGiven: 1 });
    client.send({ t: 'rate', stars: v });
    Sound.star(); haptic(14);
    setTimeout(() => waitScreen('Rated ' + '★'.repeat(v), 'Waiting for the reveal…'), 260);
  }

  /* ---- WAIT / RESULT -------------------------------------------------- */
  function waitScreen(title, note) {
    $('#waitTitle').textContent = title;
    $('#waitNote').textContent = note;
    $('#resultBadge').hidden = true;
    show('scrWait');
  }
  function onWaitOthers(m) {
    if (scr.scrWait.classList.contains('active')) $('#waitNote').textContent = `Waiting… ${m.done}/${m.total} in`;
  }

  function onPhase(m) {
    switch (m.phase) {
      case 'wait':   waitScreen('Hang tight', m.note || 'Waiting…'); break;
      case 'watch':  waitScreen('On stage', m.note || 'Your drawing is being guessed!'); break;
      case 'result': return onResult(m);
      case 'scores': return onScores(m);
    }
  }

  function onResult(m) {
    show('scrWait');
    $('#waitNote').textContent = `It was “${m.prompt}”`;
    const badge = $('#resultBadge');
    if (m.you && m.you.role === 'guesser') {
      const good = m.you.gain > 0;
      $('#waitTitle').textContent = good ? (m.you.verdict === 'exact' ? 'Spot on!' : 'So close!') : 'Not quite';
      badge.className = 'result-badge ' + (good ? 'good' : 'meh');
      badge.textContent = good ? `+${m.you.gain}` : '+0';
      badge.hidden = false;
      if (good) { Sound.correct(); Store.bump({ exact: m.you.verdict === 'exact' ? 1 : 0 }); }
      else Sound.error();
    } else if (m.you && m.you.role === 'drawer') {
      $('#waitTitle').textContent = m.you.gain ? `Your art scored!` : 'Reveal';
      badge.className = 'result-badge good';
      badge.textContent = `+${m.you.gain} · ${'★'.repeat(m.you.stars || 0)}`;
      badge.hidden = !m.you.gain;
      Store.bump({ starsEarned: m.you.stars || 0 });
      Sound.star();
    } else {
      $('#waitTitle').textContent = 'Reveal';
      badge.hidden = true;
    }
    haptic(12);
  }

  /* ---- SCORES --------------------------------------------------------- */
  function onScores(m) {
    stopTimer();
    show('scrScoresP');
    $('#scoresPTitle').textContent = m.final ? '🏆 Final results' : 'Leaderboard';
    const list = $('#scoresPList'); list.innerHTML = '';
    m.standings.forEach(p => {
      list.append(el('div', { class: `srow${p.pid === S.pid ? ' me' : ''}` },
        el('span', { class: 'srow__pos', text: p.pos }),
        el('img', { src: p.avatar || '', alt: '' }),
        el('span', { class: 'srow__name', text: p.name + (p.pid === S.pid ? ' (you)' : '') }),
        p.delta ? el('span', { class: 'srow__delta', text: `+${p.delta}` }) : null,
        el('span', { class: 'srow__score', text: p.score.toLocaleString() })));
    });

    // record stats + achievements for this device's player
    const me = m.standings.find(p => p.pid === S.pid);
    if (me) {
      Store.setBest(me.score);
      if (m.final) {
        Store.bump({ games: 1, wins: me.pos === 1 ? 1 : 0 });
        Store.pushGame({ score: me.score, pos: me.pos, players: m.standings.length, name: S.name });
        if (me.pos === 1) { Store.unlock('champion'); Confetti.rain(2200); }
        const st = Store.stats();
        if (st.games >= 10) Store.unlock('prolific');
        if (st.exact >= 1) Store.unlock('sharpshoot');
        if (new Date().getHours() >= 1 && new Date().getHours() <= 4) Store.unlock('night_owl');
      }
    }

    // host controls
    $('#scoresPHost').hidden = !(S.isHost && !m.final);
    $('#scoresPAgain').hidden = !(S.isHost && m.final);
    $('#scoresPHint').style.display = S.isHost ? 'none' : '';
    $('#scoresPHint').textContent = m.final ? 'Thanks for playing!' : 'Waiting for the host…';
    if (m.final) Sound.win();
  }

  $('#nextRoundBtn').addEventListener('click', () => { client.send({ t: 'host:next' }); Sound.start(); });
  $('#endGameBtn').addEventListener('click', () => { client.send({ t: 'host:end' }); });
  $('#againBtn').addEventListener('click', () => { client.send({ t: 'host:again' }); });

  /* ===================================================================== *
   *  LOBBY CONTROLS (ready + host panel)                                  *
   * ===================================================================== */
  $('#readyToggle').addEventListener('change', e => {
    client.send({ t: 'ready', value: e.target.checked });
    Sound.tap(); haptic(10);
  });
  $('#startBtn').addEventListener('click', () => { client.send({ t: 'host:start' }); Sound.start(); haptic(18); });

  function bindSeg(segId, key) {
    const seg = $('#' + segId);
    seg.querySelectorAll('.seg__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        seg.querySelectorAll('.seg__btn').forEach(b => b.classList.remove('on'));
        btn.classList.add('on');
        client.send({ t: 'host:setting', key, value: +btn.dataset.v });
        Sound.tap();
      });
    });
  }
  bindSeg('ctlTimer', 'timer');
  bindSeg('ctlRounds', 'rounds');
  $('#ctlRatings').addEventListener('change', e => client.send({ t: 'host:setting', key: 'ratings', value: e.target.checked }));
  $('#ctlAudience').addEventListener('change', e => client.send({ t: 'host:setting', key: 'audience', value: e.target.checked }));

  function reflectSettings() {
    setSeg('ctlTimer', S.settings.timer);
    setSeg('ctlRounds', S.settings.rounds);
    $('#ctlRatings').checked = S.settings.ratings;
    $('#ctlAudience').checked = S.settings.audience;
  }
  function setSeg(segId, val) {
    const seg = $('#' + segId); if (!seg) return;
    seg.querySelectorAll('.seg__btn').forEach(b => b.classList.toggle('on', +b.dataset.v === +val));
  }

  /* ===================================================================== *
   *  BOOT                                                                 *
   * ===================================================================== */
  function boot() {
    if (typeof Peer === 'undefined') {
      endScreen('Offline', 'Couldn’t load PeerJS. Check your connection and refresh.');
      return;
    }
    Settings.apply();
    // audio needs a user gesture to start
    const unlock = () => { Sound.unlock(); removeEventListener('pointerdown', unlock); };
    addEventListener('pointerdown', unlock, { once: true });
    initSetup();
  }
  boot();
})();
