// The authoritative simulation. One instance per party.
// Twenty-five floors, five chapters, a boss on every fifth. Everything that
// decides an outcome happens here; clients only predict their own movement.

import {
  TILE, KIND, CLASSES, CLASS_ORDER, PLAYER_BOX, INVULN_TICKS,
  KNOCKBACK_TICKS, KNOCKBACK_SPEED, REVIVE_TICKS, GHOST_TICKS, MAX_PLAYERS,
  XP_PER_LEVEL, HP_PER_LEVEL, HUNGER_MAX, HUNGER_HURT, DEW_MAX, N, E, S, W, DX, DY,
  isMob, isBoss, isNpc, rectsOverlap, clamp, dist2,
} from './constants.js';
import {
  LEVEL_W, LEVEL_LEN, TT, idx, tx, ty, inBounds, passable,
  regionOf, rngFor, MAX_DEPTH, REGIONS, shotPasses,
} from './terrain.js';
import { generate, ROOM } from './levelgen.js';
import { viewFrom, hasLine } from './fov.js';
import {
  MODE, moveActor, boxBlocked, tileUnder, centreTile, tileToPixel, clampToLevel,
} from './physics.js';
import { newPlayerState, playerStep, meleeBox } from './player.js';
import { MOBS, SPAWNS, BOSS_OF, mobBudget, scaleFor, HEARING } from './mobs.js';
import {
  ITEM, POTION, SCROLL, POTION_KINDS, SCROLL_KINDS, makeAppearances,
  rollLoot, rollPrize, rollDrop, WEAPONS, ARMORS, isConsumable, stackKey,
  itemLabel, buyPrice, sellPrice, rollStock, isWorn, isPointed,
} from './items.js';
import { WANDS, wandPower, tickWand, refill } from './wands.js';
import { MISSILES, missilePower } from './missiles.js';
import { rollWand } from './wands.js';
import { rollRing } from './rings.js';
import {
  PLANTS, PLANT, PLANT_IDS, rollPlant, plantIndex, BREWS, BREW_COST,
} from './plants.js';
import {
  ARTIFACTS, ART, ART_IDS, artMax, makeArtifact, rollArtifact,
  feed, tickArtifact, MAX_ART_LEVEL,
} from './artifacts.js';
import { CHAMPIONS, CHAMP, champChance, rollChampion, champIndex } from './champions.js';
import { QUEST, QUESTS, QUEST_IDS, QSTATE, questForDepth } from './quests.js';
import { RINGS, applyRings, RING_LEARN_TICKS } from './rings.js';
import { computeStats, canTake, clientMods, PERKS } from './perks.js';
import { toBase64 } from './b64.js';
import * as BF from './buffs.js';
import {
  ENCHANTS, GLYPHS, CURSES, ENCH_IDS, ENCH, GLYPH, CURSE,
  dressGear, markName, enchIndex, glyphIndex, curseIndex,
} from './enchants.js';
import { B } from './buffs.js';
import { TRAPS, TRAP, trapIndex, rollTrap } from './traps.js';

const QUICK_SLOTS = 8;
const BAG_BASE = 16;
const BAG_MAX = 24;

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
    this.known = { potions: [], scrolls: [], rings: [], wands: [] };
    this.artifactsSeen = [];
    this.quests = {};             // id -> QSTATE
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
      bag: new Array(BAG_BASE).fill(null),
      equip: { ring1: null, ring2: null, artifact: null,
               weapon: { type: ITEM.WEAPON, tier: 1, upgrade: 0 },
               armor: { type: ITEM.ARMOR, tier: 1, upgrade: 0 } },
      perks: {}, perkPoints: 0, stats: computeStats({}),
      gold: 0, hunger: HUNGER_MAX, hungerTick: 0, regenTick: 0,
      invuln: 0, reviveT: 0, revivedBy: 0,
      input: 0, seq: 0, queue: [], ready: false,
      fov: new Uint8Array(LEVEL_LEN), fovTile: -1,
      invis: 0, haste: 0, might: 0, kills: 0, needFloor: true,
      buffs: {}, moveMult: 1, shield: 0,
    });
    p.bag[0] = { key: ITEM.FOOD, item: { type: ITEM.FOOD }, count: 2 };
    this.recalc(p);
    p.hp = p.maxHp;
    this.players.set(id, p);
    this.metaDirty = true;
    this.lastActivity = Date.now();
    return p;
  }

  removePlayer(id) { this.players.delete(id); this.metaDirty = true; }

  /** Recompute everything the perks touch, and resize the bag to match. */
  recalc(p) {
    p.stats = applyRings(computeStats(p.perks), p.equip);
    const base = CLASSES[p.cls].hp + (p.level - 1) * HP_PER_LEVEL;
    p.maxHp = base + p.stats.maxHp;
    if (p.hp > p.maxHp) p.hp = p.maxHp;
    const want = Math.min(BAG_MAX, BAG_BASE + p.stats.bagBonus);
    while (p.bag.length < want) p.bag.push(null);
    while (p.bag.length > want && p.bag[p.bag.length - 1] === null) p.bag.pop();
    p.mods = clientMods(p.stats);
    this.metaDirty = true;
  }

  spendPerk(p, id) {
    const verdict = canTake(id, p.perks, p.cls, p.perkPoints);
    if (!verdict.ok) return;
    p.perks[id] = (p.perks[id] || 0) + 1;
    p.perkPoints--;
    this.recalc(p);
    this.fx(this.floor(p.depth), 'levelup', p.x + 8, p.y + 8);
    this.banner(`${p.name} LEARNED ${PERKS[id].name}`, 1600);
  }

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

    // timed effects: damage, mending, and everything they change about you
    const up = BF.tickBuffs(p);
    if (up.damage) {
      // a ring of elements blunts anything that eats away at you
      const soak = 1 - Math.min(0.75, p.stats.elements || 0);
      this.hurtPlayer(p, Math.ceil(up.damage * soak), p.x + 8, p.y + 40, null, true);
    }
    if (up.heal) this.healPlayer(p, Math.ceil(up.heal));
    if (up.recharge && p.abilityCd > 0) p.abilityCd = Math.max(0, p.abilityCd - up.recharge);
    const eff = BF.summarise(p);
    p.effects = eff;
    p.shield = eff.shield;
    if (eff.invisible) p.invis = Math.max(p.invis, 2);
    // standing in fire, or in water that puts it out
    const under = f.tiles[tileUnder(p, PLAYER_BOX)];

    // what the armour does simply by being worn
    const gl = p.equip.armor.glyph ? GLYPHS[p.equip.armor.glyph] : null;
    const ac = p.equip.armor.curse ? CURSES[p.equip.armor.curse] : null;
    let wear = 1;
    if (gl?.slow) wear *= 0.9;
    if (ac?.heavy) wear *= 0.82;
    if (gl?.waterSpeed && under === TT.WATER) wear *= gl.waterSpeed;
    if (gl?.calmSpeed && p.sinceHit > 240) wear *= gl.calmSpeed;
    if (gl?.grassHide && (under === TT.GRASS || under === TT.HIGH_GRASS)) {
      p.invis = Math.max(p.invis, 2);
    }
    if (gl?.fireproof) BF.clear(p, B.BURNING);
    p.moveMult = eff.move * wear;
    p.liveMods = { ...p.mods, speedMult: p.mods.speedMult * p.moveMult };
    p.sinceHit = (p.sinceHit || 0) + 1;

    if (p.thorns > 0) p.thorns--;

    // the worn artifact fills back up, and takes in whatever it lives on
    const art = p.equip.artifact;
    if (art) {
      tickArtifact(art, 1 / Math.max(0.3, p.stats.cdMult || 1));
      if (art.kind === ART.SANDALS && (under === TT.GRASS || under === TT.HIGH_GRASS)) {
        this.growArtifact(p, 'grass');
        if ((this.tick & 31) === 0) this.healPlayer(p, 1 + Math.floor(art.level / 3));
      }
    }

    // wands fill back up in the pack, faster with a ring of energy
    const chargeRate = 1 / Math.max(0.3, p.stats.cdMult || 1);
    for (const slot of p.bag) {
      if (slot?.item?.type === ITEM.WAND) tickWand(slot.item, chargeRate);
    }

    // a ring gives itself away once you have worn it a while
    for (const which of ['ring1', 'ring2']) {
      const r = p.equip[which];
      if (!r || r.known) continue;
      r.worn = (r.worn || 0) + 1;
      if (r.worn >= RING_LEARN_TICKS) {
        r.known = true;
        if (!this.known.rings.includes(r.kind)) this.known.rings.push(r.kind);
        this.banner(`IT IS A RING OF ${RINGS[r.kind].name}`, 2000);
        this.metaDirty = true;
      }
    }

    if (under === TT.WATER && !gl?.fireproof) { BF.clear(p, B.BURNING); }
    if (under === TT.EMBERS && !gl?.fireproof && Math.random() < 0.02) BF.apply(p, B.BURNING, 90);

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
      playerStep(p, p.input, f.tiles, p.cls, p.liveMods || p.mods);
      return;
    }

    const frozen = p.effects?.frozen;
    const ev = playerStep(p, frozen ? 0 : p.input, f.tiles, p.cls, p.liveMods || p.mods);

    // walking into a shut door opens it; a locked one wants this floor's key
    if (ev.blockedBy >= 0) {
      const t = f.tiles[ev.blockedBy];
      if (t === TT.DOOR) {
        f.set(ev.blockedBy, TT.OPEN_DOOR);
        this.fx(f, 'door', tx(ev.blockedBy) * TILE + 8, ty(ev.blockedBy) * TILE + 8);
      } else if (t === TT.LOCKED_DOOR) {
        const slot = p.bag.findIndex(s => s && s.item.type === ITEM.KEY);
        if (p.stats.lockpick || slot >= 0) {
          if (!p.stats.lockpick && slot >= 0) {
            if (--p.bag[slot].count <= 0) p.bag[slot] = null;
          }
          f.set(ev.blockedBy, TT.OPEN_DOOR);
          this.fx(f, 'unlock', tx(ev.blockedBy) * TILE + 8, ty(ev.blockedBy) * TILE + 8);
          this.banner(p.stats.lockpick ? 'THE LOCK YIELDS TO YOUR PICKS' : 'THE LOCK FALLS AWAY', 1400);
          this.metaDirty = true;
        }
      }
    }

    if (ev.attacked) {
      this.fx(f, 'swing', p.x + 8, p.y + 8);
      this.resolveMelee(p, f);
    }
    if (ev.ability) this.useAbility(p, f);

    if (p.stats.regen && p.hp < p.maxHp && ++p.regenTick >= p.stats.regen) {
      p.regenTick = 0;
      this.healPlayer(p, 1);
    }

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

  hurtPlayer(p, dmg, sx, sy, from, ignoreMercy = false) {
    if (p.ghost || this.state !== 'play') return;
    if (p.invuln > 0 && !ignoreMercy) return;
    const st = p.stats;
    const f = this.floor(p.depth);
    dmg *= (p.effects?.taken ?? 1);
    const gear = p.equip.armor;
    const armour = ARMORS[gear.tier - 1].def + gear.upgrade * 1.5 + st.armour;
    p.sinceHit = 0;
    let taken = Math.max(1, Math.round(dmg - armour * 0.5));
    // a ring of tenacity pays off exactly when you need it to
    if (st.tenacity) {
      const missing = 1 - p.hp / Math.max(1, p.maxHp);
      taken = Math.max(1, Math.round(taken * (1 - Math.min(0.6, st.tenacity * missing))));
    }
    taken = this.procGlyph(p, taken, from, f);
    if (p.guarding) {
      taken = Math.max(0, Math.round(taken * st.guard));
      if (st.reflect && from && !from.dead) {
        this.hurtMob(from, Math.round(dmg * st.reflect), p.dir, f, p);
      }
    }
    // a cape of thorns answers for you whether you were guarding or not
    if (p.thorns > 0 && from && !from.dead && isMob(from.kind)) {
      this.hurtMob(from, Math.max(1, Math.round(dmg * 0.5)), p.dir, f, p);
      this.fx(f, 'clang', from.x + 8, from.y + 8);
    }
    if (st.manaShield < 1 && p.abilityCd <= 0) taken = Math.round(taken * st.manaShield);
    // a barrier soaks damage before your skin does
    if (p.shield > 0) {
      const soaked = Math.min(p.shield, taken);
      taken -= soaked;
      const bar = p.buffs?.[B.BARRIER];
      if (bar) { bar.m -= soaked; if (bar.m <= 0) BF.clear(p, B.BARRIER); }
      p.shield -= soaked;
      this.fx(f, 'clang', p.x + 8, p.y + 8);
    }
    if (st.lastStand < 1 && p.hp < p.maxHp * 0.25) taken = Math.round(taken * st.lastStand);
    // a warlord standing with you takes the edge off
    for (const o of this.livingOn(p.depth)) {
      if (o.id === p.id || o.stats.aura >= 1) continue;
      if (dist2(o.x, o.y, p.x, p.y) < 64 * 64) { taken = Math.round(taken * o.stats.aura); break; }
    }
    p.hp -= Math.max(0, taken);
    if (!ignoreMercy) p.invuln = Math.round(INVULN_TICKS * st.invulnMult);
    if (!p.stats.steady) {
      const dx = (p.x + 8) - sx, dy = (p.y + 8) - sy;
      const len = Math.hypot(dx, dy) || 1;
      p.knockX = Math.round((dx / len) * KNOCKBACK_SPEED);
      p.knockY = Math.round((dy / len) * KNOCKBACK_SPEED);
      p.knockT = KNOCKBACK_TICKS;
    }
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
    p.xp += Math.max(1, Math.round(amount * p.stats.xpMult));
    while (p.xp >= XP_PER_LEVEL(p.level)) {
      p.xp -= XP_PER_LEVEL(p.level);
      p.level++;
      p.perkPoints++;
      this.recalc(p);
      p.hp = p.maxHp;
      this.fx(this.floor(p.depth), 'levelup', p.x + 8, p.y + 8);
      this.banner(`${p.name} REACHED LEVEL ${p.level} - A PERK POINT`, 1900);
    }
    this.metaDirty = true;
  }

  // --- melee ---------------------------------------------------------------
  resolveMelee(p, f) {
    const def = CLASSES[p.cls];
    const st = p.stats;
    const w = p.equip.weapon;
    const mark = w.ench ? ENCHANTS[w.ench] : null;
    const curse = w.curse ? CURSES[w.curse] : null;
    const reachMult = st.reachMult * (mark?.reach ?? 1);
    const box = meleeBox(p, Math.round(def.reach * reachMult));
    if (!box) return;
    const base = def.melee + WEAPONS[w.tier - 1].dmg + w.upgrade * 2
               + Math.floor(p.level * 0.6) + st.melee;
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind)) continue;
      if (!rectsOverlap(box.x, box.y, box.w, box.h,
                        e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h)) continue;
      let dmg = base * (p.effects?.dealt ?? 1);
      if (p.might > 0) dmg *= 1.5;
      if (st.berserk > 1 && p.hp < p.maxHp * 0.4) dmg *= st.berserk;
      if (st.execute > 1 && e.hp < e.maxHp * 0.3) dmg *= st.execute;
      if (st.backstab > 1 && !e.alerted) dmg *= st.backstab;
      const sure = st.ambush && p.invis > 0;
      if (sure || Math.random() < st.crit) { dmg *= 2; this.fx(f, 'clang', e.x + 8, e.y + 8); }
      // a wayward weapon simply misses sometimes
      if (curse?.miss && Math.random() < curse.chance) {
        this.fx(f, 'clang', e.x + 8, e.y + 8);
        continue;
      }
      if (w.kinetic) { dmg += w.kinetic; w.kinetic = 0; }
      this.hurtMob(e, Math.round(dmg), p.dir, f, p);
      if (st.daze) e.frozen = Math.max(e.frozen, st.daze);
      if (mark) this.procEnchant(p, w, mark, e, f, Math.round(dmg));
      if (curse) this.procWeaponCurse(p, w, curse, e, f);
      if (!w.known) this.learnGear(p, w, 'weapon');
    }
    // cut a path through the undergrowth
    const ahead = tileUnder({ x: p.x + DX[p.dir] * 10, y: p.y + DY[p.dir] * 10 }, PLAYER_BOX);
    if (f.tiles[ahead] === TT.HIGH_GRASS) f.set(ahead, TT.GRASS);
    if (f.tiles[ahead] === TT.BARRICADE) f.set(ahead, TT.EMBERS);
  }

  /** What a marked weapon does on top of the blow it just landed. */
  procEnchant(p, w, mark, e, f, dealt) {
    if (mark.unstable) {
      // it never settles on one thing
      const pick = ENCH_IDS[Math.floor(Math.random() * ENCH_IDS.length)];
      const other = ENCHANTS[pick];
      if (other && !other.unstable) return this.procEnchant(p, w, other, e, f, dealt);
      return;
    }
    if (mark.stores) {
      // it banks a little of every hit and spends it on the next
      w.kinetic = Math.min(30, (w.kinetic || 0) + Math.round(dealt * 0.2));
      return;
    }
    if (mark.chance && Math.random() >= mark.chance) return;

    if (mark.buff) this.afflict(e, mark.buff[0], mark.buff[1], 1, f);
    if (mark.drain) {
      const back = Math.max(1, Math.round(dealt * mark.drain));
      this.healPlayer(p, back);
      this.fx(f, 'heal', p.x + 8, p.y + 8);
    }
    if (mark.reap && e.hp < e.maxHp * mark.reap && !isBoss(e.kind)) {
      this.hurtMob(e, e.hp + 99, p.dir, f, p);
      this.fx(f, 'blast', e.x + 8, e.y + 8);
    }
    if (mark.gold) {
      p.gold += 2 + f.depth;
      this.fx(f, 'gold', e.x + 8, e.y + 8);
      this.metaDirty = true;
    }
    if (mark.arc) {
      // lightning jumps to whatever else is standing close
      for (const o of f.ents) {
        if (o === e || o.dead || !isMob(o.kind)) continue;
        if (dist2(o.x, o.y, e.x, e.y) > mark.arc * mark.arc) continue;
        this.hurtMob(o, Math.max(1, Math.round(dealt * 0.5)), p.dir, f, p);
        this.fx(f, 'spark', o.x + 8, o.y + 8);
      }
    }
    if (mark.knock) {
      e.knockX = DX[p.dir] * mark.knock;
      e.knockY = DY[p.dir] * mark.knock;
      e.knockT = 6;
    }
    if (mark.grass) {
      const at = tileUnder(e, e.box);
      if (f.tiles[at] === TT.FLOOR || f.tiles[at] === TT.FLOOR_DECO) f.set(at, TT.GRASS);
    }
    if (mark.shield) this.afflict(p, B.BARRIER, 240, mark.shield, f);
  }

  /** And what a cursed one does instead. */
  procWeaponCurse(p, w, curse, e, f) {
    if (curse.chance && Math.random() >= curse.chance) return;
    if (curse.wake) {
      for (const o of f.ents) if (isMob(o.kind)) o.alerted = 600;
    }
    if (curse.blink) {
      const spot = this.randomSpot(f);
      if (spot) { p.x = spot.x; p.y = spot.y; p.fovTile = -1; }
      this.fx(f, 'poof', p.x + 8, p.y + 8);
    }
    if (curse.buff) this.afflict(p, curse.buff[0], curse.buff[1], 1, f);
    if (curse.bleed) this.afflict(p, B.BLEEDING, 160, 1, f);
    if (curse.pacify) { BF.clear(e, B.TERROR); e.alerted = 0; e.fleeing = 0; }
  }

  /** What armour does about the blow it just took. Returns damage after it. */
  procGlyph(p, dmg, from, f) {
    const a = p.equip.armor;
    const mark = a.glyph ? GLYPHS[a.glyph] : null;
    const curse = a.curse ? CURSES[a.curse] : null;
    let out = dmg;

    if (mark) {
      if (mark.soak) out = Math.max(1, Math.round(out * (1 - mark.soak)));
      if (mark.chance && Math.random() < mark.chance) {
        if (mark.buff && from) this.afflict(from, mark.buff[0], mark.buff[1], 1, f);
        if (mark.thorns && from) {
          this.hurtMob(from, Math.max(1, Math.round(dmg * mark.thorns)), 0, f, p);
          this.fx(f, 'clang', from.x + 8, from.y + 8);
        }
        if (mark.knock && from) {
          const dx = from.x - p.x, dy = from.y - p.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          from.knockX = (dx / d) * mark.knock;
          from.knockY = (dy / d) * mark.knock;
          from.knockT = 6;
        }
        if (mark.recharge) { p.abilityCd = 0; this.afflict(p, B.RECHARGING, 200, 1, f); }
      }
      if (!a.known) this.learnGear(p, a, 'armor');
    }

    if (curse && curse.chance && Math.random() < curse.chance) {
      if (curse.chill) this.afflict(p, B.SLOW, 160, 1, f);
      if (curse.hungry) p.hunger = Math.max(0, p.hunger - 220);
      if (curse.stink) this.cloud(f, p.x + 8, p.y + 8, 40, B.POISON, 200);
      if (curse.sprout) {
        const at = tileUnder(p, PLAYER_BOX);
        if (f.tiles[at] === TT.FLOOR || f.tiles[at] === TT.FLOOR_DECO) f.set(at, TT.HIGH_GRASS);
      }
      if (curse.summon) this.spawnRandomMob(f);
    }
    return out;
  }

  /** Wearing something long enough teaches you what is written on it. */
  learnGear(p, item, which) {
    if (item.known) return;
    item.known = true;
    const word = markName(item);
    if (word) {
      this.banner(item.curse
        ? `THE ${which === 'weapon' ? 'WEAPON' : 'ARMOUR'} IS ${word}`
        : `IT IS ${word}`, 1800);
    }
    this.metaDirty = true;
  }

  /**
   * Spend a charge and point the thing. Everything is aimed with your facing,
   * so there is no cursor and no pause — you turn, and you fire.
   */
  pointWand(p, f, item) {
    const def = WANDS[item.kind];
    if (!def) return;
    if ((item.charges || 0) <= 0) {
      this.banner('THE WAND IS SPENT', 1200);
      return;
    }
    item.charges--;
    if (!item.known) {
      item.known = true;
      if (!this.known.wands.includes(item.kind)) this.known.wands.push(item.kind);
      this.banner(`IT IS A WAND OF ${def.name}`, 1800);
    }
    this.metaDirty = true;

    const dmg = wandPower(def, f.depth, item.upgrade || 0);
    const dx = DX[p.dir], dy = DY[p.dir];
    const cx = p.x + 8, cy = p.y + 8;

    switch (def.effect) {
      case 'bolt': {
        this.fx(f, 'bolt', cx, cy);
        f.ents.push({
          id: this.entSeq++, kind: KIND.BOLT, x: p.x, y: p.y, dir: p.dir,
          box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, aimed: true,
          vx: dx * 4.4, vy: dy * 4.4, speed: 4.4, range: 190, travelled: 0,
          dmg, owner: p.id, friendly: true,
          freeze: def.freeze || 0, burn: def.burn || 0,
        });
        break;
      }
      case 'cone': {
        // three tiles of flame straight ahead
        for (let step = 1; step <= 3; step++) {
          const x = cx + dx * step * TILE, y = cy + dy * step * TILE;
          this.fx(f, 'fire', x, y);
          const at = tileUnder({ x: x - 8, y: y - 8 }, PLAYER_BOX);
          if (!passable(f.tiles[at])) break;
          if (f.tiles[at] === TT.GRASS || f.tiles[at] === TT.HIGH_GRASS) f.set(at, TT.EMBERS);
          for (const e of f.ents) {
            if (e.dead || !isMob(e.kind)) continue;
            if (dist2(e.x + 8, e.y + 8, x, y) > 14 * 14) continue;
            this.hurtMob(e, dmg, p.dir, f, p);
            if (def.burn) this.afflict(e, B.BURNING, def.burn, 1, f);
          }
        }
        break;
      }
      case 'beam': {
        // a line that does not stop at the first thing it meets
        this.fx(f, 'beam', cx, cy);
        for (let step = 1; step <= 10; step++) {
          const x = cx + dx * step * TILE, y = cy + dy * step * TILE;
          const at = tileUnder({ x: x - 8, y: y - 8 }, PLAYER_BOX);
          if (!inBounds(tx(at), ty(at)) || !shotPasses(f.tiles[at])) break;
          this.fx(f, 'spark', x, y);
          for (const e of f.ents) {
            if (e.dead || !isMob(e.kind)) continue;
            if (dist2(e.x + 8, e.y + 8, x, y) > 12 * 12) continue;
            this.hurtMob(e, dmg, p.dir, f, p);
          }
        }
        break;
      }
      case 'chain': {
        // hits what is ahead, then jumps between whatever is standing close
        const first = this.nearestAhead(p, f, 120);
        if (!first) { this.fx(f, 'spark', cx + dx * 20, cy + dy * 20); break; }
        const struck = new Set([first]);
        let from = first;
        this.hurtMob(first, dmg, p.dir, f, p);
        this.fx(f, 'spark', first.x + 8, first.y + 8);
        for (let jump = 0; jump < 3; jump++) {
          let next = null, best = Infinity;
          for (const e of f.ents) {
            if (e.dead || !isMob(e.kind) || struck.has(e)) continue;
            const d = dist2(e.x, e.y, from.x, from.y);
            if (d < best && d <= def.arc * def.arc) { best = d; next = e; }
          }
          if (!next) break;
          struck.add(next);
          this.hurtMob(next, Math.max(1, Math.round(dmg * 0.7)), p.dir, f, p);
          this.fx(f, 'spark', next.x + 8, next.y + 8);
          from = next;
        }
        break;
      }
      case 'gas': {
        const x = cx + dx * 30, y = cy + dy * 30;
        this.cloud(f, x, y, def.radius, B.CORROSION, def.corrode, p);
        break;
      }
      case 'burst': {
        this.fx(f, 'blast', cx, cy);
        for (const e of f.ents) {
          if (e.dead || !isMob(e.kind)) continue;
          const d2 = dist2(e.x + 8, e.y + 8, cx, cy);
          if (d2 > def.radius * def.radius) continue;
          this.hurtMob(e, dmg, p.dir, f, p);
          const d = Math.max(1, Math.sqrt(d2));
          e.knockX = ((e.x + 8 - cx) / d) * def.knock;
          e.knockY = ((e.y + 8 - cy) / d) * def.knock;
          e.knockT = 8;
        }
        break;
      }
      case 'drain': {
        const target = this.nearestAhead(p, f, 130);
        if (!target) { this.banner('NOTHING IN FRONT OF YOU', 1100); break; }
        this.hurtMob(target, dmg, p.dir, f, p);
        this.healPlayer(p, Math.max(1, Math.round(dmg * 0.6)));
        this.fx(f, 'heal', p.x + 8, p.y + 8);
        break;
      }
      case 'grow': {
        for (let step = 1; step <= def.reach; step++) {
          const at = tileUnder({ x: cx + dx * step * TILE - 8, y: cy + dy * step * TILE - 8 }, PLAYER_BOX);
          const t = f.tiles[at];
          if (t === TT.FLOOR || t === TT.FLOOR_DECO || t === TT.EMBERS) f.set(at, TT.HIGH_GRASS);
          else if (t === TT.GRASS) f.set(at, TT.HIGH_GRASS);
          else if (!passable(t)) break;
        }
        this.fx(f, 'heal', cx + dx * 20, cy + dy * 20);
        break;
      }
      case 'charm': {
        const target = this.nearestAhead(p, f, 130);
        if (!target) { this.banner('NOTHING IN FRONT OF YOU', 1100); break; }
        this.afflict(target, B.CHARM, def.charm, 1, f);
        this.fx(f, 'poof', target.x + 8, target.y + 8);
        break;
      }
      case 'ward': {
        // in front if there is room, otherwise anywhere beside you — a wand
        // should not fizzle just because you are stood against a wall
        const here = tileUnder(p, PLAYER_BOX);
        const ahead = tileUnder({ x: cx + dx * TILE - 8, y: cy + dy * TILE - 8 }, PLAYER_BOX);
        let at = null;
        for (const cand of [ahead, here,
                            idx(tx(here) + 1, ty(here)), idx(tx(here) - 1, ty(here)),
                            idx(tx(here), ty(here) + 1), idx(tx(here), ty(here) - 1)]) {
          if (cand !== null && cand !== undefined && passable(f.tiles[cand])) { at = cand; break; }
        }
        if (at === null) { this.banner('NO ROOM FOR IT THERE', 1200); break; }
        const spot = tileToPixel(at, { x: 4, y: 4, w: 8, h: 8 });
        f.ents.push({
          id: this.entSeq++, kind: KIND.WARD, x: spot.x, y: spot.y, dir: p.dir,
          box: { x: 4, y: 4, w: 8, h: 8 }, t: 0,
          life: def.life, cd: 0, dmg, owner: p.id,
        });
        this.fx(f, 'poof', spot.x + 8, spot.y + 8);
        break;
      }
      case 'flash': {
        this.fx(f, 'blast', cx, cy);
        for (const e of f.ents) {
          if (e.dead || !isMob(e.kind)) continue;
          if (dist2(e.x + 8, e.y + 8, cx, cy) > def.radius * def.radius) continue;
          this.hurtMob(e, dmg, p.dir, f, p);
          this.afflict(e, B.BLINDNESS, def.blind, 1, f);
        }
        this.afflict(p, B.LIGHT, 400, 1, f);
        break;
      }
      default: break;
    }
  }

  /**
   * Walk a line out from the hero in the direction they face, stopping at the
   * first wall. `onTile` sees each tile crossed; `onMob` sees each monster in
   * the way, once. Stepping in small increments rather than tile-to-tile is
   * what stops a beam sliding past something standing between two samples.
   */
  sweep(p, f, reach, onTile, onMob, spark) {
    const dx = DX[p.dir], dy = DY[p.dir];
    let x = p.x + 8, y = p.y + 8;
    const hit = new Set();
    const seenTiles = new Set();
    const STEP = 4;
    for (let d = STEP; d <= reach; d += STEP) {
      x = p.x + 8 + dx * d;
      y = p.y + 8 + dy * d;
      const at = tileUnder({ x: x - 8, y: y - 8 }, PLAYER_BOX);
      if (!inBounds(tx(at), ty(at)) || !shotPasses(f.tiles[at])) break;
      if (!seenTiles.has(at)) {
        seenTiles.add(at);
        onTile?.(x, y, at);
        if (spark) this.fx(f, spark, tx(at) * TILE + 8, ty(at) * TILE + 8);
      }
      for (const e of f.ents) {
        if (e.dead || !isMob(e.kind) || hit.has(e)) continue;
        if (!rectsOverlap(x - 5, y - 5, 10, 10,
                          e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h)) continue;
        hit.add(e);
        onMob(e);
      }
    }
    return hit;
  }

  /** Put an artifact on, swapping out whatever was there. */
  wearArtifact(p, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const art = slot.item;
    const old = p.equip.artifact;
    p.equip.artifact = { ...art };
    p.bag[n] = old ? { key: stackKey(old), item: old, count: 1 } : null;
    this.fx(this.floor(p.depth), 'equip', p.x + 8, p.y + 8);
    this.banner(`${p.name} TAKES UP THE ${ARTIFACTS[art.kind].name}`, 1800);
    this.recalc(p);
  }

  /** Feed the worn artifact whatever it lives on, and say so if it grows. */
  growArtifact(p, what, amount = 1) {
    const art = p.equip.artifact;
    if (!art) return;
    if (feed(art, what, amount)) {
      this.banner(`THE ${ARTIFACTS[art.kind].name} IS STRONGER`, 1800);
      this.metaDirty = true;
    }
  }

  /**
   * The one thing you carry that answers to its own key. Everything here is
   * instant — nothing may pause, because three other people are playing.
   */
  useArtifact(p) {
    if (p.ghost || this.state !== 'play') return;
    const art = p.equip.artifact;
    if (!art) { this.banner('YOU ARE CARRYING NO SUCH THING', 1200); return; }
    const def = ARTIFACTS[art.kind];
    if (!def.active) { this.banner(`THE ${def.name} WORKS ON ITS OWN`, 1400); return; }
    if ((art.charge || 0) <= 0) { this.banner(`THE ${def.name} IS SPENT`, 1200); return; }

    const f = this.floor(p.depth);
    const lv = art.level;
    art.charge--;
    this.growArtifact(p, 'use');
    this.metaDirty = true;

    switch (art.kind) {
      case ART.CLOAK:
        p.invis = Math.max(p.invis, 160 + lv * 30);
        this.afflict(p, B.INVISIBLE, 160 + lv * 30, 1, f);
        this.fx(f, 'cloak', p.x + 8, p.y + 8);
        this.banner(`${p.name} STEPS OUT OF SIGHT`, 1400);
        break;

      case ART.HORN:
        p.hunger = HUNGER_MAX;
        this.healPlayer(p, 4 + lv);
        this.fx(f, 'eat', p.x + 8, p.y + 8);
        this.banner('A MEAL OUT OF NOTHING', 1400);
        break;

      case ART.CHALICE: {
        // it wants your blood, and pays for it afterwards
        const cost = Math.max(2, Math.round(p.maxHp * 0.18));
        this.hurtPlayer(p, cost, p.x + 8, p.y + 8, null, true);
        if (!p.ghost) {
          this.growArtifact(p, 'blood');
          this.afflict(p, B.REGEN, 600 + lv * 120, 1 + Math.floor(lv / 3), f);
          this.banner('THE CHALICE DRINKS, AND THEN GIVES BACK', 1800);
        }
        break;
      }

      case ART.TALISMAN: {
        const reach = 4 + lv;
        const here = tileUnder(p, PLAYER_BOX);
        const cx = tx(here), cy = ty(here);
        let found = 0;
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (!inBounds(nx, ny)) continue;
            const j = idx(nx, ny);
            if (f.tiles[j] === TT.TRAP_HIDDEN) { f.set(j, TT.TRAP); found++; }
            else if (f.tiles[j] === TT.SECRET_DOOR) { f.set(j, TT.DOOR); found++; }
          }
        }
        if (found) this.growArtifact(p, 'search', found);
        this.banner(found ? `THE FLOOR GIVES UP ${found} SECRETS` : 'NOTHING IS HIDDEN HERE', 1600);
        break;
      }

      case ART.HOURGLASS: {
        const ticks = 90 + lv * 20;
        for (const e of f.ents) {
          if (e.dead || !isMob(e.kind) || isNpc(e.kind)) continue;
          this.afflict(e, B.FROZEN, ticks, 1, f);
        }
        this.fx(f, 'freeze', p.x + 8, p.y + 8);
        this.banner('EVERYTHING BUT YOU STOPS', 1800);
        break;
      }

      case ART.CAPE:
        this.afflict(p, B.BARKSKIN, 260 + lv * 40, 1, f);
        p.thorns = 260 + lv * 40;
        this.fx(f, 'guard', p.x + 8, p.y + 8);
        this.banner('THE CAPE BRISTLES', 1500);
        break;

      case ART.ROSE: {
        const spot = tileToPixel(tileUnder(p, PLAYER_BOX), { x: 4, y: 4, w: 8, h: 8 });
        f.ents.push({
          id: this.entSeq++, kind: KIND.SPIRIT, x: spot.x, y: spot.y, dir: p.dir,
          box: { x: 3, y: 5, w: 10, h: 10 }, t: 0,
          life: 500 + lv * 100, cd: 0,
          dmg: 4 + lv * 2, owner: p.id,
        });
        this.fx(f, 'poof', p.x + 8, p.y + 8);
        this.banner('SOMEONE NOT QUITE GONE STEPS OUT', 1800);
        break;
      }

      case ART.CHAINS: {
        // grab the nearest thing ahead and haul it in
        const target = this.nearestAhead(p, f, 140 + lv * 10);
        if (target) {
          const dx = p.x - target.x, dy = p.y - target.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          target.knockX = (dx / d) * 26;
          target.knockY = (dy / d) * 26;
          target.knockT = 8;
          this.afflict(target, B.CRIPPLE, 120, 1, f);
          this.fx(f, 'clang', target.x + 8, target.y + 8);
          this.banner('THE CHAINS TAKE HOLD', 1400);
        } else {
          // nothing there: haul yourself instead
          const dxx = DX[p.dir], dyy = DY[p.dir];
          for (let step = 6; step >= 1; step--) {
            const at = tileUnder({ x: p.x + dxx * step * TILE, y: p.y + dyy * step * TILE }, PLAYER_BOX);
            if (!passable(f.tiles[at])) continue;
            const spot = tileToPixel(at, PLAYER_BOX);
            p.x = spot.x; p.y = spot.y;
            p.fovTile = -1;
            break;
          }
          this.fx(f, 'poof', p.x + 8, p.y + 8);
          this.banner('YOU HAUL YOURSELF ACROSS', 1400);
        }
        break;
      }

      case ART.BEACON: {
        if (!art.beacon || art.beacon.depth !== p.depth) {
          art.beacon = { depth: p.depth, x: Math.round(p.x), y: Math.round(p.y) };
          art.charge++;                          // setting it is free
          this.fx(f, 'poof', p.x + 8, p.y + 8);
          this.banner('THIS PLACE IS REMEMBERED', 1600);
        } else {
          p.x = art.beacon.x; p.y = art.beacon.y;
          p.fovTile = -1;
          this.fx(f, 'teleport', p.x + 8, p.y + 8);
          this.banner('THE BEACON PULLS YOU BACK', 1600);
        }
        break;
      }

      case ART.SPELLBOOK: {
        const pool = [SCROLL.MAPPING, SCROLL.TERROR, SCROLL.RAGE, SCROLL.LULLABY,
                      SCROLL.RECHARGE, SCROLL.MIRROR, SCROLL.TELEPORT];
        const pick = pool[Math.floor(Math.random() * pool.length)];
        this.banner('THE BOOK FALLS OPEN SOMEWHERE', 1400);
        this.read(p, f, pick);
        break;
      }

      default:
        break;
    }
  }

  /** A spirit called up by the rose: it fights beside you, then fades. */
  stepSpirit(e, f) {
    if (--e.life <= 0) { e.dead = true; this.fx(f, 'poof', e.x + 8, e.y + 8); return; }
    let best = null, bd = Infinity;
    for (const o of f.ents) {
      if (o.dead || !isMob(o.kind) || isNpc(o.kind)) continue;
      const d = dist2(o.x, o.y, e.x, e.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) {
      // nothing to fight: drift back to whoever called you
      const owner = this.players.get(e.owner);
      if (owner && dist2(owner.x, owner.y, e.x, e.y) > 40 * 40) {
        const dx = owner.x - e.x, dy = owner.y - e.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        moveActor(e, (dx / d) * 1.8, (dy / d) * 1.8, f.tiles, e.box, MODE.FLY, true);
      }
      return;
    }
    const dx = best.x - e.x, dy = best.y - e.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? E : W) : (dy > 0 ? S : N);
    if (bd > 16 * 16) {
      moveActor(e, (dx / d) * 2.1, (dy / d) * 2.1, f.tiles, e.box, MODE.FLY, true);
      clampToLevel(e, e.box);
    } else if (e.cd <= 0) {
      e.cd = 26;
      this.hurtMob(best, e.dmg, e.dir, f, this.players.get(e.owner));
      this.fx(f, 'clang', best.x + 8, best.y + 8);
    }
    if (e.cd > 0) e.cd--;
  }

  /**
   * Throw one of whatever is in that slot. It flies where you face, and what
   * is left of it lands on the floor for you to pick up on the way past.
   */
  throwMissile(p, f, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const item = slot.item;
    const def = MISSILES[item.kind];
    if (!def) return;

    if (--slot.count <= 0) p.bag[n] = null;
    this.metaDirty = true;

    const dmg = missilePower(def, f.depth, p.stats.ranged);
    const dx = DX[p.dir], dy = DY[p.dir];
    f.ents.push({
      id: this.entSeq++, kind: KIND.THROWN, x: p.x, y: p.y, dir: p.dir,
      box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, aimed: true,
      vx: dx * def.speed, vy: dy * def.speed, speed: def.speed,
      range: def.range * p.stats.rangeMult, travelled: 0,
      dmg, owner: p.id, friendly: true,
      missile: item.kind,
      pierce: def.pierce || 0,
      hitIds: [],
      homeX: p.x, homeY: p.y, coming: false,
    });
    this.fx(f, 'arrow', p.x + 8, p.y + 8);
  }

  /** A thrown thing in flight: it hits, it lands, or it comes back. */
  stepThrown(e, f, players) {
    const def = MISSILES[e.missile];
    e.x += e.vx; e.y += e.vy;
    e.travelled += Math.hypot(e.vx, e.vy);

    // a boomerang turns round at the far end and flies home
    if (def.returns && !e.coming && e.travelled >= e.range * 0.5) {
      e.coming = true;
      e.hitIds = [];
      const dx = e.homeX - e.x, dy = e.homeY - e.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      e.vx = (dx / d) * e.speed;
      e.vy = (dy / d) * e.speed;
    }

    for (const m of f.ents) {
      if (m.dead || !isMob(m.kind) || e.hitIds.includes(m.id)) continue;
      if (!rectsOverlap(e.x + 4, e.y + 4, 8, 8,
                        m.x + m.box.x, m.y + m.box.y, m.box.w, m.box.h)) continue;
      e.hitIds.push(m.id);
      this.hurtMob(m, e.dmg, e.dir, f, this.players.get(e.owner));
      if (def.roots) this.afflict(m, B.ROOTS, def.roots, 1, f);
      if (def.cripple) this.afflict(m, B.CRIPPLE, def.cripple, 1, f);
      if (def.bleed) this.afflict(m, B.BLEEDING, def.bleed, 1, f);
      if (def.burst) {
        this.fx(f, 'blast', e.x + 8, e.y + 8);
        for (const o of f.ents) {
          if (o.dead || !isMob(o.kind) || o === m) continue;
          const d2 = dist2(o.x + 8, o.y + 8, e.x + 8, e.y + 8);
          if (d2 > def.burst * def.burst) continue;
          this.hurtMob(o, Math.round(e.dmg * 0.6), e.dir, f, this.players.get(e.owner));
          const d = Math.max(1, Math.sqrt(d2));
          o.knockX = ((o.x - e.x) / d) * def.knock;
          o.knockY = ((o.y - e.y) / d) * def.knock;
          o.knockT = 8;
        }
      }
      if (e.pierce > 0 && !def.returns) { e.pierce--; continue; }
      if (def.returns) continue;      // it carries on and comes back
      return this.landMissile(e, f);
    }

    // a returning throw is caught rather than dropped
    if (def.returns && e.coming) {
      const owner = this.players.get(e.owner);
      if (owner && rectsOverlap(e.x + 4, e.y + 4, 8, 8,
                                owner.x + PLAYER_BOX.x, owner.y + PLAYER_BOX.y,
                                PLAYER_BOX.w, PLAYER_BOX.h)) {
        e.dead = true;
        this.addToBag(owner, { type: ITEM.MISSILE, kind: e.missile, amount: 1 });
        this.metaDirty = true;
        return;
      }
    }

    if (boxBlocked(f.tiles, e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h, MODE.SHOT) ||
        e.travelled > e.range * (def.returns ? 1.6 : 1) || e.t > 240) {
      return this.landMissile(e, f);
    }
  }

  /** What is left of a throw comes to rest on the floor. */
  landMissile(e, f) {
    e.dead = true;
    const def = MISSILES[e.missile];
    this.fx(f, 'fizzle', e.x + 8, e.y + 8);
    if (Math.random() > (def.keep ?? 0.7)) return;      // it broke
    const at = tileUnder(e, e.box);
    const spot = passable(f.tiles[at]) ? at : null;
    if (spot === null) return;
    this.dropItem(f, spot, { type: ITEM.MISSILE, kind: e.missile, amount: 1 });
  }

  /**
   * The pot in a laboratory. Three seeds go in and a potion comes out: three
   * of a kind gives you what that seed makes, and a mixed handful gives you
   * one of the three at random, which is the whole gamble.
   */
  brew(p, f) {
    const seeds = [];
    for (let i = 0; i < p.bag.length && seeds.length < BREW_COST; i++) {
      const slot = p.bag[i];
      if (slot?.item?.type !== ITEM.SEED) continue;
      const take = Math.min(slot.count, BREW_COST - seeds.length);
      for (let n = 0; n < take; n++) seeds.push(slot.item.kind);
      slot.count -= take;
      if (slot.count <= 0) p.bag[i] = null;
    }
    if (seeds.length < BREW_COST) {
      // put back what we took: no half brews
      for (const kind of seeds) this.addToBag(p, { type: ITEM.SEED, kind, amount: 1 });
      this.banner(`THE POT WANTS ${BREW_COST} SEEDS`, 1600);
      return;
    }

    const same = seeds.every(k => k === seeds[0]);
    const pick = same ? seeds[0] : seeds[Math.floor(Math.random() * seeds.length)];
    const kind = BREWS[pick] || 'healing';
    const potion = { type: ITEM.POTION, kind };
    if (!this.take(p, f, potion)) this.dropItem(f, tileUnder(p, PLAYER_BOX), potion);
    this.fx(f, 'drink', p.x + 8, p.y + 8);
    this.banner(same ? 'THE POT GIVES YOU EXACTLY WHAT YOU ASKED FOR'
                     : 'SOMETHING COMES OUT OF THE POT', 1800);
    this.metaDirty = true;
  }

  /** Put a seed in the ground one tile ahead of you. */
  sow(p, f, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const kind = slot.item.kind;
    const dx = DX[p.dir], dy = DY[p.dir];
    const at = tileUnder({ x: p.x + dx * TILE, y: p.y + dy * TILE }, PLAYER_BOX);
    const here = tileUnder(p, PLAYER_BOX);
    const spot = this.sowable(f, at) ? at : this.sowable(f, here) ? here : null;
    if (spot === null) { this.banner('NOTHING WILL TAKE ROOT THERE', 1300); return; }

    if (--slot.count <= 0) p.bag[n] = null;
    this.plant(f, spot, kind);
    this.fx(f, 'heal', tx(spot) * TILE + 8, ty(spot) * TILE + 8);
    this.banner(`${PLANTS[kind].name} TAKES ROOT`, 1400);
    this.metaDirty = true;
  }

  /** Will anything grow on this tile? */
  sowable(f, i) {
    if (i === null || i === undefined) return false;
    const t = f.tiles[i];
    if (t !== TT.FLOOR && t !== TT.FLOOR_DECO && t !== TT.GRASS && t !== TT.EMBERS) return false;
    return !f.ents.some(e => !e.dead && e.kind === KIND.PLANT && tileUnder(e, e.box) === i);
  }

  /** Grow one, wherever it came from. */
  plant(f, tile, kind) {
    const px = tileToPixel(tile, { x: 4, y: 4, w: 8, h: 8 });
    const e = {
      id: this.entSeq++, kind: KIND.PLANT, x: px.x, y: px.y, dir: 0,
      box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, plant: kind,
    };
    f.ents.push(e);
    return e;
  }

  /** Something stood on it. It does its one thing and is gone. */
  trample(e, f, who, isHero) {
    const def = PLANTS[e.plant];
    if (!def) { e.dead = true; return; }
    e.dead = true;
    const x = e.x + 8, y = e.y + 8;
    this.fx(f, 'poof', x, y);
    this.banner(def.name, 1200);

    if (def.buff) this.afflict(who, def.buff[0], def.buff[1], 1, f);
    if (def.cloud) this.cloud(f, x, y, def.cloud[2], def.cloud[0], def.cloud[1], null);
    if (def.teleport && isHero) {
      const spot = this.randomSpot(f);
      if (spot) { who.x = spot.x; who.y = spot.y; who.fovTile = -1; }
      this.fx(f, 'teleport', who.x + 8, who.y + 8);
    } else if (def.teleport) {
      const spot = this.randomSpot(f);
      if (spot) { who.x = spot.x; who.y = spot.y; }
    }
    if (def.shout) {
      for (const o of f.ents) {
        if (o.dead || !isMob(o.kind) || isNpc(o.kind)) continue;
        o.alerted = def.shout;
      }
    }
    if (def.feeds && isHero) {
      who.hunger = HUNGER_MAX;
      this.healPlayer(who, 3);
      this.fx(f, 'eat', x, y);
    }
    this.metaDirty = true;
  }

  /** The nearest monster roughly in front of the hero. */
  nearestAhead(p, f, reach) {
    const dx = DX[p.dir], dy = DY[p.dir];
    const cx = p.x + 8, cy = p.y + 8;
    let best = null, bd = Infinity;
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind)) continue;
      const ox = e.x + 8 - cx, oy = e.y + 8 - cy;
      if (ox * dx + oy * dy <= 0) continue;             // behind you
      const off = Math.abs(ox * dy - oy * dx);          // how far off the line
      if (off > 26) continue;
      const d = ox * ox + oy * oy;
      if (d > reach * reach || d >= bd) continue;
      bd = d; best = e;
    }
    return best;
  }

  /** A ward sits where you left it and shoots whatever comes past. */
  stepWard(e, f) {
    if (--e.life <= 0) { e.dead = true; this.fx(f, 'poof', e.x + 8, e.y + 8); return; }
    if (e.cd > 0) { e.cd--; return; }
    let best = null, bd = Infinity;
    for (const o of f.ents) {
      if (o.dead || !isMob(o.kind)) continue;
      const d = dist2(o.x, o.y, e.x, e.y);
      if (d < bd && d < 130 * 130) { bd = d; best = o; }
    }
    if (!best) return;
    e.cd = 40;
    const dx = best.x - e.x, dy = best.y - e.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    f.ents.push({
      id: this.entSeq++, kind: KIND.BOLT, x: e.x, y: e.y, dir: e.dir,
      box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, aimed: true,
      vx: (dx / d) * 3.8, vy: (dy / d) * 3.8, speed: 3.8, range: 150, travelled: 0,
      dmg: e.dmg, owner: e.owner, friendly: true,
    });
    this.fx(f, 'bolt', e.x + 8, e.y + 8);
  }

  /** Somewhere on this floor a hero could stand. */
  randomSpot(f) {
    const pts = f.level.spawnPoints;
    if (!pts || !pts.length) return null;
    for (let n = 0; n < 20; n++) {
      const i = pts[Math.floor(Math.random() * pts.length)];
      if (passable(f.tiles[i])) return tileToPixel(i, PLAYER_BOX);
    }
    return null;
  }

  useAbility(p, f) {
    const def = CLASSES[p.cls];
    const st = p.stats;
    if (def.ranged) {
      this.fx(f, def.ranged.kind === KIND.ARROW ? 'arrow' : 'bolt', p.x + 8, p.y + 8);
      const dmg = def.ranged.dmg + Math.floor(p.level * 0.8)
                + p.equip.weapon.upgrade * 2 + st.ranged;
      const shots = Math.max(1, st.spread);
      const base = Math.atan2(DY[p.dir], DX[p.dir]);
      for (let i = 0; i < shots; i++) {
        const spread = shots === 1 ? 0 : (i - (shots - 1) / 2) * 0.24;
        const a = base + spread;
        f.ents.push({
          id: this.entSeq++, kind: def.ranged.kind, x: p.x, y: p.y, dir: p.dir,
          box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, aimed: true,
          vx: Math.cos(a) * def.ranged.speed, vy: Math.sin(a) * def.ranged.speed,
          speed: def.ranged.speed, range: def.ranged.range * st.rangeMult, travelled: 0,
          dmg, owner: p.id, friendly: true,
          pierce: st.pierce, snare: st.snare,
        });
      }
    } else if (p.cls === 'rogue') {
      p.invis = Math.round(150 * st.cloakMult);
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

    // anything growing under your feet goes off
    for (const e of f.ents) {
      if (e.dead || e.kind !== KIND.PLANT) continue;
      if (!rectsOverlap(p.x + 2, p.y + 2, 12, 12, e.x + 2, e.y + 2, 12, 12)) continue;
      this.trample(e, f, p, true);
    }

    if (t === TT.CRACKED) {
      f.set(i, TT.CHASM);
      this.fx(f, 'blast', p.x + 8, p.y + 8);
      if (p.effects?.fly) {
        this.banner('THE FLOOR FALLS AWAY BENEATH YOU', 1500);
      } else {
        this.banner('THE FLOOR GIVES WAY', 1500);
        this.hurtPlayer(p, 2 + Math.floor(p.depth / 3), p.x + 8, p.y + 8, null, true);
        if (!p.dead && !p.ghost) this.descend(p, true);
      }
    }
    // a rogue — or anyone trapwise — reads the floor before standing on it
    const reach = Math.max(p.cls === 'rogue' ? 2 : 0, p.stats.search);
    // and anyone who stands still long enough finds what is beside them
    if ((p.still || 0) > 30 && (this.tick & 15) === 0) this.searchAround(p, f, i, 1);
    if (reach > 0) {
      const cx = tx(i), cy = ty(i);
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (!inBounds(nx, ny)) continue;
          const j = idx(nx, ny);
          if (f.tiles[j] === TT.TRAP_HIDDEN) f.set(j, TT.TRAP);
          else if (f.tiles[j] === TT.SECRET_DOOR) {
            f.set(j, TT.DOOR);
            this.growArtifact(p, 'search');
            this.banner('A DOOR, WHERE THERE WAS A WALL', 1800);
          }
        }
      }
    }
  }

  /** Look at the tiles around one spot and reveal what is hiding there. */
  searchAround(p, f, i, reach) {
    const cx = tx(i), cy = ty(i);
    for (let dy = -reach; dy <= reach; dy++) {
      for (let dx = -reach; dx <= reach; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (f.tiles[j] === TT.SECRET_DOOR) {
          f.set(j, TT.DOOR);
          this.banner('A DOOR, WHERE THERE WAS A WALL', 1800);
        }
      }
    }
  }

  springTrap(p, f, i) {
    const kind = f.level.traps?.[i] || TRAP.DART;
    const def = TRAPS[kind];
    const x = tx(i) * TILE + 8, y = ty(i) * TILE + 8;
    this.fx(f, def.blast ? 'blast' : 'trap', x, y);
    this.banner(def.name, 1300);

    if (def.dmg) {
      const dmg = Math.round(def.dmg * (1 + f.depth * 0.18));
      if (def.area) {
        this.burst(f, x, y, def.area, dmg, null);
        this.hurtPlayer(p, dmg, x, y, null, true);
      } else {
        this.hurtPlayer(p, dmg, x, y, null, true);
      }
    }
    if (def.buff) this.afflict(p, def.buff[0], def.buff[1], def.buff[2] || 1, f);
    if (def.cloud) this.cloud(f, x, y, def.cloud[2], def.cloud[0], def.cloud[1], null);
    if (def.scorch) f.set(i, TT.EMBERS);
    if (def.wet) {
      f.set(i, TT.WATER);
      BF.clear(p, B.BURNING);
    }
    if (def.knock) {
      p.knockX = 0; p.knockY = def.knock;
      p.knockT = KNOCKBACK_TICKS + 2;
    }
    if (def.alarm) {
      for (const e of f.ents) if (isMob(e.kind)) e.alerted = 900;
      this.banner('THE WHOLE FLOOR HEARD THAT', 1500);
    }
    if (def.summon) {
      for (let n = 0; n < def.summon; n++) this.spawnNear(f, i);
    }
    if (def.guardian) {
      const spot = tileToPixel(i, MOBS[KIND.GOLEM].box);
      const guard = this.spawnMob(f, KIND.GOLEM, spot.x, spot.y);
      guard.alerted = 900;
    }
    if (def.flock) {
      for (let n = 0; n < 4; n++) this.spawnNear(f, i, KIND.SHEEP);
    }
    if (def.teleport || def.warp) {
      const pts = f.level.spawnPoints;
      if (pts.length) {
        const spot = tileToPixel(pts[(Math.random() * pts.length) | 0], PLAYER_BOX);
        p.x = spot.x; p.y = spot.y;
        p.fovTile = -1;
        this.fx(f, 'teleport', p.x + 8, p.y + 8);
      }
      if (def.warp && p.depth < MAX_DEPTH) this.descend(p, true);
    }
    if (def.fall && p.depth < MAX_DEPTH) {
      this.banner(`${p.name} FALLS THROUGH THE FLOOR`, 1800);
      this.descend(p, true);
      this.hurtPlayer(p, 3 + Math.floor(f.depth * 0.6), p.x + 8, p.y + 8, null, true);
    }
    if (def.disarm && p.equip.weapon.tier > 1) {
      const lost = p.equip.weapon;
      p.equip.weapon = { type: ITEM.WEAPON, tier: 1, upgrade: 0 };
      this.dropItem(f, i, lost);
      this.recalc(p);
      this.banner(`${p.name}'S WEAPON IS FLUNG AWAY`, 1700);
    }
  }

  /** Drop something unpleasant next to a tile. */
  spawnNear(f, tile, forceKind) {
    const table = SPAWNS[regionOf(f.depth).key];
    const kind = forceKind || table[f.rng.int(table.length)];
    const pts = f.level.spawnPoints;
    for (let n = 0; n < 12; n++) {
      const at = pts.length ? pts[f.rng.int(pts.length)] : tile;
      const near = Math.abs(tx(at) - tx(tile)) + Math.abs(ty(at) - ty(tile));
      if (near > 7 && n < 8) continue;
      const spot = tileToPixel(at, MOBS[kind]?.box || PLAYER_BOX);
      const e = this.spawnMob(f, kind, spot.x, spot.y);
      if (e) e.alerted = 600;
      return e;
    }
    return null;
  }

  // --- loot ----------------------------------------------------------------
  pickups(p, f) {
    for (const e of f.ents) {
      if (e.dead || e.kind !== KIND.ITEM || e.t < 6) continue;
      if (!rectsOverlap(p.x + 2, p.y + 2, 12, 12, e.x + 2, e.y + 2, 12, 12)) continue;
      if (e.price) continue;   // pay for it first
      if (e.mimic) { this.springMimic(p, f, e); continue; }
      if (this.take(p, f, e.item)) e.dead = true;
    }
  }

  /** True if the item left the floor. */
  take(p, f, item) {
    if (item.type === ITEM.GOLD) {
      const art = p.equip.artifact;
      const cut = art?.kind === ART.ARMBAND ? 1 + art.level * 0.08 : 1;
      const take = Math.round(item.amount * p.stats.goldMult * cut);
      p.gold += take;
      if (art?.kind === ART.ARMBAND) this.growArtifact(p, 'gold', take);
      this.fx(f, 'gold', p.x + 8, p.y + 8);
      this.metaDirty = true;
      return true;
    }
    if (item.type === ITEM.DEW) {
      // a drop mends a little; what you cannot use goes into the vial
      const want = p.maxHp - p.hp;
      const worth = 1 + Math.floor(f.depth / 5);
      if (want > 0) {
        this.healPlayer(p, Math.min(want, worth));
      } else {
        p.dew = Math.min(DEW_MAX, (p.dew || 0) + worth);
      }
      this.fx(f, 'drink', p.x + 8, p.y + 8);
      this.metaDirty = true;
      return true;
    }
    if (item.type === ITEM.RELIC) {
      this.state = 'win';
      this.banner('THE AMULET IS YOURS', 4000);
      return true;
    }
    // a scholar knows a rune the moment they see it
    if (item.type === ITEM.SCROLL && p.stats.scholar && !this.known.scrolls.includes(item.kind)) {
      this.known.scrolls.push(item.kind);
      this.banner(`YOU RECOGNISE THE SCROLL OF ${item.kind.toUpperCase()}`, 1800);
    }
    if (!this.addToBag(p, item)) {
      this.banner(`${p.name}'S PACK IS FULL`, 1200);
      return false;
    }
    this.fx(f, isConsumable(item) ? 'pickup' : 'equip', p.x + 8, p.y + 8);
    this.metaDirty = true;
    return true;
  }

  /** Stack it if it stacks, otherwise find a free slot. */
  addToBag(p, item) {
    const n = item.amount || 1;
    if (isConsumable(item)) {
      const key = stackKey(item);
      const slot = p.bag.find(x => x && x.key === key);
      if (slot) { slot.count += n; return true; }
    }
    const free = p.bag.indexOf(null);
    if (free < 0) return false;
    const copy = { ...item };
    delete copy.amount;
    p.bag[free] = { key: stackKey(item), item: copy, count: isConsumable(item) ? n : 1 };
    return true;
  }

  /** Put a ring on, taking off whichever one is in the way. */
  wearRing(p, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const ring = slot.item;
    // an empty finger first, otherwise the one that is not stuck
    let which = !p.equip.ring1 ? 'ring1' : !p.equip.ring2 ? 'ring2' : null;
    if (!which) {
      if (!p.equip.ring1.cursed) which = 'ring1';
      else if (!p.equip.ring2.cursed) which = 'ring2';
      else {
        this.banner('BOTH RINGS ARE STUCK FAST', 1800);
        return;
      }
    }
    const off = p.equip[which];
    p.equip[which] = { ...ring, worn: 0 };
    p.bag[n] = off ? { key: stackKey(off), item: off, count: 1 } : null;
    this.fx(this.floor(p.depth), 'equip', p.x + 8, p.y + 8);
    this.banner(`${p.name} PUTS ON THE ${itemLabel(ring, this.app, this.known)}`, 1600);
    if (p.equip[which].cursed) {
      p.equip[which].known = true;
      this.banner('IT TIGHTENS, AND WILL NOT COME OFF', 2000);
    }
    this.recalc(p);
  }

  /** Take a ring off, if it will let you. */
  removeRing(p, which) {
    const ring = p.equip[which];
    if (!ring) return;
    if (ring.cursed) {
      ring.known = true;
      this.banner('IT WILL NOT COME OFF', 1600);
      this.recalc(p);
      return;
    }
    if (!this.addToBag(p, ring)) { this.banner(`${p.name}'S PACK IS FULL`, 1200); return; }
    p.equip[which] = null;
    this.banner('RING REMOVED', 1200);
    this.recalc(p);
  }

  /** Wear something from the bag, putting whatever you had back. */
  equipFrom(p, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const it = slot.item;
    if (it.type === ITEM.RING) return this.wearRing(p, n);
    if (it.type === ITEM.ARTIFACT) return this.wearArtifact(p, n);
    if (it.type !== ITEM.WEAPON && it.type !== ITEM.ARMOR) return;
    const which = it.type === ITEM.WEAPON ? 'weapon' : 'armor';
    const old = p.equip[which];
    if (old.cursed) {
      this.banner(`THE ${which === 'weapon' ? 'WEAPON' : 'ARMOUR'} WILL NOT COME OFF`, 1800);
      if (!old.known) this.learnGear(p, old, which);
      return;
    }
    p.equip[which] = { ...it };
    if (p.equip[which].cursed) {
      this.learnGear(p, p.equip[which], which);
    }
    p.bag[n] = old ? { key: stackKey(old), item: old, count: 1 } : null;
    const table = it.type === ITEM.WEAPON ? WEAPONS : ARMORS;
    this.fx(this.floor(p.depth), 'equip', p.x + 8, p.y + 8);
    this.banner(`${p.name} EQUIPS THE ${table[it.tier - 1].name}`, 1500);
    this.recalc(p);
  }

  /** Put one item back on the floor, where a friend can pick it up. */
  dropSlot(p, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const f = this.floor(p.depth);
    const item = { ...slot.item };
    if (isConsumable(item) && slot.count > 1) { item.amount = 1; slot.count--; }
    else { if (isConsumable(item)) item.amount = slot.count; p.bag[n] = null; }
    if (this.inShop(f, tileUnder(p, PLAYER_BOX))) {
      const paid = sellPrice(item);
      if (paid > 0) {
        p.gold += paid;
        this.fx(f, 'gold', p.x + 8, p.y + 8);
        this.banner(`SOLD FOR ${paid} GOLD`, 1300);
        this.metaDirty = true;
        return;
      }
      this.banner('THE SHOPKEEPER WAVES IT AWAY', 1300);
    }
    this.dropItem(f, tileUnder(p, PLAYER_BOX), item);
    this.fx(f, 'pickup', p.x + 8, p.y + 8);
    this.metaDirty = true;
  }

  /** True if one of the four tiles around this one is open air. */
  chasmBeside(f, i) {
    const cx = tx(i), cy = ty(i);
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (inBounds(nx, ny) && f.tiles[idx(nx, ny)] === TT.CHASM) return true;
    }
    return false;
  }

  /** Jump in. It is a long way down, but it is a way down. */
  leap(p, f) {
    if (p.depth >= MAX_DEPTH) { this.banner('THERE IS NOTHING BELOW', 1400); return; }
    this.fx(f, 'blast', p.x + 8, p.y + 8);
    if (p.effects?.fly) {
      this.banner('YOU DRIFT DOWN THROUGH THE DARK', 1600);
    } else {
      this.banner('YOU LEAP INTO THE DARK', 1600);
      this.hurtPlayer(p, 3 + Math.floor(p.depth / 2), p.x + 8, p.y + 8, null, true);
      if (p.dead || p.ghost) return;
    }
    this.descend(p, true);
  }

  /** Is this tile inside the shop on this floor? */
  inShop(f, tile) {
    const n = f.level.shopRoom;
    if (n === null || n === undefined) return false;
    const r = f.level.rooms[n];
    const x = tx(tile), y = ty(tile);
    return x > r.l && x < r.r && y > r.t && y < r.b;
  }

  /** Hand over the gold, take the goods. */
  buy(p, f, e) {
    if (p.gold < e.price) {
      this.banner(`YOU NEED ${e.price - p.gold} MORE GOLD`, 1500);
      return;
    }
    if (!this.take(p, f, e.item)) return;   // pack full: no sale
    p.gold -= e.price;
    e.dead = true;
    this.fx(f, 'gold', p.x + 8, p.y + 8);
    this.banner(`BOUGHT ${itemLabel(e.item, this.app, this.known)}`, 1500);
    this.metaDirty = true;
  }

  /**
   * Every floor has a character, and the party is told which as they arrive.
   * Each one changes something real, not just the wording of the banner.
   */
  rollFeeling(f) {
    if (f.depth <= 1) return 'none';
    const r = f.rng.next();
    if (r < 0.10) return 'dangerous';
    if (r < 0.20) return 'treasure';
    if (r < 0.28) return 'trapped';
    if (r < 0.36) return 'dark';
    return 'none';
  }

  /** Say it out loud when somebody first sets foot on the floor. */
  announceFeeling(f) {
    switch (f.feeling) {
      case 'dangerous': this.banner('SOMETHING IS BADLY WRONG DOWN HERE', 2600); break;
      case 'treasure': this.banner('SOMETHING VALUABLE IS CLOSE BY', 2600); break;
      case 'trapped': this.banner('THE FLOOR HERE HAS BEEN PREPARED', 2600); break;
      case 'dark': this.banner('IT IS VERY DARK ON THIS FLOOR', 2600); break;
      default: break;
    }
  }

  /** A trapped floor gets a second helping. */
  sowTraps(f) {
    f.level.traps ??= {};
    const pts = f.level.itemPoints;
    for (let n = 0; n < 14; n++) {
      const i = pts[f.rng.int(pts.length)];
      if (i === undefined || f.tiles[i] !== TT.FLOOR) continue;
      f.set(i, TT.TRAP_HIDDEN);
      f.level.traps[i] = rollTrap(f.depth, f.rng);
    }
  }

  /**
   * Some of what is lying about is not lying about. A mimic waits as a piece
   * of loot until somebody reaches for it.
   */
  sowMimics(f) {
    if (f.depth < 3) return;
    const loot = f.ents.filter(e => e.kind === KIND.ITEM && !e.price &&
      e.item.type !== ITEM.KEY && e.item.type !== ITEM.GOLDKEY);
    const want = f.rng.chance(0.55) ? 1 : 0;
    for (let n = 0; n < want && loot.length; n++) {
      const e = loot.splice(f.rng.int(loot.length), 1)[0];
      e.mimic = true;
    }
  }

  /** It stops pretending. */
  springMimic(p, f, e) {
    e.dead = true;
    const st = MOBS[KIND.MIMIC];
    const m = this.spawnMob(f, KIND.MIMIC, e.x - 4, e.y - 6);
    if (m) {
      m.alerted = 900;
      m.hoard = e.item;                 // it swallowed the thing you wanted
    }
    this.fx(f, 'poof', e.x + 8, e.y + 8);
    this.banner('IT WAS NEVER LOOT', 1800);
  }

  /** If somebody is due on this floor, stand them somewhere sensible. */
  placeQuest(f) {
    const id = questForDepth(f.depth, f.rng);
    if (!id) return;
    if (this.quests[id] !== undefined) return;      // already asked, elsewhere
    const q = QUESTS[id];
    const kind = { ghost: KIND.GHOST, wandmaker: KIND.WANDMAKER,
                   blacksmith: KIND.BLACKSMITH, imp: KIND.IMP }[id];
    if (!kind) return;
    const pts = f.level.itemPoints || [];
    let spot = null;
    for (const i of pts) {
      if (passable(f.tiles[i])) { spot = i; break; }
    }
    if (spot === null) return;

    this.quests[id] = QSTATE.OFFER;
    f.questId = id;
    const at = tileToPixel(spot, MOBS[kind].box);
    const npc = this.spawnMob(f, kind, at.x, at.y, { champion: null });
    if (npc) npc.quest = id;

    // and set out whatever the favour actually involves
    if (q.kind === 'slay') this.markQuarry(f, id, q);
    else this.hideQuestItem(f, id, q);
  }

  /** Mark one creature on the floor as the one they want dealt with. */
  markQuarry(f, id, q) {
    if (q.need) { f.questCount = 0; return; }        // a tally, not a target
    const mobs = f.ents.filter(e => isMob(e.kind) && !isNpc(e.kind) && !isBoss(e.kind) && !e.dead);
    const pick = mobs.length ? mobs[f.rng.int(mobs.length)] : this.spawnRandomMob(f);
    if (!pick) return;
    pick.quarry = id;
    this.promote(pick, CHAMP.GROWING);
    pick.maxHp = Math.round(pick.maxHp * 1.5);
    pick.hp = pick.maxHp;
    f.quarryId = pick.id;
  }

  /** Put the thing they asked for somewhere on the floor. */
  hideQuestItem(f, id, q) {
    const pts = f.level.itemPoints || [];
    const spot = pts[Math.max(0, pts.length - 1)];
    if (spot === undefined) return;
    this.dropItem(f, spot, { type: ITEM.QUEST, kind: id, name: q.item });
  }

  /** Walking up to somebody and pressing the same key you press for everything. */
  talkTo(p, f, npc) {
    const id = npc.quest;
    const q = QUESTS[id];
    if (!q) { this.banner('THEY HAVE NOTHING TO SAY', 1200); return true; }
    const state = this.quests[id] ?? QSTATE.OFFER;

    if (state === QSTATE.DONE) { this.banner('THAT IS ALL OF IT. GO ON', 1400); return true; }

    if (state === QSTATE.OFFER) {
      this.quests[id] = QSTATE.TAKEN;
      this.banner(`${q.name}: ${q.ask}`, 3200);
      this.metaDirty = true;
      return true;
    }

    // taken: is it done?
    if (q.kind === 'slay') {
      const need = q.need || 1;
      const got = q.need ? (f.questCount || 0)
                         : (f.quarrySlain ? 1 : 0);
      if (got < need) {
        this.banner(`${q.nag}${q.need ? ` (${got}/${need})` : ''}`, 2400);
        return true;
      }
    } else {
      const slot = p.bag.findIndex(s => s?.item?.type === ITEM.QUEST && s.item.kind === id);
      if (slot < 0) { this.banner(q.nag, 2400); return true; }
      p.bag[slot] = null;
    }

    this.quests[id] = QSTATE.DONE;
    this.banner(q.done, 3000);
    this.payQuest(p, f, q);
    this.metaDirty = true;
    return true;
  }

  /** What they give you for it. */
  payQuest(p, f, q) {
    const give = (item) => { if (!this.take(p, f, item)) this.dropItem(f, tileUnder(p, PLAYER_BOX), item); };
    switch (q.reward) {
      case 'gear':
        give(rollPrize(f.depth, f.rng, this.artifactsSeen));
        break;
      case 'wand':
        give(rollWand(f.depth, f.rng));
        break;
      case 'ring':
        give({ ...rollRing(f.depth, f.rng), cursed: false, known: true });
        p.gold += 100 + f.depth * 10;
        break;
      case 'reforge': {
        // he puts two upgrades into whichever of your two is behind
        const w = p.equip.weapon, a = p.equip.armor;
        const into = (w.tier * 3 + w.upgrade <= a.tier * 3 + a.upgrade) ? w : a;
        into.upgrade += 2;
        if (into.cursed) { into.cursed = false; into.curse = null; }
        this.recalc(p);
        this.fx(f, 'equip', p.x + 8, p.y + 8);
        break;
      }
      default:
        break;
    }
    this.fx(f, 'gold', p.x + 8, p.y + 8);
  }

  /** Fill the special rooms with whatever it is they promise. */
  furnish(f) {
    for (const room of f.level.rooms) {
      const spots = this.roomSpots(f, room);
      if (!spots.length) continue;
      const rng = f.rng;
      const take = () => spots.length ? spots.splice(rng.int(spots.length), 1)[0] : null;

      switch (room.type) {
        case ROOM.ARMORY: {
          const tier = Math.min(5, Math.ceil(f.depth / 5) + 1);
          this.dropItem(f, take(), { type: ITEM.WEAPON, tier, upgrade: rng.chance(0.4) ? 1 : 0 });
          this.dropItem(f, take(), { type: ITEM.ARMOR, tier, upgrade: rng.chance(0.4) ? 1 : 0 });
          break;
        }
        case ROOM.CRYPT: {
          // grave goods, and the previous owners
          this.dropItem(f, take(), rollPrize(f.depth, rng, this.artifactsSeen));
          const guards = 2 + rng.int(2);
          for (let n = 0; n < guards; n++) {
            const at = take();
            if (at === null) break;
            const px = tileToPixel(at, MOBS[KIND.SKELETON].box);
            const e = this.spawnMob(f, KIND.SKELETON, px.x, px.y);
            if (e) e.hidden = true;
          }
          break;
        }
        case ROOM.GARDEN: {
          // a garden is where they grow on their own
          const many = 3 + rng.int(3);
          for (let n = 0; n < many; n++) {
            const at = take();
            if (at === null) break;
            this.plant(f, at, rollPlant(f.depth, rng));
          }
          break;
        }
        case ROOM.LABORATORY: {
          for (let n = 0; n < 3; n++) {
            const at = take();
            if (at === null) break;
            this.dropItem(f, at, rng.chance(0.5)
              ? { type: ITEM.POTION, kind: POTION_KINDS[rng.int(POTION_KINDS.length)] }
              : { type: ITEM.SCROLL, kind: SCROLL_KINDS[rng.int(SCROLL_KINDS.length)] });
          }
          break;
        }
        case ROOM.STORAGE: {
          const crates = 3 + rng.int(3);
          for (let n = 0; n < crates; n++) {
            const at = take();
            if (at === null) break;
            this.dropItem(f, at, rollLoot(f.depth, rng));
          }
          break;
        }
        case ROOM.POOL: {
          // something lives in the water
          const at = take();
          if (at !== null) {
            const px = tileToPixel(at, MOBS[KIND.CRAB].box);
            const e = this.spawnMob(f, KIND.CRAB, px.x, px.y);
            if (e) { e.hp = e.maxHp = Math.round(e.maxHp * 1.6); e.hidden = true; }
          }
          this.dropItem(f, take(), rollPrize(f.depth, rng, this.artifactsSeen));
          break;
        }
        case ROOM.TRAP_ROOM: {
          // the prize sits in the middle of a minefield
          f.level.traps ??= {};
          const centre = idx(Math.floor((room.l + room.r) / 2),
                             Math.floor((room.t + room.b) / 2));
          for (const i of this.roomSpots(f, room)) {
            if (i === centre) continue;
            if (!rng.chance(0.55)) continue;
            f.set(i, TT.TRAP_HIDDEN);
            f.level.traps[i] = rollTrap(f.depth, rng);
          }
          if (passable(f.tiles[centre])) this.dropItem(f, centre, rollPrize(f.depth, rng, this.artifactsSeen));
          break;
        }
        default: break;
      }
    }
  }

  /** The tiles inside a room that something can stand on. */
  roomSpots(f, room) {
    const out = [];
    for (let y = room.t + 1; y <= room.b - 1; y++) {
      for (let x = room.l + 1; x <= room.r - 1; x++) {
        const i = idx(x, y);
        const t = f.tiles[i];
        if (t === TT.FLOOR || t === TT.FLOOR_DECO || t === TT.GRASS) out.push(i);
      }
    }
    return out;
  }

  /** Lay out the shelves and put someone behind them. */
  stockShop(f) {
    const n = f.level.shopRoom;
    if (n === null || n === undefined) return;
    const room = f.level.rooms[n];
    const spots = [];
    for (let y = room.t + 1; y <= room.b - 1; y++) {
      for (let x = room.l + 1; x <= room.r - 1; x++) {
        const i = idx(x, y);
        if (passable(f.tiles[i]) && f.tiles[i] !== TT.DOOR &&
            f.tiles[i] !== TT.OPEN_DOOR) spots.push(i);
      }
    }
    if (spots.length < 4) return;

    // the keeper stands in the middle, the stock goes around the walls
    const keep = spots.splice(Math.floor(spots.length / 2), 1)[0];
    const at = tileToPixel(keep, MOBS[KIND.SHOPKEEPER].box);
    const keeper = this.spawnMob(f, KIND.SHOPKEEPER, at.x, at.y);
    f.shopkeeper = keeper?.id ?? null;

    const stock = rollStock(f.depth, f.rng);
    f.rng.shuffle(spots);
    for (let k = 0; k < stock.length && k < spots.length; k++) {
      const item = stock[k];
      const e = this.dropItem(f, spots[k], item);
      if (e) e.price = buyPrice(item);
    }
  }

  swapSlots(p, a, b) {
    if (a === b) return;
    if (a < 0 || b < 0 || a >= p.bag.length || b >= p.bag.length) return;
    const t = p.bag[a]; p.bag[a] = p.bag[b]; p.bag[b] = t;
    this.metaDirty = true;
  }

  /** One entry point for everything the inventory screen can do. */
  invOp(p, op, a, b) {
    if (this.state !== 'play' || p.ghost) return;
    switch (op) {
      case 'use': this.useSlot(p, a); break;
      case 'equip': this.equipFrom(p, a); break;
      case 'drop': this.dropSlot(p, a); break;
      case 'swap': this.swapSlots(p, a, b); break;
      case 'artifact': this.useArtifact(p); break;
      case 'unequip': {
        const which = ['weapon', 'armor', 'ring1', 'ring2', 'artifact'][a] || 'weapon';
        if (which === 'ring1' || which === 'ring2') { this.removeRing(p, which); break; }
        if (which === 'artifact') {
          const art = p.equip.artifact;
          if (!art) break;
          if (!this.addToBag(p, art)) { this.banner(`${p.name}'S PACK IS FULL`, 1200); break; }
          p.equip.artifact = null;
          this.recalc(p);
          break;
        }
        const worn = p.equip[which];
        if (!worn || worn.tier <= 1) return;      // your last shirt stays on
        if (worn.cursed) {
          this.learnGear(p, worn, which);
          this.banner(`THE ${which === 'weapon' ? 'WEAPON' : 'ARMOUR'} WILL NOT COME OFF`, 1600);
          return;
        }
        if (!this.addToBag(p, worn)) return;
        p.equip[which] = { type: worn.type, tier: 1, upgrade: 0 };
        this.recalc(p);
        break;
      }
      default: break;
    }
  }

  useSlot(p, n) {
    if (p.ghost || this.state !== 'play') return;
    const f = this.floor(p.depth);
    const slot = p.bag[n];
    if (!slot) return;
    const it = slot.item;

    if (isWorn(it)) { this.equipFrom(p, n); return; }
    if (isPointed(it)) { this.pointWand(p, f, it); return; }
    if (it.type === ITEM.MISSILE) { this.throwMissile(p, f, n); return; }
    if (it.type === ITEM.SEED) { this.sow(p, f, n); return; }
    if (it.type === ITEM.KEY || it.type === ITEM.GOLDKEY) return;  // spent on doors

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
    } else return;

    if (--slot.count <= 0) p.bag[n] = null;
    this.metaDirty = true;
  }

  drink(p, f, kind) {
    if (!this.known.potions.includes(kind)) {
      this.known.potions.push(kind);
      this.banner(`IT WAS A POTION OF ${kind.toUpperCase()}`, 1800);
    }
    this.fx(f, 'drink', p.x + 8, p.y + 8);
    const pot = p.stats.potionMult;
    switch (kind) {
      case POTION.HEALING:
        this.healPlayer(p, Math.round(p.maxHp * 0.7 * pot));
        BF.cleanse(p);
        break;
      case POTION.STRENGTH:
        p.maxHp += 3; p.hp += 3;
        this.banner(`${p.name} FEELS STRONGER`, 1500);
        break;
      case POTION.HASTE: this.afflict(p, B.HASTE, Math.round(600 * pot)); break;
      case POTION.INVIS: this.afflict(p, B.INVISIBLE, Math.round(450 * pot)); break;
      case POTION.LEVITATION: this.afflict(p, B.LEVITATION, Math.round(600 * pot)); break;
      case POTION.MIND_VISION: this.afflict(p, B.MIND_VISION, Math.round(600 * pot)); break;
      case POTION.EXPERIENCE:
        this.gainXp(p, XP_PER_LEVEL(p.level));
        this.banner(`${p.name} FEELS WISER`, 1500);
        break;
      case POTION.PURITY:
        BF.cleanse(p);
        this.afflict(p, B.BLESS, 300);
        this.banner('THE AIR CLEARS', 1400);
        break;
      case POTION.FLAME:
        this.cloud(f, p.x + 8, p.y + 8, 46, B.BURNING, 140, p);
        this.burst(f, p.x + 8, p.y + 8, 44, 8 + f.depth, p);
        break;
      case POTION.TOXIC:
        this.cloud(f, p.x + 8, p.y + 8, 64, B.POISON, 220, p);
        break;
      case POTION.PARALYSIS:
        this.cloud(f, p.x + 8, p.y + 8, 64, B.PARALYSIS, 120, p);
        break;
      case POTION.FROST:
        this.cloud(f, p.x + 8, p.y + 8, 64, B.FROZEN, 150, p);
        this.fx(f, 'frost', p.x + 8, p.y + 8);
        break;
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
      case SCROLL.UPGRADE: {
        // whichever of the four is furthest behind, rings first if one is new
        const w = p.equip.weapon, a = p.equip.armor;
        const bare = ['ring1', 'ring2'].find(k => p.equip[k] && !(p.equip[k].upgrade || 0));
        let lifted = null;
        if (bare) {
          const r = p.equip[bare];
          r.upgrade = (r.upgrade || 0) + 1;
          if (r.cursed && Math.random() < 0.5) { r.cursed = false; lifted = 'RING'; }
        } else if (w.tier * 3 + w.upgrade <= a.tier * 3 + a.upgrade) {
          w.upgrade++;
          if (w.cursed && Math.random() < 0.5) { w.cursed = false; w.curse = null; lifted = 'WEAPON'; }
        } else {
          a.upgrade++;
          if (a.cursed && Math.random() < 0.5) { a.cursed = false; a.curse = null; lifted = 'ARMOUR'; }
        }
        this.recalc(p);
        this.banner(lifted ? `THE ${lifted} GLOWS, AND LETS GO` : `${p.name}'S GEAR GLOWS`, 1600);
        break;
      }
      case SCROLL.IDENTIFY: {
        // gear on your body first: knowing what is already stuck to you matters
        // more than knowing what is still in the bag
        for (const which of ['weapon', 'armor', 'ring1', 'ring2']) {
          const g = p.equip[which];
          if (!g || g.known) continue;
          g.known = true;
          if (g.kind && !this.known.rings.includes(g.kind)) this.known.rings.push(g.kind);
          this.banner(`IT IS ${itemLabel(g, this.app, this.known)}`, 1800);
          this.metaDirty = true;
          return;
        }
        for (const slot of p.bag) {
          if (!slot) continue;
          const it = slot.item;
          if (it.type === ITEM.RING && !this.known.rings.includes(it.kind)) {
            this.known.rings.push(it.kind);
            it.known = true;
            this.banner(`IT IS A RING OF ${RINGS[it.kind].name}`, 1800);
            return;
          }
          if ((it.type === ITEM.WEAPON || it.type === ITEM.ARMOR) && !it.known &&
              (it.ench || it.glyph || it.curse)) {
            it.known = true;
            this.banner(`IT IS ${itemLabel(it, this.app, this.known)}`, 1800);
            return;
          }
          if (it.type === ITEM.POTION && !this.known.potions.includes(it.kind)) {
            this.known.potions.push(it.kind);
            this.banner(`IT IS A POTION OF ${it.kind.toUpperCase()}`, 1800);
            return;
          }
          if (it.type === ITEM.SCROLL && !this.known.scrolls.includes(it.kind)) {
            this.known.scrolls.push(it.kind);
            this.banner(`IT IS A SCROLL OF ${it.kind.toUpperCase()}`, 1800);
            return;
          }
        }
        this.banner('NOTHING LEFT TO LEARN', 1400);
        break;
      }
      case SCROLL.MAPPING:
        f.explored.fill(1);
        f.mapDirty = true;
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
        for (const e of f.ents) {
          if (isMob(e.kind) && !isBoss(e.kind) && this.inSight(p, e)) {
            this.afflict(e, B.TERROR, 400);
          }
        }
        this.banner('THE FLOOR RECOILS', 1500);
        break;
      case SCROLL.LULLABY:
        for (const e of f.ents) {
          if (isMob(e.kind) && !isBoss(e.kind) && this.inSight(p, e)) {
            this.afflict(e, B.SLEEP, 500);
          }
        }
        this.banner('A LULLABY SETTLES OVER THE FLOOR', 1600);
        break;
      case SCROLL.RAGE:
        this.afflict(p, B.FURY, 500);
        for (const e of f.ents) {
          if (isMob(e.kind) && this.inSight(p, e)) e.alerted = 900;
        }
        this.banner(`${p.name} BURNS WITH RAGE`, 1500);
        break;
      case SCROLL.RETRIBUTION: {
        const missing = 1 - (p.hp / Math.max(1, p.maxHp));
        const dmg = Math.round((6 + f.depth) * (0.5 + missing * 2));
        for (const e of f.ents) {
          if (!isMob(e.kind) || !this.inSight(p, e)) continue;
          this.hurtMob(e, dmg, S, f, p);
          this.afflict(e, B.BLINDNESS, 200);
        }
        this.hurtPlayer(p, Math.round(p.hp * 0.25), p.x + 8, p.y + 8, null, true);
        this.fx(f, 'blast', p.x + 8, p.y + 8);
        this.banner('PAIN ANSWERS PAIN', 1600);
        break;
      }
      case SCROLL.RECHARGE: {
        p.abilityCd = 0;
        this.afflict(p, B.RECHARGING, 300);
        let filled = 0;
        for (const slot of p.bag) {
          if (slot?.item?.type !== ITEM.WAND) continue;
          refill(slot.item);
          filled++;
        }
        if (filled) this.banner('YOUR WANDS ARE FULL AGAIN', 1600);
        this.metaDirty = true;
        break;
      }
      case SCROLL.REMOVE_CURSE:
        BF.cleanse(p);
        this.uncurse(p);
        this.banner('A WEIGHT LIFTS', 1500);
        break;
      case SCROLL.TRANSMUTATION: {
        const spots = p.bag.map((s2, i) => (s2 ? i : -1)).filter(i => i >= 0);
        if (!spots.length) { this.banner('NOTHING TO CHANGE', 1300); break; }
        const at = spots[(Math.random() * spots.length) | 0];
        const now = this.transmute(p.bag[at].item, f);
        if (now) {
          p.bag[at] = { key: stackKey(now), item: now, count: p.bag[at].count };
          this.banner('SOMETHING IN YOUR PACK CHANGES', 1600);
          this.metaDirty = true;
        }
        break;
      }
      case SCROLL.MIRROR:
        this.afflict(p, B.INVISIBLE, 150);
        for (const e of f.ents) {
          if (isMob(e.kind) && this.inSight(p, e)) this.afflict(e, B.AMOK, 300);
        }
        this.banner('COPIES OF YOU SCATTER AND FADE', 1700);
        break;
      default: break;
    }
  }

  /** Turn an item into another of the same class. */
  transmute(item, f) {
    const rng = f.rng;
    if (item.type === ITEM.POTION) {
      const kinds = POTION_KINDS.filter(k => k !== item.kind);
      return { type: ITEM.POTION, kind: kinds[rng.int(kinds.length)] };
    }
    if (item.type === ITEM.SCROLL) {
      const kinds = SCROLL_KINDS.filter(k => k !== item.kind);
      return { type: ITEM.SCROLL, kind: kinds[rng.int(kinds.length)] };
    }
    if (item.type === ITEM.WEAPON) {
      return { type: ITEM.ARMOR, tier: item.tier, upgrade: item.upgrade || 0 };
    }
    if (item.type === ITEM.ARMOR) {
      return { type: ITEM.WEAPON, tier: item.tier, upgrade: item.upgrade || 0 };
    }
    return null;
  }

  /** Lifts a curse from what you are wearing. */
  uncurse(p) {
    let lifted = 0;
    for (const which of ['weapon', 'armor', 'ring1', 'ring2']) {
      const g = p.equip[which];
      if (!g || (!g.cursed && !g.curse)) continue;
      g.cursed = false;
      g.curse = null;
      g.known = true;
      lifted++;
    }
    for (const slot of p.bag) {
      if (!slot?.item?.cursed) continue;
      slot.item.cursed = false;
      slot.item.curse = null;
      slot.item.known = true;
      lifted++;
    }
    this.banner(lifted ? 'THE WEIGHT LIFTS' : 'NOTHING WAS BINDING YOU', 1600);
    if (lifted) this.recalc(p);
  }

  /** Is this thing in the hero's field of view right now? */
  inSight(p, e) {
    const t = tileUnder(e, e.box || PLAYER_BOX);
    return !!p.fov[t];
  }

  /** Lay an effect over everything caught in a radius. */
  cloud(f, x, y, radius, buff, ticks, from) {
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind)) continue;
      if (dist2(x, y, e.x + 8, e.y + 8) > radius * radius) continue;
      if (isBoss(e.kind) && (buff === B.PARALYSIS || buff === B.FROZEN)) {
        this.afflict(e, B.SLOW, Math.round(ticks / 2), 1, f);
        continue;
      }
      e.burner = from || null;
      this.afflict(e, buff, ticks, 1, f);
    }
    for (const o of this.livingOn(f.depth)) {
      if (o === from) continue;
      if (dist2(x, y, o.x + 8, o.y + 8) > radius * radius) continue;
      this.afflict(o, buff, Math.round(ticks * 0.6), 1, f);
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
    this.cloud(f, x, y, 70, B.FROZEN, ticks, null);
    this.fx(f, 'frost', x, y);
  }

  hunger(p) {
    if (p.hunger > 0) { p.hunger -= p.stats.hungerMult; return; }
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
    // somebody standing close enough to talk to
    const who = f.ents.find(e => !e.dead && isNpc(e.kind) && e.quest &&
      rectsOverlap(p.x - 6, p.y - 6, 28, 28, e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h));
    if (who) return void this.talkTo(p, f, who);

    // a price tag under your feet
    const good = f.ents.find(e => !e.dead && e.kind === KIND.ITEM && e.price &&
      rectsOverlap(p.x + 2, p.y + 2, 12, 12, e.x + 2, e.y + 2, 12, 12));
    if (good) return this.buy(p, f, good);

    if (t === TT.POT) return void this.brew(p, f);


    if (t === TT.PEDESTAL) {
      const item = f.depth >= MAX_DEPTH ? { type: ITEM.RELIC } : rollPrize(f.depth, f.rng, this.artifactsSeen);
      f.set(i, TT.FLOOR_DECO);
      if (!this.take(p, f, item)) this.dropItem(f, i, item);
      return;
    }

    // nothing else here: tip the vial out if you are hurt and carrying any
    if ((p.dew || 0) > 0 && p.hp < p.maxHp) {
      const drink = p.dew;
      p.dew = 0;
      this.healPlayer(p, drink);
      this.fx(f, 'heal', p.x + 8, p.y + 8);
      this.banner(`THE VIAL EMPTIES - ${drink} BACK`, 1600);
      this.metaDirty = true;
      return;
    }

    // or step over the edge, if there is one beside you
    if (this.chasmBeside(f, i)) this.leap(p, f);
  }

  descend(p, forced = false) {
    if (p.depth >= MAX_DEPTH) return;
    const from = this.floor(p.depth);
    if (!forced && from.level.boss && !from.bossDead) {
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

    f.feeling = 'none';
    if (f.level.boss) {
      const kind = BOSS_OF[region.key];
      const at = f.level.arena || { x: 15 * TILE, y: 7 * TILE };
      this.spawnMob(f, kind, at.x - 16, at.y - 16);
      this.banner(MOBS[kind].name, 3000);
      return;
    }

    f.feeling = this.rollFeeling(f);
    f.feelingIn = 100;   // let the floor-name banner land first

    const budget = Math.round(mobBudget(f.depth) * (f.feeling === 'dangerous' ? 1.6 : 1));
    for (let n = 0; n < budget; n++) this.spawnRandomMob(f);

    let drops = 5 + f.rng.int(4);
    if (f.feeling === 'treasure') drops += 3;
    for (let n = 0; n < drops && n < f.level.itemPoints.length; n++) {
      this.dropItem(f, f.level.itemPoints[n], rollLoot(f.depth, f.rng));
    }
    if (f.feeling === 'treasure' && f.level.itemPoints.length > drops) {
      this.dropItem(f, f.level.itemPoints[drops], rollPrize(f.depth, f.rng, this.artifactsSeen));
    }
    if (f.feeling === 'trapped') this.sowTraps(f);
    this.sowMimics(f);
    if (f.level.keySpot !== null && f.level.keySpot !== undefined) {
      this.dropItem(f, f.level.keySpot, { type: ITEM.KEY });
    }
    this.stockShop(f);
    this.furnish(f);
    this.placeQuest(f);
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

  spawnMob(f, kind, x, y, { champion = null } = {}) {
    const st = MOBS[kind];
    const scale = scaleFor(f.depth, regionOf(f.depth));
    const e = {
      id: this.entSeq++, kind, x, y, dir: S, box: st.box,
      hp: Math.round(st.hp * scale), maxHp: Math.round(st.hp * scale),
      dmg: Math.round(st.dmg * scale),
      t: 0, flash: 0, frozen: 0, alerted: 0, fleeing: 0, hitCd: 0, idle: 0,
      buffs: {}, effects: null,
      cd: 30 + f.rng.int(60), phase: f.rng.int(60),
      vx: 0, vy: 0, knockT: 0, knockX: 0, knockY: 0,
    };
    // now and then the dungeon promotes one
    if (!isBoss(kind) && !isNpc(kind) && !st.harmless) {
      const id = champion ??
        (f.rng.next() < champChance(f.depth) ? rollChampion(f.depth, f.rng) : null);
      if (id) this.promote(e, id);
    }
    f.ents.push(e);
    return e;
  }

  dropItem(f, tile, item) {
    if (!item) return;
    if (item.type === ITEM.ARTIFACT && !this.artifactsSeen.includes(item.kind)) {
      this.artifactsSeen.push(item.kind);
    }
    const px = tileToPixel(tile, { x: 2, y: 2, w: 12, h: 12 });
    const e = {
      id: this.entSeq++, kind: KIND.ITEM, x: px.x, y: px.y, dir: 0,
      box: { x: 2, y: 2, w: 12, h: 12 }, t: 0, item,
    };
    f.ents.push(e);
    return e;
  }

  /** Bolt a modifier onto an ordinary monster. */
  promote(e, id) {
    const c = CHAMPIONS[id];
    if (!c) return e;
    e.champ = id;
    e.maxHp = Math.round(e.maxHp * c.hp);
    e.hp = e.maxHp;
    e.dmg = Math.round(e.dmg * c.dmg);
    e.dmgBase = e.dmg;          // a growing one compounds from here, not from
    e.hpBase = e.maxHp;         // the rounded figure, or it never moves at all
    e.champSpeed = c.speed;
    e.grown = 0;
    return e;
  }

  stepFloor(f) {
    const players = this.livingOn(f.depth);
    if (f.feelingIn > 0 && players.length && --f.feelingIn === 0) this.announceFeeling(f);
    if (--f.flowAge <= 0) { this.buildFlow(f, players); f.flowAge = 8; }

    for (const e of f.ents) {
      if (e.dead) continue;
      e.t++;
      if (e.flash > 0) e.flash--;
      if (e.hitCd > 0) e.hitCd--;
      if (isMob(e.kind) && e.buffs) {
        const up = BF.tickBuffs(e);
        if (up.damage) this.hurtMob(e, Math.ceil(up.damage), S, f, e.burner || null, true);
        if (up.heal) e.hp = Math.min(e.maxHp, e.hp + Math.ceil(up.heal));
        if (e.dead) continue;
        e.effects = BF.summarise(e);
        // fire goes out in water, and catches in dry grass
        const t = f.tiles[tileUnder(e, e.box)];
        if (t === TT.WATER) BF.clear(e, B.BURNING);
        else if (BF.has(e, B.BURNING) && (t === TT.GRASS || t === TT.HIGH_GRASS) && Math.random() < 0.05) {
          f.set(tileUnder(e, e.box), TT.EMBERS);
        }
      }
      if (e.knockT > 0) {
        e.knockT--;
        moveActor(e, e.knockX, e.knockY, f.tiles, e.box, MODE.WALK, false);
        clampToLevel(e, e.box);
        continue;
      }
      if (e.frozen > 0) { e.frozen--; continue; }
      if (e.effects?.frozen) continue;
      if (e.fleeing > 0) e.fleeing--;
      if (e.alerted > 0) e.alerted--;
      this.stepEntity(e, f, players);
    }

    // a monster walking over a plant sets it off too, which is what makes
    // sowing one in a doorway worth doing
    for (const e of f.ents) {
      if (e.dead || e.kind !== KIND.PLANT) continue;
      for (const o of f.ents) {
        if (o.dead || !isMob(o.kind) || isNpc(o.kind)) continue;
        if (!rectsOverlap(e.x + 2, e.y + 2, 12, 12,
                          o.x + o.box.x, o.y + o.box.y, o.box.w, o.box.h)) continue;
        this.trample(e, f, o, false);
        break;
      }
    }

    // contact damage
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind) || e.frozen > 0 || e.hidden) continue;
      if (e.effects?.frozen || e.effects?.ai === 'flee') continue;
      const st = MOBS[e.kind];
      if (st.harmless) continue;
      const reach = CHAMPIONS[e.champ]?.reach ?? 1;
      const grow = (reach - 1) * 8;
      for (const p of players) {
        if (p.invis > 0 && !isBoss(e.kind)) continue;
        if (e.hitCd > 0) break;
        if (!rectsOverlap(p.x + PLAYER_BOX.x, p.y + PLAYER_BOX.y, PLAYER_BOX.w, PLAYER_BOX.h,
                          e.x + e.box.x - grow, e.y + e.box.y - grow,
                          e.box.w + grow * 2, e.box.h + grow * 2)) continue;
        e.hitCd = 32;
        this.hurtPlayer(p, Math.round(e.dmg * (e.effects?.dealt ?? 1)), e.x + 8, e.y + 8, e);
        const champ = e.champ ? CHAMPIONS[e.champ] : null;
        if (champ?.burns) this.afflict(p, B.BURNING, champ.burns, 1, f);
        if (champ?.blinds) this.afflict(p, B.BLINDNESS, champ.blinds, 1, f);
        if (st.bleeds) this.afflict(p, B.BLEEDING, st.bleeds, 1, f);
        if (st.charms) this.afflict(p, B.CHARM, st.charms, 1, f);
        if (st.poisons) this.afflict(p, B.POISON, st.poisons, 1, f);
        if (st.shocks) this.afflict(p, B.PARALYSIS, Math.round(st.shocks / 2), 1, f);
        if (st.fumes) this.cloud(f, e.x + 8, e.y + 8, 34, B.POISON, st.fumes, e);
        if (champ?.knock) {
          const dx = p.x - e.x, dy = p.y - e.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          p.knockX = (dx / d) * champ.knock;
          p.knockY = (dy / d) * champ.knock;
          p.knockT = KNOCKBACK_TICKS;
        }
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
      const alive = f.ents.filter(e => !e.dead && isMob(e.kind) && !isNpc(e.kind)).length;
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
      case KIND.WARD: return this.stepWard(e, f);
      case KIND.THROWN: return this.stepThrown(e, f, players);
      case KIND.SPIRIT: return this.stepSpirit(e, f);
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
        // obfuscating armour muffles the wearer's footsteps
        const gl = p.equip?.armor?.glyph ? GLYPHS[p.equip.armor.glyph] : null;
        const ear = HEARING * (gl?.quiet ?? 1);
        if (dist2(p.x, p.y, e.x, e.y) < ear * ear) { e.alerted = 240; break; }
      }
    }

    if (st.ai === 'boss') return this.stepBoss(e, f, st, target);

    const mode = (st.ai === 'flyer' || st.phasing) ? MODE.FLY : MODE.WALK;
    const champ = e.champ ? CHAMPIONS[e.champ] : null;
    let speed = st.speed * (e.enraged ? 1.4 : 1) * (e.effects?.move ?? 1)
              * (champ?.speed ?? 1);

    if (champ) {
      // a growing one is worse every second you leave it standing
      if (champ.grows && e.alerted > 0 && e.grown < 1.5) {
        e.grown = (e.grown || 0) + champ.grows;
        e.dmg = Math.max(1, Math.round((e.dmgBase ?? e.dmg) * (1 + e.grown)));
        const want = Math.round((e.hpBase ?? e.maxHp) * (1 + e.grown * 0.5));
        if (want > e.maxHp) { e.hp += want - e.maxHp; e.maxHp = want; }
      }
      // a haloed one knits its neighbours back together
      if (champ.mends && (this.tick % champ.mends) === 0) {
        for (const o of f.ents) {
          if (o === e || o.dead || !isMob(o.kind)) continue;
          if (dist2(o.x, o.y, e.x, e.y) > 44 * 44) continue;
          o.hp = Math.min(o.maxHp, o.hp + 1 + Math.floor(f.depth / 5));
        }
      }
    }

    const mind = e.effects?.ai;
    if (mind === 'flee' && target) { this.stepAway(e, f, target, speed * 1.2, mode); return; }
    if (mind === 'charm' && target) { this.stepChase(e, f, speed * 0.6, mode); return; }
    if (mind === 'amok') {
      // it attacks whatever is closest, friend or hero
      let best = null, bd = Infinity;
      for (const o of f.ents) {
        if (o === e || o.dead || !isMob(o.kind)) continue;
        const d = dist2(o.x, o.y, e.x, e.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (best && bd < 140 * 140) {
        const dx = best.x - e.x, dy = best.y - e.y;
        const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? E : W) : (dy > 0 ? S : N);
        e.dir = dir;
        moveActor(e, DX[dir] * speed, DY[dir] * speed, f.tiles, e.box, mode, true);
        clampToLevel(e, e.box);
        if (bd < 20 * 20 && e.hitCd <= 0) { e.hitCd = 26; this.hurtMob(best, e.dmg, dir, f, null); }
        return;
      }
    }

    if (st.rooted) {
      // it grew here and it is not going anywhere
      if (st.spawns && --e.cd <= 0) {
        e.cd = st.every || 300;
        const near = f.ents.filter(o => !o.dead && o.kind === st.spawns).length;
        if (near < 4) {
          const m = this.spawnMob(f, st.spawns, e.x, e.y + 16, { champion: null });
          if (m) m.alerted = 900;
          this.fx(f, 'summon', e.x + 8, e.y + 8);
        }
      }
      return;
    }
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

  /**
   * A boss is not just a bigger health bar. Each one is a short sequence of
   * fights: the phase changes when it is hurt past a threshold, and the change
   * is announced so the party knows the rules moved.
   */
  stepBoss(e, f, st, target) {
    this.bossPhase(e, f, st);

    // the shared skeleton: walk at them, and every so often do something
    const fight = st.fight ? this[`fight_${st.fight}`] : null;
    if (fight) fight.call(this, e, f, st, target);
    else this.fightPlain(e, f, st, target);

    if (e.mouth > 0) e.mouth--;
    if (e.untouchable > 0) e.untouchable--;
    if (e.windup > 0) e.windup--;
  }

  /** Move the boss into whichever phase its health now says it is in. */
  bossPhase(e, f, st) {
    const list = st.phases;
    if (!list) return;
    const frac = e.hp / Math.max(1, e.maxHp);
    let want = 0;
    for (let i = 0; i < list.length; i++) if (frac <= list[i].at) want = i;
    if (want === (e.stage ?? -1)) return;
    e.stage = want;
    e.cd = 20;
    this.banner(list[want].say, 2600);
    this.fx(f, 'roar', e.x + 16, e.y + 16);
  }

  /** What a boss does with no particular script: chase and shoot. */
  fightPlain(e, f, st, target) {
    if (target) this.stepChase(e, f, st.speed, MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);
    if (--e.cd > 0) return;
    e.cd = 70 + ((Math.random() * 40) | 0);
    e.mouth = 14;
    if (target) {
      if (st.fan) for (const spread of [-0.45, 0, 0.45]) this.bossShot(e, f, target, st, spread);
      else this.bossShot(e, f, target, st, 0);
    }
    this.bossSummon(e, f, st.summons, 6);
  }

  /** Call something up, if the floor is not already crowded. */
  bossSummon(e, f, kind, cap) {
    if (!kind) return null;
    if (f.ents.filter(x => isMob(x.kind) && !isBoss(x.kind) && !x.dead).length >= cap) return null;
    const pts = f.level.spawnPoints;
    if (!pts.length) return null;
    const spot = tileToPixel(pts[(Math.random() * pts.length) | 0], MOBS[kind].box);
    const m = this.spawnMob(f, kind, spot.x, spot.y, { champion: null });
    if (m) m.alerted = 900;
    this.fx(f, 'summon', e.x + 16, e.y + 16);
    return m;
  }

  // -------------------------------------------------------------------------
  // The five fights
  // -------------------------------------------------------------------------

  /** Glut swells up and bursts, and the water is on its side. */
  fight_glut(e, f, st, target) {
    const swollen = (e.stage || 0) >= 1;

    // it mends in water, so fighting it in the shallows is a mistake
    const under = f.tiles[tileUnder(e, e.box)];
    if (under === TT.WATER && (this.tick & 31) === 0) {
      e.hp = Math.min(e.maxHp, e.hp + (swollen ? 2 : 1));
    }

    if (e.windup > 0) {
      // holding its breath: it does not move, and then it lets go
      e.mouth = 14;
      if (e.windup === 1) {
        this.fx(f, 'blast', e.x + 16, e.y + 16);
        const r = 62;
        for (const p of this.livingOn(f.depth)) {
          if (dist2(p.x + 8, p.y + 8, e.x + 16, e.y + 16) > r * r) continue;
          this.hurtPlayer(p, Math.round(e.dmg * 1.8), e.x + 16, e.y + 16, e, true);
          this.afflict(p, B.OOZE, 240, 1, f);
        }
        // and it leaves the floor wet where it stood
        this.puddle(f, e.x + 16, e.y + 16, 2);
      }
      return;
    }

    if (target) this.stepChase(e, f, st.speed * (swollen ? 1.25 : 1), MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);

    if (--e.cd > 0) return;
    e.cd = swollen ? 60 : 80;
    e.mouth = 14;
    if (swollen && target && Math.random() < 0.5) {
      e.windup = 40;                       // the pump-up
      this.banner('IT DRAWS ITSELF IN', 1200);
      return;
    }
    if (target) this.bossShot(e, f, target, st, 0);
  }

  /** The Warden stops walking and starts appearing, leaving traps behind. */
  fight_warden(e, f, st, target) {
    const blinking = (e.stage || 0) >= 1;

    if (!blinking) {
      if (target) this.stepChase(e, f, st.speed, MODE.WALK);
      else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);
      if (--e.cd > 0) return;
      e.cd = 70;
      e.mouth = 14;
      if (target) this.bossShot(e, f, target, st, 0);
      this.bossSummon(e, f, st.summons, 5);
      return;
    }

    // in the second half it does not walk at all
    if (--e.cd > 0) return;
    e.cd = 55;
    e.mouth = 14;

    // leave something nasty where it was standing
    const was = tileUnder(e, e.box);
    if (f.tiles[was] === TT.FLOOR || f.tiles[was] === TT.FLOOR_DECO) {
      f.level.traps ??= {};
      f.set(was, TT.TRAP_HIDDEN);
      f.level.traps[was] = rollTrap(f.depth, f.rng);
    }

    // and turn up somewhere else
    const pts = f.level.spawnPoints;
    if (pts.length) {
      for (let n = 0; n < 20; n++) {
        const i = pts[(Math.random() * pts.length) | 0];
        if (!passable(f.tiles[i])) continue;
        const spot = tileToPixel(i, e.box);
        if (boxBlocked(f.tiles, spot.x + e.box.x, spot.y + e.box.y, e.box.w, e.box.h, MODE.WALK)) continue;
        e.x = spot.x; e.y = spot.y;
        break;
      }
    }
    e.untouchable = 18;                     // briefly nothing lands on it
    this.fx(f, 'poof', e.x + 16, e.y + 16);
    if (target) {
      for (const spread of [-0.35, 0, 0.35]) this.bossShot(e, f, target, st, spread);
    }
  }

  /** The Tyrant hides behind its pylons and breaks the floor as it goes. */
  fight_tyrant(e, f, st, target) {
    const raised = (e.stage || 0) >= 1;
    const pylons = f.ents.filter(x => x.kind === KIND.PYLON && !x.dead);

    if (raised && !e.pylonsUp) {
      e.pylonsUp = true;
      const at = [[-3, -3], [3, -3], [-3, 3], [3, 3]];
      for (const [dx, dy] of at) {
        const px = tx(tileUnder(e, e.box)) + dx, py = ty(tileUnder(e, e.box)) + dy;
        if (!inBounds(px, py) || !passable(f.tiles[idx(px, py)])) continue;
        const spot = tileToPixel(idx(px, py), MOBS[KIND.PYLON].box);
        this.spawnMob(f, KIND.PYLON, spot.x, spot.y, { champion: null });
      }
      this.fx(f, 'summon', e.x + 16, e.y + 16);
    }

    // while a pylon stands, most of what you land on it does not take
    e.shielded = raised && pylons.length > 0;

    if (target) this.stepChase(e, f, st.speed * (raised ? 0.8 : 1), MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);

    if (--e.cd > 0) return;
    e.cd = raised ? 55 : 75;
    e.mouth = 14;
    if (target) this.bossShot(e, f, target, st, 0);

    if (raised) {
      // it breaks the ground it walks over
      const here = tileUnder(e, e.box);
      const cx = tx(here), cy = ty(here);
      for (let n = 0; n < 3; n++) {
        const nx = cx + (f.rng.int(7) - 3), ny = cy + (f.rng.int(7) - 3);
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (f.tiles[j] === TT.FLOOR || f.tiles[j] === TT.FLOOR_DECO) f.set(j, TT.RUBBLE);
      }
    }
  }

  /** The King calls his court, and then comes back without his skin. */
  fight_king(e, f, st, target) {
    const phase = e.stage || 0;

    if (phase >= 2 && !e.risen) {
      e.risen = true;
      e.dmg = Math.round(e.dmg * 1.5);
      e.untouchable = 40;
      this.fx(f, 'blast', e.x + 16, e.y + 16);
      // his court goes down with him, and he comes back alone
      for (const o of f.ents) {
        if (o.dead || !isMob(o.kind) || isBoss(o.kind)) continue;
        this.hurtMob(o, 9999, S, f, null);
      }
    }

    if (target) this.stepChase(e, f, st.speed * (e.risen ? 1.3 : 1), MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);

    if (--e.cd > 0) return;
    e.cd = e.risen ? 45 : 70;
    e.mouth = 14;
    if (target) this.bossShot(e, f, target, st, e.risen ? 0.3 : 0);
    if (target && e.risen) this.bossShot(e, f, target, st, -0.3);
    if (phase >= 1 && !e.risen) this.bossSummon(e, f, st.summons, 5);
  }

  /** It does not move. It reaches, and you have to take the hands off first. */
  fight_unsleeping(e, f, st, target) {
    const fists = f.ents.filter(x => x.kind === KIND.FIST && !x.dead);

    if (!e.handsOut) {
      e.handsOut = true;
      for (let n = 0; n < 2; n++) {
        const m = this.bossSummon(e, f, KIND.FIST, 99);
        if (m) m.alerted = 900;
      }
    }

    // nothing touches it while a fist still stands
    e.shielded = fists.length > 0;

    // it never walks
    if (--e.cd > 0) return;
    e.cd = fists.length ? 60 : 40;
    e.mouth = 14;
    if (target) {
      for (const spread of [-0.45, 0, 0.45]) this.bossShot(e, f, target, st, spread);
    }
    // it keeps putting hands back out, more slowly once it is awake
    if (fists.length < 2 && Math.random() < ((e.stage || 0) >= 2 ? 0.25 : 0.5)) {
      this.bossSummon(e, f, KIND.FIST, 99);
    }
    if ((e.stage || 0) >= 2) this.bossSummon(e, f, st.summons, 4);
  }

  /** Leave water where something wet has been. */
  puddle(f, x, y, radius) {
    const c = tileUnder({ x: x - 8, y: y - 8 }, PLAYER_BOX);
    const cx = tx(c), cy = ty(c);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (f.tiles[j] === TT.FLOOR || f.tiles[j] === TT.FLOOR_DECO ||
            f.tiles[j] === TT.EMBERS) f.set(j, TT.WATER);
      }
    }
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
        if (e.hitIds?.includes(m.id)) continue;
        if (!rectsOverlap(e.x + 4, e.y + 4, 8, 8,
                          m.x + m.box.x, m.y + m.box.y, m.box.w, m.box.h)) continue;
        this.hurtMob(m, e.dmg, e.dir, f, this.players.get(e.owner));
        if (e.snare) m.frozen = Math.max(m.frozen, e.snare);
        if (e.freeze) this.afflict(m, B.FROZEN, e.freeze, 1, f);
        if (e.burn) this.afflict(m, B.BURNING, e.burn, 1, f);
        if (e.pierce > 0) { e.pierce--; e.hitIds = (e.hitIds || []).concat(m.id); continue; }
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

  hurtMob(e, dmg, fromDir, f, byPlayer, overTime = false) {
    if (e.flash > 3 && !overTime) return;
    const st = MOBS[e.kind];
    if (e.untouchable > 0 && !overTime) { this.fx(f, 'clang', e.x + 8, e.y + 8); return; }
    if (e.shielded && !overTime) {
      // it is standing behind something; take most of the blow off
      dmg = Math.max(1, Math.round(dmg * 0.15));
      this.fx(f, 'clang', e.x + 8, e.y + 8);
    }
    const champ = e.champ ? CHAMPIONS[e.champ] : null;
    if (champ?.evade && !overTime && Math.random() < champ.evade) {
      this.fx(f, 'clang', e.x + 8, e.y + 8);
      e.flash = 4;
      return;
    }
    if (st.npc) {
      // rob a shopkeeper and he leaves, taking the shelves with him
      e.dead = true;
      f.shopkeeper = null;
      for (const o of f.ents) if (o.price) o.dead = true;
      this.fx(f, 'poof', e.x + 8, e.y + 8);
      this.banner('THE SHOPKEEPER VANISHES, AND SO DOES HIS STOCK', 2400);
      return;
    }
    const scaled = dmg * (e.effects?.taken ?? 1);
    const armour = (st.armour || 0) + (overTime ? 0 : (champ?.armour || 0));
    const taken = Math.max(1, Math.round(scaled - (overTime ? 0 : armour)));
    e.hp -= taken;
    if (!overTime) e.flash = 6;
    e.alerted = 480;
    BF.clear(e, B.SLEEP);
    if (e.hp > 0) {
      if (!isBoss(e.kind) && !overTime) {
        e.knockX = DX[fromDir] * 3;
        e.knockY = DY[fromDir] * 3;
        e.knockT = 4;
      }
      this.fx(f, 'hit', e.x + 8, e.y + 8);
      return;
    }
    this.killMob(e, f, byPlayer);
  }

  /** Put a timed effect on an actor and let the floor know about it. */
  afflict(actor, id, ticks, mag = 1, f = null) {
    if (isNpc(actor.kind)) return;   // gas should not rob you of a shop
    BF.apply(actor, id, ticks, mag);
    if (f) {
      const def = BF.BUFFS[id];
      this.fx(f, def?.bad ? 'hurt' : 'drink', actor.x + 8, actor.y + 8);
    }
  }

  killMob(e, f, byPlayer) {
    e.dead = true;
    this.kills++;
    const st = MOBS[e.kind];

    // Somebody may be waiting on this one. Count it before anything below can
    // return early — a monster that splits or a boss both leave by other doors.
    if (e.quarry) f.quarrySlain = true;
    if (!isNpc(e.kind) && !isBoss(e.kind) && f.questId && QUESTS[f.questId]?.need) {
      if (st.hp >= 18) f.questCount = (f.questCount || 0) + 1;   // only the big ones count
    }

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
      this.dropItem(f, at, rollPrize(f.depth, f.rng, this.artifactsSeen));
      this.dropItem(f, at, { type: ITEM.POTION, kind: POTION.HEALING });
      if (st.splitsOnDeath) {
        for (let n = 0; n < 3; n++) this.spawnMob(f, st.splitsOnDeath, e.x + (n - 1) * 20, e.y + 12);
      }
      this.metaDirty = true;
      return;
    }

    const at = tileUnder(e, e.box);
    const champ = e.champ ? CHAMPIONS[e.champ] : null;
    if (champ?.pyre) {
      this.fx(f, 'blast', e.x + 8, e.y + 8);
      this.burst(f, e.x + 8, e.y + 8, 42, Math.round(6 + f.depth), null);
      for (const p of this.livingOn(f.depth)) {
        if (dist2(p.x + 8, p.y + 8, e.x + 8, e.y + 8) > 42 * 42) continue;
        this.afflict(p, B.BURNING, champ.pyre, 1, f);
      }
    }
    if (champ) {
      // a champion is worth the trouble it gave you
      e.loot = Math.round((e.loot || 0) + 12 + f.depth * 4);
    }
    if (e.hoard) this.dropItem(f, at, e.hoard);
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
    const gloom = f.feeling === 'dark' ? 3 : 0;
    const sight = Math.max(2,
      CLASSES[p.cls].sight + p.stats.sight + (p.effects?.sight || 0) - gloom);
    viewFrom(f.level, here, sight, p.fov);
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
    // Whoever called this — a player pressing on, or the timer after a wipe —
    // the clients have to be told, or they sit on the death screen forever.
    this.announceStart = true;
    this.seed = (Math.random() * 0x7fffffff) | 0;
    this.app = makeAppearances(this.seed);
    this.known = { potions: [], scrolls: [], rings: [], wands: [] };
    this.artifactsSeen = [];
    this.floors.clear();
    this.kills = 0; this.deaths = 0; this.deepest = 1;
    for (const p of this.players.values()) {
      const def = CLASSES[p.cls];
      const keep = { id: p.id, name: p.name, cls: p.cls, colour: p.colour, ready: p.ready };
      Object.assign(p, newPlayerState(), keep, {
        depth: 1, hp: def.hp, maxHp: def.hp, level: 1, xp: 0, gold: 0,
        equip: { ring1: null, ring2: null, artifact: null,
                 weapon: { type: ITEM.WEAPON, tier: 1, upgrade: 0 },
                 armor: { type: ITEM.ARMOR, tier: 1, upgrade: 0 } },
        bag: new Array(BAG_BASE).fill(null),
        perks: {}, perkPoints: 0,
        hunger: HUNGER_MAX, hungerTick: 0, regenTick: 0, kills: 0,
        invuln: 0, invis: 0, haste: 0, might: 0,
        fov: p.fov, fovTile: -1, queue: [], input: 0, seq: p.seq,
        needFloor: true,
      });
      p.bag[0] = { key: ITEM.FOOD, item: { type: ITEM.FOOD }, count: 2 };
      this.recalc(p);
      p.hp = p.maxHp;
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
      tiles: toBase64(f.tiles),
      explored: toBase64(f.explored),
      entrance: f.level.entrance,
      exit: f.level.exit,
      traps: Object.fromEntries(
        Object.entries(f.level.traps || {}).map(([i, k]) => [i, trapIndex(k)])),
      rooms: f.level.rooms.map(r => [r.l, r.t, r.r, r.b, r.type === 'tunnel' ? 1 : 0]),
    };
  }

  snapshotFor(p) {
    const f = this.floor(p.depth);
    // A non-finite coordinate JSON-encodes as null, and an entity at null is
    // drawn nowhere at all with nothing said about it. Round through this so a
    // bug upstream shows as a thing standing in the corner, not a thing gone.
    const at = (v) => (Number.isFinite(v) ? Math.round(v) : 0);
    const ents = [];
    const items = [];
    const sense = p.stats.senseMobs * TILE;
    for (const e of f.ents) {
      if (e.dead) continue;
      const t = tileUnder(e, e.box);
      // fog hides what you cannot see — unless you can feel it moving
      if (!p.fov[t] && !(sense && isMob(e.kind) && dist2(p.x, p.y, e.x, e.y) < sense * sense)) continue;
      if (e.kind === KIND.ITEM) {
        const it = e.item;
        items.push([e.id, at(e.x), at(e.y), it.type,
                    it.kind || '', it.tier || 0, it.upgrade || 0, it.amount || 0,
                    e.price || 0]);
      } else {
        let flags = 0;
        if (e.flash > 0) flags |= 1;
        if (e.frozen > 0) flags |= 2;
        if (e.hidden) flags |= 4;
        if (e.mouth > 0) flags |= 8;
        if (e.enraged) flags |= 16;
        flags |= BF.buffFlags(e) << 5;
        flags |= champIndex(e.champ) << 12;
        if (e.kind === KIND.PLANT) flags = plantIndex(e.plant);
        ents.push([e.id, e.kind, at(e.x), at(e.y), e.dir | 0, flags,
                   e.hp | 0, e.maxHp | 0]);
      }
    }

    const others = [];
    for (const o of this.players.values()) {
      if (o.id === p.id || o.depth !== p.depth) continue;
      if (!p.fov[tileUnder(o, PLAYER_BOX)]) continue;
      others.push([o.id, at(o.x), at(o.y), o.dir,
                   CLASS_ORDER.indexOf(o.cls), o.ghost ? 1 : 0, o.atk,
                   o.hp, o.maxHp, o.walk, o.invis > 0 ? 1 : 0]);
    }

    const party = [];
    for (const o of this.players.values()) {
      party.push([o.id, o.hp, o.maxHp, o.depth, o.ghost ? 1 : 0]);
    }

    return {
      t: 's', k: this.tick, a: p.seq, d: p.depth,
      me: [at(p.x), at(p.y), p.dir, p.atk, p.hp, p.maxHp,
           p.level, p.xp, XP_PER_LEVEL(p.level), p.ghost ? 1 : 0, p.invuln,
           p.abilityCd, p.knockT, Math.round(p.knockX), Math.round(p.knockY),
           p.stun, p.gold, Math.round(p.hunger), p.invis, p.reviveT | 0,
           p.revivedBy | 0, p.perkPoints, Math.round((p.moveMult ?? 1) * 100),
           Math.round(p.shield || 0), Math.round(p.dew || 0)],
      bf: BF.packBuffs(p),
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
        equip: o.equip,
        perks: o.perks, perkPoints: o.perkPoints,
        mods: o.mods,
        bag: o.bag.map(s => (s ? { item: s.item, count: s.count } : null)),
      })),
    };
  }

  exploredPacket(depth) {
    const f = this.floor(depth);
    return { t: 'ex', d: depth, explored: toBase64(f.explored) };
  }

  clearTransient() {
    for (const f of this.floors.values()) {
      if (f.fx.length) f.fx = [];
      if (f.changes.length) f.changes = [];
    }
  }
}
