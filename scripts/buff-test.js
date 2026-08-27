// The buff framework: does an effect actually change the simulation?
import { Game } from '../shared/game.js';
import * as BF from '../shared/buffs.js';
import { B, BUFFS, BUFF_IDS } from '../shared/buffs.js';
import { PLAYER_BOX, isMob } from '../shared/constants.js';
import { POTION, SCROLL } from '../shared/items.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

const g = new Game('BUFF');
const a = g.addPlayer(1, 'BEN');
g.begin();
const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
idle(4);
const f = g.floor(1);

// --- the table itself -------------------------------------------------------
check('every effect has a name and a short tag',
  BUFF_IDS.every(id => BUFFS[id].name && BUFFS[id].short));
check('short tags are unique',
  new Set(BUFF_IDS.map(id => BUFFS[id].short)).size === BUFF_IDS.length);
check('every effect survives the round trip to the wire',
  BUFF_IDS.every(id => BF.buffById(BF.buffIndex(id)) === id));

// --- damage over time -------------------------------------------------------
a.invuln = 0;
const hp0 = a.hp;
BF.apply(a, B.POISON, 200);
idle(60);
check('poison eats away at you', a.hp < hp0, `${hp0} -> ${a.hp}`);
check('and it is still running', BF.has(a, B.POISON));

// --- cleansing --------------------------------------------------------------
BF.apply(a, B.BURNING, 200);
BF.apply(a, B.HASTE, 200);
const cleared = BF.cleanse(a);
check('cleansing takes the bad and leaves the good',
  cleared === 2 && !BF.has(a, B.POISON) && !BF.has(a, B.BURNING) && BF.has(a, B.HASTE),
  `${cleared} lifted`);

// --- movement ---------------------------------------------------------------
idle(2);
check('haste makes you quicker', a.moveMult > 1, `x${a.moveMult.toFixed(2)}`);
BF.clear(a, B.HASTE);
BF.apply(a, B.FROZEN, 100);
idle(2);
check('being frozen stops you dead', a.moveMult === 0 && a.effects.frozen);
BF.clear(a, B.FROZEN);
BF.apply(a, B.CRIPPLE, 100);
idle(2);
check('a crippled hero is slower', a.moveMult > 0 && a.moveMult < 1, `x${a.moveMult.toFixed(2)}`);
BF.clear(a, B.CRIPPLE);

// --- damage maths -----------------------------------------------------------
idle(2);
const mob = f.ents.find(e => isMob(e.kind));
mob.hp = mob.maxHp = 500;
const before = mob.hp;
g.hurtMob(mob, 20, 0, f, a);
const plain = before - mob.hp;
mob.flash = 0;
BF.apply(mob, B.VULNERABLE, 200);
mob.effects = BF.summarise(mob);
const mid = mob.hp;
g.hurtMob(mob, 20, 0, f, a);
const weak = mid - mob.hp;
check('a vulnerable monster takes more', weak > plain, `${plain} -> ${weak}`);

// --- shields ----------------------------------------------------------------
a.invuln = 0; a.hp = a.maxHp;
BF.apply(a, B.BARRIER, 400, 30);
idle(2);
check('a barrier registers', a.shield > 0, `${a.shield} points`);
const full = a.hp;
g.hurtPlayer(a, 10, a.x + 20, a.y);
check('and it soaks the hit instead of your skin', a.hp === full, `hp ${a.hp}`);
check('the barrier is spent down', a.shield < 30, `${a.shield} left`);
BF.clear(a, B.BARRIER);

// --- sight ------------------------------------------------------------------
a.fovTile = -1;
g.refreshFov(a);
let litNormal = 0; for (let i = 0; i < a.fov.length; i++) litNormal += a.fov[i];
BF.apply(a, B.BLINDNESS, 200);
idle(2);
a.fovTile = -1;
g.refreshFov(a);
let litBlind = 0; for (let i = 0; i < a.fov.length; i++) litBlind += a.fov[i];
check('blindness closes your eyes', litBlind < litNormal, `${litNormal} -> ${litBlind} tiles`);
BF.clear(a, B.BLINDNESS);

// --- minds ------------------------------------------------------------------
const runner = f.ents.find(e => isMob(e.kind) && !e.dead);
BF.apply(runner, B.TERROR, 300);
runner.effects = BF.summarise(runner);
check('terror overrides what a monster wants', runner.effects.ai === 'flee');
BF.clear(runner, B.TERROR);

// --- potions and scrolls reach the framework --------------------------------
a.hp = a.maxHp;
g.drink(a, f, POTION.HASTE);
check('a potion of haste hastens you', BF.has(a, B.HASTE));
g.drink(a, f, POTION.LEVITATION);
check('levitation lifts you', BF.has(a, B.LEVITATION));
g.drink(a, f, POTION.MIND_VISION);
check('mind vision arrives', BF.has(a, B.MIND_VISION));
const lvl = a.level;
g.drink(a, f, POTION.EXPERIENCE);
check('a potion of experience levels you', a.level > lvl, `${lvl} -> ${a.level}`);

const { tileUnder } = await import('../shared/physics.js');
const sleepers = f.ents.filter(e => isMob(e.kind));
for (const e of sleepers) a.fov[tileUnder(e, e.box)] = 1;
g.read(a, f, SCROLL.LULLABY);
check('a lullaby puts the floor to sleep',
  sleepers.some(e => BF.has(e, B.SLEEP)), `${sleepers.filter(e => BF.has(e, B.SLEEP)).length} asleep`);

g.read(a, f, SCROLL.TERROR);
check('terror scatters them',
  sleepers.some(e => BF.has(e, B.TERROR)));

// --- expiry -----------------------------------------------------------------
BF.apply(a, B.BLESS, 5);
idle(8);
check('effects run out', !BF.has(a, B.BLESS));

// --- the wire ---------------------------------------------------------------
BF.apply(a, B.BURNING, 100);
BF.apply(a, B.BLESS, 100);
const snap = g.snapshotFor(a);
check('buffs ride along in the snapshot', (snap.bf || []).length >= 2, `${snap.bf.length} sent`);
check('and the snapshot stays small', JSON.stringify(snap).length < 4000,
  `${JSON.stringify(snap).length} bytes`);

console.log(fails ? `\n${fails} FAILURES` : '\nall buff checks passed');
process.exit(fails ? 1 : 0);
