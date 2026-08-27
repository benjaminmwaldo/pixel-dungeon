// The wire. Sends input 30 times a second, predicts the local hero with the
// same code the server runs, interpolates everyone else, and works out its own
// field of view so the fog never lags behind your feet.

import { CLASS_ORDER, PLAYER_BOX, CLASSES } from '../shared/constants.js';
import { LEVEL_LEN, LEVEL_W } from '../shared/terrain.js';
import { newPlayerState, playerStep, NO_MODS } from '../shared/player.js';
import { tileUnder } from '../shared/physics.js';
import { viewFrom } from '../shared/fov.js';
import { buffById, BUFFS } from '../shared/buffs.js';

const RENDER_DELAY = 70;

function unpack(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.transport = null;
    this.id = 0;
    this.cls = 'warrior';
    this.code = '';
    this.seq = 0;
    this.history = [];
    this.local = newPlayerState();
    this.err = { x: 0, y: 0 };
    this.buffer = [];
    this.depth = 1;
    this.region = 'sewers';
    this.tiles = new Uint8Array(LEVEL_LEN);
    this.explored = new Uint8Array(LEVEL_LEN);
    this.fov = new Uint8Array(LEVEL_LEN);
    this.level = { tiles: this.tiles, rooms: [] };
    this.fovTile = -1;
    this.bag = [];
    this.equip = { weapon: { tier: 1, upgrade: 0 }, armor: { tier: 1, upgrade: 0 } };
    this.perks = {};
    this.perkPoints = 0;
    this.mods = NO_MODS;
    this.party = [];
    this.roster = new Map();
    this.known = { potions: [], scrolls: [] };
    this.app = { potionLook: {}, scrollLook: {} };
    this.latency = 0;
    this.connected = false;
    this.haveFloor = false;
  }

  /**
   * Point this client at a transport: an in-page host, a data channel to a
   * friend's browser, or a WebSocket to a Node server. The protocol above it
   * is identical in all three cases.
   */
  attach(transport) {
    this.transport = transport;
    transport.onMessage = (m) => this.handle(m);
    if ('onClose' in transport) transport.onClose = () => {
      this.connected = false;
      clearInterval(this.pingTimer);
      this.h.onClose?.();
    };
    this.connected = true;
    clearInterval(this.pingTimer);
    if (transport.kind !== 'local') {
      this.pingTimer = setInterval(() => this.send({ t: 'ping', c: Date.now() }), 2000);
    }
    this.h.onOpen?.();
  }

  send(o) { this.transport?.send(o); }

  create(name, cls) { this.send({ t: 'create', name, cls }); }
  join(code, name, cls) { this.send({ t: 'join', code, name, cls }); }
  chooseClass(cls) { this.send({ t: 'class', cls }); }
  ready(v) { this.send({ t: 'ready', v }); }
  act() { this.send({ t: 'act' }); }
  useSlot(n) { this.send({ t: 'use', n }); }
  invOp(op, a, b = 0) { this.send({ t: 'inv', op, a, b }); }
  takePerk(id) { this.send({ t: 'perk', id }); }
  again() { this.send({ t: 'again' }); }

  handle(m) {
    switch (m.t) {
      case 'welcome':
        this.id = m.id; this.code = m.code; this.cls = m.cls;
        this.h.onWelcome?.(m);
        break;
      case 'lobby': this.h.onLobby?.(m); break;
      case 'start':
        this.history.length = 0;
        this.buffer.length = 0;
        this.haveFloor = false;
        this.h.onStart?.();
        break;
      case 'floor': this.onFloor(m); break;
      case 'ex':
        if (m.d === this.depth) {
          const inc = unpack(m.explored);
          for (let i = 0; i < LEVEL_LEN; i++) if (inc[i]) this.explored[i] = 1;
        }
        break;
      case 's': this.onSnapshot(m); break;
      case 'm': this.onMeta(m); break;
      case 'b': this.h.onBanner?.(m.m, m.ms); break;
      case 'note': this.h.onBanner?.(m.m, 1400); break;
      case 'win': this.h.onEnd?.(m.stats, true); break;
      case 'over': this.h.onEnd?.(m.stats, false); break;
      case 'error': this.h.onError?.(m.m); break;
      case 'pong': this.latency = Date.now() - m.c; break;
    }
  }

  onFloor(m) {
    this.depth = m.d;
    this.region = m.region;
    this.tiles = unpack(m.tiles);
    this.explored = unpack(m.explored);
    this.level = {
      tiles: this.tiles,
      rooms: m.rooms.map(([l, t, r, b, tunnel]) =>
        ({ l, t, r, b, type: tunnel ? 'tunnel' : 'room' })),
    };
    this.entrance = m.entrance;
    this.exit = m.exit;
    this.traps = m.traps || {};
    this.fovTile = -1;
    this.haveFloor = true;
    this.buffer.length = 0;
  }

  onMeta(m) {
    this.known = m.known;
    this.app = m.app;
    this.serverState = m.state;
    this.roster = new Map(m.players.map(p => [p.id, p]));
    const mine = this.roster.get(this.id);
    if (mine) {
      this.bag = mine.bag || [];
      this.equip = mine.equip || this.equip;
      this.perks = mine.perks || {};
      this.perkPoints = mine.perkPoints || 0;
      this.mods = mine.mods || NO_MODS;
      this.cls = mine.cls;
      this.perkSight = (this.perks.keenEye || 0);
      this.fovTile = -1;   // sight may have changed
    }
  }

  onSnapshot(m) {
    if (!this.haveFloor) return;
    if (m.d !== this.depth) return;      // a floor packet is on its way

    for (const [i, tile] of m.tc) this.tiles[i] = tile;

    const me = m.me;
    const prevX = this.local.x, prevY = this.local.y;
    const s = this.local;
    s.x = me[0]; s.y = me[1]; s.dir = me[2]; s.atk = me[3];
    this.hp = me[4]; this.maxHp = me[5];
    this.level_ = me[6]; this.xp = me[7]; this.xpNext = me[8];
    s.ghost = !!me[9];
    this.invuln = me[10];
    s.abilityCd = me[11];
    s.knockT = me[12]; s.knockX = me[13]; s.knockY = me[14];
    s.stun = me[15];
    this.gold = me[16]; this.hunger = me[17]; this.invis = me[18];
    this.reviveT = me[19]; this.revivedBy = me[20];
    this.livePoints = me[21] ?? this.perkPoints;
    this.moveMult = (me[22] ?? 100) / 100;
    this.shield = me[23] || 0;
    this.buffs = (m.bf || []).map(([i, t, mag]) => ({ id: buffById(i), t, m: mag }))
      .filter(b => b.id);

    const ack = m.a;
    this.history = this.history.filter(h => h.seq > ack);
    for (const h of this.history) {
      s.prev = h.prev;
      playerStep(s, h.bits, this.tiles, this.cls, this.liveMods());
    }

    this.err.x = clampErr(this.err.x + (prevX - s.x));
    this.err.y = clampErr(this.err.y + (prevY - s.y));

    this.buffer.push({
      time: performance.now(),
      ents: m.e.map(([id, kind, x, y, dir, flags, hp, maxHp]) =>
        ({ id, kind, x, y, dir, flags, hp, maxHp })),
      items: m.it.map(([id, x, y, type, kind, tier, upgrade, amount]) =>
        ({ id, x, y, type, kind, tier, upgrade, amount })),
      others: m.o.map(([id, x, y, dir, clsIdx, ghost, atk, hp, maxHp, walk, invis]) =>
        ({ id, x, y, dir, clsIdx, ghost: !!ghost, atk, hp, maxHp, walk, invis })),
    });
    while (this.buffer.length > 8) this.buffer.shift();

    this.party = m.pl.map(([id, hp, maxHp, depth, ghost]) => {
      const r = this.roster.get(id);
      return { id, hp, maxHp, depth, ghost: !!ghost, name: r?.name || '', cls: r?.cls || 'warrior' };
    });

    for (const [kind, x, y] of m.f) this.h.onFx?.(kind, x, y);
    this.refreshFov();
  }

  /** Work out what the local hero can see, from the predicted position. */
  refreshFov(force = false) {
    if (!this.haveFloor) return;
    const here = tileUnder(this.local, PLAYER_BOX);
    if (!force && here === this.fovTile) return;
    this.fovTile = here;
    const bonus = this.perkSight || 0;
    viewFrom(this.level, here, (CLASSES[this.cls]?.sight || 8) + bonus, this.fov);
    for (let i = 0; i < LEVEL_LEN; i++) if (this.fov[i]) this.explored[i] = 1;
  }

  /** Perk multipliers with any timed effects folded in, so prediction matches. */
  liveMods() {
    const mm = this.moveMult ?? 1;
    return mm === 1 ? this.mods : { ...this.mods, speedMult: this.mods.speedMult * mm };
  }

  tick(bits) {
    if (!this.haveFloor) return;
    // held in place: send nothing, so both sides agree you did nothing
    if (this.moveMult === 0) bits = 0;
    this.seq++;
    this.history.push({ seq: this.seq, bits, prev: this.local.prev });
    if (this.history.length > 90) this.history.shift();
    this.send({ t: 'in', s: this.seq, b: bits });
    playerStep(this.local, bits, this.tiles, this.cls, this.liveMods());
    this.refreshFov();
  }

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
    if (!a) return { ents: [], items: [], others: [] };

    let alpha = 0;
    if (b && b.time > a.time) alpha = Math.min(1, Math.max(0, (target - a.time) / (b.time - a.time)));
    const list = b || a;

    const lerpAll = (cur, prevList) => {
      const prev = new Map(prevList.map(e => [e.id, e]));
      return cur.map(e => {
        const p = prev.get(e.id);
        return (p && b) ? { ...e, x: p.x + (e.x - p.x) * alpha, y: p.y + (e.y - p.y) * alpha } : e;
      });
    };

    const others = lerpAll(list.others, a.others).map(o => ({
      ...o, name: this.roster.get(o.id)?.name || '',
    }));
    return { ents: lerpAll(list.ents, a.ents), items: list.items, others };
  }

  state(now) {
    const { ents, items, others } = this.view(now);
    const me = this.local;
    return {
      myId: this.id,
      depth: this.depth,
      region: this.region,
      tiles: this.tiles,
      explored: this.explored,
      fov: this.fov,
      traps: this.traps || {},
      me: {
        x: me.x + this.err.x, y: me.y + this.err.y,
        dir: me.dir, atk: me.atk, walk: me.walk, ghost: me.ghost,
        cls: this.cls, invuln: this.invuln, invis: this.invis,
        hp: this.hp, maxHp: this.maxHp, level: this.level_,
        xp: this.xp, xpNext: this.xpNext, gold: this.gold, hunger: this.hunger,
        abilityCd: me.abilityCd,
      },
      ents, items, others,
      party: this.party,
      buffs: this.buffs || [],
      shield: this.shield || 0,
      bag: this.bag,
      equip: this.equip,
      perks: this.perks,
      perkPoints: this.livePoints ?? this.perkPoints,
      app: this.app,
      known: this.known,
      particles: [],
    };
  }

  /** What the hero is standing on, so the client can offer a prompt. */
  tileHere() {
    if (!this.haveFloor) return -1;
    return this.tiles[tileUnder(this.local, PLAYER_BOX)];
  }
}

function clampErr(v) { return Math.max(-24, Math.min(24, v)); }
