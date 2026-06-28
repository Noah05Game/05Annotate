/* ============================================================================
   main.js — the Main Screen. This device is the ROOM AUTHORITY: it creates the
   PeerJS room, runs the entire Classic game loop, validates host commands and
   renders the big "stage" display. Players connect from their phones (join.js).

   Only "Classic" mode is implemented end-to-end (per brief). The protocol is a
   small set of JSON messages described in the README.
   ========================================================================== */
(function () {
  'use strict';
  const { $, el, clamp, fmtTime, escapeHtml, shuffle, tweenNumber, toast, Settings } = U;

  /* ---- tunables -------------------------------------------------------- */
  const MAX_PLAYERS   = 12;
  const GUESS_SECONDS = 45;
  const RATE_SECONDS  = 18;
  const REVEAL_HOLD   = 5500;   // ms a finished reveal lingers before advancing
  const TICK_MS       = 250;

  /* ---- game state ------------------------------------------------------ */
  const G = {
    phase: 'lobby',                 // lobby | draw | reveal | scores | ended
    sub: null,                      // during reveal: guess | rate | show
    settings: { timer: 90, rounds: 3, ratings: true, audience: false },
    round: 0,
    players: new Map(),             // pid -> player
    order: [],                      // stable join order of pids
    conn2pid: new Map(),            // transport connId -> pid
    prompts: new Map(),             // pid -> {text,cat}
    drawings: new Map(),            // pid -> dataUrl
    queue: [],                      // pids being revealed this round
    qi: -1,
    guesses: new Map(),             // drawerPid -> Map(guesserPid -> {text,verdict,score})
    ratings: new Map(),             // drawerPid -> Map(raterPid -> stars)
    deadline: 0,
    started: false,
  };

  let host = null;                  // Net host handle
  let roomCode = '';
  let ticker = null;

  /* ---- screen switching ----------------------------------------------- */
  const screens = {};
  ['scrConnecting','scrLobby','scrDraw','scrReveal','scrScores'].forEach(id => screens[id] = $('#' + id));
  function show(id) {
    for (const [k, n] of Object.entries(screens)) n.classList.toggle('active', k === id);
  }
  function setPhaseChip(txt) { $('#phaseChip').textContent = txt; }

  /* ===================================================================== *
   *  PLAYER / LOBBY HELPERS                                                *
   * ===================================================================== */
  function connectedPlayers() { return G.order.map(p => G.players.get(p)).filter(p => p && p.connected); }
  function hostPid() { for (const p of G.players.values()) if (p.host) return p.pid; return null; }

  function ensureHost() {
    if (hostPid()) return;
    const next = connectedPlayers()[0];
    if (next) { next.host = true; host.sendTo(next.connId, { t: 'youHost' }); }
  }

  function lobbyPayload() {
    return {
      t: 'lobby',
      players: G.order.map(p => {
        const pl = G.players.get(p);
        return { pid: pl.pid, name: pl.name, avatar: pl.avatar, host: pl.host, ready: pl.ready, connected: pl.connected };
      }),
      host: hostPid(),
      settings: G.settings,
      started: G.started,
    };
  }
  function broadcastLobby() { host.broadcast(lobbyPayload()); renderLobby(); }

  /* ===================================================================== *
   *  INCOMING PLAYER MESSAGES                                              *
   * ===================================================================== */
  function onPlayerData(connId, msg) {
    if (!msg || typeof msg !== 'object') return;
    const pid = G.conn2pid.get(connId);

    switch (msg.t) {
      case 'join': return handleJoin(connId, msg);
      case 'ready': {
        const p = G.players.get(pid); if (!p) return;
        p.ready = !!msg.value; broadcastLobby(); break;
      }
      case 'draw':       return handleDraw(pid, msg);
      case 'guess':      return handleGuess(pid, msg);
      case 'rate':       return handleRate(pid, msg);
      /* ---- host-only commands (validated) ---- */
      case 'host:start':   if (pid === hostPid()) startGame(); break;
      case 'host:next':    if (pid === hostPid()) hostNext(); break;
      case 'host:end':     if (pid === hostPid()) endGame(); break;
      case 'host:again':   if (pid === hostPid()) backToLobby(); break;
      case 'host:kick':    if (pid === hostPid()) kickPlayer(msg.pid); break;
      case 'host:setting': if (pid === hostPid()) changeSetting(msg.key, msg.value); break;
    }
  }

  function handleJoin(connId, msg) {
    // reconnect by token → restore the same player slot
    if (msg.token) {
      for (const p of G.players.values()) {
        if (p.token === msg.token) {
          G.conn2pid.set(connId, p.pid);
          p.connId = connId; p.connected = true;
          if (msg.name) p.name = msg.name;
          if (msg.avatar) p.avatar = msg.avatar;
          host.sendTo(connId, { t: 'accepted', pid: p.pid, token: p.token, isHost: p.host });
          host.sendTo(connId, lobbyPayload());
          resyncPlayer(p);
          broadcastLobby();
          return;
        }
      }
    }
    // fresh join
    if (connectedPlayers().length >= MAX_PLAYERS) {
      host.sendTo(connId, { t: 'rejected', reason: 'Room is full (12 players max).' });
      return;
    }
    const pid = U.uid(6);
    const token = U.uid(12);
    const isHost = connectedPlayers().length === 0 && !hostPid();
    const player = {
      pid, connId, token,
      name: (msg.name || 'Player').slice(0, 16),
      avatar: msg.avatar || '',
      score: 0, lastDelta: 0,
      ready: false, connected: true, host: isHost,
    };
    G.players.set(pid, player);
    G.order.push(pid);
    G.conn2pid.set(connId, pid);
    Sound.join();
    host.sendTo(connId, { t: 'accepted', pid, token, isHost });
    host.sendTo(connId, lobbyPayload());
    if (G.started) host.sendTo(connId, { t: 'phase', phase: 'wait', note: 'Game in progress — you’re in next round.' });
    broadcastLobby();
  }

  // when a reconnect lands mid-phase, tell them what to do right now
  function resyncPlayer(p) {
    if (!G.started) return;
    if (G.phase === 'draw' && !G.drawings.has(p.pid) && G.prompts.has(p.pid)) {
      host.sendTo(p.connId, { t: 'youDraw', prompt: G.prompts.get(p.pid).text, endsAt: G.deadline });
    } else if (G.phase === 'reveal') {
      sendCurrentTarget(p);
    } else {
      host.sendTo(p.connId, { t: 'phase', phase: 'wait', note: 'Hang tight…' });
    }
  }

  function kickPlayer(pid) {
    const p = G.players.get(pid); if (!p) return;
    if (p.connId) host.kick(p.connId);
    removePlayer(pid, true);
  }

  function removePlayer(pid, hard) {
    const p = G.players.get(pid); if (!p) return;
    const wasHost = p.host;
    if (hard) {
      G.players.delete(pid);
      G.order = G.order.filter(x => x !== pid);
    } else {
      p.connected = false;
    }
    if (wasHost) { if (p) p.host = false; ensureHost(); }
    Sound.leave();
    broadcastLobby();
    // don't let the game hang waiting on someone who left
    if (G.started) maybeAdvance();
  }

  function changeSetting(key, value) {
    if (!(key in G.settings)) return;
    if (key === 'timer') value = clamp(+value | 0, 15, 300);
    else if (key === 'rounds') value = clamp(+value | 0, 1, 10);
    else value = !!value;
    G.settings[key] = value;
    host.broadcast({ t: 'settings', settings: G.settings });
    renderLobby();
  }

  /* ===================================================================== *
   *  GAME LOOP — DRAW PHASE                                                *
   * ===================================================================== */
  function startGame() {
    if (connectedPlayers().length < 2) { toast('Need at least 2 players', 'bad'); return; }
    G.started = true;
    G.round = 0;
    for (const p of G.players.values()) { p.score = 0; p.lastDelta = 0; }
    Sound.start();
    nextRound();
  }

  function nextRound() {
    G.round++;
    G.phase = 'draw';
    G.sub = null;
    G.prompts.clear(); G.drawings.clear();
    G.guesses.clear(); G.ratings.clear();
    G.queue = []; G.qi = -1;

    const roster = connectedPlayers();
    const deck = Prompts.deal(roster.length, Store.packs());
    roster.forEach((p, i) => G.prompts.set(p.pid, deck[i] || Prompts.random()));

    G.deadline = Date.now() + G.settings.timer * 1000;
    roster.forEach(p => host.sendTo(p.connId, { t: 'youDraw', prompt: G.prompts.get(p.pid).text, endsAt: G.deadline }));

    $('#drawRound').textContent = `Round ${G.round}`;
    $('#drawTotal').textContent = roster.length;
    $('#drawDone').textContent = 0;
    renderDrawAvatars();
    setPhaseChip(`Round ${G.round} · Drawing`);
    show('scrDraw');
    $('#roomTag').hidden = false;
    startTicker();
  }

  function handleDraw(pid, msg) {
    if (G.phase !== 'draw' || !msg.dataUrl) return;
    if (!G.prompts.has(pid)) return;          // not part of this round
    G.drawings.set(pid, msg.dataUrl);
    const p = G.players.get(pid);
    if (p) host.sendTo(p.connId, { t: 'waitOthers', done: G.drawings.size, total: G.prompts.size });
    renderDrawAvatars();
    $('#drawDone').textContent = G.drawings.size;
    Sound.pop();
    maybeAdvance();
  }

  /* ===================================================================== *
   *  GAME LOOP — REVEAL (guess → rate → show)                             *
   * ===================================================================== */
  function beginReveal() {
    stopTicker();
    // only drawings that actually arrived, in join order
    G.queue = G.order.filter(pid => G.drawings.has(pid));
    if (!G.queue.length) { showLeaderboard(); return; }
    G.qi = -1;
    advanceReveal();
  }

  function advanceReveal() {
    G.qi++;
    if (G.qi >= G.queue.length) { showLeaderboard(); return; }
    const drawer = G.players.get(G.queue[G.qi]);
    G.guesses.set(drawer.pid, new Map());
    G.ratings.set(drawer.pid, new Map());
    G.sub = 'guess';
    G.phase = 'reveal';

    // paint the stage
    $('#revealImg').src = G.drawings.get(drawer.pid);
    $('#revealImg').style.animation = 'none'; void $('#revealImg').offsetWidth;
    $('#revealImg').style.animation = '';
    $('#revealAvatar').src = drawer.avatar || '';
    $('#revealName').textContent = drawer.name;
    $('#revealAnswer').hidden = true;
    $('#revealGuesses').innerHTML = '';
    $('#revealStatus').textContent = 'Guess the prompt';
    $('#revealTimerWrap').style.display = '';
    setPhaseChip(`Round ${G.round} · Guessing`);
    show('scrReveal');
    Sound.reveal();

    G.deadline = Date.now() + GUESS_SECONDS * 1000;
    // ask every connected non-drawer to guess; drawer just watches
    for (const p of connectedPlayers()) {
      if (p.pid === drawer.pid) host.sendTo(p.connId, { t: 'phase', phase: 'watch', note: 'Your masterpiece is up!' });
      else host.sendTo(p.connId, { t: 'guessTarget', drawer: drawer.pid, drawerName: drawer.name, image: G.drawings.get(drawer.pid), endsAt: G.deadline });
    }
    startTicker();
  }

  function handleGuess(pid, msg) {
    if (G.phase !== 'reveal' || G.sub !== 'guess') return;
    const drawer = G.players.get(G.queue[G.qi]); if (!drawer || pid === drawer.pid) return;
    const map = G.guesses.get(drawer.pid);
    if (map.has(pid)) return;                                   // one guess each
    const text = String(msg.text || '').slice(0, 60);
    const res = Match.score(text, G.prompts.get(drawer.pid).text);
    map.set(pid, { text, verdict: res.verdict, score: res.score });
    const p = G.players.get(pid);
    if (p) host.sendTo(p.connId, { t: 'waitOthers', done: map.size, total: nonDrawerCount(drawer.pid) });
    $('#revealStatus').textContent = `Guessing · ${map.size}/${nonDrawerCount(drawer.pid)}`;
    Sound.tap();
    maybeAdvance();
  }

  function beginRating() {
    const drawer = G.players.get(G.queue[G.qi]);
    if (!G.settings.ratings) { revealAnswer(); return; }
    G.sub = 'rate';
    G.deadline = Date.now() + RATE_SECONDS * 1000;
    $('#revealStatus').textContent = 'Rate the drawing ★';
    setPhaseChip(`Round ${G.round} · Rating`);
    for (const p of connectedPlayers()) {
      if (p.pid === drawer.pid) continue;
      host.sendTo(p.connId, { t: 'rateTarget', drawer: drawer.pid, drawerName: drawer.name, endsAt: G.deadline });
    }
    startTicker();
  }

  function handleRate(pid, msg) {
    if (G.phase !== 'reveal' || G.sub !== 'rate') return;
    const drawer = G.players.get(G.queue[G.qi]); if (!drawer || pid === drawer.pid) return;
    const map = G.ratings.get(drawer.pid);
    if (map.has(pid)) return;
    map.set(pid, clamp(+msg.stars | 0, 1, 5));
    Sound.star();
    $('#revealStatus').textContent = `Rating · ${map.size}/${nonDrawerCount(drawer.pid)}`;
    maybeAdvance();
  }

  function revealAnswer() {
    stopTicker();
    G.sub = 'show';
    const drawer = G.players.get(G.queue[G.qi]);
    const prompt = G.prompts.get(drawer.pid).text;
    const gmap = G.guesses.get(drawer.pid);
    const rmap = G.ratings.get(drawer.pid);

    // ---- scoring ----
    let drawerGain = 0;
    if (G.settings.ratings && rmap.size) {
      const avg = [...rmap.values()].reduce((a, b) => a + b, 0) / rmap.size;
      drawerGain = Math.round(avg) * 100;                       // +100 per star (avg)
    }
    drawer.score += drawerGain; drawer.lastDelta = drawerGain;

    const guessResults = [];
    for (const [gpid, g] of gmap) {
      const gain = Match.points(g.verdict);
      const gp = G.players.get(gpid);
      if (gp) { gp.score += gain; gp.lastDelta = gain; }
      guessResults.push({ pid: gpid, name: gp ? gp.name : '?', avatar: gp ? gp.avatar : '', text: g.text, verdict: g.verdict, gain });
    }

    // ---- stage: show the answer + stars + guesses ----
    const avg = (G.settings.ratings && rmap.size) ? [...rmap.values()].reduce((a, b) => a + b, 0) / rmap.size : 0;
    $('#revealPrompt').textContent = prompt;
    $('#revealStars').innerHTML = starString(Math.round(avg));
    $('#revealAnswer').hidden = false;
    $('#revealTimerWrap').style.display = 'none';
    $('#revealStatus').textContent = 'Reveal';

    // best (exact/close) first, then a couple of funny wrong ones
    const ranked = [...guessResults].sort((a, b) =>
      (verdictRank(b.verdict) - verdictRank(a.verdict)) || (b.gain - a.gain));
    const box = $('#revealGuesses'); box.innerHTML = '';
    ranked.slice(0, 6).forEach((g, i) => {
      const row = el('div', { class: `guess-row ${g.verdict}`, style: { animationDelay: (i * 70) + 'ms' } },
        el('img', { src: g.avatar || '', alt: '' }),
        el('span', { class: 'guess-row__text', text: g.text || '—' }),
        el('span', { class: 'guess-row__tag',
          text: g.verdict === 'exact' ? `+${g.gain}` : g.verdict === 'close' ? `+${g.gain}` : 'nope' }));
      box.append(row);
    });
    Sound.correct();

    // tell each player their personal result for this drawing
    for (const p of connectedPlayers()) {
      const mine = guessResults.find(g => g.pid === p.pid);
      host.sendTo(p.connId, {
        t: 'phase', phase: 'result',
        prompt, drawerName: drawer.name,
        you: p.pid === drawer.pid
          ? { role: 'drawer', gain: drawerGain, stars: Math.round(avg) }
          : mine ? { role: 'guesser', gain: mine.gain, verdict: mine.verdict } : null,
      });
    }

    setTimeout(advanceReveal, REVEAL_HOLD);
  }

  /* ===================================================================== *
   *  GAME LOOP — LEADERBOARD                                               *
   * ===================================================================== */
  function showLeaderboard() {
    stopTicker();
    G.phase = 'scores';
    const ranked = [...G.players.values()].filter(p => G.order.includes(p.pid))
      .sort((a, b) => b.score - a.score);

    $('#scoresTitle').textContent = G.round >= G.settings.rounds ? 'Final Leaderboard' : `Round ${G.round} Leaderboard`;
    renderPodium(ranked);
    renderRankings(ranked);
    $('#scoresHint').textContent = G.round >= G.settings.rounds
      ? 'Host can play again or end the game.'
      : 'Host: start the next round when ready.';
    setPhaseChip('Leaderboard');
    show('scrScores');
    Confetti.sides(); Sound.win();

    // host phone gets the right buttons; everyone sees standings
    host.broadcast({
      t: 'phase', phase: 'scores',
      final: false,
      standings: ranked.map((p, i) => ({ pos: i + 1, name: p.name, avatar: p.avatar, score: p.score, delta: p.lastDelta, pid: p.pid })),
      lastRound: G.round, totalRounds: G.settings.rounds,
    });
  }

  function hostNext() {
    if (G.phase !== 'scores') return;
    nextRound();
  }

  function endGame() {
    stopTicker();
    G.phase = 'ended';
    G.started = false;
    const ranked = [...G.players.values()].filter(p => G.order.includes(p.pid))
      .sort((a, b) => b.score - a.score);

    $('#scoresTitle').textContent = '🏆 Champion';
    renderPodium(ranked);
    renderRankings(ranked);
    $('#scoresHint').textContent = 'Host can play again from their phone.';
    setPhaseChip('Game over');
    show('scrScores');
    Confetti.rain(2600); Confetti.sides(); Sound.win();

    const winner = ranked[0];
    host.broadcast({
      t: 'phase', phase: 'scores', final: true,
      winner: winner ? winner.pid : null,
      standings: ranked.map((p, i) => ({ pos: i + 1, name: p.name, avatar: p.avatar, score: p.score, delta: p.lastDelta, pid: p.pid })),
    });
  }

  function backToLobby() {
    stopTicker();
    G.started = false; G.phase = 'lobby'; G.round = 0;
    for (const p of G.players.values()) { p.score = 0; p.lastDelta = 0; p.ready = false; }
    setPhaseChip('Lobby');
    show('scrLobby');
    broadcastLobby();
  }

  /* ===================================================================== *
   *  ADVANCE GATE + TICKER                                                 *
   * ===================================================================== */
  function nonDrawerCount(drawerPid) {
    return connectedPlayers().filter(p => p.pid !== drawerPid).length;
  }
  function maybeAdvance() {
    if (G.phase === 'draw') {
      const need = connectedPlayers().filter(p => G.prompts.has(p.pid));
      if (need.every(p => G.drawings.has(p.pid)) && need.length) beginReveal();
    } else if (G.phase === 'reveal' && G.sub === 'guess') {
      const drawer = G.players.get(G.queue[G.qi]);
      if (drawer && G.guesses.get(drawer.pid).size >= nonDrawerCount(drawer.pid)) beginRating();
    } else if (G.phase === 'reveal' && G.sub === 'rate') {
      const drawer = G.players.get(G.queue[G.qi]);
      if (drawer && G.ratings.get(drawer.pid).size >= nonDrawerCount(drawer.pid)) revealAnswer();
    }
  }

  function startTicker() { stopTicker(); ticker = setInterval(onTick, TICK_MS); onTick(); }
  function stopTicker() { if (ticker) { clearInterval(ticker); ticker = null; } }

  let lastTickSec = -1;
  function onTick() {
    const left = Math.max(0, (G.deadline - Date.now()) / 1000);

    if (G.phase === 'draw') {
      const total = G.settings.timer;
      updateRing($('#drawTimer'), left, total);
      $('#drawTimerLabel').textContent = fmtTime(left);
      const sec = Math.ceil(left);
      if (left <= 0) beginReveal();
      else if (sec <= 5 && sec !== lastTickSec) { lastTickSec = sec; Sound.tick(); }
    } else if (G.phase === 'reveal' && (G.sub === 'guess' || G.sub === 'rate')) {
      const total = G.sub === 'guess' ? GUESS_SECONDS : RATE_SECONDS;
      const bar = $('#revealTimerBar');
      bar.style.transform = `scaleX(${clamp(left / total, 0, 1)})`;
      if (left <= 0) { if (G.sub === 'guess') beginRating(); else revealAnswer(); }
    }
  }

  function updateRing(ring, left, total) {
    const c = 2 * Math.PI * 54;
    const fg = ring.querySelector('.tr-fg');
    fg.style.strokeDasharray = c;
    fg.style.strokeDashoffset = c * (1 - clamp(left / total, 0, 1));
    ring.classList.toggle('warn', left <= total * 0.34 && left > 5);
    ring.classList.toggle('crit', left <= 5);
  }

  /* ===================================================================== *
   *  RENDERERS                                                            *
   * ===================================================================== */
  function renderLobby() {
    const players = G.order.map(p => G.players.get(p)).filter(Boolean);
    $('#pcount').textContent = `${players.filter(p => p.connected).length}/${MAX_PLAYERS}`;
    $('#lobbyEmpty').style.display = players.length ? 'none' : '';
    const roster = $('#roster');
    roster.innerHTML = '';
    players.forEach((p, i) => {
      const kickBtn = el('button', {
        class: 'player-card__kick', title: `Remove ${p.name}`, 'aria-label': `Remove ${p.name}`,
        text: '✕',
        onclick: e => { e.stopPropagation(); armKick(card); },
      });
      const confirm = el('div', { class: 'player-card__confirm' },
        el('span', { class: 'player-card__confirm-q', html: 'Remove<br><strong></strong>?' }));
      confirm.querySelector('strong').textContent = p.name;
      confirm.append(
        el('div', { class: 'player-card__confirm-row' },
          el('button', { class: 'pc-btn pc-btn--no', text: 'Cancel',
            onclick: e => { e.stopPropagation(); disarmKick(card); } }),
          el('button', { class: 'pc-btn pc-btn--yes', text: 'Remove',
            onclick: e => { e.stopPropagation(); doKick(p); } })));

      const card = el('div', {
          class: `player-card${p.connected ? '' : ' disc'}`,
          style: { animationDelay: (i * 50) + 'ms' },
        },
        p.host ? el('span', { class: 'player-card__crown', text: '👑' }) : null,
        kickBtn,
        el('img', { class: 'player-card__av', src: p.avatar || '', alt: '' }),
        el('span', { class: 'player-card__name', text: p.name }),
        el('span', { class: `player-card__ready ${p.ready ? '' : 'waiting'}`, text: p.ready ? 'Ready' : 'Joined' }),
        confirm);
      roster.append(card);
    });
    $('#hostWaiting').textContent = players.length
      ? 'Click a player’s ✕ to remove them · host starts the game' : 'Waiting for players…';
  }

  // arm/disarm the inline "Remove?" confirmation on a lobby card
  let armedCard = null;
  function armKick(card) {
    if (armedCard && armedCard !== card) disarmKick(armedCard);
    card.classList.add('confirming');
    armedCard = card;
    Sound.tap();
    clearTimeout(armKick._t);
    armKick._t = setTimeout(() => disarmKick(card), 4000); // auto-cancel
  }
  function disarmKick(card) {
    if (!card) return;
    card.classList.remove('confirming');
    if (armedCard === card) armedCard = null;
  }
  function doKick(p) {
    armedCard = null;
    const card = $('#roster') && $('#roster').querySelector('.player-card.confirming');
    if (card) card.classList.add('leaving');
    Sound.leave();
    toast(`Removed ${p.name}`, '');
    setTimeout(() => kickPlayer(p.pid), 180);
  }

  function renderDrawAvatars() {
    const box = $('#drawAvatars'); box.innerHTML = '';
    connectedPlayers().forEach(p => {
      const done = G.drawings.has(p.pid);
      box.append(el('div', { class: `draw-chip${done ? ' done' : ''}` },
        el('img', { src: p.avatar || '', alt: '' }),
        el('span', { text: p.name })));
    });
  }

  function renderPodium(ranked) {
    const podium = $('#podium'); podium.innerHTML = '';
    const top = ranked.slice(0, 3);
    const orderCols = [1, 0, 2];       // 2nd, 1st, 3rd visual order
    orderCols.forEach(idx => {
      const p = top[idx]; if (!p) return;
      const rank = idx + 1;
      const col = el('div', { class: 'podium__col', 'data-rank': rank },
        el('img', { class: 'podium__av', src: p.avatar || '', alt: '' }),
        el('span', { class: 'podium__name', text: p.name }),
        el('span', { class: 'podium__score', text: '0' }),
        el('div', { class: 'podium__bar', text: rank === 1 ? '🥇' : rank === 2 ? '🥈' : '🥉' }));
      podium.append(col);
      const scoreNode = col.querySelector('.podium__score');
      setTimeout(() => tweenNumber(scoreNode, 0, p.score, 1100), 250);
    });
  }

  function renderRankings(ranked) {
    const box = $('#rankings'); box.innerHTML = '';
    ranked.forEach((p, i) => {
      box.append(el('div', { class: 'rank-row', style: { animationDelay: (i * 55) + 'ms' } },
        el('span', { class: 'rank-row__pos', text: i + 1 }),
        el('img', { src: p.avatar || '', alt: '' }),
        el('span', { class: 'rank-row__name', text: p.name }),
        p.lastDelta ? el('span', { class: 'rank-row__delta', text: `+${p.lastDelta}` }) : null,
        el('span', { class: 'rank-row__score', text: p.score.toLocaleString() })));
    });
  }

  function sendCurrentTarget(p) {
    const drawer = G.players.get(G.queue[G.qi]); if (!drawer) return;
    if (p.pid === drawer.pid) { host.sendTo(p.connId, { t: 'phase', phase: 'watch', note: 'Your drawing is up!' }); return; }
    if (G.sub === 'guess') host.sendTo(p.connId, { t: 'guessTarget', drawer: drawer.pid, drawerName: drawer.name, image: G.drawings.get(drawer.pid), endsAt: G.deadline });
    else if (G.sub === 'rate') host.sendTo(p.connId, { t: 'rateTarget', drawer: drawer.pid, drawerName: drawer.name, endsAt: G.deadline });
  }

  /* ---- small utils ----------------------------------------------------- */
  function starString(n) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += i <= n ? '★' : '<span class="empty">★</span>';
    return s;
  }
  function verdictRank(v) { return v === 'exact' ? 2 : v === 'close' ? 1 : 0; }

  /* ===================================================================== *
   *  ROOM SETUP                                                            *
   * ===================================================================== */
  function buildRoom() {
    roomCode = U.uid(6);
    host = Net.createHost(roomCode, {
      onReady: code => roomReady(code),
      onIdTaken: () => { roomCode = U.uid(6); host.restart(roomCode); },
      onError: err => { console.error(err); toast('Connection error — retrying…', 'bad'); },
      onPlayerConnect: () => {},
      onPlayerData: onPlayerData,
      onPlayerDisconnect: connId => {
        const pid = G.conn2pid.get(connId);
        G.conn2pid.delete(connId);
        if (pid) removePlayer(pid, false);
      },
    });
  }

  function roomReady(code) {
    roomCode = code;
    const base = new URL('join.html', location.href).href;
    const joinUrl = base + '?room=' + code;
    // QR encodes the prefilled link; humans read the bare URL + code
    try {
      const qr = qrcode(0, 'M'); qr.addData(joinUrl); qr.make();
      $('#qrBox').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 0, scalable: true });
    } catch (e) { $('#qrBox').textContent = code; }
    $('#joinUrl').textContent = base.replace(/^https?:\/\//, '');
    $('#codeBig').textContent = code;
    $('#roomTagCode').textContent = code;
    G.phase = 'lobby';
    setPhaseChip('Lobby · waiting');
    show('scrLobby');
    renderLobby();
  }

  /* ===================================================================== *
   *  CHROME (music / fullscreen / particles)                              *
   * ===================================================================== */
  function initChrome() {
    U.particles($('#particles'), { count: 40, color: 'rgba(180,180,255,.5)' });

    const music = $('#musicToggle');
    music.classList.toggle('chip--on', Settings.get().music);
    music.addEventListener('click', () => {
      const on = !Settings.get().music;
      Settings.set({ music: on });
      Sound.musicToggle(on);
      music.style.opacity = on ? '1' : '.55';
      toast(on ? 'Music on' : 'Music off');
    });
    music.style.opacity = Settings.get().music ? '1' : '.55';
    if (Settings.get().music) Sound.musicToggle(true);

    $('#fsBtn').addEventListener('click', () => {
      if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
      else document.exitFullscreen?.();
    });

    // unlock the WebAudio context on first interaction
    const unlock = () => { Sound.unlock(); removeEventListener('pointerdown', unlock); };
    addEventListener('pointerdown', unlock, { once: true });
  }

  /* ---- boot ------------------------------------------------------------ */
  function boot() {
    if (typeof Peer === 'undefined') {
      setPhaseChip('Offline');
      $('#scrConnecting').querySelector('.display').textContent = 'Couldn’t load PeerJS';
      $('#scrConnecting').querySelector('.muted').textContent = 'Check your connection and refresh.';
      return;
    }
    show('scrConnecting');
    initChrome();
    buildRoom();
  }
  boot();
})();
