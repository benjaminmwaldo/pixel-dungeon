// Artifacts: one slot, no scroll will improve them, and each wants using in
// its own particular way.
import { Game } from '../shared/game.js';
import {
  ART, ARTIFACTS, ART_IDS, makeArtifact, rollArtifact, feed, tickArtifact,
  artMax, artIndex, artById, MAX_ART_LEVEL,
} from '../shared/artifacts.js';
import { ITEM, itemLabel, makeAppearances, rollPrize, stackKey, itemValue } from '../shared/items.js';
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
check('twelve artifacts', ART_IDS.length === 12);
check('each is named and described',
  ART_IDS.every(id => ARTIFACTS[id].name && ARTIFACTS[id].blurb));
check('each says what feeds it', ART_IDS.every(id => ARTIFACTS[id].grow && ARTIFACTS[id].per > 0));
check('the active ones hold charges',
  ART_IDS.filter(id => ARTIFACTS[id].active).every(id => ARTIFACTS[id].max > 0));
check('they survive the round trip to the wire',
  ART_IDS.every(id => artById(artIndex(id)) === id) && artById(0) === null);

// --- levelling --------------------------------------------------------------
{
  const a = makeArtifact(ART.CLOAK);
  check('one starts at the bottom', a.level === 0 && a.charge === ARTIFACTS[ART.CLOAK].max);
  let grew = 0;
  for (let n = 0; n < 200; n++) if (feed(a, 'use')) grew++;
  check('using it raises it', a.level > 0, `level ${a.level}`);
  check('and it stops at the top', a.level === MAX_ART_LEVEL, `level ${a.level}`);
  check('a higher level holds more charges',
    artMax(ARTIFACTS[ART.CLOAK], 5) > artMax(ARTIFACTS[ART.CLOAK], 0));

  const b = makeArtifact(ART.SANDALS);
  check('feeding one the wrong thing does nothing', !feed(b, 'use') && b.level === 0);
  for (let n = 0; n < 200; n++) feed(b, 'grass');
  check('but the right thing works', b.level > 0, `level ${b.level}`);
}

// --- recharging -------------------------------------------------------------
{
  const a = makeArtifact(ART.CLOAK);
  a.charge = 0;
  let ticks = 0;
  while (a.charge === 0 && ticks < ARTIFACTS[ART.CLOAK].refill * 3) { tickArtifact(a); ticks++; }
  check('an empty one fills back up', a.charge === 1, `after ${ticks} ticks`);
  const passive = makeArtifact(ART.SANDALS);
  check('a passive one has nothing to recharge', !tickArtifact(passive));
}

// --- naming and uniqueness --------------------------------------------------
{
  const app = makeAppearances(9);
  const known = { potions: [], scrolls: [], rings: [], wands: [] };
  const a = makeArtifact(ART.HORN);
  check('an artifact is obvious on sight',
    itemLabel(a, app, known) === 'HORN OF PLENTY', itemLabel(a, app, known));
  a.level = 4;
  check('and shows how far you have taken it',
    itemLabel(a, app, known) === 'HORN OF PLENTY +4');
  check('no two artifacts stack',
    stackKey(makeArtifact(ART.HORN)) !== stackKey(makeArtifact(ART.CAPE)));

  const rng = rngFor(77);
  const taken = ART_IDS.slice(0, ART_IDS.length - 1);
  const last = rollArtifact(10, rng, taken);
  check('one already found never turns up again', last.kind === ART_IDS[ART_IDS.length - 1]);
  check('and when they are all found, none does', rollArtifact(10, rng, ART_IDS) === null);
}

// --- they turn up as prizes, not floor litter --------------------------------
{
  const rng = rngFor(2024);
  let asPrize = 0;
  for (let n = 0; n < 3000; n++) if (rollPrize(12, rng, []).type === ITEM.ARTIFACT) asPrize++;
  check('artifacts turn up on pedestals', asPrize > 100, `${asPrize}/3000 prizes`);
  check('one is worth a great deal', itemValue(makeArtifact(ART.CLOAK)) > 300);
}

// --- a live hero -------------------------------------------------------------
function hero(kind, level = 0) {
  const g = new Game('ARTI');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
  idle(4);
  const f = g.floor(1);
  if (kind) {
    p.equip.artifact = makeArtifact(kind);
    p.equip.artifact.level = level;
    p.equip.artifact.charge = artMax(ARTIFACTS[kind], level);
    g.recalc(p);
  }
  // recalc derives maxHp from class, level and stats, so give the hero room to
  // take a hit only after it has run
  p.maxHp = 300;
  p.hp = 300;
  p.invuln = 600;
  return { g, p, f, idle };
}

// wearing one
{
  const { g, p } = hero(null);
  check('a fresh hero carries no artifact', !p.equip.artifact);
  const art = makeArtifact(ART.CAPE);
  p.bag[0] = { key: stackKey(art), item: art, count: 1 };
  g.invOp(p, 'use', 0);
  check('taking one up fills the slot', p.equip.artifact?.kind === ART.CAPE);
  g.invOp(p, 'unequip', 4);
  check('and it comes off again', !p.equip.artifact);
  check('back into the pack', p.bag.some(s => s?.item?.kind === ART.CAPE));
}

// every active one fires without falling over
{
  const used = [];
  for (const id of ART_IDS) {
    if (!ARTIFACTS[id].active) { used.push(id); continue; }
    const { g, p, f } = hero(id, 3);
    let threw = null;
    try {
      g.useArtifact(p);
      for (let i = 0; i < 30; i++) { g.step(); g.clearTransient(); }
    } catch (err) { threw = err; }
    if (threw) check(`${ARTIFACTS[id].name} works`, false, String(threw.message).slice(0, 70));
    else used.push(id);
  }
  check('every artifact in the table works without throwing',
    used.length === ART_IDS.length, `${used.length}/${ART_IDS.length}`);
}

// using one spends a charge and feeds it
{
  const { g, p } = hero(ART.CLOAK, 0);
  const before = p.equip.artifact.charge;
  g.useArtifact(p);
  check('using one spends a charge', p.equip.artifact.charge === before - 1);
  check('and hides you', p.invis > 0, `${p.invis} ticks`);
  p.equip.artifact.charge = 0;
  const exp = p.equip.artifact.exp;
  g.useArtifact(p);
  check('an empty one does nothing', p.equip.artifact.exp === exp);
}

// a passive one refuses to be triggered
{
  const { g, p } = hero(ART.SANDALS);
  g.useArtifact(p);
  check('a passive artifact has no button', p.equip.artifact.level === 0);
}

// the hourglass stops the floor
{
  const { g, p, f } = hero(ART.HOURGLASS, 2);
  const mobs = f.ents.filter(e => isMob(e.kind) && !e.dead);
  g.useArtifact(p);
  check('the hourglass stops everything but you',
    mobs.length > 0 && mobs.every(e => BF.has(e, B.FROZEN)), `${mobs.length} stopped`);
}

// the chalice costs you blood and pays it back
{
  const { g, p } = hero(ART.CHALICE, 0);
  p.hp = 200;
  p.invuln = 0;
  g.useArtifact(p);
  check('the chalice takes your blood', p.hp < 200, `hp ${p.hp}`);
  check('and gives regeneration back', BF.has(p, B.REGEN));
  check('drinking from it is what raises it', p.equip.artifact.level > 0 || p.equip.artifact.exp > 0);
}

// the talisman reveals what the floor is hiding
{
  const { g, p, f } = hero(ART.TALISMAN, 2);
  // stand well clear of the map edge, or the tiles we plant wrap round a row
  p.x = 12 * 16; p.y = 14 * 16;
  p.fovTile = -1;
  const here = tileUnder(p, PLAYER_BOX);
  f.set(idx(tx(here) + 2, ty(here)), TT.TRAP_HIDDEN);
  f.set(idx(tx(here) - 2, ty(here)), TT.SECRET_DOOR);
  g.useArtifact(p);
  check('the talisman finds the trap', f.tiles[idx(tx(here) + 2, ty(here))] === TT.TRAP);
  check('and the hidden door', f.tiles[idx(tx(here) - 2, ty(here))] === TT.DOOR);
}

// the rose calls up something that fights
{
  const { g, p, f, idle } = hero(ART.ROSE, 2);
  g.useArtifact(p);
  const spirit = f.ents.find(e => e.kind === KIND.SPIRIT);
  check('the rose calls someone up', !!spirit);
  spirit.life = 1;
  idle(3);
  check('and they do not stay', spirit.dead);
}

// the beacon remembers a place and brings you back
{
  const { g, p, f } = hero(ART.BEACON, 1);
  const home = { x: p.x, y: p.y };
  g.useArtifact(p);
  check('the first use marks the spot', !!p.equip.artifact.beacon);
  p.x = home.x + 120; p.y = home.y + 60;
  g.useArtifact(p);
  check('the second brings you back',
    Math.abs(p.x - home.x) < 2 && Math.abs(p.y - home.y) < 2, `${p.x},${p.y}`);
}

// the cape answers whoever hit you
{
  const { g, p, f } = hero(ART.CAPE, 2);
  g.useArtifact(p);
  check('the cape bristles', p.thorns > 0);
  const e = f.ents.find(x => isMob(x.kind) && !x.dead);
  e.hp = e.maxHp = 400;
  e.flash = 0;
  p.invuln = 0;
  g.hurtPlayer(p, 20, e.x, e.y, e);
  check('and hitting you hurts them', e.hp < 400, `hp ${e.hp}`);
}

// the armband takes a bigger cut
{
  const plain = hero(null);
  plain.p.gold = 0;
  plain.g.take(plain.p, plain.f, { type: ITEM.GOLD, amount: 100 });

  const thief = hero(ART.ARMBAND, 6);
  thief.p.gold = 0;
  thief.g.take(thief.p, thief.f, { type: ITEM.GOLD, amount: 100 });
  check('the armband takes a bigger cut', thief.p.gold > plain.p.gold,
    `${plain.p.gold} -> ${thief.p.gold}`);
  check('and counting coin is what raises it', thief.p.equip.artifact.exp > 0 ||
    thief.p.equip.artifact.level > 0);
}

// the sandals mend you while you stand in grass
{
  const { g, p, f, idle } = hero(ART.SANDALS, 3);
  const here = tileUnder(p, PLAYER_BOX);
  f.set(here, TT.GRASS);
  p.hp = 100;
  const exp0 = p.equip.artifact.exp;
  for (let i = 0; i < 80; i++) {
    p.invuln = 600;
    f.set(tileUnder(p, PLAYER_BOX), TT.GRASS);
    g.step(); g.clearTransient();
  }
  check('grass underfoot feeds the sandals',
    p.equip.artifact.exp > exp0 || p.equip.artifact.level > 3);
  check('and mends you as you go', p.hp > 100, `hp ${p.hp}`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall artifact checks passed');
process.exit(fails ? 1 : 0);
