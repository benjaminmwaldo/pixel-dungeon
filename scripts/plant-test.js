// Plants: they sit there doing nothing until something stands on them, and
// then they do exactly one thing and are gone.
import { Game } from '../shared/game.js';
import {
  PLANT, PLANTS, PLANT_IDS, rollPlant, rollSeed, plantsForDepth,
  plantIndex, plantById,
} from '../shared/plants.js';
import { ITEM, itemLabel, makeAppearances, rollLoot, stackKey, itemValue } from '../shared/items.js';
import { KIND, isMob, isNpc, PLAYER_BOX, E } from '../shared/constants.js';
import { rngFor, TT, idx, tx, ty } from '../shared/terrain.js';
import { tileUnder } from '../shared/physics.js';
import * as BF from '../shared/buffs.js';
import { B } from '../shared/buffs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the table --------------------------------------------------------------
check('thirteen of them', PLANT_IDS.length === 13);
check('each is named, coloured and described',
  PLANT_IDS.every(id => PLANTS[id].name && PLANTS[id].colour && PLANTS[id].blurb));
check('each actually does something',
  PLANT_IDS.every(id => {
    const d = PLANTS[id];
    return d.buff || d.cloud || d.teleport || d.shout || d.feeds;
  }));
check('they survive the round trip to the wire',
  PLANT_IDS.every(id => plantById(plantIndex(id)) === id) && plantById(0) === null);
check('the rare one stays out of the shallows',
  !plantsForDepth(1).includes(PLANT.STARFLOWER) &&
  plantsForDepth(15).includes(PLANT.STARFLOWER));
{
  const rng = rngFor(3);
  let stars = 0;
  for (let n = 0; n < 3000; n++) if (rollPlant(15, rng) === PLANT.STARFLOWER) stars++;
  check('and stays rare even where it grows', stars > 0 && stars < 500, `${stars}/3000`);
}

// --- seeds -------------------------------------------------------------------
{
  const app = makeAppearances(5);
  const known = { potions: [], scrolls: [], rings: [], wands: [] };
  check('one seed reads as one',
    itemLabel({ type: ITEM.SEED, kind: PLANT.SUNGRASS, amount: 1 }, app, known) === 'SUNGRASS SEED');
  check('and several as several',
    itemLabel({ type: ITEM.SEED, kind: PLANT.SUNGRASS, amount: 4 }, app, known) === '4 SUNGRASS SEEDS');
  check('the same kind stacks, different kinds do not',
    stackKey({ type: ITEM.SEED, kind: PLANT.SUNGRASS }) === stackKey({ type: ITEM.SEED, kind: PLANT.SUNGRASS }) &&
    stackKey({ type: ITEM.SEED, kind: PLANT.SUNGRASS }) !== stackKey({ type: ITEM.SEED, kind: PLANT.ICECAP }));

  const rng = rngFor(99);
  let found = 0;
  for (let n = 0; n < 6000; n++) if (rollLoot(10, rng).type === ITEM.SEED) found++;
  check('seeds drop', found > 60, `${found}/6000 drops`);
  check('and are worth a little', itemValue({ type: ITEM.SEED, amount: 2 }) > 0);
}

// --- a live floor ------------------------------------------------------------
function floorFor(depth = 8) {
  const g = new Game('PLNT');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => {
    for (let i = 0; i < n; i++) {
      p.invuln = 9999; p.hp = p.maxHp; p.ghost = false;
      g.step(); g.clearTransient();
    }
  };
  idle(4);
  while (p.depth < depth) { g.descend(p, true); idle(4); }
  idle(6);
  p.x = 12 * 16; p.y = 14 * 16; p.fovTile = -1;
  const f = g.floor(depth);
  const here = tileUnder(p, PLAYER_BOX);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = tx(here) + dx, y = ty(here) + dy;
      if (x < 1 || y < 1 || x > 30 || y > 30) continue;
      f.set(idx(x, y), TT.FLOOR);
    }
  }
  p.maxHp = 400; p.hp = 400; p.invuln = 9999;
  p.dir = E;
  return { g, p, f, idle };
}

// sowing
{
  const { g, p, f } = floorFor();
  const item = { type: ITEM.SEED, kind: PLANT.SUNGRASS };
  p.bag[0] = { key: stackKey(item), item, count: 3 };
  g.invOp(p, 'use', 0);
  check('sowing a seed grows a plant', f.ents.some(e => e.kind === KIND.PLANT && !e.dead));
  check('and takes one off the stack', p.bag[0]?.count === 2);
  // and never two on one tile
  const at = tileUnder(f.ents.find(e => e.kind === KIND.PLANT), { x: 4, y: 4, w: 8, h: 8 });
  check('nothing grows where something already has', !g.sowable(f, at));
}

// every one of them can be stood on without falling over
{
  const grew = [];
  for (const id of PLANT_IDS) {
    const { g, p, f } = floorFor();
    let threw = null;
    try {
      const here = tileUnder(p, PLAYER_BOX);
      const e = g.plant(f, here, id);
      g.trample(e, f, p, true);
      for (let i = 0; i < 30; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
    } catch (err) { threw = err; }
    if (threw) check(`${PLANTS[id].name} works`, false, String(threw.message).slice(0, 70));
    else grew.push(id);
  }
  check('every plant in the table works when trodden on',
    grew.length === PLANT_IDS.length, `${grew.length}/${PLANT_IDS.length}`);
}

// walking onto one sets it off, and uses it up
{
  const { g, p, f } = floorFor();
  const here = tileUnder(p, PLAYER_BOX);
  const e = g.plant(f, here, PLANT.SUNGRASS);
  g.underfoot(p, f);
  check('standing on one sets it off', e.dead);
  check('and it heals you when it is a friendly one', BF.has(p, B.HEALING));
}

// sorrowmoss is not friendly
{
  const { g, p, f } = floorFor();
  const here = tileUnder(p, PLAYER_BOX);
  const e = g.plant(f, here, PLANT.SORROWMOSS);
  g.underfoot(p, f);
  check('sorrowmoss poisons whoever stood on it', BF.has(p, B.POISON));
}

// a monster walking over one sets it off too
{
  const { g, p, f } = floorFor();
  for (const o of f.ents) if (isMob(o.kind) && !isNpc(o.kind)) o.dead = true;
  const mob = g.spawnMob(f, KIND.RAT, p.x + 60, p.y, { champion: null });
  mob.hp = mob.maxHp = 400;
  const at = tileUnder(mob, mob.box);
  const e = g.plant(f, at, PLANT.SORROWMOSS);
  for (let i = 0; i < 20 && !e.dead; i++) {
    mob.x = e.x; mob.y = e.y;
    p.invuln = 9999;
    g.step(); g.clearTransient();
  }
  check('a monster walking over one sets it off', e.dead);
  check('and takes what it was carrying', BF.has(mob, B.POISON));
}

// fadeleaf moves you
{
  const { g, p, f } = floorFor();
  const here = tileUnder(p, PLAYER_BOX);
  const e = g.plant(f, here, PLANT.FADELEAF);
  const at = { x: p.x, y: p.y };
  g.trample(e, f, p, true);
  check('fadeleaf puts you somewhere else',
    Math.abs(p.x - at.x) > 8 || Math.abs(p.y - at.y) > 8, `${at.x},${at.y} -> ${p.x},${p.y}`);
}

// rotberry brings the floor running
{
  const { g, p, f } = floorFor();
  for (const o of f.ents) if (isMob(o.kind)) o.alerted = 0;
  const here = tileUnder(p, PLAYER_BOX);
  const e = g.plant(f, here, PLANT.ROTBERRY);
  g.trample(e, f, p, true);
  const awake = f.ents.filter(o => isMob(o.kind) && !isNpc(o.kind) && o.alerted > 0).length;
  check('rotberry brings everything running', awake > 0, `${awake} woke up`);
}

// blandfruit is food
{
  const { g, p, f } = floorFor();
  p.hunger = 100;
  const here = tileUnder(p, PLAYER_BOX);
  const e = g.plant(f, here, PLANT.BLANDFRUIT);
  g.trample(e, f, p, true);
  check('blandfruit fills you up', p.hunger > 100, `${p.hunger}`);
}

// firebloom makes a cloud rather than a single hit
{
  const { g, p, f } = floorFor();
  for (const o of f.ents) if (isMob(o.kind) && !isNpc(o.kind)) o.dead = true;
  const here = tileUnder(p, PLAYER_BOX);
  const mob = g.spawnMob(f, KIND.RAT, p.x + 10, p.y, { champion: null });
  mob.hp = mob.maxHp = 400;
  const e = g.plant(f, here, PLANT.FIREBLOOM);
  g.trample(e, f, p, false);
  check('firebloom lights up what is standing near it', BF.has(mob, B.BURNING));
}

// gardens grow them on their own
{
  let withPlants = 0, tried = 0;
  for (const code of ['GRD0', 'GRD1', 'GRD2', 'GRD3', 'GRD4', 'GRD5']) {
    const g = new Game(code);
    const p = g.addPlayer(1, 'BEN');
    g.begin();
    const idle = (n) => {
      for (let i = 0; i < n; i++) {
        p.invuln = 9999; p.hp = p.maxHp; p.ghost = false;
        g.step(); g.clearTransient();
      }
    };
    idle(4);
    for (let d = 2; d <= 12; d++) {
      g.descend(p, true);
      idle(8);
      const f = g.floor(d);
      const garden = f.level.rooms.some(r => r.type === 'garden');
      if (!garden) continue;
      tried++;
      if (f.ents.some(e => e.kind === KIND.PLANT && !e.dead)) withPlants++;
    }
  }
  check('a garden grows things on its own',
    tried === 0 || withPlants > 0, `${withPlants} of ${tried} gardens`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall plant checks passed');
process.exit(fails ? 1 : 0);
