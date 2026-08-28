// Wands: point them where you are facing, watch the charge go, wait for it
// to come back.
import { Game } from '../shared/game.js';
import {
  WAND, WANDS, WAND_IDS, WAND_LOOKS, rollWand, refill, tickWand,
  wandIndex, wandById, wandPower,
} from '../shared/wands.js';
import { ITEM, itemLabel, makeAppearances, rollLoot, itemValue, stackKey } from '../shared/items.js';
import { rngFor, TT, idx, tx, ty } from '../shared/terrain.js';
import { KIND, isMob, PLAYER_BOX, E, N, S, W } from '../shared/constants.js';
import { tileUnder } from '../shared/physics.js';
import * as BF from '../shared/buffs.js';
import { B } from '../shared/buffs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the table --------------------------------------------------------------
check('twelve wands', WAND_IDS.length === 12);
check('each has a name, an effect and something to say',
  WAND_IDS.every(id => WANDS[id].name && WANDS[id].effect && WANDS[id].blurb));
check('each holds charges and refills at some rate',
  WAND_IDS.every(id => WANDS[id].max > 0 && WANDS[id].recharge > 0));
check('there is a wood for every one', WAND_LOOKS.length >= WAND_IDS.length);
check('they survive the round trip to the wire',
  WAND_IDS.every(id => wandById(wandIndex(id)) === id) && wandById(0) === null);
check('a deeper floor makes them hit harder',
  wandPower(WANDS[WAND.MAGIC_MISSILE], 20, 0) > wandPower(WANDS[WAND.MAGIC_MISSILE], 1, 0));
check('and so does an upgrade',
  wandPower(WANDS[WAND.MAGIC_MISSILE], 5, 3) > wandPower(WANDS[WAND.MAGIC_MISSILE], 5, 0));

// --- charges ----------------------------------------------------------------
{
  const w = { type: ITEM.WAND, kind: WAND.FROST, upgrade: 0, charges: 0, cd: 0 };
  const def = WANDS[WAND.FROST];
  let ticks = 0;
  while (w.charges === 0 && ticks < def.recharge * 3) { tickWand(w); ticks++; }
  check('an empty wand fills back up on its own', w.charges === 1, `after ${ticks} ticks`);
  refill(w);
  check('and a recharge fills it to the top', w.charges === def.max);
  w.charges = def.max;
  const before = w.cd;
  tickWand(w);
  check('a full one does not keep counting', w.cd === 0 && before === 0);

  const up = { type: ITEM.WAND, kind: WAND.FROST, upgrade: 2, charges: 0, cd: 0 };
  refill(up);
  check('an upgraded wand holds more', up.charges > def.max, `${up.charges} vs ${def.max}`);
}

// --- naming -----------------------------------------------------------------
{
  const app = makeAppearances(11);
  const known = { potions: [], scrolls: [], rings: [], wands: [] };
  const w = { type: ITEM.WAND, kind: WAND.LIGHTNING, upgrade: 0, known: false };
  const hidden = itemLabel(w, app, known);
  check('an untried wand is named for its wood',
    /WAND$/.test(hidden) && !hidden.includes('LIGHTNING'), hidden);
  known.wands.push(WAND.LIGHTNING);
  check('once fired it says what it is', itemLabel(w, app, known).includes('LIGHTNING'));
  check('every wand gets its own wood',
    new Set(Object.values(app.wandLook)).size === WAND_IDS.length);
}

// --- two of the same wand keep their own charges ----------------------------
{
  const rng = rngFor(5);
  const a = rollWand(5, rng), b = rollWand(5, rng);
  a.kind = b.kind = WAND.FROST;
  a.upgrade = b.upgrade = 0;
  check('two wands never merge in the pack', stackKey(a) !== stackKey(b));
}

// --- they turn up ------------------------------------------------------------
{
  const rng = rngFor(808);
  let found = 0;
  for (let n = 0; n < 6000; n++) if (rollLoot(12, rng).type === ITEM.WAND) found++;
  check('wands drop, but rarely', found > 30 && found < 500, `${found}/6000 drops`);
  check('a wand is worth real money', itemValue({ type: ITEM.WAND }) > 100);
}

// --- pointing them ----------------------------------------------------------
function hero(kind, upgrade = 0) {
  const g = new Game('WAND');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
  idle(4);
  const f = g.floor(1);
  p.hp = p.maxHp = 300;
  p.invuln = 600;
  const wand = { type: ITEM.WAND, kind, upgrade, charges: 9, cd: 0, known: true };
  p.bag[0] = { key: stackKey(wand), item: wand, count: 1 };
  return { g, p, f, idle, wand };
}

/** Put a monster directly in front of the hero, on open ground. */
function targetAhead(g, p, f, tiles = 2) {
  // Stand the hero in the middle of the map first. Left where they spawn they
  // can be against the east wall, and then a beam stopping is the architecture
  // doing its job rather than the wand failing at its own.
  p.x = 12 * 16; p.y = 14 * 16;
  p.fovTile = -1;
  // clear a corridor long enough for a beam to prove it does not stop at the
  // first thing it meets
  const here = tileUnder(p, PLAYER_BOX);
  const cx = tx(here), cy = ty(here);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 9; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 1 || y < 1 || x > 30 || y > 30) continue;
      f.set(idx(x, y), TT.FLOOR);
    }
  }
  p.dir = E;
  // line the target up with the hero, not with the tile grid: a bolt is a
  // projectile, and the hero is rarely stood exactly on a tile boundary
  const e = f.ents.find(x => isMob(x.kind) && !x.dead) ||
            g.spawnMob(f, KIND.RAT, 0, 0);
  // and clear the corridor of everything else, so a single-target wand cannot
  // pick some other monster that wandered into the line
  for (const o of f.ents) {
    if (o === e || o.dead || !isMob(o.kind)) continue;
    o.x = 2 * 16; o.y = 2 * 16;
  }
  e.x = p.x + tiles * 16; e.y = p.y;
  e.hp = e.maxHp = 500;
  e.buffs = {};
  e.flash = 0;
  e.effects = null;
  return e;
}

// every wand fires without falling over
{
  const fired = [];
  for (const id of WAND_IDS) {
    const { g, p, f, wand } = hero(id);
    const e = targetAhead(g, p, f);
    let threw = null;
    try {
      g.pointWand(p, f, wand);
      for (let i = 0; i < 40; i++) { g.step(); g.clearTransient(); }
    } catch (err) { threw = err; }
    if (threw) check(`${WANDS[id].name} fires`, false, String(threw.message).slice(0, 70));
    else fired.push(id);
  }
  check('every wand in the table fires without throwing',
    fired.length === WAND_IDS.length, `${fired.length}/${WAND_IDS.length}`);
}

// pointing one spends a charge
{
  const { g, p, f, wand } = hero(WAND.MAGIC_MISSILE);
  targetAhead(g, p, f);
  const before = wand.charges;
  g.pointWand(p, f, wand);
  check('pointing one spends a charge', wand.charges === before - 1);
  wand.charges = 0;
  g.pointWand(p, f, wand);
  check('and an empty one does nothing', wand.charges === 0);
}

// a missile actually reaches what is in front of you
{
  const { g, p, f, wand } = hero(WAND.MAGIC_MISSILE);
  const e = targetAhead(g, p, f, 3);
  const at = { x: e.x, y: e.y };
  g.pointWand(p, f, wand);
  // hold it still while the bolt is in the air; a rat that walks out of the
  // way is not the wand failing
  for (let i = 0; i < 60 && e.hp === 500; i++) {
    e.x = at.x; e.y = at.y;
    g.step(); g.clearTransient();
  }
  check('a magic missile reaches what is in front of you', e.hp < 500, `hp ${e.hp}`);
}

// a beam goes through more than one of them
{
  const { g, p, f, wand } = hero(WAND.DISINTEGRATION);
  const a = targetAhead(g, p, f, 2);
  const b = g.spawnMob(f, KIND.RAT, p.x + 4 * 16, p.y);
  b.hp = b.maxHp = 500;
  g.pointWand(p, f, wand);
  check('a beam cuts through everything in the line', a.hp < 500 && b.hp < 500,
    `${a.hp} and ${b.hp}`);
}

// frost freezes
{
  const { g, p, f, wand } = hero(WAND.FROST);
  const e = targetAhead(g, p, f, 3);
  const at = { x: e.x, y: e.y };
  g.pointWand(p, f, wand);
  for (let i = 0; i < 60 && !BF.has(e, B.FROZEN); i++) {
    e.x = at.x; e.y = at.y;
    g.step(); g.clearTransient();
  }
  check('a frost bolt stops what it touches', BF.has(e, B.FROZEN));
}

// transfusion pays you back
{
  const { g, p, f, wand } = hero(WAND.TRANSFUSION);
  const e = targetAhead(g, p, f, 2);
  p.hp = 100;
  g.pointWand(p, f, wand);
  check('transfusion takes from them and gives to you', e.hp < 500 && p.hp > 100,
    `them ${e.hp}, you ${p.hp}`);
}

// regrowth leaves grass behind
{
  const { g, p, f, wand } = hero(WAND.REGROWTH);
  targetAhead(g, p, f);
  const here = tileUnder(p, PLAYER_BOX);
  g.pointWand(p, f, wand);
  check('regrowth grows what you point it at',
    f.tiles[idx(tx(here) + 1, ty(here))] === TT.HIGH_GRASS);
}

// corruption turns one around
{
  const { g, p, f, wand } = hero(WAND.CORRUPTION);
  const e = targetAhead(g, p, f, 2);
  g.pointWand(p, f, wand);
  check('corruption turns one of them around', BF.has(e, B.CHARM));
}

// blast wave shoves
{
  const { g, p, f, wand } = hero(WAND.BLAST_WAVE);
  const e = targetAhead(g, p, f, 1);
  g.pointWand(p, f, wand);
  check('a blast wave shoves them away', e.knockT > 0 && (e.knockX !== 0 || e.knockY !== 0));
}

// warding leaves something behind that shoots
{
  const { g, p, f, wand } = hero(WAND.WARDING);
  const e = targetAhead(g, p, f, 2);
  g.pointWand(p, f, wand);
  const ward = f.ents.find(x => x.kind === KIND.WARD);
  check('warding leaves something behind', !!ward);
  const at = { x: e.x, y: e.y };
  for (let i = 0; i < 120 && e.hp === 500; i++) {
    e.x = at.x; e.y = at.y;
    g.step(); g.clearTransient();
  }
  check('and it shoots for you', e.hp < 500, `hp ${e.hp}`);
  ward.life = 1;
  for (let i = 0; i < 4; i++) { g.step(); g.clearTransient(); }
  check('but not forever', ward.dead);
}

// prismatic light blinds a room
{
  const { g, p, f, wand } = hero(WAND.PRISMATIC);
  const e = targetAhead(g, p, f, 2);
  g.pointWand(p, f, wand);
  check('prismatic light blinds what is near', BF.has(e, B.BLINDNESS));
}

// firing an unknown wand teaches you what it is
{
  const { g, p, f, wand } = hero(WAND.FIREBLAST);
  wand.known = false;
  targetAhead(g, p, f);
  g.pointWand(p, f, wand);
  check('firing an untried wand tells you what it was', wand.known === true);
  check('and the party remembers', g.known.wands.includes(WAND.FIREBLAST));
}

// they recharge in the pack, and a scroll fills them
{
  const { g, p, f, wand } = hero(WAND.MAGIC_MISSILE);
  wand.charges = 0;
  wand.cd = 0;
  for (let i = 0; i < WANDS[WAND.MAGIC_MISSILE].recharge + 40; i++) {
    p.invuln = 600; p.hp = p.maxHp; p.ghost = false;
    g.step(); g.clearTransient();
  }
  check('a wand in the pack fills back up as you walk', wand.charges > 0, `${wand.charges}`);
  wand.charges = 0;
  g.read(p, f, 'recharging');
  check('and a scroll of recharging tops it right off',
    wand.charges === WANDS[WAND.MAGIC_MISSILE].max, `${wand.charges}`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall wand checks passed');
process.exit(fails ? 1 : 0);
