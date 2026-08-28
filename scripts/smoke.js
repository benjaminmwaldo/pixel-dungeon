// Headless checks against the real simulation: does a party spawn, fight,
// loot, descend, and can a boss floor be finished?
import { Game } from '../shared/game.js';
import { IN, KIND, CLASSES, isMob, isBoss } from '../shared/constants.js';
import { TT, MAX_DEPTH, regionOf, LEVEL_LEN } from '../shared/terrain.js';
import { tileToPixel, tileUnder } from '../shared/physics.js';
import { PLAYER_BOX } from '../shared/constants.js';
import { ITEM } from '../shared/items.js';
import { MOBS, BOSS_OF } from '../shared/mobs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

const g = new Game('TEST');
const a = g.addPlayer(1, 'BEN');
const b = g.addPlayer(2, 'JASON');
g.begin();

const hold = (p, bits, n) => {
  for (let i = 0; i < n; i++) { p.queue.push({ seq: ++p.seq, bits }); g.step(); g.clearTransient(); }
};
const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };

check('the party starts on floor 1', a.depth === 1 && b.depth === 1);
check('classes are handed out, no duplicates', a.cls !== b.cls, `${a.cls} / ${b.cls}`);
check('each hero has their class hit points', a.maxHp === CLASSES[a.cls].hp);

// --- the floor is alive ----------------------------------------------------
idle(5);
let f1 = g.floor(1);
check('floor 1 populated itself', f1.ents.length > 0, `${f1.ents.length} entities`);
check('and it has monsters on it', f1.ents.some(e => isMob(e.kind)));
const mobsBefore = f1.ents.filter(e => isMob(e.kind)).map(e => `${Math.round(e.x)},${Math.round(e.y)}`).join('|');
idle(60);
const mobsAfter = f1.ents.filter(e => isMob(e.kind)).map(e => `${Math.round(e.x)},${Math.round(e.y)}`).join('|');
check('monsters move about', mobsBefore !== mobsAfter);

// --- walking opens doors ---------------------------------------------------
let doorOpened = false;
for (let i = 0; i < LEVEL_LEN; i++) if (f1.tiles[i] === TT.DOOR) { doorOpened = true; break; }
check('the floor has shut doors to open', doorOpened);

// --- a doorway you meet at an angle must still open ------------------------
{
  const { boxBlocker } = await import('../shared/physics.js');
  const { idx } = await import('../shared/terrain.js');
  const probe = new Uint8Array(1024).fill(TT.WALL);
  probe[idx(3, 18)] = TT.FLOOR;
  probe[idx(3, 17)] = TT.DOOR;
  // a hitbox straddling two columns, pushing up into the door
  const hit = boxBlocker(probe, 44, 287, 10, 10, 'walk');
  check('a door is reported over the wall beside it', hit === idx(3, 17),
    `got tile ${hit}`);
}

// --- melee kills and pays out ---------------------------------------------
const victim = f1.ents.find(e => isMob(e.kind));
const spot = { x: victim.x, y: victim.y + 14 };
a.x = spot.x; a.y = spot.y; a.dir = 0; a.invuln = 9999;
const xp0 = a.xp, lvl0 = a.level;
// invuln stops blows, not traps or poison — and this check is about whether a
// swing kills, not whether the hero survives the walk to the monster
for (let i = 0; i < 200 && !victim.dead; i++) {
  a.x = victim.x; a.y = victim.y + 13; a.dir = 0; a.invuln = 9999;
  a.hp = a.maxHp; a.ghost = false; a.buffs = {};
  // teleporting onto arbitrary tiles can drop the hero through a weak floor
  a.depth = 1;
  a.queue.push({ seq: ++a.seq, bits: IN.A }); g.step();
  a.queue.push({ seq: ++a.seq, bits: 0 }); g.step();
  g.clearTransient();
}
check('a monster can be cut down', victim.dead);
check('and killing it pays experience', a.xp > xp0 || a.level > lvl0, `xp ${xp0} -> ${a.xp}`);

// --- loot ------------------------------------------------------------------
// The fight above can leave the hero on the floor — poisoned, burning, or
// outright dead. None of the checks below are about surviving it, so put the
// hero back on their feet first, and again before anything that matters.
// If both heroes go down the run ends, and the simulation then refuses every
// action — which would look like a dozen unrelated failures below.
function steady(hp = null) {
  for (const h of g.players.values()) {
    h.ghost = false;
    h.reviveT = 0;
    h.buffs = {};
    h.effects = null;
    h.invuln = 600;
    h.hp = h.maxHp;
  }
  g.state = 'play';
  g.overTimer = 0;
  // a wipe rebuilds the dungeon, which leaves the captured floor orphaned
  f1 = g.floor(a.depth);
  if (hp !== null) a.hp = hp;
}
steady();
g.dropItem(f1, tileUnder(a, PLAYER_BOX), { type: ITEM.GOLD, amount: 25 });
const gold0 = a.gold;
idle(12);
// a slain monster may have left its own coins underfoot, so allow more
check('gold is picked up by walking over it', a.gold >= gold0 + 25, `${gold0} -> ${a.gold}`);

g.dropItem(f1, tileUnder(a, PLAYER_BOX), { type: ITEM.POTION, kind: 'healing' });
idle(12);
check('a potion goes in the pack',
  a.bag.some(s => s && s.item.type === ITEM.POTION && s.item.kind === 'healing'));
steady(1);
// The hero may have swept up someone else's potion on the way here, so pick
// the healing one rather than the first bottle in the pack.
const potSlot = a.bag.findIndex(s => s && s.item.type === ITEM.POTION &&
  s.item.kind === 'healing');
g.useSlot(a, potSlot);
check('drinking it heals', a.hp > 1, `hp=${a.hp}`);
check('and identifies the potion for the party', g.known.potions.includes('healing'));

// --- the pack --------------------------------------------------------------
{
  const before = a.equip.weapon.tier;
  g.take(a, f1, { type: ITEM.WEAPON, tier: 4, upgrade: 1 });
  // the hero may already be carrying a weapon off the floor, so find the one
  // that was just handed over
  const wSlot = a.bag.findIndex(s => s && s.item.type === ITEM.WEAPON &&
    s.item.tier === 4 && s.item.upgrade === 1);
  check('better gear waits in the pack rather than auto-equipping',
    wSlot >= 0 && a.equip.weapon.tier === before);
  g.invOp(a, 'equip', wSlot);
  check('equipping it swaps the old one back into the pack',
    a.equip.weapon.tier === 4 && a.bag[wSlot]?.item.tier === before,
    `now tier ${a.equip.weapon.tier}`);

  const src = a.bag.findIndex(s => s && s.item.type === ITEM.FOOD);
  const dst = a.bag.findIndex((s, i) => s === null && i > src);
  if (src >= 0 && dst >= 0) {
    g.invOp(a, 'swap', src, dst);
    check('items can be moved between slots', a.bag[dst]?.item.type === ITEM.FOOD);
  }

  const dropSlot = a.bag.findIndex(s => s && s.item.type === ITEM.FOOD);
  const floorBefore = f1.ents.filter(e => e.kind === KIND.ITEM).length;
  g.invOp(a, 'drop', dropSlot);
  check('dropping puts it back on the floor for a friend',
    f1.ents.filter(e => e.kind === KIND.ITEM).length === floorBefore + 1);
}

// --- perks -----------------------------------------------------------------
{
  const hpBefore = a.maxHp;
  a.perkPoints = 4;
  g.spendPerk(a, 'thickSkin');
  check('a perk with an unmet prerequisite is refused', !a.perks.thickSkin);
  g.spendPerk(a, 'tough');
  check('a root perk can be learned', a.perks.tough === 1);
  check('and it changes the hero', a.maxHp === hpBefore + 5, `${hpBefore} -> ${a.maxHp}`);
  g.spendPerk(a, 'thickSkin');
  check('the prerequisite now opens the branch', a.perks.thickSkin === 1);
  check('armour went up', a.stats.armour === 2);
  check('points were spent', a.perkPoints === 2, `${a.perkPoints} left`);

  g.spendPerk(a, 'arcanePower');
  check('you cannot spend in another class tree', !a.perks.arcanePower);

  const lvl = a.level, pts = a.perkPoints;
  g.gainXp(a, 9999);
  check('levelling up hands out perk points', a.level > lvl && a.perkPoints > pts,
    `level ${lvl}->${a.level}, points ${pts}->${a.perkPoints}`);
}

// --- fog of war hides what you cannot see ---------------------------------
const snap = g.snapshotFor(a);
const totalMobs = f1.ents.filter(e => isMob(e.kind)).length;
check('the snapshot only carries what is in sight',
  snap.e.length <= totalMobs, `${snap.e.length} sent of ${totalMobs} alive`);
check('the snapshot stays small', JSON.stringify(snap).length < 3000,
  `${JSON.stringify(snap).length} bytes`);

// --- descending ------------------------------------------------------------
steady();
a.depth = 1; b.depth = 1;
f1 = g.floor(1);
const exitPix = tileToPixel(f1.level.exit, PLAYER_BOX);
a.x = exitPix.x; a.y = exitPix.y;
g.step();
g.interact(a);
check('standing on the stairs and acting descends', a.depth === 2, `depth ${a.depth}`);
check('the other hero stays where they were', b.depth === 1);
idle(5);
check('the new floor populates', g.floor(2).ents.length > 0);
check('a floor packet is queued for the client', a.needFloor === true || a.depth === 2);

// --- ascending back up -----------------------------------------------------
const upPix = tileToPixel(g.floor(2).level.entrance, PLAYER_BOX);
a.x = upPix.x; a.y = upPix.y;
g.step();
g.interact(a);
check('and the stairs up take you back', a.depth === 1);

// --- every region can be reached and has its boss --------------------------
for (const depth of [5, 10, 15, 20, 25]) {
  a.depth = depth;
  a.needFloor = true;
  const f = g.floor(depth);
  const px = tileToPixel(f.level.entrance, PLAYER_BOX);
  a.x = px.x; a.y = px.y;
  a.invuln = 99999;
  idle(3);
  const boss = f.ents.find(e => isBoss(e.kind));
  const region = regionOf(depth);
  check(`floor ${depth} (${region.key}) has its boss`, !!boss,
    boss ? MOBS[boss.kind].name : 'none');
  if (depth < 25) {
    const sealed = f.tiles[f.level.exit] === TT.LOCKED_EXIT;
    check(`floor ${depth} keeps the way down sealed`, sealed);
  }
}

// --- killing a boss unseals the stairs -------------------------------------
a.depth = 5;
const f5 = g.floor(5);
const boss5 = f5.ents.find(e => isBoss(e.kind));
a.invuln = 99999;
for (let i = 0; i < 4000 && boss5 && !boss5.dead; i++) {
  g.hurtMob(boss5, 40, 0, f5, a);
  boss5.flash = 0;
  g.step(); g.clearTransient();
}
check('the chapter boss can be brought down', boss5.dead);
check('and that unseals the way down', f5.tiles[f5.level.exit] === TT.EXIT);

// --- falling and being helped up ------------------------------------------
b.depth = 1; b.invuln = 0;
g.hurtPlayer(b, 9999, b.x + 20, b.y);
check('a hero at zero becomes a spirit', b.ghost);
a.depth = 1; a.ghost = false; a.hp = a.maxHp;
for (let i = 0; i < 90; i++) { a.x = b.x; a.y = b.y; g.step(); g.clearTransient(); }
check('standing on them brings them back', !b.ghost, `hp=${b.hp}`);

// --- a party wipe must restart AND tell the clients ------------------------
{
  a.depth = 1; b.depth = 1;
  a.invuln = 0; b.invuln = 0;
  a.ghost = false; b.ghost = false;
  g.hurtPlayer(a, 9999, a.x + 20, a.y);
  g.hurtPlayer(b, 9999, b.x + 20, b.y);
  g.step();
  check('a wiped party ends the run', g.state === 'over', g.state);
  g.announceStart = false;
  for (let i = 0; i < 300 && g.state !== 'play'; i++) { g.step(); g.clearTransient(); }
  check('the dungeon starts over on its own', g.state === 'play');
  check('and the clients are told to begin again', g.announceStart === true);
  check('heroes come back on their feet', !a.ghost && a.depth === 1 && a.hp > 0);
}

// --- nothing on the wire is ever at nowhere ---------------------------------
// A non-finite coordinate encodes as null and the client then draws the thing
// nowhere, silently. Cheap to check, and impossible to notice by eye.
{
  steady();
  let bad = 0;
  for (let i = 0; i < 400; i++) {
    g.step();
    const snap = g.snapshotFor(a);
    const coords = [
      ...snap.e.flatMap(e => [e[2], e[3]]),
      ...snap.it.flatMap(e => [e[1], e[2]]),
      ...snap.o.flatMap(e => [e[1], e[2]]),
      snap.me[0], snap.me[1],
    ];
    if (coords.some(v => !Number.isFinite(v))) bad++;
    g.clearTransient();
  }
  check('every position on the wire is a real number', bad === 0, `${bad} bad frames`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall checks passed');
process.exit(fails ? 1 : 0);
