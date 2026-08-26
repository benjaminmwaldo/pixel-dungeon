// The authoritative simulation. One instance per party.
// Twenty-five floors, five chapters, a boss on every fifth. Everything that
// decides an outcome happens here; clients only predict their own movement.

import {
  TILE, KIND, CLASSES, CLASS_ORDER, PLAYER_BOX, INVULN_TICKS,
  KNOCKBACK_TICKS, KNOCKBACK_SPEED, REVIVE_TICKS, GHOST_TICKS, MAX_PLAYERS,
  XP_PER_LEVEL, HP_PER_LEVEL, HUNGER_MAX, HUNGER_HURT, N, E, S, W, DX, DY,
  isMob, isBoss, rectsOverlap, clamp, dist2,
} from '../shared/constants.js';
import {
  LEVEL_W, LEVEL_LEN, TT, idx, tx, ty, inBounds, passable,
  regionOf, rngFor, MAX_DEPTH, REGIONS,
} from '../shared/terrain.js';
import { generate } from '../shared/levelgen.js';
import { viewFrom, hasLine } from '../shared/fov.js';
import {
  MODE, moveActor, boxBlocked, tileUnder, centreTile, tileToPixel, clampToLevel,
} from '../shared/physics.js';
import { newPlayerState, playerStep, meleeBox } from '../shared/player.js';
import { MOBS, SPAWNS, BOSS_OF, mobBudget, scaleFor, HEARING } from '../shared/mobs.js';
import {
  ITEM, POTION, SCROLL, makeAppearances, rollLoot, rollPrize, rollDrop,
  WEAPONS, ARMORS, isConsumable, stackKey,
} from '../shared/items.js';

const QUICK_SLOTS = 8;

// ---------------------------------------------------------------------------
class Floor {
  constructor(depth, seed) {
    this.depth = depth;
    this.level = generate(depth, seed);
    this.tiles = this.level.tiles;              // mutated in play (doors, grass)
    this.explored = new Uint8Array(LEVEL_LEN);  // what the party has seen
    this.ents = [];
    this.changes = [];                          // tile edits since the last snapshot
    this.fx = [];
    this.active = false;
    this.spawnTimer = 300;
    this.bossDead = false;
    this.flow = new Int16Array(LEVEL_LEN).fill(-1);
    this.flowAge = 0;
    this.rng = rngFor((seed * 7919 + depth * 104729) >>> 0);
    this.populated = false;
  }

  set(i, tile) {
    if (this.tiles[i] === tile) return;
    this.tiles[i] = tile;
    this.changes.push([i, tile]);
  }
}

// ---------------------------------------------------------------------------
export class Game {
  constructor(code) {
    this.code = code;
    this.tick = 0;
    this.entSeq = 1;
    this.players = new Map();
    this.floors = new Map();
    this.state = 'lobby';
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.app = makeAppearances(this.seed);
    this.known = { potions: [], scrolls: [] };
    this.metaDirty = true;
    this.banners = [];
    this.overTimer = 0;
    this.startedAt = 0;
    this.kills = 0;
    this.deaths = 0;
    this.deepest = 1;
    this.lastActivity = Date.now();
  }

  floor(depth) {
    let f = this.floors.get(depth);
    if (!f) { f = new Floor(depth, this.seed); this.floors.set(depth, f); }
    return f;
  }

  // -- players --------------------------------------------------------------
  addPlayer(id, name, wanted) {
    if (this.players.size >= MAX_PLAYERS) return null;
    const taken = new Set([...this.players.values()].map(p => p.cls));
    const cls = (wanted && CLASSES[wanted] && !taken.has(wanted))
      ? wanted
      : (CLASS_ORDER.find(c => !taken.has(c)) || CLASS_ORDER[0]);
    const def = CLASSES[cls];

    const p = Object.assign(newPlayerState(), {
      id, name: (name || 'HERO').slice(0, 8).toUpperCase(),
      cls, colour: def.colour,
      depth: 1, hp: def.hp, maxHp: def.hp, level: 1, xp: 0,
      weapon: { tier: 1, upgrade: 0 },
      armor: { tier: 1, upgrade: 0 },
      inv: [], gold: 0, hunger: HUNGER_MAX, hungerTick: 0,
      invuln: 0, reviveT: 0, revivedBy: 0,
      input: 0, seq: 0, queue: [], ready: false,
      fov: new Uint8Array(LEVEL_LEN), fovTile: -1,
      invis: 0, haste: 0, might: 0, kills: 0, needFloor: true,
    });
    this.players.set(id, p);
    this.metaDirty = true;
    this.lastActivity = Date.now();
    return p;
  }

  removePlayer(id) { this.players.delete(id); this.metaDirty = true; }

  playersOn(depth) {
    const out = [];
    for (const p of this.players.values()) if (p.depth === depth) out.push(p);
    return out;
  }
  livingOn(depth) { return this.playersOn(depth).filter(p => !p.ghost); }

  banner(m, ms = 1800) { this.banners.push({ m, ms }); }

  fx(f, kind, x, y) { f.fx.push([kind, Math.round(x), Math.round(y)]); }

  // =========================================================================
  // Tick
  // =========================================================================
  step() {
    this.tick++;
    if (this.state === 'over') {
      if (--this.overTimer <= 0) this.restart();
      return;
    }
    if (this.state !== 'play') return;

    for (const p of this.players.values()) this.stepPlayer(p);

    const live = new Set([...this.players.values()].map(p => p.depth));
    for (const [depth, f] of this.floors) {
      if (live.has(depth)) {
        if (!f.active) this.wakeFloor(f);
        this.stepFloor(f);
      } else if (f.active) {
        f.active = false;
      }
    }

    for (const p of this.players.values()) this.refreshFov(p);

    const alive = [...this.players.values()].filter(p => !p.ghost);
    if (this.players.size && !alive.length) {
      this.state = 'over';
      this.overTimer = 150;
      this.banner('THE PARTY HAS FALLEN', 3000);
    }
  }

  // -------------------------------------------------------------------------
  // Player
  // -------------------------------------------------------------------------
  stepPlayer(p) {
    const next = p.queue.shift();
    if (next) { p.input = next.bits; p.seq = next.seq; }

    const f = this.floor(p.depth);
    if (p.invuln > 0) p.invuln--;
    if (p.invis > 0) p.invis--;
    if (p.haste > 0) p.haste--;
    if (p.might > 0) p.might--;

    if (p.ghost) {
      p.reviveT--;
      const helper = this.livingOn(p.depth).find(o =>
        rectsOverlap(p.x + 4, p.y + 4, 8, 8, o.x + 4, o.y + 4, 8, 8));
      if (helper) {
        if (++p.revivedBy >= REVIVE_TICKS) this.revive(p, f);
      } else p.revivedBy = 0;
      if (p.reviveT <= 0) {
        const spot = tileToPixel(f.level.entrance, PLAYER_BOX);
        p.x = spot.x; p.y = spot.y;
        this.revive(p, f);
      }
      playerStep(p, p.input, f.tiles, p.cls);
      return;
    }

    const ev = playerStep(p, p.input, f.tiles, p.cls);

    // walking into a shut door opens it; a locked one wants this floor's key
    if (ev.blockedBy >= 0) {
      const t = f.tiles[ev.blockedBy];
      if (t === TT.DOOR) {
        f.set(ev.blockedBy, TT.OPEN_DOOR);
        this.fx(f, 'door', tx(ev.blockedBy) * TILE + 8, ty(ev.blockedBy) * TILE + 8);
      } else if (t === TT.LOCKED_DOOR) {
        const slot = p.inv.findIndex(s => s.item.type === ITEM.KEY);
        if (slot >= 0) {
          if (--p.inv[slot].count <= 0) p.inv.splice(slot, 1);
          f.set(ev.blockedBy, TT.OPEN_DOOR);
          this.fx(f, 'unlock', tx(ev.blockedBy) * TILE + 8, ty(ev.blockedBy) * TILE + 8);
          this.banner('THE LOCK FALLS AWAY', 1400);
          this.metaDirty = true;
        }
      }
    }

    if (ev.attacked) {
      this.fx(f, 'swing', p.x + 8, p.y + 8);
      this.resolveMelee(p, f);
    }
    if (ev.ability) this.useAbility(p, f);

    this.underfoot(p, f);
    this.pickups(p, f);
    this.hunger(p);
  }

  revive(p, f) {
    p.ghost = false;
    p.hp = Math.max(1, Math.round(p.maxHp * 0.4));
    p.invuln = INVULN_TICKS * 3;
    p.revivedBy = 0;
    this.fx(f, 'revive', p.x + 8, p.y + 8);
    this.banner(`${p.name} IS BACK ON THEIR FEET`, 1400);
    this.metaDirty = true;
  }

  hurtPlayer(p, dmg, sx, sy) {
    if (p.ghost || p.invuln > 0 || this.state !== 'play') return;
    const armour = ARMORS[p.armor.tier - 1].def + p.armor.upgrade * 1.5;
    let taken = Math.max(1, Math.round(dmg - armour * 0.5));
    if (p.guarding) taken = Math.max(0, Math.round(taken * 0.35));
    p.hp -= taken;
    p.invuln = INVULN_TICKS;
    const f = this.floor(p.depth);
    const dx = (p.x + 8) - sx, dy = (p.y + 8) - sy;
    const len = Math.hypot(dx, dy) || 1;
    p.knockX = Math.round((dx / len) * KNOCKBACK_SPEED);
    p.knockY = Math.round((dy / len) * KNOCKBACK_SPEED);
    p.knockT = KNOCKBACK_TICKS;
    p.atk = 0;
    if (p.hp <= 0) {
      p.hp = 0;
      p.ghost = true;
      p.reviveT = GHOST_TICKS;
      p.revivedBy = 0;
      p.knockT = 0;
      this.deaths++;
      this.fx(f, 'die', p.x + 8, p.y + 8);
      this.banner(`${p.name} HAS FALLEN ON FLOOR ${p.depth}`, 2200);
    } else {
      this.fx(f, 'hurt', p.x + 8, p.y + 8);
    }
    this.metaDirty = true;
  }

  healPlayer(p, amount) {
    p.hp = Math.min(p.maxHp, p.hp + amount);
    this.metaDirty = true;
  }

  gainXp(p, amount) {
    p.xp += amount;
    while (p.xp >= XP_PER_LEVEL(p.level)) {
      p.xp -= XP_PER_LEVEL(p.level);
      p.level++;
      p.maxHp += HP_PER_LEVEL;
      p.hp = p.maxHp;
      this.fx(this.floor(p.depth), 'levelup', p.x + 8, p.y + 8);
      this.banner(`${p.name} REACHED LEVEL ${p.level}`, 1600);
    }
    this.metaDirty = true;
  }

  // --- melee ---------------------------------------------------------------
  resolveMelee(p, f) {
    const def = CLASSES[p.cls];
    const box = meleeBox(p, def.reach);
    if (!box) return;
    let dmg = def.melee + WEAPONS[p.weapon.tier - 1].dmg + p.weapon.upgrade * 2
            + Math.floor(p.level * 0.6);
    if (p.might > 0) dmg = Math.round(dmg * 1.5);
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind)) continue;
      if (!rectsOverlap(box.x, box.y, box.w, box.h,
                        e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h)) continue;
      this.hurtMob(e, dmg, p.dir, f, p);
    }
    // cut a path through the undergrowth
    const ahead = tileUnder({ x: p.x + DX[p.dir] * 10, y: p.y + DY[p.dir] * 10 }, PLAYER_BOX);
    if (f.tiles[ahead] === TT.HIGH_GRASS) f.set(ahead, TT.GRASS);
    if (f.tiles[ahead] === TT.BARRICADE) f.set(ahead, TT.EMBERS);
  }

  useAbility(p, f) {
    const def = CLASSES[p.cls];
    if (def.ranged) {
      this.fx(f, def.ranged.kind === KIND.ARROW ? 'arrow' : 'bolt', p.x + 8, p.y + 8);
      f.ents.push({
        id: this.entSeq++, kind: def.ranged.kind, x: p.x, y: p.y, dir: p.dir,
        box: { x: 4, y: 4, w: 8, h: 8 }, t: 0,
        speed: def.ranged.speed, range: def.ranged.range, travelled: 0,
        dmg: def.ranged.dmg + Math.floor(p.level * 0.8) + p.weapon.upgrade * 2,
        owner: p.id, friendly: true,
      });
    } else if (p.cls === 'rogue') {
      p.invis = 150;
      this.fx(f, 'cloak', p.x + 8, p.y + 8);
      this.banner(`${p.name} SLIPS INTO SHADOW`, 1200);
    }
  }

  // --- what you are standing on -------------------------------------------
  underfoot(p, f) {
    const i = tileUnder(p, PLAYER_BOX);
    const t = f.tiles[i];

    if (t === TT.HIGH_GRASS && Math.random() < 0.2) f.set(i, TT.GRASS);

    if (t === TT.TRAP_HIDDEN || t === TT.TRAP) {
      f.set(i, TT.TRAP_SPENT);
      this.springTrap(p, f, i);
    }
    // a rogue reads the floor before standing on it
    if (p.cls === 'rogue') {
      const cx = tx(i), cy = ty(i);
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (!inBounds(nx, ny)) continue;
          const j = idx(nx, ny);
          if (f.tiles[j] === TT.TRAP_HIDDEN) f.set(j, TT.TRAP);
        }
      }
    }
  }

  springTrap(p, f, i) {
    this.fx(f, 'trap', tx(i) * TILE + 8, ty(i) * TILE + 8);
    this.hurtPlayer(p, 3 + f.depth, p.x + 8, p.y + 20);
    this.banner('A TRAP!', 900);
    const region = regionOf(f.depth);
    if (region.key === 'caves' || region.key === 'halls') {
      for (const e of f.ents) if (isMob(e.kind)) e.alerted = 600;
    }
  }

  // --- loot ----------------------------------------------------------------
  pickups(p, f) {
    for (const e of f.ents) {
      if (e.dead || e.kind !== KIND.ITEM || e.t < 6) continue;
      if (!rectsOverlap(p.x + 2, p.y + 2, 12, 12, e.x + 2, e.y + 2, 12, 12)) continue;
      if (this.take(p, f, e.item)) e.dead = true;
    }
  }

  /** True if the item left the floor. */
  take(p, f, item) {
    switch (item.type) {
      case ITEM.GOLD:
        p.gold += item.amount;
        this.fx(f, 'gold', p.x + 8, p.y + 8);
        this.metaDirty = true;
        return true;
      case ITEM.RELIC:
        this.state = 'win';
        this.banner('THE AMULET IS YOURS', 4000);
        return true;
      case ITEM.WEAPON: {
        if (item.tier * 3 + (item.upgrade || 0) <= p.weapon.tier * 3 + p.weapon.upgrade) return false;
        p.weapon = { tier: item.tier, upgrade: item.upgrade || 0 };
        this.fx(f, 'equip', p.x + 8, p.y + 8);
        this.banner(`${p.name} TAKES UP THE ${WEAPONS[item.tier - 1].name}`, 1600);
        this.metaDirty = true;
        return true;
      }
      case ITEM.ARMOR: {
        if (item.tier * 3 + (item.upgrade || 0) <= p.armor.tier * 3 + p.armor.upgrade) return false;
        p.armor = { tier: item.tier, upgrade: item.upgrade || 0 };
        this.fx(f, 'equip', p.x + 8, p.y + 8);
        this.banner(`${p.name} DONS THE ${ARMORS[item.tier - 1].name}`, 1600);
        this.metaDirty = true;
        return true;
      }
      default: {
        if (!isConsumable(item)) return false;
        const key = stackKey(item);
        const slot = p.inv.find(s => s.key === key);
        const n = item.amount || 1;
        if (slot) slot.count += n;
        else {
          if (p.inv.length >= QUICK_SLOTS) return false;
          const copy = { ...item };
          delete copy.amount;
          p.inv.push({ key, item: copy, count: n });
        }
        this.fx(f, 'pickup', p.x + 8, p.y + 8);
        this.metaDirty = true;
        return true;
      }
    }
  }

  useSlot(p, n) {
    if (p.ghost || this.state !== 'play') return;
    const f = this.floor(p.depth);
    const slot = p.inv[n];
    if (!slot) return;
    const it = slot.item;
    if (it.type === ITEM.KEY || it.type === ITEM.GOLDKEY) return; // spent by walking into a door

    if (it.type === ITEM.FOOD) {
      p.hunger = HUNGER_MAX;
      this.healPlayer(p, 4);
      this.fx(f, 'eat', p.x + 8, p.y + 8);
    } else if (it.type === ITEM.BOMB) {
      f.ents.push({
        id: this.entSeq++, kind: KIND.BOMB,
        x: p.x + DX[p.dir] * 14, y: p.y + DY[p.dir] * 14,
        box: { x: 2, y: 2, w: 12, h: 12 }, t: 0, fuse: 60, owner: p.id,
      });
      this.fx(f, 'bomb', p.x + 8, p.y + 8);
    } else if (it.type === ITEM.POTION) {
      this.drink(p, f, it.kind);
    } else if (it.type === ITEM.SCROLL) {
      this.read(p, f, it.kind);
    }
    if (--slot.count <= 0) p.inv.splice(n, 1);
    this.metaDirty = true;
  }

  drink(p, f, kind) {
    if (!this.known.potions.includes(kind)) {
      this.known.potions.push(kind);
      this.banner(`IT WAS A POTION OF ${kind.toUpperCase()}`, 1800);
    }
    this.fx(f, 'drink', p.x + 8, p.y + 8);
    switch (kind) {
      case POTION.HEALING: this.healPlayer(p, Math.round(p.maxHp * 0.7)); break;
      case POTION.STRENGTH: p.maxHp += 3; p.hp += 3; this.banner(`${p.name} FEELS STRONGER`, 1500); break;
      case POTION.HASTE: p.haste = 450; break;
      case POTION.INVIS: p.invis = 450; break;
      case POTION.MIGHT: p.might = 450; break;
      case POTION.FIRE: this.burst(f, p.x + 8, p.y + 8, 44, 10 + f.depth, p); break;
      case POTION.TOXIC: this.burst(f, p.x + 8, p.y + 8, 60, 6 + f.depth, p); break;
      case POTION.FROST: this.freezeNear(f, p.x + 8, p.y + 8, 90); break;
      case POTION.PARALYSIS: this.freezeNear(f, p.x + 8, p.y + 8, 130); break;
      default: break;
    }
  }

  read(p, f, kind) {
    if (!this.known.scrolls.includes(kind)) {
      this.known.scrolls.push(kind);
      this.banner(`IT WAS A SCROLL OF ${kind.toUpperCase()}`, 1800);
    }
    this.fx(f, 'read', p.x + 8, p.y + 8);
    switch (kind) {
      case SCROLL.UPGRADE:
        if (p.weapon.tier * 3 + p.weapon.upgrade <= p.armor.tier * 3 + p.armor.upgrade) p.weapon.upgrade++;
        else p.armor.upgrade++;
        this.banner(`${p.name}'S GEAR GLOWS`, 1600);
        break;
      case SCROLL.IDENTIFY: {
        for (const s of p.inv) {
          if (s.item.type === ITEM.POTION && !this.known.potions.includes(s.item.kind)) {
            this.known.potions.push(s.item.kind);
            this.banner(`IT IS A POTION OF ${s.item.kind.toUpperCase()}`, 1800);
            return;
          }
          if (s.item.type === ITEM.SCROLL && !this.known.scrolls.includes(s.item.kind)) {
            this.known.scrolls.push(s.item.kind);
            this.banner(`IT IS A SCROLL OF ${s.item.kind.toUpperCase()}`, 1800);
            return;
          }
        }
        break;
      }
      case SCROLL.MAPPING:
        f.explored.fill(1);
        this.mapDirty = true;
        this.banner('THE FLOOR LAYS ITSELF BARE', 1800);
        break;
      case SCROLL.TELEPORT: {
        const pts = f.level.spawnPoints;
        if (pts.length) {
          const spot = tileToPixel(pts[(Math.random() * pts.length) | 0], PLAYER_BOX);
          p.x = spot.x; p.y = spot.y;
          p.fovTile = -1;
          this.fx(f, 'teleport', p.x + 8, p.y + 8);
        }
        break;
      }
      case SCROLL.TERROR:
        for (const e of f.ents) if (isMob(e.kind) && !isBoss(e.kind)) e.fleeing = 300;
        this.banner('THE FLOOR RECOILS', 1500);
        break;
      case SCROLL.RAGE:
        p.might = 600;
        this.banner(`${p.name} BURNS WITH RAGE`, 1500);
        break;
      case SCROLL.RECHARGE:
        p.abilityCd = 0;
        break;
      default: break;
    }
  }

  burst(f, x, y, radius, dmg, from) {
    this.fx(f, 'blast', x, y);
    f.ents.push({
      id: this.entSeq++, kind: KIND.BLAST, x: x - 16, y: y - 16,
      box: { x: 0, y: 0, w: 32, h: 32 }, t: 0, life: 20,
    });
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind)) continue;
      if (dist2(x, y, e.x + 8, e.y + 8) <= radius * radius) this.hurtMob(e, dmg, S, f, from);
    }
  }

  freezeNear(f, x, y, ticks) {
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind) || isBoss(e.kind)) continue;
      if (dist2(x, y, e.x + 8, e.y + 8) <= 70 * 70) e.frozen = ticks;
    }
    this.fx(f, 'frost', x, y);
  }

  hunger(p) {
    if (p.hunger > 0) { p.hunger--; return; }
    if (++p.hungerTick >= HUNGER_HURT) {
      p.hungerTick = 0;
      this.hurtPlayer(p, 2, p.x + 8, p.y + 8);
      this.banner(`${p.name} IS STARVING`, 1400);
    }
  }

  // --- stairs, wells, pedestals -------------------------------------------
  interact(p) {
    if (p.ghost || this.state !== 'play') return;
    const f = this.floor(p.depth);
    const i = tileUnder(p, PLAYER_BOX);
    const t = f.tiles[i];
    if (t === TT.EXIT) return this.descend(p);
    if (t === TT.ENTRANCE && p.depth > 1) return this.ascend(p);
    if (t === TT.LOCKED_EXIT) { this.banner('THE WAY DOWN IS SEALED', 1400); return; }
    if (t === TT.WELL) {
      f.set(i, TT.FLOOR_DECO);
      this.healPlayer(p, Math.round(p.maxHp * 0.5));
      p.hunger = HUNGER_MAX;
      this.fx(f, 'drink', p.x + 8, p.y + 8);
      this.banner('THE WELL RESTORES YOU', 1600);
      return;
    }
    if (t === TT.PEDESTAL) {
      const item = f.depth >= MAX_DEPTH ? { type: ITEM.RELIC } : rollPrize(f.depth, f.rng);
      f.set(i, TT.FLOOR_DECO);
      if (!this.take(p, f, item)) this.dropItem(f, i, item);
    }
  }

  descend(p) {
    if (p.depth >= MAX_DEPTH) return;
    const from = this.floor(p.depth);
    if (from.level.boss && !from.bossDead) {
      this.banner('THE WAY DOWN IS SEALED', 1400);
      return;
    }
    p.depth++;
    this.deepest = Math.max(this.deepest, p.depth);
    const f = this.floor(p.depth);
    const spot = tileToPixel(f.level.entrance, PLAYER_BOX);
    p.x = spot.x; p.y = spot.y;
    p.knockT = 0; p.atk = 0; p.invuln = INVULN_TICKS * 2;
    p.fovTile = -1;
    p.needFloor = true;
    this.fx(f, 'stairs', p.x + 8, p.y + 8);
    const region = regionOf(p.depth);
    this.banner(p.depth === region.from ? region.name : `FLOOR ${p.depth}`,
                p.depth === region.from ? 2600 : 1200);
    this.metaDirty = true;
  }

  ascend(p) {
    if (p.depth <= 1) return;
    p.depth--;
    const f = this.floor(p.depth);
    const spot = tileToPixel(f.level.exit, PLAYER_BOX);
    p.x = spot.x; p.y = spot.y;
    p.knockT = 0; p.atk = 0; p.invuln = INVULN_TICKS * 2;
    p.fovTile = -1;
    p.needFloor = true;
    this.fx(f, 'stairs', p.x + 8, p.y + 8);
    this.banner(`FLOOR ${p.depth}`, 1200);
    this.metaDirty = true;
  }

  // -------------------------------------------------------------------------
  // Floors
  // -------------------------------------------------------------------------
  wakeFloor(f) {
    f.active = true;
    if (f.populated) return;
    f.populated = true;
    const region = regionOf(f.depth);

    if (f.level.boss) {
      const kind = BOSS_OF[region.key];
      const at = f.level.arena || { x: 15 * TILE, y: 7 * TILE };
      this.spawnMob(f, kind, at.x - 16, at.y - 16);
      this.banner(MOBS[kind].name, 3000);
      return;
    }

    for (let n = 0; n < mobBudget(f.depth); n++) this.spawnRandomMob(f);

    const drops = 5 + f.rng.int(4);
    for (let n = 0; n < drops && n < f.level.itemPoints.length; n++) {
      this.dropItem(f, f.level.itemPoints[n], rollLoot(f.depth, f.rng));
    }
    if (f.level.keySpot !== null && f.level.keySpot !== undefined) {
      this.dropItem(f, f.level.keySpot, { type: ITEM.KEY });
    }
  }

  spawnRandomMob(f) {
    const table = SPAWNS[regionOf(f.depth).key];
    const kind = table[f.rng.int(table.length)];
    const pts = f.level.spawnPoints;
    if (!pts.length) return;
    for (let attempt = 0; attempt < 12; attempt++) {
      const i = pts[f.rng.int(pts.length)];
      const px = tileToPixel(i, MOBS[kind].box);
      if (this.playersOn(f.depth).some(p => dist2(p.x, p.y, px.x, px.y) < 120 * 120)) continue;
      this.spawnMob(f, kind, px.x, px.y);
      return;
    }
  }

  spawnMob(f, kind, x, y) {
    const st = MOBS[kind];
    const scale = scaleFor(f.depth, regionOf(f.depth));
    const e = {
      id: this.entSeq++, kind, x, y, dir: S, box: st.box,
      hp: Math.round(st.hp * scale), maxHp: Math.round(st.hp * scale),
      dmg: Math.round(st.dmg * scale),
      t: 0, flash: 0, frozen: 0, alerted: 0, fleeing: 0, hitCd: 0, idle: 0,
      cd: 30 + f.rng.int(60), phase: f.rng.int(60),
      vx: 0, vy: 0, knockT: 0, knockX: 0, knockY: 0,
    };
    f.ents.push(e);
    return e;
  }

  dropItem(f, tile, item) {
    if (!item) return;
    const px = tileToPixel(tile, { x: 2, y: 2, w: 12, h: 12 });
    f.ents.push({
      id: this.entSeq++, kind: KIND.ITEM, x: px.x, y: px.y, dir: 0,
      box: { x: 2, y: 2, w: 12, h: 12 }, t: 0, item,
    });
  }

  stepFloor(f) {
    const players = this.livingOn(f.depth);
    if (--f.flowAge <= 0) { this.buildFlow(f, players); f.flowAge = 8; }

    for (const e of f.ents) {
      if (e.dead) continue;
      e.t++;
      if (e.flash > 0) e.flash--;
      if (e.hitCd > 0) e.hitCd--;
      if (e.knockT > 0) {
        e.knockT--;
        moveActor(e, e.knockX, e.knockY, f.tiles, e.box, MODE.WALK, false);
        clampToLevel(e, e.box);
        continue;
      }
      if (e.frozen > 0) { e.frozen--; continue; }
      if (e.fleeing > 0) e.fleeing--;
      if (e.alerted > 0) e.alerted--;
      this.stepEntity(e, f, players);
    }

    // contact damage
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind) || e.frozen > 0 || e.hidden) continue;
      const st = MOBS[e.kind];
      for (const p of players) {
        if (p.invis > 0 && !isBoss(e.kind)) continue;
        if (e.hitCd > 0) break;
        if (!rectsOverlap(p.x + PLAYER_BOX.x, p.y + PLAYER_BOX.y, PLAYER_BOX.w, PLAYER_BOX.h,
                          e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h)) continue;
        e.hitCd = 32;
        this.hurtPlayer(p, e.dmg, e.x + 8, e.y + 8);
        if (st.drains) e.hp = Math.min(e.maxHp, e.hp + 3);
        if (st.ai === 'thief' && p.gold > 0) {
          const stolen = Math.min(p.gold, 25 + f.depth * 3);
          p.gold -= stolen;
          e.loot = (e.loot || 0) + stolen;
          e.fleeing = 700;
          this.banner(`${p.name} WAS ROBBED`, 1400);
          this.metaDirty = true;
        }
      }
    }

    if (!f.level.boss && --f.spawnTimer <= 0) {
      f.spawnTimer = 220;
      const alive = f.ents.filter(e => !e.dead && isMob(e.kind)).length;
      if (alive < mobBudget(f.depth)) this.spawnRandomMob(f);
    }

    for (let i = f.ents.length - 1; i >= 0; i--) if (f.ents[i].dead) f.ents.splice(i, 1);
  }

  /** Breadth-first distance to the nearest hero, so mobs can round corners. */
  buildFlow(f, players) {
    const dist = f.flow;
    dist.fill(-1);
    const queue = [];
    for (const p of players) {
      const t = tileUnder(p, PLAYER_BOX);
      if (dist[t] === -1) { dist[t] = 0; queue.push(t); }
    }
    let head = 0;
    while (head < queue.length) {
      const i = queue[head++];
      if (dist[i] > 45) continue;
      const x = tx(i), y = ty(i);
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (dist[j] !== -1) continue;
        const t = f.tiles[j];
        if (!passable(t) && t !== TT.DOOR) continue;
        dist[j] = dist[i] + 1;
        queue.push(j);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Entity behaviour
  // -------------------------------------------------------------------------
  stepEntity(e, f, players) {
    switch (e.kind) {
      case KIND.ARROW: case KIND.BOLT: case KIND.FIREBALL:
      case KIND.DART: case KIND.WEB: case KIND.ACID: case KIND.BEAM:
        return this.stepShot(e, f, players);
      case KIND.BOMB: return this.stepBomb(e, f);
      case KIND.BLAST: if (--e.life <= 0) e.dead = true; return;
      case KIND.ITEM: return;
      default: break;
    }
    if (!isMob(e.kind)) return;

    const st = MOBS[e.kind];
    const target = this.nearestVisible(e, f, players);
    if (target) e.alerted = 420;
    else if (!e.alerted) {
      // it cannot see you, but it can hear you moving close by
      for (const p of players) {
        if (p.invis > 0) continue;
        if (dist2(p.x, p.y, e.x, e.y) < HEARING * HEARING) { e.alerted = 240; break; }
      }
    }

    if (st.ai === 'boss') return this.stepBoss(e, f, st, target);

    const mode = (st.ai === 'flyer' || st.phasing) ? MODE.FLY : MODE.WALK;
    const speed = st.speed * (e.enraged ? 1.4 : 1);

    if (e.fleeing > 0 && target) this.stepAway(e, f, target, speed, mode);
    else if (st.ai === 'flyer') this.stepFlyer(e, f, target, speed);
    else if (st.ai === 'shooter' && target) this.stepShooter(e, f, target, st, speed, mode);
    else if (st.ai === 'caster') this.stepCaster(e, f, target, st);
    else if (target || e.alerted > 0) this.stepChase(e, f, speed, mode);
    else this.stepWander(e, f, speed, mode);

    if (st.enrages && !e.enraged && e.hp < e.maxHp * 0.35) {
      e.enraged = true;
      this.fx(f, 'roar', e.x + 8, e.y + 8);
    }
  }

  nearestVisible(e, f, players) {
    let best = null, bd = Infinity;
    const et = tileUnder(e, e.box);
    const ex = tx(et), ey = ty(et);
    for (const p of players) {
      if (p.invis > 0) continue;
      const d = dist2(p.x, p.y, e.x, e.y);
      if (d > 210 * 210) continue;
      const pt = tileUnder(p, PLAYER_BOX);
      if (!hasLine(f.tiles, ex, ey, tx(pt), ty(pt), 14)) continue;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  stepChase(e, f, speed, mode) {
    const here = tileUnder(e, e.box);
    const d = f.flow[here];
    if (d <= 0) { this.stepWander(e, f, speed, mode); return; }
    let bestDir = -1, bestVal = d;
    for (let dir = 0; dir < 4; dir++) {
      const nx = tx(here) + DX[dir], ny = ty(here) + DY[dir];
      if (!inBounds(nx, ny)) continue;
      const v = f.flow[idx(nx, ny)];
      if (v !== -1 && v < bestVal) { bestVal = v; bestDir = dir; }
    }
    if (bestDir === -1) { this.stepWander(e, f, speed, mode); return; }
    e.dir = bestDir;
    const r = moveActor(e, DX[bestDir] * speed, DY[bestDir] * speed, f.tiles, e.box, mode, true);
    if (r.blockedBy >= 0 && f.tiles[r.blockedBy] === TT.DOOR) f.set(r.blockedBy, TT.OPEN_DOOR);
    clampToLevel(e, e.box);
  }

  stepWander(e, f, speed, mode) {
    if (--e.cd <= 0) {
      e.cd = 25 + ((Math.random() * 40) | 0);
      e.dir = (Math.random() * 4) | 0;
      if (Math.random() < 0.35) e.idle = 30;
    }
    if (e.idle > 0) { e.idle--; return; }
    const r = moveActor(e, DX[e.dir] * speed * 0.7, DY[e.dir] * speed * 0.7,
      f.tiles, e.box, mode, true);
    if (r.hitX || r.hitY) e.cd = 0;
    clampToLevel(e, e.box);
  }

  stepAway(e, f, target, speed, mode) {
    const dx = e.x - target.x, dy = e.y - target.y;
    const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? E : W) : (dy > 0 ? S : N);
    e.dir = dir;
    const r = moveActor(e, DX[dir] * speed, DY[dir] * speed, f.tiles, e.box, mode, true);
    if (r.hitX && r.hitY) e.fleeing = 0;
    clampToLevel(e, e.box);
  }

  stepFlyer(e, f, target, speed) {
    if (e.t % 20 === 0 || (e.vx === 0 && e.vy === 0)) {
      const a = Math.random() * Math.PI * 2;
      e.vx = Math.cos(a) * speed; e.vy = Math.sin(a) * speed;
      if (target && Math.random() < 0.65) {
        const dx = target.x - e.x, dy = target.y - e.y;
        const len = Math.hypot(dx, dy) || 1;
        e.vx = (dx / len) * speed; e.vy = (dy / len) * speed;
      }
    }
    const r = moveActor(e, e.vx, e.vy, f.tiles, e.box, MODE.FLY, false);
    if (r.hitX) e.vx *= -1;
    if (r.hitY) e.vy *= -1;
    e.dir = Math.abs(e.vx) > Math.abs(e.vy) ? (e.vx > 0 ? E : W) : (e.vy > 0 ? S : N);
    clampToLevel(e, e.box);
  }

  stepShooter(e, f, target, st, speed, mode) {
    const d = Math.hypot(target.x - e.x, target.y - e.y);
    const want = st.keepsAway ? 110 : 80;
    if (d > want + 24) this.stepChase(e, f, speed, mode);
    else if (d < want - 24) this.stepAway(e, f, target, speed * 0.8, mode);
    if (--e.cd <= 0) {
      e.cd = 70 + ((Math.random() * 50) | 0);
      this.mobShoot(e, f, target, st);
    }
  }

  stepCaster(e, f, target, st) {
    e.phase++;
    e.hidden = (e.phase % 150) > 105;
    if (e.phase % 150 === 0) {
      const pts = f.level.spawnPoints;
      if (pts.length) {
        const spot = tileToPixel(pts[(Math.random() * pts.length) | 0], e.box);
        e.x = spot.x; e.y = spot.y;
        this.fx(f, 'blink', e.x + 8, e.y + 8);
      }
    }
    if (!e.hidden && target && --e.cd <= 0) {
      e.cd = 80;
      this.mobShoot(e, f, target, st);
    }
  }

  mobShoot(e, f, target, st) {
    const dx = target.x - e.x, dy = target.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? E : W) : (dy > 0 ? S : N);
    f.ents.push({
      id: this.entSeq++, kind: st.shot || KIND.DART, x: e.x, y: e.y, dir: e.dir,
      box: { x: 4, y: 4, w: 8, h: 8 }, t: 0,
      vx: (dx / len) * 3.2, vy: (dy / len) * 3.2, aimed: true,
      speed: 3.2, range: st.range || 160, travelled: 0,
      dmg: e.dmg, friendly: false,
    });
    this.fx(f, 'shoot', e.x + 8, e.y + 8);
  }

  stepBoss(e, f, st, target) {
    if (target) this.stepChase(e, f, st.speed, MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);

    if (--e.cd <= 0) {
      e.cd = 70 + ((Math.random() * 40) | 0);
      e.mouth = 14;
      if (target) {
        if (st.fan) for (const spread of [-0.45, 0, 0.45]) this.bossShot(e, f, target, st, spread);
        else this.bossShot(e, f, target, st, 0);
      }
      if (st.summons && f.ents.filter(x => isMob(x.kind) && !isBoss(x.kind)).length < 6) {
        const pts = f.level.spawnPoints;
        if (pts.length) {
          const spot = tileToPixel(pts[(Math.random() * pts.length) | 0], MOBS[st.summons].box);
          this.spawnMob(f, st.summons, spot.x, spot.y);
          this.fx(f, 'summon', e.x + 16, e.y + 16);
        }
      }
    }
    if (e.mouth > 0) e.mouth--;
  }

  bossShot(e, f, target, st, spread) {
    const a = Math.atan2(target.y - (e.y + 16), target.x - (e.x + 16)) + spread;
    f.ents.push({
      id: this.entSeq++, kind: st.shot, x: e.x + 12, y: e.y + 12, dir: S,
      box: { x: 4, y: 4, w: 8, h: 8 }, t: 0,
      vx: Math.cos(a) * 2.9, vy: Math.sin(a) * 2.9, aimed: true,
      speed: 2.9, range: 260, travelled: 0, dmg: e.dmg, friendly: false,
    });
    this.fx(f, 'shoot', e.x + 16, e.y + 16);
  }

  stepShot(e, f, players) {
    const vx = e.aimed ? e.vx : DX[e.dir] * e.speed;
    const vy = e.aimed ? e.vy : DY[e.dir] * e.speed;
    e.x += vx; e.y += vy;
    e.travelled += Math.hypot(vx, vy);

    if (boxBlocked(f.tiles, e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h, MODE.SHOT) ||
        e.travelled > e.range || e.t > 220) {
      e.dead = true;
      this.fx(f, 'fizzle', e.x + 8, e.y + 8);
      return;
    }
    if (e.friendly) {
      for (const m of f.ents) {
        if (m.dead || !isMob(m.kind)) continue;
        if (!rectsOverlap(e.x + 4, e.y + 4, 8, 8,
                          m.x + m.box.x, m.y + m.box.y, m.box.w, m.box.h)) continue;
        this.hurtMob(m, e.dmg, e.dir, f, this.players.get(e.owner));
        e.dead = true;
        return;
      }
    } else {
      for (const p of players) {
        if (!rectsOverlap(e.x + 4, e.y + 4, 8, 8,
                          p.x + PLAYER_BOX.x, p.y + PLAYER_BOX.y, PLAYER_BOX.w, PLAYER_BOX.h)) continue;
        this.hurtPlayer(p, e.dmg, e.x + 8, e.y + 8);
        if (e.kind === KIND.WEB) p.stun = 30;
        e.dead = true;
        return;
      }
    }
  }

  stepBomb(e, f) {
    if (--e.fuse > 0) return;
    e.dead = true;
    this.burst(f, e.x + 8, e.y + 8, 46, 16 + f.depth * 2, null);
    const c = centreTile(e, e.box);
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = c.x + dx, ny = c.y + dy;
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        const t = f.tiles[j];
        if (t === TT.BARRICADE || t === TT.HIGH_GRASS || t === TT.GRASS) f.set(j, TT.EMBERS);
      }
    }
  }

  hurtMob(e, dmg, fromDir, f, byPlayer) {
    if (e.flash > 3) return;
    const st = MOBS[e.kind];
    const taken = Math.max(1, Math.round(dmg - (st.armour || 0)));
    e.hp -= taken;
    e.flash = 6;
    e.alerted = 480;
    if (e.hp > 0) {
      if (!isBoss(e.kind)) {
        e.knockX = DX[fromDir] * 3;
        e.knockY = DY[fromDir] * 3;
        e.knockT = 4;
      }
      this.fx(f, 'hit', e.x + 8, e.y + 8);
      return;
    }
    this.killMob(e, f, byPlayer);
  }

  killMob(e, f, byPlayer) {
    e.dead = true;
    this.kills++;
    const st = MOBS[e.kind];
    if (byPlayer) { byPlayer.kills++; this.gainXp(byPlayer, st.xp); }
    this.fx(f, isBoss(e.kind) ? 'bossdie' : 'die', e.x + 8, e.y + 8);

    if (st.splits && !e.small) {
      for (const off of [-12, 12]) {
        const s = this.spawnMob(f, e.kind, clamp(e.x + off, TILE, (LEVEL_W - 2) * TILE), e.y);
        s.small = true;
        s.hp = s.maxHp = Math.max(4, Math.round(s.maxHp * 0.4));
        s.dmg = Math.round(s.dmg * 0.6);
      }
      return;
    }

    if (isBoss(e.kind)) {
      f.bossDead = true;
      this.banner(`${st.name} FALLS`, 3000);
      for (let i = 0; i < LEVEL_LEN; i++) {
        if (f.tiles[i] === TT.LOCKED_EXIT) f.set(i, TT.EXIT);
      }
      const at = tileUnder(e, e.box);
      this.dropItem(f, at, rollPrize(f.depth, f.rng));
      this.dropItem(f, at, { type: ITEM.POTION, kind: POTION.HEALING });
      if (st.splitsOnDeath) {
        for (let n = 0; n < 3; n++) this.spawnMob(f, st.splitsOnDeath, e.x + (n - 1) * 20, e.y + 12);
      }
      this.metaDirty = true;
      return;
    }

    const at = tileUnder(e, e.box);
    if (e.loot) this.dropItem(f, at, { type: ITEM.GOLD, amount: e.loot });
    const drop = rollDrop(f.depth, f.rng);
    if (drop) this.dropItem(f, at, drop);
  }

  // -------------------------------------------------------------------------
  // Sight
  // -------------------------------------------------------------------------
  refreshFov(p) {
    const f = this.floor(p.depth);
    const here = tileUnder(p, PLAYER_BOX);
    if (here === p.fovTile) return;
    p.fovTile = here;
    viewFrom(f.level, here, CLASSES[p.cls].sight, p.fov);
    for (let i = 0; i < LEVEL_LEN; i++) {
      if (p.fov[i] && !f.explored[i]) { f.explored[i] = 1; f.mapDirty = true; }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------
  begin() {
    this.state = 'play';
    this.startedAt = Date.now();
    const f = this.floor(1);
    const spot = tileToPixel(f.level.entrance, PLAYER_BOX);
    for (const p of this.players.values()) {
      p.depth = 1;
      p.x = spot.x; p.y = spot.y;
      p.needFloor = true;
      p.fovTile = -1;
    }
    this.banner(REGIONS[0].name, 3000);
    this.metaDirty = true;
  }

  restart() {
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.app = makeAppearances(this.seed);
    this.known = { potions: [], scrolls: [] };
    this.floors.clear();
    this.kills = 0; this.deaths = 0; this.deepest = 1;
    for (const p of this.players.values()) {
      const def = CLASSES[p.cls];
      const keep = { id: p.id, name: p.name, cls: p.cls, colour: p.colour, ready: p.ready };
      Object.assign(p, newPlayerState(), keep, {
        depth: 1, hp: def.hp, maxHp: def.hp, level: 1, xp: 0, gold: 0,
        weapon: { tier: 1, upgrade: 0 }, armor: { tier: 1, upgrade: 0 },
        inv: [], hunger: HUNGER_MAX, hungerTick: 0, kills: 0,
        invuln: 0, invis: 0, haste: 0, might: 0,
        fov: p.fov, fovTile: -1, queue: [], input: 0, seq: p.seq,
        needFloor: true,
      });
    }
    this.begin();
  }

  // -------------------------------------------------------------------------
  // Wire format
  // -------------------------------------------------------------------------
  floorPacket(p) {
    const f = this.floor(p.depth);
    return {
      t: 'floor',
      d: p.depth,
      region: f.level.region,
      boss: !!f.level.boss,
      tiles: Buffer.from(f.tiles).toString('base64'),
      explored: Buffer.from(f.explored).toString('base64'),
      entrance: f.level.entrance,
      exit: f.level.exit,
      rooms: f.level.rooms.map(r => [r.l, r.t, r.r, r.b, r.type === 'tunnel' ? 1 : 0]),
    };
  }

  snapshotFor(p) {
    const f = this.floor(p.depth);
    const ents = [];
    const items = [];
    for (const e of f.ents) {
      if (e.dead) continue;
      const t = tileUnder(e, e.box);
      if (!p.fov[t]) continue;                       // fog hides what you cannot see
      if (e.kind === KIND.ITEM) {
        const it = e.item;
        items.push([e.id, Math.round(e.x), Math.round(e.y), it.type,
                    it.kind || '', it.tier || 0, it.upgrade || 0, it.amount || 0]);
      } else {
        let flags = 0;
        if (e.flash > 0) flags |= 1;
        if (e.frozen > 0) flags |= 2;
        if (e.hidden) flags |= 4;
        if (e.mouth > 0) flags |= 8;
        if (e.enraged) flags |= 16;
        ents.push([e.id, e.kind, Math.round(e.x), Math.round(e.y), e.dir | 0, flags,
                   e.hp | 0, e.maxHp | 0]);
      }
    }

    const others = [];
    for (const o of this.players.values()) {
      if (o.id === p.id || o.depth !== p.depth) continue;
      if (!p.fov[tileUnder(o, PLAYER_BOX)]) continue;
      others.push([o.id, Math.round(o.x), Math.round(o.y), o.dir,
                   CLASS_ORDER.indexOf(o.cls), o.ghost ? 1 : 0, o.atk,
                   o.hp, o.maxHp, o.walk, o.invis > 0 ? 1 : 0]);
    }

    const party = [];
    for (const o of this.players.values()) {
      party.push([o.id, o.hp, o.maxHp, o.depth, o.ghost ? 1 : 0]);
    }

    return {
      t: 's', k: this.tick, a: p.seq, d: p.depth,
      me: [Math.round(p.x), Math.round(p.y), p.dir, p.atk, p.hp, p.maxHp,
           p.level, p.xp, XP_PER_LEVEL(p.level), p.ghost ? 1 : 0, p.invuln,
           p.abilityCd, p.knockT, Math.round(p.knockX), Math.round(p.knockY),
           p.stun, p.gold, p.hunger, p.invis, p.reviveT | 0, p.revivedBy | 0],
      e: ents, it: items, o: others, pl: party,
      f: f.fx, tc: f.changes,
    };
  }

  metaFor() {
    return {
      t: 'm',
      state: this.state,
      known: this.known,
      app: this.app,
      deepest: this.deepest,
      players: [...this.players.values()].map(o => ({
        id: o.id, name: o.name, cls: o.cls, depth: o.depth,
        hp: o.hp, maxHp: o.maxHp, level: o.level, gold: o.gold,
        weapon: o.weapon, armor: o.armor,
        inv: o.inv.map(s => ({ item: s.item, count: s.count })),
      })),
    };
  }

  exploredPacket(depth) {
    const f = this.floor(depth);
    return { t: 'ex', d: depth, explored: Buffer.from(f.explored).toString('base64') };
  }

  clearTransient() {
    for (const f of this.floors.values()) {
      if (f.fx.length) f.fx = [];
      if (f.changes.length) f.changes = [];
    }
  }
}
