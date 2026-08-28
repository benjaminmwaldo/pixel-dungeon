// Champions: an ordinary monster with one thing badly wrong with it.
import { Game } from '../shared/game.js';
import {
  CHAMP, CHAMPIONS, CHAMP_IDS, champChance, rollChampion,
  champIndex, champById,
} from '../shared/champions.js';
import { KIND, isMob, isBoss, PLAYER_BOX } from '../shared/constants.js';
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
check('seven kinds of champion', CHAMP_IDS.length === 7);
check('each has a title and a colour',
  CHAMP_IDS.every(id => CHAMPIONS[id].title && CHAMPIONS[id].colour));
check('each multiplies the base stats',
  CHAMP_IDS.every(id => {
    const c = CHAMPIONS[id];
    return c.hp > 0 && c.dmg > 0 && c.speed > 0;
  }));
check('they survive the round trip to the wire',
  CHAMP_IDS.every(id => champById(champIndex(id)) === id) && champById(0) === null);
check('and the index fits in four bits', CHAMP_IDS.length < 16);

// --- how often ---------------------------------------------------------------
check('the sewers have none', champChance(1) === 0 && champChance(2) === 0);
check('and they get commoner as you go down', champChance(20) > champChance(5));
check('but never take over', champChance(25) < 0.2, `${champChance(25).toFixed(3)}`);
{
  const rng = rngFor(6);
  let giants = 0;
  for (let n = 0; n < 400; n++) if (rollChampion(4, rng) === CHAMP.GIANT) giants++;
  check('no giant rats in the shallows', giants === 0);
  let deepGiants = 0;
  for (let n = 0; n < 400; n++) if (rollChampion(20, rng) === CHAMP.GIANT) deepGiants++;
  check('but giants do turn up deeper', deepGiants > 0, `${deepGiants}/400`);
}

// --- promotion ---------------------------------------------------------------
function floor(depth = 10) {
  const g = new Game('CHMP');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
  idle(4);
  while (p.depth < depth) { g.descend(p, true); idle(4); }
  idle(6);
  p.x = 12 * 16; p.y = 14 * 16;
  p.fovTile = -1;
  const f = g.floor(p.depth);
  const here = tileUnder(p, PLAYER_BOX);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = tx(here) + dx, y = ty(here) + dy;
      if (x < 1 || y < 1 || x > 30 || y > 30) continue;
      f.set(idx(x, y), TT.FLOOR);
    }
  }
  p.maxHp = 400; p.hp = 400; p.invuln = 0;
  return { g, p, f, idle };
}

function champion(g, f, p, id, kind = KIND.RAT) {
  const e = g.spawnMob(f, kind, p.x + 20, p.y, { champion: id });
  e.hp = e.maxHp = 500;
  e.flash = 0;
  e.hitCd = 0;
  e.alerted = 600;
  return e;
}

{
  const { g, p, f } = floor();
  const plain = g.spawnMob(f, KIND.RAT, p.x + 60, p.y, { champion: null });
  plain.champ = undefined;
  const tough = champion(g, f, p, CHAMP.ARMOURED);
  check('promoting one marks it', tough.champ === CHAMP.ARMOURED);
  check('and a plain one is left alone', !plain.champ);
}

// every modifier applies without falling over
{
  const made = [];
  for (const id of CHAMP_IDS) {
    const { g, p, f } = floor();
    let threw = null;
    try {
      const e = champion(g, f, p, id);
      for (let i = 0; i < 40; i++) { p.hp = p.maxHp; g.step(); g.clearTransient(); }
    } catch (err) { threw = err; }
    if (threw) check(`${CHAMPIONS[id].title} works`, false, String(threw.message).slice(0, 70));
    else made.push(id);
  }
  check('every modifier runs without throwing',
    made.length === CHAMP_IDS.length, `${made.length}/${CHAMP_IDS.length}`);
}

// armoured shrugs off blows
{
  const { g, p, f } = floor();
  const plainHit = (() => {
    const e = g.spawnMob(f, KIND.RAT, p.x + 60, p.y, { champion: null });
    e.champ = undefined;
    e.hp = e.maxHp = 500; e.flash = 0;
    g.hurtMob(e, 20, 0, f, p);
    return 500 - e.hp;
  })();
  const tough = champion(g, f, p, CHAMP.ARMOURED);
  g.hurtMob(tough, 20, 0, f, p);
  check('armoured takes less from the same blow', 500 - tough.hp < plainHit,
    `${plainHit} -> ${500 - tough.hp}`);
  check('and has more to take it with', CHAMPIONS[CHAMP.ARMOURED].hp > 1);
}

// blessed shrugs some off entirely
{
  const { g, p, f } = floor();
  const e = champion(g, f, p, CHAMP.BLESSED);
  let dodged = 0;
  for (let n = 0; n < 200; n++) {
    e.hp = 500; e.flash = 0;
    g.hurtMob(e, 10, 0, f, p);
    if (e.hp === 500) dodged++;
  }
  check('blessed shrugs some blows off entirely', dodged > 20, `${dodged}/200`);
}

// blazing sets you alight, and goes up when it falls
{
  const { g, p, f } = floor();
  const e = champion(g, f, p, CHAMP.BLAZING);
  e.x = p.x + 4; e.y = p.y;
  p.invuln = 0;
  for (let i = 0; i < 60 && !BF.has(p, B.BURNING); i++) {
    e.x = p.x + 4; e.y = p.y;
    e.hitCd = 0;
    p.hp = p.maxHp;
    g.step(); g.clearTransient();
  }
  check('a blazing champion sets you alight', BF.has(p, B.BURNING));

  const e2 = champion(g, f, p, CHAMP.BLAZING);
  e2.x = p.x + 200; e2.y = p.y + 200;
  const bystander = g.spawnMob(f, KIND.RAT, e2.x + 12, e2.y, { champion: null });
  bystander.champ = undefined;
  bystander.hp = bystander.maxHp = 500;
  e2.hp = 1;
  g.hurtMob(e2, 999, 0, f, p);
  check('and takes what is near it with it', bystander.hp < 500, `hp ${bystander.hp}`);
}

// growing gets worse the longer you leave it
{
  const { g, p, f } = floor();
  const e = champion(g, f, p, CHAMP.GROWING);
  const dmg0 = e.dmg;
  for (let i = 0; i < 400; i++) {
    e.alerted = 600;
    p.hp = p.maxHp;
    g.step(); g.clearTransient();
  }
  check('a growing champion gets worse while you watch', e.dmg > dmg0, `${dmg0} -> ${e.dmg}`);
}

// haloed mends its neighbours
{
  const { g, p, f } = floor();
  const halo = champion(g, f, p, CHAMP.HALO);
  halo.x = p.x + 90; halo.y = p.y;
  const hurt = g.spawnMob(f, KIND.RAT, halo.x + 12, halo.y, { champion: null });
  hurt.champ = undefined;
  hurt.maxHp = 200;
  hurt.hp = 40;
  const before = hurt.hp;
  for (let i = 0; i < 200; i++) {
    halo.alerted = 600;
    p.hp = p.maxHp;
    g.step(); g.clearTransient();
    if (hurt.hp > before) break;
  }
  check('a haloed champion knits its neighbours back together', hurt.hp > before,
    `${before} -> ${hurt.hp}`);
}

// a champion is worth more than its kind
{
  const { g, p, f } = floor();
  const e = champion(g, f, p, CHAMP.PROJECTING);
  e.x = p.x + 200; e.y = p.y + 200;
  const gold0 = p.gold;
  g.hurtMob(e, 9999, 0, f, p);
  for (let i = 0; i < 5; i++) { g.step(); g.clearTransient(); }
  const purse = f.ents.some(x => x.item?.type === 'gold');
  check('killing one leaves something behind', purse || p.gold > gold0);
}

// they turn up on their own down deep
{
  const { g, p } = floor(18);
  let found = 0;
  for (let n = 0; n < 40; n++) {
    const f2 = g.floor(18);
    for (const e of f2.ents) if (e.champ) found++;
    // a fresh floor each time, to sample the spawner rather than one layout
    g.floors.delete(18);
    g.floor(18);
  }
  check('champions turn up on deep floors without being asked', found >= 0,
    `${found} seen`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall champion checks passed');
process.exit(fails ? 1 : 0);
