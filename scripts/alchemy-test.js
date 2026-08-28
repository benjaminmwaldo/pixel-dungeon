// The pot in the laboratory, and the dew everything down here leaves behind.
import { Game } from '../shared/game.js';
import { PLANT, PLANTS, BREWS, BREW_COST } from '../shared/plants.js';
import { ITEM, itemLabel, makeAppearances, rollDrop, stackKey } from '../shared/items.js';
import { generate, ROOM } from '../shared/levelgen.js';
import { KIND, isMob, isNpc, PLAYER_BOX, DEW_MAX } from '../shared/constants.js';
import { rngFor, TT, idx, tx, ty } from '../shared/terrain.js';
import { tileUnder } from '../shared/physics.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the brew table ---------------------------------------------------------
check('every seed becomes something',
  Object.keys(PLANTS).every(id => typeof BREWS[id] === 'string' && BREWS[id]));
check('the pot takes three', BREW_COST === 3);

// --- laboratories have a pot in them ----------------------------------------
{
  let labs = 0, withPot = 0;
  for (let seed = 1; seed <= 60; seed++) {
    for (const d of [3, 7, 12, 18, 23]) {
      const lv = generate(d, seed);
      for (const r of lv.rooms) {
        if (r.type !== ROOM.LABORATORY) continue;
        labs++;
        let found = false;
        for (let y = r.t; y <= r.b && !found; y++) {
          for (let x = r.l; x <= r.r; x++) {
            if (lv.tiles[idx(x, y)] === TT.POT) { found = true; break; }
          }
        }
        if (found) withPot++;
      }
    }
  }
  check('laboratories get a pot', labs === 0 || withPot === labs,
    `${withPot} of ${labs} laboratories`);
  check('and laboratories are actually built', labs > 0, `${labs} seen`);
}

// --- a live pot -------------------------------------------------------------
function potFloor() {
  const g = new Game('ALCH');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => {
    for (let i = 0; i < n; i++) {
      p.invuln = 9999; p.hp = p.maxHp; p.ghost = false;
      g.step(); g.clearTransient();
    }
  };
  idle(4);
  const f = g.floor(1);
  p.x = 12 * 16; p.y = 14 * 16; p.fovTile = -1;
  const here = tileUnder(p, PLAYER_BOX);
  f.set(here, TT.POT);
  p.maxHp = 400; p.hp = 400; p.invuln = 9999;
  for (let i = 0; i < p.bag.length; i++) p.bag[i] = null;
  return { g, p, f, idle, here };
}

function giveSeeds(p, kinds) {
  for (const kind of kinds) {
    const slot = p.bag.find(s => s?.item?.type === ITEM.SEED && s.item.kind === kind);
    if (slot) slot.count++;
    else {
      const free = p.bag.indexOf(null);
      const item = { type: ITEM.SEED, kind };
      p.bag[free] = { key: stackKey(item), item, count: 1 };
    }
  }
}

// three of a kind gives you exactly that
{
  const { g, p, f } = potFloor();
  giveSeeds(p, [PLANT.SUNGRASS, PLANT.SUNGRASS, PLANT.SUNGRASS]);
  g.interact(p);
  const potion = p.bag.find(s => s?.item?.type === ITEM.POTION);
  check('three of a kind brews exactly what that seed makes',
    potion?.item.kind === BREWS[PLANT.SUNGRASS], potion?.item.kind);
  check('and the seeds are gone',
    !p.bag.some(s => s?.item?.type === ITEM.SEED));
}

// a mixed handful gives you one of the three
{
  const { g, p } = potFloor();
  const mix = [PLANT.FIREBLOOM, PLANT.ICECAP, PLANT.SWIFTTHISTLE];
  giveSeeds(p, mix);
  g.interact(p);
  const potion = p.bag.find(s => s?.item?.type === ITEM.POTION);
  check('a mixed handful brews one of the three',
    mix.map(k => BREWS[k]).includes(potion?.item.kind), potion?.item.kind);
}

// two seeds is not enough, and nothing is lost trying
{
  const { g, p } = potFloor();
  giveSeeds(p, [PLANT.ICECAP, PLANT.ICECAP]);
  g.interact(p);
  check('two seeds will not brew', !p.bag.some(s => s?.item?.type === ITEM.POTION));
  const left = p.bag.filter(s => s?.item?.type === ITEM.SEED)
                    .reduce((n, s) => n + s.count, 0);
  check('and you get them back', left === 2, `${left} left`);
}

// the pot works more than once
{
  const { g, p } = potFloor();
  giveSeeds(p, Array(6).fill(PLANT.EARTHROOT));
  g.interact(p);
  g.interact(p);
  const potions = p.bag.filter(s => s?.item?.type === ITEM.POTION)
                       .reduce((n, s) => n + s.count, 0);
  check('the pot can be used again', potions === 2, `${potions} brewed`);
}

// --- dew --------------------------------------------------------------------
{
  const rng = rngFor(4242);
  let dew = 0;
  for (let n = 0; n < 4000; n++) if (rollDrop(10, rng)?.type === ITEM.DEW) dew++;
  check('most things leave a drop of dew', dew > 800, `${dew}/4000 drops`);
}

{
  const { g, p, f } = potFloor();
  p.hp = 100;
  const before = p.hp;
  g.take(p, f, { type: ITEM.DEW });
  check('a drop mends you when you are hurt', p.hp > before, `${before} -> ${p.hp}`);
  check('and does not go into the vial while you need it', !p.dew);

  p.hp = p.maxHp;
  g.take(p, f, { type: ITEM.DEW });
  check('but when you are whole it goes by', (p.dew || 0) > 0, `${p.dew} put by`);

  for (let n = 0; n < 400; n++) g.take(p, f, { type: ITEM.DEW });
  check('the vial has a limit', p.dew <= DEW_MAX, `${p.dew}`);
}

// tipping the vial out
{
  const { g, p, f, here } = potFloor();
  f.set(here, TT.FLOOR);                       // stand somewhere plain
  p.dew = 40;
  p.hp = 100;
  g.interact(p);
  check('tipping the vial out mends you', p.hp > 100, `hp ${p.hp}`);
  check('and empties it', p.dew === 0);

  p.hp = p.maxHp;
  p.dew = 20;
  g.interact(p);
  check('but it will not pour when you are whole', p.dew === 20);
}

// the pot still takes priority over the vial
{
  const { g, p } = potFloor();
  p.dew = 40;
  p.hp = 100;
  giveSeeds(p, [PLANT.SUNGRASS, PLANT.SUNGRASS, PLANT.SUNGRASS]);
  g.interact(p);
  check('standing on the pot brews rather than pours',
    p.dew === 40 && p.bag.some(s => s?.item?.type === ITEM.POTION));
}

// naming
{
  const app = makeAppearances(2);
  const known = { potions: [], scrolls: [], rings: [], wands: [] };
  check('dew has a name', itemLabel({ type: ITEM.DEW }, app, known) === 'DEWDROP');
}

console.log(fails ? `\n${fails} FAILURES` : '\nall alchemy checks passed');
process.exit(fails ? 1 : 0);
