// One party's worth of game, plus the message pump around it.
//
// This is deliberately transport-free: it is handed `send(playerId, obj)` and
// `broadcast(obj)` and never knows whether those go down a WebSocket to a
// player on your LAN or a WebRTC data channel to a friend three states away.
// The Node server and the browser host both drive the same class.

import { Game } from './game.js';
import { unpackChallenges, packChallenges } from './badges.js';
import { TICK_MS, MAX_PLAYERS, IN, CLASSES } from './constants.js';
import { MAX_DEPTH } from './terrain.js';

export class Session {
  constructor(code, { send, broadcast }) {
    this.game = new Game(code);
    this.send = send;
    this.broadcast = broadcast;
    this.acc = 0;
    this.beat = 0;
  }

  get code() { return this.game.code; }
  get state() { return this.game.state; }
  get players() { return this.game.players; }

  full() { return this.game.players.size >= MAX_PLAYERS; }

  addPlayer(id, name, cls) {
    const p = this.game.addPlayer(id, name, cls);
    if (p) {
      this.send(id, { t: 'welcome', id, code: this.game.code, cls: p.cls });
      this.broadcast(this.lobbyPayload());
      if (this.game.state !== 'lobby') this.send(id, { t: 'start' });
    }
    return p;
  }

  removePlayer(id) {
    const p = this.game.players.get(id);
    this.game.removePlayer(id);
    if (this.game.players.size) {
      this.broadcast(this.lobbyPayload());
      if (p) this.broadcast({ t: 'note', m: `${p.name} LEFT THE PARTY` });
    }
  }

  lobbyPayload() {
    return {
      t: 'lobby',
      code: this.game.code,
      state: this.game.state,
      challenges: packChallenges(this.game.challenges),
      players: [...this.game.players.values()].map(p => ({
        id: p.id, name: p.name, cls: p.cls, ready: p.ready,
      })),
    };
  }

  /** Everything a client may ask for. */
  handle(id, msg) {
    const game = this.game;
    const p = game.players.get(id);
    if (!msg || typeof msg.t !== 'string') return;

    switch (msg.t) {
      case 'class': {
        if (!p || game.state !== 'lobby') return;
        const want = String(msg.cls || '');
        if (!CLASSES[want]) return;
        if ([...game.players.values()].some(o => o.id !== p.id && o.cls === want)) return;
        p.cls = want;
        p.colour = CLASSES[want].colour;
        p.hp = p.maxHp = CLASSES[want].hp;
        game.recalc(p);
        this.broadcast(this.lobbyPayload());
        break;
      }
      case 'chal': {
        // only whoever opened the room sets the terms
        if (!p || p.id !== [...game.players.keys()][0]) return;
        if (game.state !== 'lobby') return;
        game.challenges = unpackChallenges(msg.bits | 0);
        this.broadcast(this.lobbyPayload());
        break;
      }
      case 'ready': {
        if (!p) return;
        p.ready = !!msg.v;
        this.broadcast(this.lobbyPayload());
        const all = [...game.players.values()];
        if (game.state === 'lobby' && all.length && all.every(x => x.ready)) {
          game.begin();
          this.broadcast({ t: 'start' });
        }
        break;
      }
      case 'in': {
        if (!p) return;
        const bits = (msg.b | 0) & (IN.UP | IN.RIGHT | IN.DOWN | IN.LEFT | IN.A | IN.B);
        p.queue.push({ seq: msg.s | 0, bits });
        if (p.queue.length > 12) p.queue.splice(0, p.queue.length - 12);
        game.lastActivity = Date.now();
        break;
      }
      case 'act': if (p) game.interact(p); break;
      case 'use': if (p) game.useSlot(p, msg.n | 0); break;
      case 'inv': if (p) game.invOp(p, String(msg.op || ''), msg.a | 0, msg.b | 0); break;
      case 'perk': if (p) game.spendPerk(p, String(msg.id || '')); break;
      case 'again':
        if (game.state === 'win' || game.state === 'over') game.restart();
        break;
      case 'ping': this.send(id, { t: 'pong', c: msg.c }); break;
      default: break;
    }
  }

  /** Advance by real elapsed time, then push out whatever changed. */
  advance(dtMs) {
    const game = this.game;
    this.acc += dtMs;
    if (this.acc > 250) this.acc = 250;

    let steps = 0;
    while (this.acc >= TICK_MS && steps < 5) {
      this.acc -= TICK_MS;
      steps++;
      if (game.state === 'play' || game.state === 'over') game.step();
    }
    if (!steps) return;

    this.beat++;
    if (game.state === 'lobby') return;

    if (game.announceStart) {
      game.announceStart = false;
      this.broadcast({ t: 'start' });
    }

    for (const p of game.players.values()) {
      if (p.needFloor) {
        p.needFloor = false;
        this.send(p.id, game.floorPacket(p));
      }
      this.send(p.id, game.snapshotFor(p));
    }

    // teammates' exploration bleeds into everyone's map a couple of times a second
    if (this.beat % 15 === 0) {
      const depths = new Set([...game.players.values()].map(x => x.depth));
      for (const d of depths) {
        const f = game.floors.get(d);
        if (!f?.mapDirty) continue;
        f.mapDirty = false;
        const packet = game.exploredPacket(d);
        for (const o of game.players.values()) {
          if (o.depth === d) this.send(o.id, packet);
        }
      }
    }

    if (game.metaDirty) {
      game.metaDirty = false;
      this.broadcast(game.metaFor());
    }
    for (const b of game.banners) this.broadcast({ t: 'b', ...b });
    game.banners.length = 0;
    game.clearTransient();

    if (game.state === 'win' && !game.announcedWin) {
      game.announcedWin = true;
      this.broadcast({ t: 'win', stats: this.stats(MAX_DEPTH) });
    }
    if (game.state === 'over' && !game.announcedOver) {
      game.announcedOver = true;
      this.broadcast({ t: 'over', stats: this.stats(game.deepest) });
    }
    if (game.state === 'play') { game.announcedWin = false; game.announcedOver = false; }
  }

  stats(deepest) {
    const game = this.game;
    return {
      time: Math.round((Date.now() - game.startedAt) / 1000),
      kills: game.kills, deaths: game.deaths, deepest,
      badges: game.badges || [],
      challenges: game.challenges || [],
      players: [...game.players.values()].map(x => ({
        name: x.name, cls: x.cls, level: x.level, kills: x.kills, gold: x.gold,
      })),
    };
  }
}
