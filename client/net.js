// The wire. Sends input 30 times a second, predicts the local hero with the
// same code the server runs, and interpolates everyone else between snapshots.

import { TICK_MS, PLAYER_COLORS, ROOM_W, T, DOOR } from '../shared/constants.js';
import { ROOM_BY_ID } from '../shared/dungeon.js';
import { newPlayerState, playerStep } from '../shared/player.js';

const RENDER_DELAY = 70;   // ms of interpolation buffer for remote entities

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.id = 0;
    this.colour = 'green';
    this.code = '';
    this.seq = 0;
    this.history = [];
    this.local = newPlayerState();
    this.serverMe = null;
    this.err = { x: 0, y: 0 };
    this.buffer = [];
    this.room = null;
    this.roomTiles = null;
    this.party = { keys: 0, bombs: 0, gems: 0, map: false, compass: false, boomerang: false, skullKey: false, relic: false, potion: false, containers: 0 };
    this.map = new Map();
    this.roster = new Map();
    this.partyList = [];
    this.latency = 0;
    this.connected = false;
  }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.connected = true;
      this.h.onOpen?.();
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: Date.now() }), 2000);
    };
    this.ws.onclose = () => {
      this.connected = false;
      clearInterval(this.pingTimer);
      this.h.onClose?.();
    };
    this.ws.onerror = () => { /* onclose follows */ };
    this.ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      this.handle(m);
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
  }

  create(name) { this.send({ t: 'create', name }); }
  join(code, name) { this.send({ t: 'join', code, name }); }
  ready(v) { this.send({ t: 'ready', v }); }
  cycle() { this.send({ t: 'cycle' }); }
  again() { this.send({ t: 'again' }); }

  handle(m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id; this.code = m.code; this.colour = m.colour;
        this.h.onWelcome?.(m);
        break;
      case 'lobby':
        this.h.onLobby?.(m);
        break;
      case 'start':
        this.history.length = 0;
        this.buffer.length = 0;
        this.h.onStart?.();
        break;
      case 's': this.onSnapshot(m); break;
      case 'm': this.onMeta(m); break;
      case 'b': this.h.onBanner?.(m.m, m.ms); break;
      case 'note': this.h.onBanner?.(m.m, 1400); break;
      case 'win': this.h.onWin?.(m.stats); break;
      case 'error': this.h.onError?.(m.m); break;
      case 'pong': this.latency = Date.now() - m.c; break;
    }
  }

  onMeta(m) {
    const [keys, bombs, gems, map, compass, boomerang, skullKey, relic, potion, containers] = m.p;
    this.party = {
      keys, bombs, gems,
      map: !!map, compass: !!compass, boomerang: !!boomerang,
      skullKey: !!skullKey, relic: !!relic, potion: !!potion, containers,
    };
    this.map = new Map(m.map.map(([id, visited, cleared, boss, item]) =>
      [id, { visited: !!visited, cleared: !!cleared, boss: !!boss, item: !!item }]));
    this.roster = new Map(m.players.map(([id, name, colour, sel]) => [id, { id, name, colour, sel }]));
    this.serverState = m.state;
  }

  onSnapshot(m) {
    const me = m.me;
    const roomChanged = !this.room || this.room.id !== m.r[0];

    this.room = {
      id: m.r[0],
      doors: [m.r[1], m.r[2], m.r[3], m.r[4]],
      cleared: !!m.r[5],
      pushed: !!m.r[6],
    };
    if (roomChanged || this.roomPushed !== this.room.pushed) {
      this.roomPushed = this.room.pushed;
      this.roomTiles = this.buildTiles(this.room.id, this.room.pushed);
      this.buffer.length = 0;
    }

    const prevX = this.local.x, prevY = this.local.y;

    // Authoritative state, then replay everything the server has not seen yet.
    const s = this.local;
    s.x = me[0]; s.y = me[1]; s.dir = me[2];
    this.hp = me[3]; this.maxHp = me[4];
    s.atk = me[5];
    this.invuln = me[6];
    s.ghost = !!me[7];
    s.trans = me[8];
    this.transDir = me[9];
    s.walk = me[10];
    s.knockT = me[11]; s.knockX = me[12]; s.knockY = me[13];
    this.reviveT = me[14]; this.revivedBy = me[15];
    this.transFrom = m.r[7] || null;

    const ack = m.a;
    this.history = this.history.filter(h => h.seq > ack);
    for (const h of this.history) {
      // Restore the button state each frame saw, or a replayed swing would be
      // swallowed by edge detection and the sword would flicker.
      s.prev = h.prev;
      playerStep(s, h.bits, this.roomTiles, this.room.doors);
    }

    // Fold the correction into a decaying offset so it never visibly snaps.
    if (!roomChanged && s.trans <= 0) {
      this.err.x = clampErr(this.err.x + (prevX - s.x));
      this.err.y = clampErr(this.err.y + (prevY - s.y));
    } else {
      this.err.x = 0; this.err.y = 0;
    }

    this.buffer.push({
      time: performance.now(),
      ents: m.e.map(([id, kind, x, y, dir, flags, extra]) => ({ id, kind, x, y, dir, flags, item: extra, hp: extra })),
      others: m.o.map(([id, x, y, dir, colourIdx, ghost, atk, hp, maxHp, walk]) =>
        ({ id, x, y, dir, colourIdx, ghost: !!ghost, atk, hp, maxHp, walk })),
    });
    while (this.buffer.length > 8) this.buffer.shift();

    this.partyList = m.pl.map(([id, hp, maxHp, room, ghost]) => {
      const r = this.roster.get(id);
      return {
        id, hp, maxHp, room, ghost: !!ghost,
        name: r?.name || '',
        colourIdx: Math.max(0, PLAYER_COLORS.indexOf(r?.colour || 'green')),
      };
    });

    for (const [kind, x, y] of m.f) this.h.onFx?.(kind, x, y);
  }

  buildTiles(roomId, pushed) {
    const def = ROOM_BY_ID.get(roomId);
    if (!def) return new Uint8Array(ROOM_W * 11);
    const tiles = Uint8Array.from(def.tiles);
    if (pushed && def.pushBlock) {
      const tx = def.pushBlock.ix + 1, ty = def.pushBlock.iy + 1;
      tiles[ty * ROOM_W + tx] = T.FLOOR;
      // the block itself ends up one tile along, but only its old square matters
      // for walking, and the server owns the authoritative copy either way.
    }
    return tiles;
  }

  /** Called once per fixed tick: sample input, send it, predict locally. */
  tick(bits) {
    if (!this.room) return;
    this.seq++;
    this.history.push({ seq: this.seq, bits, prev: this.local.prev });
    if (this.history.length > 90) this.history.shift();
    this.send({ t: 'in', s: this.seq, b: bits });
    playerStep(this.local, bits, this.roomTiles, this.room.doors);
  }

  /** Interpolated view of the room for rendering. */
  view(now) {
    this.err.x *= 0.72;
    this.err.y *= 0.72;
    if (Math.abs(this.err.x) < 0.2) this.err.x = 0;
    if (Math.abs(this.err.y) < 0.2) this.err.y = 0;

    const target = now - RENDER_DELAY;
    let a = null, b = null;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i].time <= target) { a = this.buffer[i]; b = this.buffer[i + 1] || null; break; }
    }
    if (!a) { a = this.buffer[0]; b = this.buffer[1] || null; }
    if (!a) return { ents: [], others: [] };

    let alpha = 0;
    if (b && b.time > a.time) alpha = Math.min(1, Math.max(0, (target - a.time) / (b.time - a.time)));

    const ents = [];
    const list = b || a;
    const prevById = new Map(a.ents.map(e => [e.id, e]));
    for (const e of list.ents) {
      const p = prevById.get(e.id);
      ents.push(p && b
        ? { ...e, x: p.x + (e.x - p.x) * alpha, y: p.y + (e.y - p.y) * alpha }
        : e);
    }
    const others = [];
    const prevOther = new Map(a.others.map(o => [o.id, o]));
    for (const o of list.others) {
      const p = prevOther.get(o.id);
      const r = this.roster.get(o.id);
      const base = p && b ? { ...o, x: p.x + (o.x - p.x) * alpha, y: p.y + (o.y - p.y) * alpha } : { ...o };
      base.colour = PLAYER_COLORS[o.colourIdx] || 'green';
      base.name = r?.name || '';
      others.push(base);
    }
    return { ents, others };
  }

  /** What the renderer needs, assembled in one place. */
  state(now) {
    const { ents, others } = this.view(now);
    const me = this.local;
    const roster = this.roster.get(this.id);
    return {
      myId: this.id,
      colour: this.colour,
      room: this.room,
      me: {
        x: me.x + this.err.x,
        y: me.y + this.err.y,
        dir: me.dir, atk: me.atk, walk: me.walk, ghost: me.ghost,
        invuln: this.invuln, hp: this.hp, maxHp: this.maxHp,
        trans: me.trans, transDir: this.transDir, transFrom: this.transFrom,
      },
      ents, others,
      party: this.party,
      map: this.map,
      partyList: this.partyList,
      bItem: roster?.sel || 'bomb',
      particles: [],
    };
  }
}

function clampErr(v) { return Math.max(-24, Math.min(24, v)); }
