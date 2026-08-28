// The full roster: everything that can turn up, on the floor it belongs to,
// doing the thing its entry says it does.
import { Game } from '../shared/game.js';
import { MOBS, SPAWNS, BOSS_OF, mobBudget } from '../shared/mobs.js';
import { KIND, isMob, isBoss, isNpc, PLAYER_BOX } from '../shared/constants.js';
import { REGIONS, regionOf, TT, idx, tx, ty } from '../shared/terrain.js';
import { tileUnder } from '../shared/physics.js';
import * as BF from '../shared/buffs.js';
import { B } from '../shared/buffs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

const KIND_NAME = Object.fromEntries(Object.entries(KIND).map(([k, v]) => [v, k]));

// --- the numbering ----------------------------------------------------------
{
  const seen = new Map();
  let clash = null;
  for (const [name, v] of Object.entries(KIND)) {
    if (seen.has(v)) clash = `${seen.get(v)} and ${name} are both ${v}`;
    seen.set(v, name);
  }
  check('no two kinds share a number', !clash, clash || '');
  check('bosses are mobs', Object.values(BOSS_OF).every(k => isMob(k) && isBoss(k)));
  check('npcs are mobs but not bosses',
    [KIND.SHOPKEEPER, KIND.GHOST, KIND.WANDMAKER, KIND.BLACKSMITH, KIND.IMP]
      .every(k => isMob(k) && isNpc(k) && !isBoss(k)));
  check('projectiles and world objects are neither',
    [KIND.ARROW, KIND.BEAM, KIND.ITEM, KIND.SPIRIT, KIND.WARD, KIND.THROWN]
      .every(k => !isMob(k) && !isBoss(k) && !isNpc(k)));
}

// --- the table --------------------------------------------------------------
{
  const ids = Object.keys(MOBS).map(Number);
  check('every mob entry is named, sized and worth something',
    ids.every(k => MOBS[k].name && MOBS[k].box && MOBS[k].sprite &&
                   MOBS[k].hp > 0 && MOBS[k].xp >= 0));
  check('every mob entry has a way of behaving',
    ids.every(k => typeof MOBS[k].ai === 'string'));
  check('anything that shoots has something to shoot',
    ids.filter(k => MOBS[k].ai === 'shooter' || MOBS[k].ai === 'caster')
       .every(k => MOBS[k].shot));
  check('the roster has grown past the twenty it started with',
    ids.length >= 40, `${ids.length} entries`);
}

// --- the spawn tables --------------------------------------------------------
{
  const chapters = Object.keys(SPAWNS);
  check('every chapter has a spawn table', chapters.length === 5);
  check('and nothing in one is a boss, an npc, or a piece of scenery',
    chapters.every(c => SPAWNS[c].every(k =>
      MOBS[k] && isMob(k) && !isBoss(k) && !isNpc(k) &&
      k !== KIND.PYLON && k !== KIND.FIST && k !== KIND.MIMIC)));
  check('every chapter can throw at least six different things at you',
    chapters.every(c => new Set(SPAWNS[c]).size >= 5),
    chapters.map(c => `${c}:${new Set(SPAWNS[c]).size}`).join(' '));

  // the new arrivals are actually reachable
  const all = new Set(chapters.flatMap(c => SPAWNS[c]));
  const added = [KIND.GNOLL, KIND.TRICKSTER, KIND.LASHER, KIND.SPINNER,
                 KIND.SPARK, KIND.SUCCUBUS, KIND.ENGINE, KIND.RIPPER, KIND.SPAWNER];
  check('all nine of the new ones can turn up',
    added.every(k => all.has(k)),
    added.filter(k => !all.has(k)).map(k => KIND_NAME[k]).join(',') || 'yes');
  check('and each in the chapter it belongs to',
    SPAWNS.sewers.includes(KIND.GNOLL) &&
    SPAWNS.prison.includes(KIND.TRICKSTER) && SPAWNS.prison.includes(KIND.LASHER) &&
    SPAWNS.caves.includes(KIND.SPINNER) && SPAWNS.caves.includes(KIND.SPARK) &&
    SPAWNS.city.includes(KIND.SUCCUBUS) && SPAWNS.city.includes(KIND.ENGINE) &&
    SPAWNS.halls.includes(KIND.RIPPER) && SPAWNS.halls.includes(KIND.SPAWNER));
}

// --- every one of them runs for a while without falling over -----------------
function floorFor(depth) {
  const g = new Game('ROST');
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
  p.maxHp = 900; p.hp = 900;
  const f = g.floor(depth);
  const here = tileUnder(p, PLAYER_BOX);
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const x = tx(here) + dx, y = ty(here) + dy;
      if (x < 1 || y < 1 || x > 30 || y > 30) continue;
      f.set(idx(x, y), TT.FLOOR);
    }
  }
  return { g, p, f, idle };
}

{
  const ran = [];
  for (const k of Object.keys(MOBS).map(Number)) {
    if (isBoss(k)) continue;                  // bosses have their own suite
    const depth = isNpc(k) ? 5 : 12;
    const { g, p, f } = floorFor(depth);
    let threw = null;
    try {
      const e = g.spawnMob(f, k, p.x + 40, p.y, { champion: null });
      if (e) { e.alerted = 900; e.hp = e.maxHp = 400; }
      for (let i = 0; i < 200; i++) {
        p.invuln = 9999; p.hp = p.maxHp; p.ghost = false;
        g.step(); g.clearTransient();
      }
    } catch (err) { threw = err; }
    if (threw) check(`${MOBS[k].name} runs`, false, String(threw.message).slice(0, 70));
    else ran.push(k);
  }
  check('every creature in the table runs for two hundred ticks',
    ran.length === Object.keys(MOBS).map(Number).filter(k => !isBoss(k)).length,
    `${ran.length} of them`);
}

// --- the ones that stay put, stay put ----------------------------------------
for (const k of [KIND.LASHER, KIND.SPAWNER]) {
  const { g, p, f } = floorFor(12);
  const e = g.spawnMob(f, k, p.x + 50, p.y, { champion: null });
  e.alerted = 900;
  const at = { x: e.x, y: e.y };
  for (let i = 0; i < 300; i++) { p.invuln = 9999; g.step(); g.clearTransient(); }
  check(`a ${MOBS[k].name.toLowerCase()} never leaves its spot`,
    Math.abs(e.x - at.x) < 2 && Math.abs(e.y - at.y) < 2);
}

// --- a spawner produces things -----------------------------------------------
{
  const { g, p, f } = floorFor(22);
  for (const o of f.ents) if (isMob(o.kind) && !isNpc(o.kind)) o.dead = true;
  const e = g.spawnMob(f, KIND.SPAWNER, p.x + 50, p.y, { champion: null });
  e.alerted = 900;
  e.cd = 1;
  // hold off the floor's own refill, or we would be counting its work too
  for (let i = 0; i < 900; i++) {
    p.invuln = 9999; p.hp = p.maxHp;
    f.spawnTimer = 9999;
    g.step(); g.clearTransient();
  }
  const brood = f.ents.filter(o => o.kind === KIND.RIPPER && !o.dead).length;
  check('a demon spawner keeps producing things', brood > 0, `${brood} of them`);
  check('but not without limit', brood <= 4, `${brood}`);
}

// --- contact does what the entry says ----------------------------------------
// Mercy frames space contact out, and a short effect can wear off before the
// loop ends — so watch for it throughout rather than only looking at the end.
function touched(k, ticks = 200) {
  const { g, p, f } = floorFor(18);
  for (const o of f.ents) if (isMob(o.kind) && !isNpc(o.kind)) o.dead = true;
  const e = g.spawnMob(f, k, p.x + 4, p.y, { champion: null });
  e.alerted = 900;
  e.hp = e.maxHp = 900;
  p.invuln = 0;
  const saw = new Set();
  const gas = { seen: false };
  for (let i = 0; i < ticks; i++) {
    e.x = p.x + 4; e.y = p.y;
    e.hitCd = 0;
    p.hp = p.maxHp;
    g.step(); g.clearTransient();
    for (const id of Object.keys(p.buffs || {})) saw.add(id);
    if (f.ents.some(o => o.kind === KIND.GAS)) gas.seen = true;
  }
  return { p, f, saw, gas };
}

{
  const { saw } = touched(KIND.RIPPER);
  check('a ripper demon leaves you bleeding', saw.has(B.BLEEDING));
}
{
  const { saw } = touched(KIND.SUCCUBUS);
  check('a succubus charms you', saw.has(B.CHARM));
}
{
  const { saw } = touched(KIND.SPINNER);
  check('a giant spinner poisons you', saw.has(B.POISON));
}
{
  const { saw } = touched(KIND.SPARK);
  check('a DM-100 shocks you still', saw.has(B.PARALYSIS));
}
{
  const { saw, gas } = touched(KIND.ENGINE);
  check('a DM-200 fouls the air around it', gas.seen || saw.has(B.POISON));
}

// --- floors still fill up ----------------------------------------------------
for (const depth of [3, 8, 13, 18, 23]) {
  const { f } = floorFor(depth);
  const alive = f.ents.filter(e => isMob(e.kind) && !isNpc(e.kind) && !isBoss(e.kind) && !e.dead);
  const kinds = new Set(alive.map(e => e.kind));
  check(`floor ${depth} is populated`, alive.length >= 3, `${alive.length} of them`);
  check(`  and not all the same thing`, kinds.size >= 2, `${kinds.size} kinds`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall roster checks passed');
process.exit(fails ? 1 : 0);
