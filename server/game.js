// The authoritative simulation. One instance per party.
// Everything that decides an outcome happens here; clients only predict their
// own movement and are corrected by the snapshots this produces.

import {
  TILE, ROOM_W, ROOM_H, PLAY_W, PLAY_H, T, KIND, PICKUP, PERMANENT, DOOR,
  N, E, S, W, DX, DY, OPPOSITE, DOOR_TILES, ENTRY_POS, PLAYER_BOX,
  START_HEARTS, MAX_HEARTS, INVULN_TICKS, KNOCKBACK_TICKS, KNOCKBACK_SPEED,
  TRANSITION_TICKS, REVIVE_TICKS, GHOST_AUTO_REVIVE, ATTACK_TICKS,
  MAX_PLAYERS, PLAYER_COLORS, rectsOverlap, clamp,
} from '../shared/constants.js';
import {
  ROOMS, ROOM_BY_ID, START_ROOM, DUNGEON_NAME, freeTiles, neighbourOf,
} from '../shared/dungeon.js';
import {
  DS, MODE, moveActor, boxBlocked, doorwayExit, clampToRoom, tileBlocks,
} from '../shared/physics.js';
import { newPlayerState, playerStep, swordBox } from '../shared/player.js';

const rnd = () => Math.random();
const pick = (arr) => arr[(rnd() * arr.length) | 0];

// ---------------------------------------------------------------------------
// Bestiary stats
// ---------------------------------------------------------------------------
const BOX16 = { x: 2, y: 3, w: 12, h: 12 };
const BOX_SMALL = { x: 3, y: 5, w: 10, h: 10 };

export const ENEMY = {
  [KIND.BAT]:        { hp: 2,  speed: 2.4, touch: 1, box: BOX_SMALL, mode: MODE.FLY },
  [KIND.SLIME]:      { hp: 2,  speed: 1.0, touch: 1, box: BOX_SMALL },
  [KIND.SLIMELET]:   { hp: 2,  speed: 1.4, touch: 1, box: BOX_SMALL },
  [KIND.BONEWALKER]: { hp: 4,  speed: 1.2, touch: 2, box: BOX16 },
  [KIND.HURLER]:     { hp: 4,  speed: 1.2, touch: 2, box: BOX16 },
  [KIND.IRONCLAD]:   { hp: 8,  speed: 1.4, touch: 2, box: BOX16, armoured: true },
  [KIND.WISP]:       { hp: 4,  speed: 0,   touch: 2, box: BOX16 },
  [KIND.GRABHAND]:   { hp: 4,  speed: 1.1, touch: 0, box: BOX16, grabs: true },
  [KIND.WYRM]:       { hp: 16, speed: 0.7, touch: 4, box: { x: 2, y: 4, w: 28, h: 26 }, w: 32, h: 32, boss: true },
};

const IS_ENEMY = (k) => k >= KIND.BAT && k <= KIND.WYRM;

const SWORD_DMG = 2;
const BOMB_DMG = 4;

// Weighted drop table, rolled when an enemy dies.
const DROPS = [
  [null, 34], [PICKUP.HEART, 22], [PICKUP.GEM, 22], [PICKUP.BOMB, 12],
  [PICKUP.FAIRY, 5], [PICKUP.CLOCK, 5],
];

function rollDrop() {
  let total = 0;
  for (const [, w] of DROPS) total += w;
  let r = rnd() * total;
  for (const [item, w] of DROPS) { r -= w; if (r <= 0) return item; }
  return null;
}

// ---------------------------------------------------------------------------
// Room state
// ---------------------------------------------------------------------------
class RoomState {
  constructor(def) {
    this.def = def;
    this.opened = [false, false, false, false];
    this.cleared = false;
    this.visited = false;
    this.itemTaken = false;
    this.rewardGiven = false;
    this.pushed = false;
    this.bossDead = false;
    this.ents = [];
    this.active = false;
    this.fx = [];
    this.tiles = Uint8Array.from(def.tiles);
  }

  doorState() {
    const out = [0, 0, 0, 0];
    for (let d = 0; d < 4; d++) {
      const type = this.def.doors[d];
      if (type === DOOR.NONE) out[d] = DS.SOLID;
      else if (type === DOOR.OPEN) out[d] = DS.OPEN;
      else out[d] = this.opened[d] ? DS.OPEN : DS.BARRED;
    }
    return out;
  }
}

// ---------------------------------------------------------------------------
// Game
// ---------------------------------------------------------------------------
export class Game {
  constructor(code) {
    this.code = code;
    this.tick = 0;
    this.entSeq = 1;
    this.players = new Map();
    this.rooms = new Map();
    for (const def of ROOMS) this.rooms.set(def.id, new RoomState(def));
    this.party = {
      keys: 0, bombs: 0, maxBombs: 8, gems: 0,
      map: false, compass: false, boomerang: false, skullKey: false,
      relic: false, potion: false, containers: 0,
    };
    this.metaDirty = true;
    this.state = 'lobby';   // lobby | play | over | win
    this.overTimer = 0;
    this.banners = [];
    this.startedAt = 0;
    this.kills = 0;
    this.deaths = 0;
    this.lastActivity = Date.now();
  }

  // -- players --------------------------------------------------------------
  addPlayer(id, name) {
    if (this.players.size >= MAX_PLAYERS) return null;
    const used = new Set([...this.players.values()].map(p => p.colour));
    const colour = PLAYER_COLORS.find(c => !used.has(c)) || PLAYER_COLORS[0];
    const p = Object.assign(newPlayerState(), {
      id, name: (name || 'HERO').slice(0, 8).toUpperCase(), colour,
      room: START_ROOM, hp: START_HEARTS * 2, maxHp: START_HEARTS * 2,
      invuln: 0, input: 0, seq: 0, ready: false, queue: [],
      reviveT: 0, revivedBy: 0, pushT: 0, pushDir: -1,
      sel: 'bomb', transFrom: null, boomerangOut: false,
      gems: 0, kills: 0,
    });
    p.maxHp = (START_HEARTS + this.party.containers) * 2;
    p.hp = p.maxHp;
    this.players.set(id, p);
    this.metaDirty = true;
    this.lastActivity = Date.now();
    return p;
  }

  removePlayer(id) {
    this.players.delete(id);
    this.metaDirty = true;
  }

  room(id) { return this.rooms.get(id); }

  livingIn(roomId) {
    return [...this.players.values()].filter(p => p.room === roomId && !p.ghost && p.trans <= 0);
  }
  anyIn(roomId) {
    return [...this.players.values()].filter(p => p.room === roomId);
  }

  banner(text, ms = 1800) { this.banners.push({ m: text, ms }); }

  // =========================================================================
  // Main tick
  // =========================================================================
  step() {
    this.tick++;

    if (this.state === 'over') {
      if (--this.overTimer <= 0) this.continueAfterDeath();
      return;
    }
    if (this.state !== 'play') return;

    for (const p of this.players.values()) this.stepPlayer(p);

    const active = new Set([...this.players.values()].map(p => p.room));
    for (const [id, room] of this.rooms) {
      if (active.has(id)) {
        if (!room.active) this.activateRoom(room);
        this.stepRoom(room);
      } else if (room.active) {
        room.active = false;
        room.ents.length = 0;   // enemies come back fresh next visit
      }
    }

    // Everyone down?
    const living = [...this.players.values()].filter(p => !p.ghost);
    if (this.players.size > 0 && living.length === 0 && this.state === 'play') {
      this.state = 'over';
      this.overTimer = 90;
      this.pushFxEverywhere('lose');
    }
  }

  pushFxEverywhere(kind) {
    for (const p of this.players.values()) this.room(p.room).fx.push([kind, 128, 88]);
  }

  // -------------------------------------------------------------------------
  // Player
  // -------------------------------------------------------------------------
  stepPlayer(p) {
    // One queued input frame per tick. When the queue runs dry (jitter, a
    // dropped packet) the last frame repeats, which holds movement steady and
    // cannot re-trigger a button edge.
    const next = p.queue.shift();
    if (next) { p.input = next.bits; p.seq = next.seq; }

    const room = this.room(p.room);
    const doors = room.doorState();

    if (p.invuln > 0) p.invuln--;

    if (p.ghost) {
      // Downed: drift as a spirit until a friend revives you or time does.
      p.reviveT--;
      const helper = this.livingIn(p.room).find(o =>
        rectsOverlap(p.x + 4, p.y + 4, 8, 8, o.x + 4, o.y + 4, 8, 8));
      if (helper) {
        p.revivedBy++;
        if (p.revivedBy >= REVIVE_TICKS) this.revive(p, room);
      } else {
        p.revivedBy = 0;
      }
      if (p.reviveT <= 0) {
        p.room = START_ROOM;
        p.x = 120; p.y = 96;
        this.revive(p, this.room(START_ROOM));
      }
      playerStep(p, p.input, room.tiles, doors);
      return;
    }

    const ev = playerStep(p, p.input, room.tiles, doors);
    if (ev.attacked) {
      room.fx.push(['sword', p.x + 8, p.y + 8]);
      if (p.hp >= p.maxHp) this.spawnBeam(room, p);
    }
    if (ev.useItem) this.useItem(p, room);

    this.tryPush(p, room, ev);
    this.tryDoors(p, room);
    this.pickUp(p, room);

    const exit = doorwayExit(p, PLAYER_BOX, room.doorState());
    if (exit >= 0) this.throughDoor(p, room, exit);
  }

  revive(p, room) {
    p.ghost = false;
    p.hp = Math.min(p.maxHp, START_HEARTS * 2);
    p.invuln = INVULN_TICKS * 2;
    p.revivedBy = 0;
    room.fx.push(['revive', p.x + 8, p.y + 8]);
    this.banner(`${p.name} IS BACK`, 1200);
  }

  hurtPlayer(p, dmg, sx, sy) {
    if (p.ghost || p.invuln > 0 || p.trans > 0 || this.state !== 'play') return;
    p.hp -= dmg;
    p.invuln = INVULN_TICKS;
    const room = this.room(p.room);
    const dx = (p.x + 8) - sx, dy = (p.y + 8) - sy;
    const len = Math.hypot(dx, dy) || 1;
    p.knockX = Math.round((dx / len) * KNOCKBACK_SPEED);
    p.knockY = Math.round((dy / len) * KNOCKBACK_SPEED);
    p.knockT = KNOCKBACK_TICKS;
    p.atk = 0;
    if (p.hp <= 0) {
      p.hp = 0;
      p.ghost = true;
      p.reviveT = GHOST_AUTO_REVIVE;
      p.revivedBy = 0;
      p.knockT = 0;
      this.deaths++;
      room.fx.push(['die', p.x + 8, p.y + 8]);
      this.banner(`${p.name} HAS FALLEN`, 1600);
    } else {
      room.fx.push(['hurt', p.x + 8, p.y + 8]);
    }
  }

  // --- pushing a block ------------------------------------------------------
  tryPush(p, room, ev) {
    if (!ev.moved || room.pushed) { p.pushT = 0; return; }
    const cx = p.x + 8, cy = p.y + 8;
    const tx = Math.floor((cx + DX[p.dir] * 12) / TILE);
    const ty = Math.floor((cy + DY[p.dir] * 12) / TILE);
    if (tx < 0 || ty < 0 || tx >= ROOM_W || ty >= ROOM_H) { p.pushT = 0; return; }
    if (room.tiles[ty * ROOM_W + tx] !== T.PUSH) { p.pushT = 0; p.pushDir = -1; return; }

    if (p.pushDir !== p.dir) { p.pushDir = p.dir; p.pushT = 0; }
    if (++p.pushT < 18) return;
    p.pushT = 0;

    const def = room.def;
    const isTheOne = def.pushBlock &&
      def.pushBlock.ix + 1 === tx && def.pushBlock.iy + 1 === ty;
    if (!isTheOne) return;

    const nx = tx + DX[p.dir], ny = ty + DY[p.dir];
    if (nx < 1 || ny < 1 || nx >= ROOM_W - 1 || ny >= ROOM_H - 1) return;
    if (room.tiles[ny * ROOM_W + nx] !== T.FLOOR && room.tiles[ny * ROOM_W + nx] !== T.FLOOR_ALT) return;

    room.tiles[ty * ROOM_W + tx] = T.FLOOR;
    room.tiles[ny * ROOM_W + nx] = T.PUSH;
    room.pushed = true;
    room.fx.push(['secret', 128, 88]);
    if (def.pushOpens !== undefined) this.openDoor(room, def.pushOpens);
    this.banner('A SECRET GIVES WAY', 1600);
  }

  // --- doors ---------------------------------------------------------------
  openDoor(room, dir) {
    if (room.opened[dir]) return;
    room.opened[dir] = true;
    const other = neighbourOf(room.def, dir);
    if (other) this.room(other.id).opened[OPPOSITE[dir]] = true;
    room.fx.push(['door', 128, 88]);
    this.metaDirty = true;
  }

  tryDoors(p, room) {
    const doors = room.doorState();
    const cx = p.x + 8, cy = p.y + 8;
    for (let d = 0; d < 4; d++) {
      if (doors[d] !== DS.BARRED) continue;
      const type = room.def.doors[d];
      if (type !== DOOR.LOCK && type !== DOOR.BOSS) continue;
      const [tx, ty] = DOOR_TILES[d][0];
      const dcx = (d === N || d === S) ? 128 : tx * TILE + 8;
      const dcy = (d === N || d === S) ? ty * TILE + 8 : cy;
      if (Math.abs(cx - dcx) > 20 || Math.abs(cy - dcy) > 24) continue;
      if (p.dir !== d) continue;

      if (type === DOOR.LOCK) {
        if (this.party.keys > 0) {
          this.party.keys--;
          this.openDoor(room, d);
          this.banner('THE LOCK FALLS AWAY', 1400);
        }
      } else if (type === DOOR.BOSS) {
        if (this.party.skullKey) {
          this.openDoor(room, d);
          room.fx.push(['boss', 128, 88]);
          this.banner('THE SKULL DOOR OPENS', 1600);
        }
      }
    }
  }

  throughDoor(p, room, dir) {
    const nextDef = neighbourOf(room.def, dir);
    if (!nextDef) return;
    const entry = ENTRY_POS[OPPOSITE[dir]];
    p.room = nextDef.id;
    p.transFrom = room.def.id;
    p.trans = TRANSITION_TICKS;
    p.transDir = dir;
    p.x = entry.x; p.y = entry.y;
    p.dir = dir;
    p.knockT = 0; p.atk = 0;
    p.invuln = Math.max(p.invuln, TRANSITION_TICKS + 10);
    const next = this.room(nextDef.id);
    if (!next.visited) { next.visited = true; this.metaDirty = true; }
  }

  // --- items ---------------------------------------------------------------
  useItem(p, room) {
    if (p.sel === 'bomb') {
      if (this.party.bombs <= 0) return;
      this.party.bombs--;
      this.metaDirty = true;
      const x = clamp(p.x + DX[p.dir] * 14, TILE, PLAY_W - TILE - 16);
      const y = clamp(p.y + DY[p.dir] * 14, TILE, PLAY_H - TILE - 16);
      room.ents.push({
        id: this.entSeq++, kind: KIND.BOMB, x, y, dir: 0, hp: 1, t: 0,
        box: BOX16, fuse: 66, owner: p.id,
      });
      room.fx.push(['bomb', x + 8, y + 8]);
    } else if (p.sel === 'boomerang') {
      if (!this.party.boomerang || p.boomerangOut) return;
      p.boomerangOut = true;
      room.ents.push({
        id: this.entSeq++, kind: KIND.BOOMERANG, x: p.x, y: p.y, dir: p.dir,
        box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, owner: p.id, back: false, dist: 0,
      });
      room.fx.push(['boom', p.x + 8, p.y + 8]);
    } else if (p.sel === 'potion') {
      if (!this.party.potion) return;
      this.party.potion = false;
      p.hp = p.maxHp;
      this.metaDirty = true;
      room.fx.push(['heart', p.x + 8, p.y + 8]);
      this.banner('THE POTION RESTORES YOU', 1400);
    }
  }

  cycleItem(p) {
    const owned = ['bomb'];
    if (this.party.boomerang) owned.push('boomerang');
    if (this.party.potion) owned.push('potion');
    const i = owned.indexOf(p.sel);
    p.sel = owned[(i + 1) % owned.length];
  }

  spawnBeam(room, p) {
    room.ents.push({
      id: this.entSeq++, kind: KIND.BEAM, x: p.x, y: p.y, dir: p.dir,
      box: { x: 3, y: 3, w: 10, h: 10 }, t: 0, owner: p.id,
    });
    room.fx.push(['beam', p.x + 8, p.y + 8]);
  }

  pickUp(p, room) {
    for (const e of room.ents) {
      if (e.kind !== KIND.DROP || e.dead) continue;
      if (e.t < 8) continue;
      if (!rectsOverlap(p.x + 2, p.y + 2, 12, 12, e.x + 2, e.y + 2, 12, 12)) continue;
      this.collect(p, room, e.item);
      if (e.permanent) { room.itemTaken = true; room.rewardGiven = true; }
      e.dead = true;
    }
  }

  collect(p, room, item) {
    const P = this.party;
    switch (item) {
      case PICKUP.HEART:
        p.hp = Math.min(p.maxHp, p.hp + 2);
        room.fx.push(['heart', p.x + 8, p.y + 8]); break;
      case PICKUP.GEM:
        P.gems++; p.gems++; room.fx.push(['gem', p.x + 8, p.y + 8]); break;
      case PICKUP.GEM_BIG:
        P.gems += 30; p.gems += 30; room.fx.push(['item', p.x + 8, p.y + 8]);
        this.banner('THIRTY GEMS!', 1500); break;
      case PICKUP.BOMB:
        P.bombs = Math.min(P.maxBombs, P.bombs + 4);
        room.fx.push(['pickup', p.x + 8, p.y + 8]); break;
      case PICKUP.KEY:
        P.keys++; room.fx.push(['key', p.x + 8, p.y + 8]);
        this.banner('A SMALL KEY', 1300); break;
      case PICKUP.FAIRY: {
        p.hp = p.maxHp;
        for (const o of this.players.values()) if (o.ghost) this.revive(o, this.room(o.room));
        room.fx.push(['item', p.x + 8, p.y + 8]);
        this.banner('THE FAIRY MENDS THE PARTY', 1600); break;
      }
      case PICKUP.CLOCK:
        for (const r of this.rooms.values()) {
          for (const e of r.ents) if (IS_ENEMY(e.kind)) e.stun = Math.max(e.stun || 0, 300);
        }
        room.fx.push(['item', p.x + 8, p.y + 8]);
        this.banner('TIME STOPS', 1500); break;
      case PICKUP.MAP:
        P.map = true; this.itemFanfare(room, p, 'THE DUNGEON MAP'); break;
      case PICKUP.COMPASS:
        P.compass = true; this.itemFanfare(room, p, 'THE COMPASS'); break;
      case PICKUP.BOOMERANG:
        P.boomerang = true; p.sel = 'boomerang';
        this.itemFanfare(room, p, 'THE BOOMERANG'); break;
      case PICKUP.BOMBBAG:
        P.bombs = P.maxBombs; this.itemFanfare(room, p, 'A BAG OF BOMBS'); break;
      case PICKUP.POTION:
        P.potion = true; this.itemFanfare(room, p, 'A RED POTION'); break;
      case PICKUP.SKULL_KEY:
        P.skullKey = true; this.itemFanfare(room, p, 'THE SKULL KEY'); break;
      case PICKUP.HEART_CONTAINER: {
        P.containers = Math.min(MAX_HEARTS - START_HEARTS, P.containers + 1);
        for (const o of this.players.values()) {
          o.maxHp = (START_HEARTS + P.containers) * 2;
          o.hp = o.maxHp;
        }
        this.itemFanfare(room, p, 'A HEART CONTAINER'); break;
      }
      case PICKUP.RELIC:
        P.relic = true;
        this.itemFanfare(room, p, 'THE SUNKEN RELIC');
        this.state = 'win';
        break;
    }
    this.metaDirty = true;
  }

  itemFanfare(room, p, label) {
    room.fx.push(['item', p.x + 8, p.y + 8]);
    this.banner(`${p.name} FOUND ${label}!`, 2200);
  }

  // -------------------------------------------------------------------------
  // Rooms
  // -------------------------------------------------------------------------
  activateRoom(room) {
    room.active = true;
    room.visited = true;
    this.metaDirty = true;
    const def = room.def;

    if (!(def.boss && room.bossDead) && def.enemies?.length) {
      const spots = freeTiles(def).filter(([x, y]) => {
        // keep spawns away from the doorways players walk in through
        return !(y <= 2 && x >= 6 && x <= 9) && !(y >= ROOM_H - 3 && x >= 6 && x <= 9);
      });
      for (const group of def.enemies) {
        for (let i = 0; i < group.n; i++) {
          if (group.k === KIND.WYRM) {
            this.spawnEnemy(room, group.k, 176, 64);
          } else {
            const [tx, ty] = pick(spots);
            this.spawnEnemy(room, group.k, tx * TILE, ty * TILE);
          }
        }
      }
    }

    if (def.item && !room.itemTaken) {
      const t = def.itemTile || { ix: 6, iy: 4 };
      this.spawnDrop(room, (t.ix + 1) * TILE, (t.iy + 1) * TILE, def.item, true);
    }
    if (def.reward && room.cleared && !room.rewardGiven) {
      room.rewardGiven = true;
      this.spawnDrop(room, 120, 80, def.reward, true);
    }
  }

  spawnEnemy(room, kind, x, y) {
    const st = ENEMY[kind];
    room.ents.push({
      id: this.entSeq++, kind, x, y, dir: S, hp: st.hp, box: st.box,
      t: 0, flash: 0, stun: 0, turnT: 0, phase: (rnd() * 60) | 0,
      vx: 0, vy: 0, shootT: 60 + ((rnd() * 90) | 0), hidden: false,
    });
  }

  spawnDrop(room, x, y, item, permanent = false) {
    room.ents.push({
      id: this.entSeq++, kind: KIND.DROP, x, y, item, t: 0,
      box: BOX16, life: permanent ? Infinity : 420, permanent,
    });
  }

  stepRoom(room) {
    const players = this.livingIn(room.def.id);
    const tiles = room.tiles;
    const doors = room.doorState();

    for (const e of room.ents) {
      if (e.dead) continue;
      e.t++;
      if (e.flash > 0) e.flash--;
      if (e.knockT > 0) {
        e.knockT--;
        moveActor(e, e.knockX, e.knockY, tiles, doors, e.box, MODE.WALK, false);
        clampToRoom(e, e.box);
      } else if (e.stun > 0) {
        e.stun--;
      } else {
        this.stepEntity(e, room, players, tiles, doors);
      }
    }

    // sword vs enemies
    for (const p of players) {
      const sb = swordBox(p);
      if (!sb) continue;
      for (const e of room.ents) {
        if (e.dead || !IS_ENEMY(e.kind)) continue;
        const w = ENEMY[e.kind].w || 16, h = ENEMY[e.kind].h || 16;
        if (!rectsOverlap(sb.x, sb.y, sb.w, sb.h, e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h)) continue;
        this.hurtEnemy(e, SWORD_DMG, p.dir, room, p);
      }
    }

    // enemies vs players
    for (const e of room.ents) {
      if (e.dead || !IS_ENEMY(e.kind)) continue;
      if (e.hidden) continue;
      const st = ENEMY[e.kind];
      for (const p of players) {
        if (!rectsOverlap(p.x + PLAYER_BOX.x, p.y + PLAYER_BOX.y, PLAYER_BOX.w, PLAYER_BOX.h,
                          e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h)) continue;
        if (st.grabs) {
          if (p.invuln <= 0) this.grab(p, room, e);
        } else if (st.touch) {
          this.hurtPlayer(p, st.touch, e.x + 8, e.y + 8);
        }
      }
    }

    // clean up + room clear
    let removed = false;
    for (let i = room.ents.length - 1; i >= 0; i--) {
      if (room.ents[i].dead) { room.ents.splice(i, 1); removed = true; }
    }
    if (removed && !room.cleared) {
      const left = room.ents.some(e => IS_ENEMY(e.kind));
      if (!left && room.def.enemies?.length) this.clearRoom(room);
    }
  }

  clearRoom(room) {
    room.cleared = true;
    this.metaDirty = true;
    let openedAny = false;
    for (let d = 0; d < 4; d++) {
      if (room.def.doors[d] === DOOR.SHUT && d !== room.def.pushOpens && !room.opened[d]) {
        this.openDoor(room, d);
        openedAny = true;
      }
    }
    if (openedAny) room.fx.push(['shutter', 128, 88]);
    if (room.def.reward && !room.rewardGiven) {
      room.rewardGiven = true;
      this.spawnDrop(room, 120, 80, room.def.reward, true);
      room.fx.push(['clear', 128, 88]);
    }
  }

  grab(p, room, e) {
    room.fx.push(['grab', p.x + 8, p.y + 8]);
    p.room = START_ROOM;
    p.x = 120; p.y = 100;
    p.trans = TRANSITION_TICKS;
    p.transFrom = room.def.id;
    p.transDir = S;
    p.invuln = INVULN_TICKS * 2;
    p.stun = 0;
    this.banner(`${p.name} WAS DRAGGED AWAY`, 1800);
  }

  hurtEnemy(e, dmg, fromDir, room, byPlayer) {
    if (e.flash > 3) return;             // one hit per swing
    const st = ENEMY[e.kind];
    if (st.armoured && e.dir === OPPOSITE[fromDir]) {
      room.fx.push(['clang', e.x + 8, e.y + 8]);
      if (byPlayer) {
        byPlayer.knockX = -DX[fromDir] * 3;
        byPlayer.knockY = -DY[fromDir] * 3;
        byPlayer.knockT = 4;
      }
      return;
    }
    e.hp -= dmg;
    e.flash = 6;
    if (e.hp > 0) {
      e.knockX = DX[fromDir] * 4;
      e.knockY = DY[fromDir] * 4;
      e.knockT = 5;
      room.fx.push(['hit', e.x + 8, e.y + 8]);
      return;
    }
    this.killEnemy(e, room, byPlayer);
  }

  killEnemy(e, room, byPlayer) {
    e.dead = true;
    this.kills++;
    if (byPlayer) byPlayer.kills++;
    const st = ENEMY[e.kind];
    const cx = e.x + ((st.w || 16) >> 1) - 8;
    const cy = e.y + ((st.h || 16) >> 1) - 8;
    room.fx.push([st.boss ? 'bossdie' : 'die', cx + 8, cy + 8]);

    if (e.kind === KIND.SLIME) {
      for (const off of [-10, 10]) {
        this.spawnEnemy(room, KIND.SLIMELET,
          clamp(e.x + off, TILE, PLAY_W - TILE - 16), e.y);
      }
      return;
    }
    if (st.boss) {
      room.bossDead = true;
      room.cleared = true;
      this.metaDirty = true;
      this.banner('THE WYRM IS SLAIN', 2400);
      for (let d = 0; d < 4; d++) {
        if (room.def.doors[d] === DOOR.SHUT) this.openDoor(room, d);
      }
      if (room.def.reward && !room.rewardGiven) {
        room.rewardGiven = true;
        this.spawnDrop(room, 120, 96, room.def.reward, true);
      }
      return;
    }
    const item = rollDrop();
    if (item !== null) this.spawnDrop(room, cx, cy, item);
  }

  // -------------------------------------------------------------------------
  // Entity behaviour
  // -------------------------------------------------------------------------
  stepEntity(e, room, players, tiles, doors) {
    const target = nearest(e, players);
    switch (e.kind) {
      case KIND.BAT:        return this.aiBat(e, room, target, tiles, doors);
      case KIND.SLIME:
      case KIND.SLIMELET:   return this.aiSlime(e, room, target, tiles, doors);
      case KIND.BONEWALKER: return this.aiWalker(e, room, target, tiles, doors, 0.55);
      case KIND.HURLER:     return this.aiHurler(e, room, target, tiles, doors);
      case KIND.IRONCLAD:   return this.aiWalker(e, room, target, tiles, doors, 0.35, 45);
      case KIND.WISP:       return this.aiWisp(e, room, target, tiles, doors);
      case KIND.GRABHAND:   return this.aiWalker(e, room, target, tiles, doors, 0.8);
      case KIND.WYRM:       return this.aiWyrm(e, room, target, players);

      case KIND.FIREBALL:
      case KIND.MAGIC:      return this.stepShot(e, room, tiles, doors, players);
      case KIND.BLADE:      return this.stepBlade(e, room, tiles, doors, players);
      case KIND.BEAM:       return this.stepBeam(e, room, tiles, doors);
      case KIND.BOOMERANG:  return this.stepBoomerang(e, room, tiles, doors);
      case KIND.BOMB:       return this.stepBomb(e, room);
      case KIND.BLAST:      return this.stepBlast(e, room, players);
      case KIND.DROP:
        if (e.life !== Infinity && --e.life <= 0) e.dead = true;
        return;
    }
  }

  aiBat(e, room, target, tiles, doors) {
    const sp = ENEMY[e.kind].speed;
    if (e.t % 22 === 0 || (e.vx === 0 && e.vy === 0)) {
      const ang = rnd() * Math.PI * 2;
      e.vx = Math.cos(ang) * sp;
      e.vy = Math.sin(ang) * sp;
      if (target && rnd() < 0.4) {
        const dx = target.x - e.x, dy = target.y - e.y;
        const len = Math.hypot(dx, dy) || 1;
        e.vx = (dx / len) * sp; e.vy = (dy / len) * sp;
      }
    }
    const hit = moveActor(e, e.vx, e.vy, tiles, doors, e.box, MODE.FLY, false);
    if (hit.hitX) e.vx *= -1;
    if (hit.hitY) e.vy *= -1;
    clampToRoom(e, e.box);
    e.dir = Math.abs(e.vx) > Math.abs(e.vy) ? (e.vx > 0 ? E : W) : (e.vy > 0 ? S : N);
  }

  aiSlime(e, room, target, tiles, doors) {
    const sp = ENEMY[e.kind].speed;
    e.phase = (e.phase + 1) % 56;
    if (e.phase === 0 && target) {
      const dx = target.x - e.x, dy = target.y - e.y;
      e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? E : W) : (dy > 0 ? S : N);
    }
    if (e.phase < 26) {
      const hit = moveActor(e, DX[e.dir] * sp, DY[e.dir] * sp, tiles, doors, e.box, MODE.WALK, false);
      if (hit.hitX || hit.hitY) e.dir = (e.dir + 1) & 3;
    }
  }

  aiWalker(e, room, target, tiles, doors, bias, runFor = 26) {
    const sp = ENEMY[e.kind].speed;
    if (--e.turnT <= 0) {
      e.turnT = runFor + ((rnd() * runFor) | 0);
      e.dir = this.chooseDir(e, target, bias);
    }
    const hit = moveActor(e, DX[e.dir] * sp, DY[e.dir] * sp, tiles, doors, e.box, MODE.WALK, false);
    if (hit.hitX || hit.hitY) {
      e.turnT = 0;
      e.dir = this.chooseDir(e, target, bias * 0.5);
    }
    clampToRoom(e, e.box);
  }

  chooseDir(e, target, bias) {
    if (target && rnd() < bias) {
      const dx = target.x - e.x, dy = target.y - e.y;
      if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? E : W;
      return dy > 0 ? S : N;
    }
    return (rnd() * 4) | 0;
  }

  aiHurler(e, room, target, tiles, doors) {
    this.aiWalker(e, room, target, tiles, doors, 0.5);
    if (--e.shootT <= 0) {
      e.shootT = 110 + ((rnd() * 70) | 0);
      room.ents.push({
        id: this.entSeq++, kind: KIND.BLADE, x: e.x, y: e.y, dir: e.dir,
        box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, owner: e.id, dist: 0, back: false,
      });
      room.fx.push(['throw', e.x + 8, e.y + 8]);
    }
  }

  aiWisp(e, room, target, tiles, doors) {
    // 0-70 visible (fires at 40), 70-90 fading, 90-130 gone, then reappear
    e.phase = (e.phase + 1) % 130;
    e.hidden = e.phase >= 78;
    if (e.phase === 40 && target) {
      const dx = target.x - e.x, dy = target.y - e.y;
      e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? E : W) : (dy > 0 ? S : N);
      room.ents.push({
        id: this.entSeq++, kind: KIND.MAGIC, x: e.x, y: e.y, dir: e.dir,
        box: { x: 3, y: 3, w: 10, h: 10 }, t: 0, speed: 3,
      });
      room.fx.push(['magic', e.x + 8, e.y + 8]);
    }
    if (e.phase === 0) {
      const spots = freeTiles(room.def);
      const [tx, ty] = pick(spots);
      e.x = tx * TILE; e.y = ty * TILE;
      room.fx.push(['magic', e.x + 8, e.y + 8]);
    }
  }

  aiWyrm(e, room, target, players) {
    const st = ENEMY[KIND.WYRM];
    if (e.vy === 0) e.vy = st.speed;
    e.y += e.vy;
    if (e.y < TILE + 4) { e.y = TILE + 4; e.vy = st.speed; }
    if (e.y > PLAY_H - TILE - 36) { e.y = PLAY_H - TILE - 36; e.vy = -st.speed; }
    e.x = clamp(e.x + (rnd() < 0.02 ? (rnd() < 0.5 ? -1 : 1) * 4 : 0), 120, PLAY_W - TILE - 34);

    if (--e.shootT <= 0) {
      e.shootT = 95;
      e.mouth = 16;
      for (const dy of [-1, 0, 1]) {
        const ent = {
          id: this.entSeq++, kind: KIND.FIREBALL, x: e.x - 4, y: e.y + 14, dir: W,
          box: { x: 0, y: 0, w: 8, h: 8 }, t: 0, speed: 2.3, vy: dy * 0.9,
        };
        room.ents.push(ent);
      }
      room.fx.push(['fire', e.x, e.y + 16]);
    }
    if (e.mouth > 0) e.mouth--;
  }

  stepShot(e, room, tiles, doors, players) {
    const sp = e.speed || 2.5;
    e.x += DX[e.dir] * sp;
    e.y += DY[e.dir] * sp + (e.vy || 0);
    if (boxBlocked(tiles, doors, e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h, MODE.SHOT) ||
        e.x < 0 || e.y < 0 || e.x > PLAY_W || e.y > PLAY_H || e.t > 180) {
      e.dead = true;
      room.fx.push(['fizzle', e.x + 4, e.y + 4]);
      return;
    }
    for (const p of players) {
      if (rectsOverlap(p.x + PLAYER_BOX.x, p.y + PLAYER_BOX.y, PLAYER_BOX.w, PLAYER_BOX.h,
                       e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h)) {
        this.hurtPlayer(p, 2, e.x + 4, e.y + 4);
        e.dead = true;
        return;
      }
    }
  }

  stepBlade(e, room, tiles, doors, players) {
    const sp = 3;
    const owner = room.ents.find(o => o.id === e.owner && !o.dead);
    if (!e.back) {
      e.x += DX[e.dir] * sp; e.y += DY[e.dir] * sp; e.dist += sp;
      if (e.dist > 58 || boxBlocked(tiles, doors, e.x + 4, e.y + 4, 8, 8, MODE.SHOT)) e.back = true;
    } else {
      if (!owner) { e.dead = true; return; }
      const dx = owner.x - e.x, dy = owner.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      e.x += (dx / len) * (sp + 1); e.y += (dy / len) * (sp + 1);
      if (len < 8) { e.dead = true; return; }
    }
    if (e.t > 200) e.dead = true;
    for (const p of players) {
      if (rectsOverlap(p.x + PLAYER_BOX.x, p.y + PLAYER_BOX.y, PLAYER_BOX.w, PLAYER_BOX.h,
                       e.x + 4, e.y + 4, 8, 8)) {
        this.hurtPlayer(p, 2, e.x + 8, e.y + 8);
        e.dead = true;
        return;
      }
    }
  }

  stepBeam(e, room, tiles, doors) {
    const sp = 5;
    e.x += DX[e.dir] * sp; e.y += DY[e.dir] * sp;
    if (boxBlocked(tiles, doors, e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h, MODE.SHOT) ||
        e.t > 60) {
      e.dead = true;
      room.fx.push(['fizzle', e.x + 8, e.y + 8]);
      return;
    }
    for (const o of room.ents) {
      if (o.dead || !IS_ENEMY(o.kind)) continue;
      if (rectsOverlap(e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h,
                       o.x + o.box.x, o.y + o.box.y, o.box.w, o.box.h)) {
        this.hurtEnemy(o, 2, e.dir, room, this.players.get(e.owner));
        e.dead = true;
        return;
      }
    }
  }

  stepBoomerang(e, room, tiles, doors) {
    const owner = this.players.get(e.owner);
    const sp = 4.5;
    if (!e.back) {
      e.x += DX[e.dir] * sp; e.y += DY[e.dir] * sp; e.dist += sp;
      if (e.dist > 96 || boxBlocked(tiles, doors, e.x + 4, e.y + 4, 8, 8, MODE.SHOT)) e.back = true;
    } else {
      if (!owner || owner.room !== room.def.id) { e.dead = true; if (owner) owner.boomerangOut = false; return; }
      const dx = owner.x - e.x, dy = owner.y - e.y;
      const len = Math.hypot(dx, dy) || 1;
      e.x += (dx / len) * (sp + 1.5); e.y += (dy / len) * (sp + 1.5);
      if (len < 10) { e.dead = true; owner.boomerangOut = false; return; }
    }
    if (e.t > 240) { e.dead = true; if (owner) owner.boomerangOut = false; }

    for (const o of room.ents) {
      if (o.dead || o.id === e.id) continue;
      if (!rectsOverlap(e.x + 4, e.y + 4, 8, 8, o.x + (o.box?.x ?? 2), o.y + (o.box?.y ?? 2),
                        o.box?.w ?? 12, o.box?.h ?? 12)) continue;
      if (o.kind === KIND.DROP && owner) {
        this.collect(owner, room, o.item);
        o.dead = true;
      } else if (IS_ENEMY(o.kind)) {
        const frail = o.kind === KIND.BAT || o.kind === KIND.SLIMELET || o.kind === KIND.SLIME;
        if (frail) this.hurtEnemy(o, 2, e.dir, room, owner);
        else { o.stun = Math.max(o.stun, 70); room.fx.push(['hit', o.x + 8, o.y + 8]); }
        e.back = true;
      }
    }
  }

  stepBomb(e, room) {
    if (--e.fuse > 0) return;
    e.dead = true;
    room.ents.push({
      id: this.entSeq++, kind: KIND.BLAST, x: e.x - 8, y: e.y - 8,
      box: { x: 0, y: 0, w: 32, h: 32 }, t: 0, life: 21, hurt: true,
    });
    room.fx.push(['blast', e.x + 8, e.y + 8]);

    // Crack open a bombable wall if the charge was set beside one.
    const cx = e.x + 8, cy = e.y + 8;
    for (let d = 0; d < 4; d++) {
      if (room.def.doors[d] !== DOOR.BOMB || room.opened[d]) continue;
      const [tx, ty] = DOOR_TILES[d][0];
      const dcx = (d === N || d === S) ? 128 : tx * TILE + 8;
      const dcy = (d === N || d === S) ? ty * TILE + 8 : ty * TILE + 8;
      if (Math.hypot(cx - dcx, cy - dcy) < 40) {
        this.openDoor(room, d);
        room.fx.push(['secret', 128, 88]);
        this.banner('THE WALL CRUMBLES', 1800);
      }
    }
  }

  stepBlast(e, room, players) {
    if (e.hurt) {
      e.hurt = false;
      for (const o of room.ents) {
        if (o.dead || !IS_ENEMY(o.kind)) continue;
        if (rectsOverlap(e.x, e.y, 32, 32, o.x + o.box.x, o.y + o.box.y, o.box.w, o.box.h)) {
          o.flash = 0;
          this.hurtEnemy(o, BOMB_DMG, (rnd() * 4) | 0, room, null);
        }
      }
      // Your own bombs never hurt you — same as the game this follows, and it
      // keeps a four-player party from blowing each other up by accident.
    }
    if (--e.life <= 0) e.dead = true;
  }

  // -------------------------------------------------------------------------
  // Death + restart
  // -------------------------------------------------------------------------
  continueAfterDeath() {
    this.state = 'play';
    for (const p of this.players.values()) {
      p.ghost = false;
      p.room = START_ROOM;
      p.x = 120; p.y = 100;
      p.hp = p.maxHp;
      p.invuln = INVULN_TICKS;
      p.trans = 0;
      p.knockT = 0;
      p.boomerangOut = false;
    }
    for (const room of this.rooms.values()) { room.ents.length = 0; room.active = false; }
    this.banner('THE CRYPT DRAWS YOU BACK', 2200);
    this.metaDirty = true;
  }

  restart() {
    for (const [id, def] of ROOM_BY_ID) this.rooms.set(id, new RoomState(def));
    Object.assign(this.party, {
      keys: 0, bombs: 0, gems: 0, map: false, compass: false,
      boomerang: false, skullKey: false, relic: false, potion: false, containers: 0,
    });
    this.kills = 0; this.deaths = 0;
    this.state = 'play';
    this.startedAt = Date.now();
    for (const p of this.players.values()) {
      p.maxHp = START_HEARTS * 2;
      p.hp = p.maxHp;
      p.ghost = false;
      p.room = START_ROOM;
      p.x = 120; p.y = 100;
      p.gems = 0; p.kills = 0;
      p.sel = 'bomb';
      p.queue.length = 0;
      p.prev = 0;
      p.boomerangOut = false;
    }
    this.room(START_ROOM).visited = true;
    this.metaDirty = true;
  }

  begin() {
    this.restart();
    this.banner(DUNGEON_NAME, 2600);
  }

  // -------------------------------------------------------------------------
  // Wire format
  // -------------------------------------------------------------------------
  snapshotFor(p) {
    const room = this.room(p.room);
    const doors = room.doorState();
    const ents = [];
    for (const e of room.ents) {
      if (e.dead) continue;
      let flags = 0;
      if (e.flash > 0) flags |= 1;
      if (e.stun > 0) flags |= 2;
      if (e.hidden) flags |= 4;
      if (e.mouth > 0) flags |= 8;
      ents.push([e.id, e.kind, Math.round(e.x), Math.round(e.y), e.dir | 0, flags,
                 e.kind === KIND.DROP ? e.item : (e.kind === KIND.WYRM ? e.hp : 0)]);
    }
    const others = [];
    for (const o of this.players.values()) {
      if (o.id === p.id || o.room !== p.room) continue;
      others.push([o.id, Math.round(o.x), Math.round(o.y), o.dir,
                   PLAYER_COLORS.indexOf(o.colour), o.ghost ? 1 : 0, o.atk, o.hp, o.maxHp, o.walk]);
    }
    const party = [];
    for (const o of this.players.values()) {
      party.push([o.id, o.hp, o.maxHp, o.room, o.ghost ? 1 : 0]);
    }
    return {
      t: 's', k: this.tick, a: p.seq,
      me: [Math.round(p.x), Math.round(p.y), p.dir, p.hp, p.maxHp, p.atk,
           p.invuln, p.ghost ? 1 : 0, p.trans, p.transDir ?? 0, p.walk,
           p.knockT, Math.round(p.knockX), Math.round(p.knockY), p.reviveT | 0, p.revivedBy | 0],
      r: [room.def.id, doors[0], doors[1], doors[2], doors[3],
          room.cleared ? 1 : 0, room.pushed ? 1 : 0, p.transFrom || ''],
      e: ents, o: others, pl: party,
      f: room.fx,
    };
  }

  metaFor() {
    const P = this.party;
    const map = [];
    for (const room of this.rooms.values()) {
      if (!room.visited && !P.map) continue;
      map.push([room.def.id, room.visited ? 1 : 0, room.cleared ? 1 : 0,
                room.def.boss ? 1 : 0, room.def.item && !room.itemTaken ? 1 : 0]);
    }
    return {
      t: 'm',
      p: [P.keys, P.bombs, P.gems, P.map ? 1 : 0, P.compass ? 1 : 0,
          P.boomerang ? 1 : 0, P.skullKey ? 1 : 0, P.relic ? 1 : 0,
          P.potion ? 1 : 0, P.containers],
      map,
      players: [...this.players.values()].map(o => [o.id, o.name, o.colour, o.sel]),
      state: this.state,
    };
  }

  clearFx() {
    for (const room of this.rooms.values()) if (room.fx.length) room.fx = [];
  }
}

function nearest(e, players) {
  let best = null, bd = Infinity;
  for (const p of players) {
    const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2;
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
