// The five bosses, fought down through their phases. A boss that is only a
// bigger health bar would pass none of this.
import { Game } from '../shared/game.js';
import { MOBS, BOSS_OF } from '../shared/mobs.js';
import { KIND, isMob, isBoss, PLAYER_BOX } from '../shared/constants.js';
import { TT, idx, tx, ty, regionOf, MAX_DEPTH } from '../shared/terrain.js';
import { tileUnder } from '../shared/physics.js';
import * as BF from '../shared/buffs.js';
import { B } from '../shared/buffs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

const BOSSES = [
  [KIND.BOSS_GLUT, 5], [KIND.BOSS_WARDEN, 10], [KIND.BOSS_TYRANT, 15],
  [KIND.BOSS_KING, 20], [KIND.BOSS_UNSLEEPING, 25],
];

// --- the table --------------------------------------------------------------
check('every boss has a scripted fight',
  BOSSES.every(([k]) => MOBS[k].fight && typeof MOBS[k].fight === 'string'));
check('and at least two phases each',
  BOSSES.every(([k]) => (MOBS[k].phases || []).length >= 2));
check('every phase says something',
  BOSSES.every(([k]) => MOBS[k].phases.every(ph => ph.say && ph.at > 0 && ph.at <= 1)));
check('and the thresholds descend',
  BOSSES.every(([k]) => {
    const at = MOBS[k].phases.map(p => p.at);
    return at.every((v, i) => i === 0 || v <= at[i - 1]);
  }));

// --- a live arena -----------------------------------------------------------
function arena(depth) {
  const g = new Game('BOSS');
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
  idle(10);
  const f = g.floor(depth);
  p.maxHp = 900; p.hp = 900; p.invuln = 9999;
  const boss = f.ents.find(e => isBoss(e.kind) && !e.dead);
  return { g, p, f, idle, boss };
}

/** Beat a boss down to a fraction of its health, letting the fight run. */
function grind(g, f, p, boss, to, ticks = 4000) {
  const want = Math.round(boss.maxHp * to);
  for (let i = 0; i < ticks && boss.hp > want && !boss.dead; i++) {
    p.invuln = 9999; p.hp = p.maxHp; p.ghost = false;
    // hit it whether or not it is standing behind something
    boss.flash = 0;
    boss.untouchable = 0;
    const before = boss.shielded;
    boss.shielded = false;
    g.hurtMob(boss, 6, 0, f, p);
    boss.shielded = before;
    g.step(); g.clearTransient();
  }
  return boss.hp / boss.maxHp;
}

// --- each boss reaches every one of its phases --------------------------------
for (const [kind, depth] of BOSSES) {
  const st = MOBS[kind];
  const { g, p, f, boss } = arena(depth);
  if (!boss || boss.kind !== kind) {
    check(`${st.name} is waiting on floor ${depth}`, false, `found ${boss?.kind}`);
    continue;
  }
  const seen = new Set();
  const want = Math.round(boss.maxHp * 0.05);
  let threw = null;
  try {
    for (let i = 0; i < 6000 && boss.hp > want && !boss.dead; i++) {
      p.invuln = 9999; p.hp = p.maxHp; p.ghost = false;
      boss.flash = 0; boss.untouchable = 0;
      const shield = boss.shielded;
      boss.shielded = false;
      g.hurtMob(boss, 4, 0, f, p);
      boss.shielded = shield;
      g.step(); g.clearTransient();
      if (boss.stage !== undefined) seen.add(boss.stage);
    }
  } catch (err) { threw = err; }
  if (threw) {
    check(`${st.name} fights without throwing`, false, String(threw.message).slice(0, 70));
  } else {
    check(`${st.name} passes through all ${st.phases.length} of its phases`,
      seen.size === st.phases.length, `saw ${[...seen].sort().join(',')}`);
  }
}

// --- glut mends in water and bursts when it swells ---------------------------
{
  const { g, p, f, boss } = arena(5);
  const here = tileUnder(boss, boss.box);
  f.set(here, TT.WATER);
  boss.hp = Math.round(boss.maxHp * 0.4);
  const before = boss.hp;
  for (let i = 0; i < 200; i++) {
    p.invuln = 9999;
    f.set(tileUnder(boss, boss.box), TT.WATER);
    g.step(); g.clearTransient();
    if (boss.hp > before) break;
  }
  check('glut mends itself in water', boss.hp > before, `${before} -> ${boss.hp}`);

  // force the pump-up and stand in it
  boss.windup = 2;
  p.x = boss.x + 8; p.y = boss.y + 8;
  p.invuln = 0; p.hp = p.maxHp;
  const hp0 = p.hp;
  for (let i = 0; i < 6; i++) {
    p.x = boss.x + 8; p.y = boss.y + 8;
    g.step(); g.clearTransient();
  }
  check('and when it bursts it takes you with it', p.hp < hp0, `${hp0} -> ${p.hp}`);
}

// --- the warden stops walking and starts appearing ---------------------------
{
  const { g, p, f, boss } = arena(10);
  boss.hp = Math.round(boss.maxHp * 0.4);
  const at = { x: boss.x, y: boss.y };
  let moved = false, laid = 0;
  const traps0 = Object.keys(f.level.traps || {}).length;
  for (let i = 0; i < 600; i++) {
    p.invuln = 9999; p.hp = p.maxHp;
    g.step(); g.clearTransient();
    if (Math.abs(boss.x - at.x) > 40 || Math.abs(boss.y - at.y) > 40) moved = true;
  }
  laid = Object.keys(f.level.traps || {}).length - traps0;
  check('the warden blinks across the arena', moved);
  check('and leaves traps where it was', laid > 0, `${laid} laid`);
}

// --- the tyrant hides behind pylons ------------------------------------------
{
  const { g, p, f, boss } = arena(15);
  boss.hp = Math.round(boss.maxHp * 0.5);
  for (let i = 0; i < 120; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
  const pylons = f.ents.filter(e => e.kind === KIND.PYLON && !e.dead);
  check('the tyrant raises its pylons', pylons.length > 0, `${pylons.length} up`);
  check('and hides behind them', boss.shielded === true);

  boss.flash = 0;
  const hp0 = boss.hp;
  g.hurtMob(boss, 40, 0, f, p);
  const shielded = hp0 - boss.hp;
  for (const py of pylons) { py.flash = 0; g.hurtMob(py, 9999, 0, f, p); }
  for (let i = 0; i < 5; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
  boss.flash = 0;
  const hp1 = boss.hp;
  g.hurtMob(boss, 40, 0, f, p);
  const bare = hp1 - boss.hp;
  check('bringing the pylons down opens it up', bare > shielded, `${shielded} -> ${bare}`);
}

// --- the king comes back without his skin ------------------------------------
{
  const { g, p, f, boss } = arena(20);
  boss.hp = Math.round(boss.maxHp * 0.62);
  for (let i = 0; i < 400; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
  const court = f.ents.filter(e => isMob(e.kind) && !isBoss(e.kind) && !e.dead).length;
  check('the king calls his court up', court > 0, `${court} standing`);

  const dmg0 = boss.dmg;
  boss.hp = Math.round(boss.maxHp * 0.25);
  for (let i = 0; i < 30; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
  check('and then gets back up harder than before', boss.dmg > dmg0, `${dmg0} -> ${boss.dmg}`);
  const left = f.ents.filter(e => isMob(e.kind) && !isBoss(e.kind) && !e.dead).length;
  check('taking his court with him', left < court, `${court} -> ${left}`);
}

// --- the unsleeping puts its hands out first ---------------------------------
{
  const { g, p, f, boss } = arena(25);
  for (let i = 0; i < 60; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
  const fists = f.ents.filter(e => e.kind === KIND.FIST && !e.dead);
  check('the unsleeping reaches out', fists.length > 0, `${fists.length} fists`);
  check('and nothing touches it while a fist stands', boss.shielded === true);

  const at = { x: boss.x, y: boss.y };
  for (let i = 0; i < 120; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
  check('it never moves', Math.abs(boss.x - at.x) < 2 && Math.abs(boss.y - at.y) < 2);

  for (const fist of f.ents.filter(e => e.kind === KIND.FIST && !e.dead)) {
    fist.flash = 0;
    g.hurtMob(fist, 9999, 0, f, p);
  }
  for (let i = 0; i < 3; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
  check('take the hands off and it is open', boss.shielded === false);
}

// --- and a boss can still be killed, which unseals the stairs ----------------
{
  const { g, p, f, boss } = arena(5);
  for (let i = 0; i < 3000 && !boss.dead; i++) {
    p.invuln = 9999; p.hp = p.maxHp;
    boss.flash = 0; boss.untouchable = 0; boss.shielded = false;
    g.hurtMob(boss, 20, 0, f, p);
    g.step(); g.clearTransient();
  }
  check('a boss can be brought down', boss.dead);
  for (let i = 0; i < 10; i++) { g.step(); g.clearTransient(); }
  check('and the way down opens', f.bossDead === true);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall boss checks passed');
process.exit(fails ? 1 : 0);
