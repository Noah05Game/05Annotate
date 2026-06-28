/* ============================================================================
   net.js — realtime transport over PeerJS (star topology).
   The host (Main Screen) is the room authority; every player connects only to
   the host. This module is a thin transport: it handles connecting, room-id
   collisions, heartbeats and reconnection. Game rules live in main.js/join.js.

   Requires global `Peer` (peerjs) to be loaded first.
   Exposes global `Net`.
   ========================================================================== */
(function (global) {
  'use strict';

  // Optional custom PeerServer. Leave null to use the free PeerJS cloud.
  // To self-host: set { host:'peer.yourdomain.com', port:443, path:'/', secure:true }
  const PEER_CONFIG = global.PEER_CONFIG || null;
  const PREFIX = 'o5annotate-v1-';     // namespace so room codes don't clash globally
  const HEARTBEAT_MS = 4000;
  const TIMEOUT_MS = 12000;

  function makePeer(id) {
    const opts = { debug: 1 };
    if (PEER_CONFIG) Object.assign(opts, PEER_CONFIG);
    return id ? new Peer(id, opts) : new Peer(opts);
  }

  /* ===================== HOST ============================================ */
  function createHost(code, h = {}) {
    let peer, closed = false;
    const conns = new Map();          // connId -> { conn, lastSeen }
    const roomId = PREFIX + code;

    function start() {
      peer = makePeer(roomId);
      peer.on('open', () => h.onReady && h.onReady(code));
      peer.on('connection', conn => wire(conn));
      peer.on('disconnected', () => { if (!closed) { try { peer.reconnect(); } catch (_) {} } });
      peer.on('error', err => {
        if (err.type === 'unavailable-id') { h.onIdTaken && h.onIdTaken(); }
        else h.onError && h.onError(err);
      });
    }

    function wire(conn) {
      conn.on('open', () => {
        conns.set(conn.peer, { conn, lastSeen: Date.now() });
        h.onPlayerConnect && h.onPlayerConnect(conn.peer);
      });
      conn.on('data', raw => {
        const rec = conns.get(conn.peer); if (rec) rec.lastSeen = Date.now();
        if (raw && raw.t === '__ping') { try { conn.send({ t: '__pong' }); } catch (_) {} return; }
        h.onPlayerData && h.onPlayerData(conn.peer, raw);
      });
      conn.on('close', () => drop(conn.peer));
      conn.on('error', () => drop(conn.peer));
    }
    function drop(id) {
      if (!conns.has(id)) return;
      conns.delete(id);
      h.onPlayerDisconnect && h.onPlayerDisconnect(id);
    }

    // prune dead connections
    const hb = setInterval(() => {
      const now = Date.now();
      for (const [id, rec] of conns) if (now - rec.lastSeen > TIMEOUT_MS) { try { rec.conn.close(); } catch (_) {} drop(id); }
    }, HEARTBEAT_MS);

    start();

    return {
      get code() { return code; },
      broadcast(msg) { for (const { conn } of conns.values()) { try { conn.send(msg); } catch (_) {} } },
      sendTo(id, msg) { const r = conns.get(id); if (r) { try { r.conn.send(msg); } catch (_) {} } },
      kick(id) { const r = conns.get(id); if (r) { try { r.conn.send({ t: '__kicked' }); setTimeout(() => r.conn.close(), 120); } catch (_) {} } drop(id); },
      count() { return conns.size; },
      close() { closed = true; clearInterval(hb); try { peer.destroy(); } catch (_) {} },
      restart(newCode) { closed = true; try { peer.destroy(); } catch (_) {} closed = false; code = newCode; start(); },
    };
  }

  /* ===================== CLIENT ========================================= */
  function createClient(code, h = {}) {
    let peer, conn, closed = false, attempts = 0, hbTimer, watchdog, lastPong = Date.now();
    const roomId = PREFIX + code;

    function start() {
      peer = makePeer(null);
      peer.on('open', () => connect());
      peer.on('disconnected', () => { if (!closed) { try { peer.reconnect(); } catch (_) {} } });
      peer.on('error', err => {
        if (['peer-unavailable','network','server-error'].includes(err.type)) scheduleReconnect();
        else h.onError && h.onError(err);
      });
    }

    function connect() {
      conn = peer.connect(roomId, { reliable: true, serialization: 'json' });
      const openTimer = setTimeout(() => { if (!conn || !conn.open) scheduleReconnect(); }, TIMEOUT_MS);
      conn.on('open', () => {
        clearTimeout(openTimer); attempts = 0; lastPong = Date.now();
        startHeartbeat();
        h.onOpen && h.onOpen();
      });
      conn.on('data', raw => {
        if (raw && raw.t === '__pong') { lastPong = Date.now(); return; }
        if (raw && raw.t === '__kicked') { closed = true; h.onKicked && h.onKicked(); cleanup(); return; }
        h.onData && h.onData(raw);
      });
      conn.on('close', () => { if (!closed) scheduleReconnect(); });
      conn.on('error', () => { if (!closed) scheduleReconnect(); });
    }

    function startHeartbeat() {
      clearInterval(hbTimer); clearInterval(watchdog);
      hbTimer = setInterval(() => { try { conn && conn.open && conn.send({ t: '__ping' }); } catch (_) {} }, HEARTBEAT_MS);
      watchdog = setInterval(() => { if (Date.now() - lastPong > TIMEOUT_MS) scheduleReconnect(); }, HEARTBEAT_MS);
    }

    function scheduleReconnect() {
      if (closed) return;
      clearInterval(hbTimer); clearInterval(watchdog);
      try { conn && conn.close(); } catch (_) {}
      attempts++;
      if (attempts > 8) { h.onReconnectFailed && h.onReconnectFailed(); return; }
      h.onReconnecting && h.onReconnecting(attempts);
      const delay = Math.min(800 * attempts, 4000);
      setTimeout(() => {
        if (closed) return;
        if (peer.disconnected) { try { peer.reconnect(); } catch (_) {} }
        if (peer.destroyed) { start(); return; }
        connect();
      }, delay);
    }

    function cleanup() { clearInterval(hbTimer); clearInterval(watchdog); try { conn && conn.close(); } catch (_) {} try { peer && peer.destroy(); } catch (_) {} }

    start();

    return {
      send(msg) { try { if (conn && conn.open) { conn.send(msg); return true; } } catch (_) {} return false; },
      isOpen() { return !!(conn && conn.open); },
      reconnect() { attempts = 0; scheduleReconnect(); },
      close() { closed = true; cleanup(); },
    };
  }

  global.Net = { createHost, createClient, PREFIX };
})(window);
