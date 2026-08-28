// Rings: two on your hands, quietly changing the numbers, and one of them is
// probably a mistake.
import { Game } from '../shared/game.js';
import {
  RING, RINGS, RING_IDS, RING_LOOKS, applyRings, rollRing,
  ringIndex, ringById, RING_LEARN_TICKS,
} from '../shared/rings.js';
import { baseStats } from '../shared/perks.js';
import { ITEM, itemLabel, makeAppearances, rollLoot, itemValue, stackKey } from '../shared/items.js';
import { rngFor } from '../shared/terrain.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the table --------------------------------------------------------------
check('twelve rings', RING_IDS.length === 12);
check('each is named, described, and does something',
  RING_IDS.every(id => RINGS[id].name && RINGS[id].blurb && typeof RINGS[id].apply === 'function'));
check('there is a stone for every one', RING_LOOKS.length >= RING_IDS.length);
check('they survive the round trip to the wire',
  RING_IDS.every(id => ringById(ringIndex(id)) === id) && ringById(0) === null);

// --- every ring moves a number, and a cursed one moves it the wrong way ------
{
  let allMoved = true, allBackwards = true;
  for (const id of RING_IDS) {
    const plain = baseStats();
    const good = applyRings(baseStats(), { ring1: { kind: id, upgrade: 0 } });
    const bad = applyRings(baseStats(), { ring1: { kind: id, upgrade: 0, cursed: true } });
    const differs = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
    if (!differs(plain, good)) { allMoved = false; console.log(`    ${id} changed nothing`); }
    if (!differs(good, bad)) { allBackwards = false; console.log(`    ${id} is the same cursed`); }
  }
  check('every ring changes the stat block', allMoved);
  check('and a cursed one changes it differently', allBackwards);
}

// --- two at once add up -----------------------------------------------------
{
  const one = applyRings(baseStats(), { ring1: { kind: RING.FORCE, upgrade: 0 } });
  const two = applyRings(baseStats(), {
    ring1: { kind: RING.FORCE, upgrade: 0 },
    ring2: { kind: RING.FORCE, upgrade: 0 },
  });
  check('two of the same ring stack', two.melee > one.melee, `${one.melee} -> ${two.melee}`);
  const up = applyRings(baseStats(), { ring1: { kind: RING.FORCE, upgrade: 2 } });
  check('and an upgraded one counts for more', up.melee > one.melee, `${one.melee} -> ${up.melee}`);
}

// --- naming -----------------------------------------------------------------
{
  const app = makeAppearances(7);
  const known = { potions: [], scrolls: [], rings: [] };
  const r = { type: ITEM.RING, kind: RING.HASTE, upgrade: 0, known: false };
  const hidden = itemLabel(r, app, known);
  check('an unknown ring is named for its stone', /RING$/.test(hidden) && !hidden.includes('HASTE'), hidden);
  known.rings.push(RING.HASTE);
  check('a known one says what it is',
    itemLabel(r, app, known).includes('HASTE'), itemLabel(r, app, known));
  check('every ring gets its own stone',
    new Set(Object.values(app.ringLook)).size === RING_IDS.length);
}

// --- rings do not stack in the pack -----------------------------------------
check('two different rings take two slots',
  stackKey({ type: ITEM.RING, kind: RING.FORCE }) !== stackKey({ type: ITEM.RING, kind: RING.HASTE }));
check('and so do two of the same at different upgrades',
  stackKey({ type: ITEM.RING, kind: RING.FORCE, upgrade: 0 }) !==
  stackKey({ type: ITEM.RING, kind: RING.FORCE, upgrade: 2 }));

// --- they turn up in the world ----------------------------------------------
{
  const rng = rngFor(4242);
  let found = 0, cursed = 0;
  for (let n = 0; n < 6000; n++) {
    const it = rollLoot(10, rng);
    if (it.type === ITEM.RING) { found++; if (it.cursed) cursed++; }
  }
  check('rings drop, but not often', found > 40 && found < 600, `${found}/6000 drops`);
  check('and some of them are cursed', cursed > 0, `${cursed} of ${found}`);
  check('a ring is worth real money', itemValue({ type: ITEM.RING }) > 100);
}

// --- a live hero ------------------------------------------------------------
function hero() {
  const g = new Game('RING');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
  idle(4);
  p.hp = p.maxHp = 300;
  p.invuln = 0;
  return { g, p, f: g.floor(1), idle };
}

{
  const { g, p } = hero();
  check('a fresh hero wears no rings', !p.equip.ring1 && !p.equip.ring2);

  p.bag[0] = { key: 'r1', item: { type: ITEM.RING, kind: RING.FORCE, upgrade: 0, known: true }, count: 1 };
  p.bag[1] = { key: 'r2', item: { type: ITEM.RING, kind: RING.MIGHT, upgrade: 0, known: true }, count: 1 };
  const melee0 = p.stats.melee;
  g.invOp(p, 'use', 0);
  check('putting one on fills the first finger', p.equip.ring1?.kind === RING.FORCE);
  check('and it reaches the stat block', p.stats.melee > melee0, `${melee0} -> ${p.stats.melee}`);
  g.invOp(p, 'use', 1);
  check('the second goes on the other hand', p.equip.ring2?.kind === RING.MIGHT);

  g.invOp(p, 'unequip', 2);
  check('and it comes off again', !p.equip.ring1);
  check('back into the pack', p.bag.some(s => s?.item.kind === RING.FORCE));
}

// --- wearing one long enough tells you what it is ---------------------------
{
  const { g, p } = hero();
  p.equip.ring1 = { type: ITEM.RING, kind: RING.WEALTH, upgrade: 0, known: false, worn: 0 };
  g.recalc(p);
  check('it starts a mystery', !p.equip.ring1.known);
  // a dead hero learns nothing, and this check is not about surviving the floor
  for (let i = 0; i < RING_LEARN_TICKS + 60; i++) {
    p.invuln = 600;
    p.hp = p.maxHp;
    p.ghost = false;
    g.step();
    g.clearTransient();
  }
  check('and wearing it long enough gives it away', p.equip.ring1.known === true,
    `worn ${p.equip.ring1.worn}`);
  check('which the whole party then knows', g.known.rings.includes(RING.WEALTH));
}

// --- a cursed ring will not come off ----------------------------------------
{
  const { g, p } = hero();
  p.equip.ring1 = { type: ITEM.RING, kind: RING.HASTE, upgrade: 0, cursed: true, known: true, worn: 0 };
  g.recalc(p);
  g.invOp(p, 'unequip', 2);
  check('a cursed ring stays on your finger', !!p.equip.ring1);
  g.uncurse(p);
  check('until a scroll lifts it', !p.equip.ring1.cursed);
  g.invOp(p, 'unequip', 2);
  check('and then it comes off', !p.equip.ring1);
}

// --- and both hands full of curses is its own problem -----------------------
{
  const { g, p } = hero();
  p.equip.ring1 = { type: ITEM.RING, kind: RING.HASTE, cursed: true, known: true, upgrade: 0 };
  p.equip.ring2 = { type: ITEM.RING, kind: RING.FORCE, cursed: true, known: true, upgrade: 0 };
  p.bag[0] = { key: 'r', item: { type: ITEM.RING, kind: RING.MIGHT, upgrade: 0, known: true }, count: 1 };
  g.invOp(p, 'use', 0);
  check('with both fingers stuck you cannot put a third on',
    p.equip.ring1.kind === RING.HASTE && p.equip.ring2.kind === RING.FORCE &&
    p.bag[0]?.item.kind === RING.MIGHT);
}

// --- tenacity actually pays off ---------------------------------------------
// recalc() derives maxHp from class, level and stats, so set the health after
// it runs or the two heroes are not being compared on the same scale.
{
  const bruise = (withRing) => {
    const { g, p } = hero();
    p.equip.armor = { type: ITEM.ARMOR, tier: 1, upgrade: 0 };
    if (withRing) p.equip.ring1 = { type: ITEM.RING, kind: RING.TENACITY, upgrade: 2, known: true };
    g.recalc(p);
    p.maxHp = 300;
    p.hp = 100;                 // two thirds gone: tenacity should be at its best
    p.invuln = 0;
    g.hurtPlayer(p, 40, p.x + 30, p.y);
    return 100 - p.hp;
  };
  const plain = bruise(false);
  const tough = bruise(true);
  check('tenacity softens a blow when you are nearly gone', tough < plain, `${plain} -> ${tough}`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall ring checks passed');
process.exit(fails ? 1 : 0);
