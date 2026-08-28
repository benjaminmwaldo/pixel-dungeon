// Missiles: throw them, and then go and pick them back up.
import { Game } from '../shared/game.js';
import {
  MISSILE, MISSILES, MISSILE_IDS, rollMissile, missilesForDepth,
  missilePower, missileIndex, missileById,
} from '../shared/missiles.js';
import { ITEM, itemLabel, makeAppearances, rollLoot, stackKey, itemValue } from '../shared/items.js';
import { rngFor, TT, idx, tx, ty } from '../shared/terrain.js';
import { KIND, isMob, PLAYER_BOX, E } from '../shared/constants.js';
import { tileUnder } from '../shared/physics.js';
import * as BF from '../shared/buffs.js';
import { B } from '../shared/buffs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the table --------------------------------------------------------------
check('ten things to throw', MISSILE_IDS.length === 10);
check('each is named, described, and flies',
  MISSILE_IDS.every(id => {
    const d = MISSILES[id];
    return d.name && d.blurb && d.dmg > 0 && d.speed > 0 && d.range > 0;
  }));
check('each has a chance of surviving the trip',
  MISSILE_IDS.every(id => MISSILES[id].keep > 0 && MISSILES[id].keep <= 1));
check('they survive the round trip to the wire',
  MISSILE_IDS.every(id => missileById(missileIndex(id)) === id) && missileById(0) === null);
check('shallow floors hand out only the simple ones',
  missilesForDepth(1).every(id => MISSILES[id].tier === 1));
check('and the deepest hand out everything',
  missilesForDepth(25).length === MISSILE_IDS.length);
check('a deeper floor throws harder',
  missilePower(MISSILES[MISSILE.STONE], 20) > missilePower(MISSILES[MISSILE.STONE], 1));

// --- naming and stacking ----------------------------------------------------
{
  const app = makeAppearances(2);
  const known = { potions: [], scrolls: [], rings: [], wands: [] };
  check('one reads as one',
    itemLabel({ type: ITEM.MISSILE, kind: MISSILE.KNIFE, amount: 1 }, app, known) === 'THROWING KNIFE');
  check('and several read as several',
    itemLabel({ type: ITEM.MISSILE, kind: MISSILE.KNIFE, amount: 5 }, app, known) === '5 THROWING KNIFES');
  check('the same kind stacks together',
    stackKey({ type: ITEM.MISSILE, kind: MISSILE.KNIFE }) ===
    stackKey({ type: ITEM.MISSILE, kind: MISSILE.KNIFE }));
  check('different kinds do not',
    stackKey({ type: ITEM.MISSILE, kind: MISSILE.KNIFE }) !==
    stackKey({ type: ITEM.MISSILE, kind: MISSILE.STONE }));
}

// --- they turn up -----------------------------------------------------------
{
  const rng = rngFor(31337);
  let found = 0, bundles = 0;
  for (let n = 0; n < 6000; n++) {
    const it = rollLoot(12, rng);
    if (it.type !== ITEM.MISSILE) continue;
    found++;
    if ((it.amount || 1) > 1) bundles++;
  }
  check('missiles drop', found > 100, `${found}/6000 drops`);
  check('and often in handfuls', bundles > found * 0.5, `${bundles} of ${found}`);
  check('a bundle is worth more than one', itemValue({ type: ITEM.MISSILE, kind: MISSILE.KNIFE, amount: 5 }) >
    itemValue({ type: ITEM.MISSILE, kind: MISSILE.KNIFE, amount: 1 }));
}

// --- throwing them ----------------------------------------------------------
function hero(kind, amount = 5) {
  const g = new Game('THRW');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  for (let i = 0; i < 4; i++) { g.step(); g.clearTransient(); }
  const f = g.floor(1);
  p.hp = p.maxHp = 300;
  p.invuln = 600;
  const item = { type: ITEM.MISSILE, kind };
  p.bag[0] = { key: stackKey(item), item, count: amount };
  return { g, p, f };
}

/** Open ground, hero in the middle, one monster directly ahead. */
function targetAhead(g, p, f, tiles = 3) {
  p.x = 12 * 16; p.y = 14 * 16;
  p.fovTile = -1;
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
  const e = f.ents.find(x => isMob(x.kind) && !x.dead) || g.spawnMob(f, KIND.RAT, 0, 0);
  for (const o of f.ents) {
    if (o === e || o.dead || !isMob(o.kind)) continue;
    o.x = 2 * 16; o.y = 2 * 16;
  }
  e.x = p.x + tiles * 16; e.y = p.y;
  e.hp = e.maxHp = 500;
  e.buffs = {}; e.flash = 0; e.effects = null;
  return e;
}

/** Fly the thing, holding the target still so we measure the throw. */
function fly(g, f, e, ticks = 80) {
  const at = e ? { x: e.x, y: e.y } : null;
  for (let i = 0; i < ticks; i++) {
    if (at) { e.x = at.x; e.y = at.y; }
    g.step();
    g.clearTransient();
  }
}

// every one of them flies without falling over
{
  const flew = [];
  for (const id of MISSILE_IDS) {
    const { g, p, f } = hero(id);
    const e = targetAhead(g, p, f);
    let threw = null;
    try {
      g.throwMissile(p, f, 0);
      fly(g, f, e, 60);
    } catch (err) { threw = err; }
    if (threw) check(`${MISSILES[id].name} flies`, false, String(threw.message).slice(0, 70));
    else flew.push(id);
  }
  check('everything in the table flies without throwing',
    flew.length === MISSILE_IDS.length, `${flew.length}/${MISSILE_IDS.length}`);
}

// throwing one takes one from the stack
{
  const { g, p, f } = hero(MISSILE.KNIFE, 3);
  targetAhead(g, p, f);
  g.throwMissile(p, f, 0);
  check('throwing one takes one off the stack', p.bag[0]?.count === 2);
  g.throwMissile(p, f, 0);
  g.throwMissile(p, f, 0);
  check('and the last one empties the slot', !p.bag[0]);
}

// it reaches what is in front of you
{
  const { g, p, f } = hero(MISSILE.KNIFE);
  const e = targetAhead(g, p, f);
  g.throwMissile(p, f, 0);
  fly(g, f, e, 80);
  check('a thrown knife reaches what is in front of you', e.hp < 500, `hp ${e.hp}`);
}

// and lands where you can pick it up
{
  const { g, p, f } = hero(MISSILE.KNIFE);
  const e = targetAhead(g, p, f);
  let landed = false;
  for (let n = 0; n < 25 && !landed; n++) {
    p.bag[0] = { key: stackKey({ type: ITEM.MISSILE, kind: MISSILE.KNIFE }),
                 item: { type: ITEM.MISSILE, kind: MISSILE.KNIFE }, count: 5 };
    const before = f.ents.filter(x => x.kind === KIND.ITEM && x.item?.type === ITEM.MISSILE).length;
    g.throwMissile(p, f, 0);
    fly(g, f, e, 80);
    const after = f.ents.filter(x => x.kind === KIND.ITEM && x.item?.type === ITEM.MISSILE).length;
    if (after > before) landed = true;
  }
  check('and what survives lands on the floor to be picked up', landed);
}

// a stone is more likely to break than a knife
check('the cheap ones break more often',
  MISSILES[MISSILE.STONE].keep < MISSILES[MISSILE.KNIFE].keep);

// bolas hold them still
{
  const { g, p, f } = hero(MISSILE.BOLAS);
  const e = targetAhead(g, p, f);
  g.throwMissile(p, f, 0);
  fly(g, f, e, 80);
  check('bolas wrap their legs', BF.has(e, B.ROOTS));
}

// a tomahawk leaves them bleeding
{
  const { g, p, f } = hero(MISSILE.TOMAHAWK);
  const e = targetAhead(g, p, f);
  g.throwMissile(p, f, 0);
  fly(g, f, e, 80);
  check('a tomahawk leaves them bleeding', BF.has(e, B.BLEEDING));
}

// a trident goes through more than one
{
  const { g, p, f } = hero(MISSILE.TRIDENT);
  const a = targetAhead(g, p, f, 2);
  const b = g.spawnMob(f, KIND.RAT, p.x + 4 * 16, p.y);
  b.hp = b.maxHp = 500;
  const at = { ax: a.x, ay: a.y, bx: b.x, by: b.y };
  g.throwMissile(p, f, 0);
  for (let i = 0; i < 80; i++) {
    a.x = at.ax; a.y = at.ay; b.x = at.bx; b.y = at.by;
    g.step(); g.clearTransient();
  }
  check('a trident goes through two of them', a.hp < 500 && b.hp < 500, `${a.hp} and ${b.hp}`);
}

// a force cube shoves the room
{
  const { g, p, f } = hero(MISSILE.FORCE_CUBE);
  const a = targetAhead(g, p, f, 2);
  const b = g.spawnMob(f, KIND.RAT, a.x + 12, a.y + 12);
  b.hp = b.maxHp = 500;
  g.throwMissile(p, f, 0);
  for (let i = 0; i < 30; i++) {
    a.x = p.x + 32; a.y = p.y;
    g.step(); g.clearTransient();
    if (b.knockT > 0) break;
  }
  check('a force cube shoves whatever is standing near it', b.knockT > 0 || b.hp < 500);
}

// a boomerang comes back
{
  const { g, p, f } = hero(MISSILE.BOOMERANG, 1);
  targetAhead(g, p, f, 8);
  g.throwMissile(p, f, 0);
  check('throwing it empties the slot', !p.bag[0]);
  let back = false;
  for (let i = 0; i < 200 && !back; i++) {
    g.step(); g.clearTransient();
    back = p.bag.some(s => s?.item?.kind === MISSILE.BOOMERANG);
  }
  check('a boomerang comes back to your hand', back);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall missile checks passed');
process.exit(fails ? 1 : 0);
