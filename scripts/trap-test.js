// Every trap in the table, sprung on a live floor. Catches the ones that throw
// rather than the ones that merely disappoint.
import { Game } from '../shared/game.js';
import { TRAPS, TRAP_IDS, trapsForDepth, rollTrap } from '../shared/traps.js';
import { generate } from '../shared/levelgen.js';
import { TT, rngFor, LEVEL_LEN } from '../shared/terrain.js';
import { PLAYER_BOX, isMob } from '../shared/constants.js';
import { tileUnder, tileToPixel } from '../shared/physics.js';
import * as BF from '../shared/buffs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the table --------------------------------------------------------------
check('every trap has a name and a colour',
  TRAP_IDS.every(id => TRAPS[id].name && TRAPS[id].colour));
check('shallow floors only lay shallow traps',
  trapsForDepth(1).every(id => TRAPS[id].tier === 1),
  `${trapsForDepth(1).length} kinds on floor 1`);
check('the deepest floors can lay anything',
  trapsForDepth(25).length === TRAP_IDS.length,
  `${trapsForDepth(25).length} kinds on floor 25`);

// --- generation -------------------------------------------------------------
let withTraps = 0, kinds = new Set();
for (let seed = 1; seed <= 20; seed++) {
  for (const depth of [1, 6, 13, 18, 24]) {
    const lv = generate(depth, seed);
    const n = Object.keys(lv.traps || {}).length;
    if (n) withTraps++;
    for (const k of Object.values(lv.traps || {})) kinds.add(k);
    for (const i of Object.keys(lv.traps || {})) {
      if (lv.tiles[i] !== TT.TRAP_HIDDEN) {
        check(`trap at ${i} sits on a trap tile`, false, `depth ${depth} seed ${seed}`);
      }
    }
  }
}
check('floors lay traps', withTraps > 90, `${withTraps}/100 floors`);
check('and a good spread of kinds turns up', kinds.size >= 15, `${kinds.size} of ${TRAP_IDS.length}`);

// --- springing every single one ---------------------------------------------
const sprung = [];
for (const id of TRAP_IDS) {
  const g = new Game('TRAP');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  for (let i = 0; i < 5; i++) { g.step(); g.clearTransient(); }
  const f = g.floor(1);
  p.hp = p.maxHp = 200;
  p.invuln = 0;

  // put the trap under our feet and name it
  const here = tileUnder(p, PLAYER_BOX);
  f.level.traps ??= {};
  f.level.traps[here] = id;
  f.set(here, TT.TRAP_HIDDEN);

  let threw = null;
  try {
    g.springTrap(p, f, here);
    for (let i = 0; i < 40; i++) { g.step(); g.clearTransient(); }
  } catch (e) {
    threw = e;
  }
  if (threw) {
    check(`${TRAPS[id].name} springs`, false, String(threw.message).slice(0, 60));
  } else {
    sprung.push(id);
  }
}
check('every trap in the table springs without throwing',
  sprung.length === TRAP_IDS.length, `${sprung.length}/${TRAP_IDS.length}`);

// --- a few that should have a visible consequence ---------------------------
function spring(id, setup) {
  const g = new Game('T');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  for (let i = 0; i < 5; i++) { g.step(); g.clearTransient(); }
  const f = g.floor(1);
  p.hp = p.maxHp = 200; p.invuln = 0;
  const here = tileUnder(p, PLAYER_BOX);
  f.level.traps ??= {};
  f.level.traps[here] = id;
  setup?.(g, p, f);
  g.springTrap(p, f, here);
  return { g, p, f, here };
}

{
  const { p } = spring('poisonDart');
  check('a poison dart poisons', BF.has(p, 'poison'));
}
{
  const { p } = spring('frost');
  check('a frost trap freezes you', BF.has(p, 'frozen'));
}
{
  const { p } = spring('burning');
  check('a burning trap lights you up', BF.has(p, 'burning'));
}
{
  const { g, f } = spring('summoning');
  const mobs = f.ents.filter(e => isMob(e.kind)).length;
  check('a summoning trap brings company', mobs > 8, `${mobs} on the floor`);
}
{
  const { p } = spring('pitfall');
  check('a pitfall drops you a floor', p.depth === 2, `on floor ${p.depth}`);
}
{
  const { p, f } = spring('disarming', (g, pl) => { pl.equip.weapon = { type: 'weapon', tier: 4, upgrade: 1 }; });
  check('a disarming trap takes your weapon', p.equip.weapon.tier === 1);
  check('and leaves it on the ground', f.ents.some(e => e.item?.type === 'weapon'));
}
{
  const { p } = spring('alarm');
  check('an alarm wakes the floor',
    p.depth === 1);
}
{
  const { p, f, here } = spring('geyser');
  check('a geyser floods the tile', f.tiles[here] === TT.WATER);
}
{
  const { p } = spring('grim');
  check('a grim trap hurts badly', p.hp < 190, `hp ${p.hp}`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall trap checks passed');
process.exit(fails ? 1 : 0);
