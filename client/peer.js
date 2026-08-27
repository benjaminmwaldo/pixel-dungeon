// Playing without a server of our own.
//
// One player's browser runs the authoritative Session; everyone else connects
// to it over a WebRTC data channel, with PeerJS's public broker doing nothing
// but the introduction. The host's own client talks to the Session in-process,
// so it takes the identical code path as a guest — just with no wire.

import { Session } from '../shared/session.js';
import { TICK_MS } from '../shared/constants.js';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PREFIX = 'pxdgn';

export const makeCode = (n = 4) =>
  Array.from({ length: n }, () => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');

export const peerIdFor = (code) => `${PREFIX}-${String(code).trim().toLowerCase()}`;

function waitOpen(peer) {
  return new Promise((resolve, reject) => {
    if (peer.open) return resolve();
    const ok = () => { cleanup(); resolve(); };
    const bad = (e) => { cleanup(); reject(e); };
    const cleanup = () => { peer.off('open', ok); peer.off('error', bad); };
    peer.on('open', ok);
    peer.on('error', bad);
  });
}

function waitConn(conn, ms = 12000) {
  return new Promise((resolve, reject) => {
    if (conn.open) return resolve();
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    conn.on('open', () => { clearTimeout(timer); resolve(); });
    conn.on('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

// ---------------------------------------------------------------------------
// The host: owns the Session and pumps it
// ---------------------------------------------------------------------------
export class Host {
  constructor(code) {
    this.code = code;
    this.guests = new Map();     // playerId -> DataConnection
    this.localInbox = null;      // the host's own client
    this.localId = 1;
    this.nextId = 2;
    this.peer = null;

    this.session = new Session(code, {
      send: (playerId, obj) => {
        if (playerId === this.localId) this.localInbox?.(obj);
        else {
          const c = this.guests.get(playerId);
          if (c?.open) c.send(obj);
        }
      },
      broadcast: (obj) => {
        this.localInbox?.(obj);
        for (const c of this.guests.values()) if (c.open) c.send(obj);
      },
    });

    this.last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      const dt = now - this.last;
      this.last = now;
      this.session.advance(dt);
    }, TICK_MS);
  }

  /** A transport for the host's own client — same protocol, no wire. */
  localTransport() {
    const host = this;
    return {
      kind: 'local',
      send(obj) { host.session.handle(host.localId, obj); },
      set onMessage(fn) { host.localInbox = fn; },
      close() {},
    };
  }

  /** Open the door so friends can find this party. */
  async publish() {
    if (!window.Peer) throw new Error('PEERJS DID NOT LOAD');
    const peer = new window.Peer(peerIdFor(this.code), { debug: 0 });
    this.peer = peer;
    await waitOpen(peer);
    peer.on('connection', (conn) => this.accept(conn));
    peer.on('error', (e) => {
      if (e?.type !== 'peer-unavailable') this.onError?.(friendlyError(e));
    });
    return this.code;
  }

  accept(conn) {
    conn.on('open', () => {
      if (this.session.full()) {
        conn.send({ t: 'error', m: 'PARTY IS FULL' });
        setTimeout(() => conn.close(), 200);
        return;
      }
      const id = this.nextId++;
      this.guests.set(id, conn);
      const meta = conn.metadata || {};
      const name = String(meta.name || 'HERO').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 8) || 'HERO';
      this.session.addPlayer(id, name, meta.cls);

      conn.on('data', (msg) => {
        if (msg && typeof msg.t === 'string' && msg.t !== 'create' && msg.t !== 'join') {
          this.session.handle(id, msg);
        }
      });
      const drop = () => {
        if (!this.guests.has(id)) return;
        this.guests.delete(id);
        this.session.removePlayer(id);
      };
      conn.on('close', drop);
      conn.on('error', drop);
    });
  }

  close() {
    clearInterval(this.timer);
    for (const c of this.guests.values()) { try { c.close(); } catch { /* gone */ } }
    try { this.peer?.destroy(); } catch { /* gone */ }
  }
}

// ---------------------------------------------------------------------------
// The guest: one data channel to the host
// ---------------------------------------------------------------------------
export async function joinAsGuest(code, name, cls) {
  if (!window.Peer) throw new Error('PEERJS DID NOT LOAD');
  const peer = new window.Peer({ debug: 0 });
  await waitOpen(peer);
  const conn = peer.connect(peerIdFor(code), {
    reliable: true,
    metadata: { name, cls },
  });
  await waitConn(conn);

  let inbox = null;
  conn.on('data', (obj) => inbox?.(obj));
  return {
    kind: 'peer',
    peer,
    conn,
    send(obj) { if (conn.open) conn.send(obj); },
    set onMessage(fn) { inbox = fn; },
    set onClose(fn) { conn.on('close', fn); },
    close() { try { conn.close(); peer.destroy(); } catch { /* gone */ } },
  };
}

// ---------------------------------------------------------------------------
// A WebSocket to our own Node server, for playing on one network.
// ---------------------------------------------------------------------------
export function socketTransport() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const ws = new WebSocket(`${proto}://${location.host}`);
  let inbox = null, closed = null;
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    inbox?.(m);
  };
  ws.onclose = () => closed?.();
  return {
    kind: 'socket',
    ready: new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('no server here'));
    }),
    send(obj) { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); },
    set onMessage(fn) { inbox = fn; },
    set onClose(fn) { closed = fn; },
    close() { try { ws.close(); } catch { /* gone */ } },
  };
}

export function friendlyError(e) {
  switch (e?.type) {
    case 'unavailable-id': return 'THAT CODE IS TAKEN - TRY AGAIN';
    case 'peer-unavailable': return 'NO PARTY WITH THAT CODE';
    case 'network': return 'CANNOT REACH THE MATCHMAKER';
    case 'browser-incompatible': return 'THIS BROWSER CANNOT DO WEBRTC';
    case 'disconnected': return 'CONNECTION DROPPED';
    default: return String(e?.message || e?.type || 'CONNECTION FAILED').toUpperCase().slice(0, 30);
  }
}
