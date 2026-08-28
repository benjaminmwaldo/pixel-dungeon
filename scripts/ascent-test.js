// Taking the amulet, carrying it back out, and what the run is remembered for.
import { Game } from '../shared/game.js';
import {
  BADGE, BADGES, BADGE_IDS, CHAL, CHALLENGES, CHAL_IDS,
  packChallenges, unpackChallenges, chalIndex, chalById, isHard,
} from '../shared/badges.js';
import { ITEM, stackKey } from '../shared/items.js';
import { KIND, isMob, isNpc, isBoss, PLAYER_BOX, HUNGER_MAX, DEW_MAX } from '../shared/constants.js';
import { TT, idx, tx, ty, MAX_DEPTH } from '../shared/terrain.js';
import { tileUnder } from '../shared/physics.js';
import { IN } from '../shared/constants.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the tables -------------------------------------------------------------
check('twenty badges', BADGE_IDS.length === 20);
check('each is named and says how to get it',
  BADGE_IDS.every(id => BADGES[id].name && BADGES[id].how));
check('six challenges', CHAL_IDS.length === 6);
check('each is named and says what it takes away',
  CHAL_IDS.every(id => CHALLENGES[id].name && CHALLENGES[id].blurb));
check('challenges pack into one number and come back out',
  CHAL_IDS.every(id => unpackChallenges(packChallenges([id]))[0] === id));
check('and several at once survive it too',
  unpackChallenges(packChallenges(CHAL_IDS)).length === CHAL_IDS.length);
check('a run with none of them is not a hard one', !isHard([]) && isHard([CHAL.DRY]));

// --- a live run --------------------------------------------------------------
function run(challenges = []) {
  const g = new Game('ASCN');
  g.challenges = challenges;
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => {
    for (let i = 0; i < n; i++) {
      p.invuln = 9999; p.hp = p.maxHp; p.ghost = false;
      g.step(); g.clearTransient();
    }
  };
  idle(4);
  p.maxHp = 900; p.hp = 900; p.invuln = 9999;
  return { g, p, idle };
}

// --- badges ------------------------------------------------------------------
{
  const { g, p, idle } = run();
  check('a fresh run has earned nothing', g.badges.length === 0);

  const f = g.floor(1);
  const mob = f.ents.find(e => isMob(e.kind) && !isNpc(e.kind));
  g.killMob(mob, f, p);
  check('killing something is worth a badge', g.badges.includes(BADGE.FIRST_BLOOD));
  g.killMob(f.ents.find(e => isMob(e.kind) && !isNpc(e.kind) && !e.dead), f, p);
  check('and it is only said once', g.badges.filter(b => b === BADGE.FIRST_BLOOD).length === 1);

  g.descend(p, true);
  idle(4);
  check('taking the stairs is worth one too', g.badges.includes(BADGE.FIRST_FLOOR));

  p.gold = 1200;
  g.checkBadges(p);
  check('so is a thousand gold', g.badges.includes(BADGE.RICH));

  p.equip.weapon.upgrade = 6;
  g.checkBadges(p);
  check('and gear at plus five', g.badges.includes(BADGE.ARMED));

  g.brewed = 5;
  g.sown = 10;
  g.champsFelled = 10;
  g.checkBadges(p);
  check('brewing, sowing and giant-killing all count',
    g.badges.includes(BADGE.ALCHEMIST) && g.badges.includes(BADGE.GARDENER) &&
    g.badges.includes(BADGE.CHAMPION));
}

// a run under a challenge earns the defiant badge alongside anything else
{
  const { g, p } = run([CHAL.DRY]);
  const f = g.floor(1);
  g.killMob(f.ents.find(e => isMob(e.kind) && !isNpc(e.kind)), f, p);
  check('doing anything under a challenge is itself worth a badge',
    g.badges.includes(BADGE.DEFIANT));
}

// --- putting a boss down is worth its chapter --------------------------------
{
  const pairs = [
    [KIND.BOSS_GLUT, 5, BADGE.SEWERS], [KIND.BOSS_WARDEN, 10, BADGE.PRISON],
    [KIND.BOSS_TYRANT, 15, BADGE.CAVES], [KIND.BOSS_KING, 20, BADGE.CITY],
    [KIND.BOSS_UNSLEEPING, 25, BADGE.HALLS],
  ];
  let all = true;
  for (const [kind, depth, badge] of pairs) {
    const { g, p, idle } = run();
    while (p.depth < depth) { g.descend(p, true); idle(4); }
    idle(6);
    const f = g.floor(depth);
    const boss = f.ents.find(e => isBoss(e.kind) && !e.dead);
    if (!boss) { all = false; continue; }
    g.killMob(boss, f, p);
    if (!g.badges.includes(badge)) all = false;
  }
  check('each boss is worth its own chapter badge', all);
}

// --- the ascent --------------------------------------------------------------
{
  const { g, p, idle } = run();
  while (p.depth < MAX_DEPTH) { g.descend(p, true); idle(3); }
  idle(6);
  const f = g.floor(MAX_DEPTH);
  check('the run is not on its way up yet', !g.ascending);

  g.take(p, f, { type: ITEM.RELIC });
  check('taking the amulet does not end the run', g.state === 'play');
  check('it starts the way back up', g.ascending === true);
  check('and it goes in your pack', p.bag.some(s => s?.item?.type === ITEM.RELIC));
  check('which is worth a badge', g.badges.includes(BADGE.AMULET));

  // every floor you already cleared fills back up
  const stale = [...g.floors.values()].filter(x => x.populated).length;
  check('every floor you cleared is repopulating', stale === 0, `${stale} still stale`);
}

// the dungeon keeps sending things after you
{
  const { g, p, idle } = run();
  while (p.depth < MAX_DEPTH) { g.descend(p, true); idle(3); }
  idle(6);
  g.take(p, g.floor(MAX_DEPTH), { type: ITEM.RELIC });
  const f = g.floor(MAX_DEPTH);
  const before = f.ents.filter(e => isMob(e.kind) && !isNpc(e.kind) && !e.dead).length;
  g.ascentTimer = 1;
  idle(4);
  const after = f.ents.filter(e => isMob(e.kind) && !isNpc(e.kind) && !e.dead).length;
  check('something else comes looking', after > before, `${before} -> ${after}`);
  check('and what it sends is a champion',
    f.ents.some(e => e.champ && !e.dead));
}

// climbing back out with it wins the run
{
  const { g, p, idle } = run();
  while (p.depth < MAX_DEPTH) { g.descend(p, true); idle(3); }
  idle(6);
  g.take(p, g.floor(MAX_DEPTH), { type: ITEM.RELIC });
  while (p.depth > 1) { g.ascend(p); idle(2); }
  check('you get back to the top', p.depth === 1);
  check('and the run is still going', g.state === 'play');
  g.ascend(p);
  check('walking out with it wins', g.state === 'win');
  check('which is the badge worth having', g.badges.includes(BADGE.ASCENDED));
}

// but not without it
{
  const { g, p, idle } = run();
  while (p.depth < MAX_DEPTH) { g.descend(p, true); idle(3); }
  idle(6);
  g.take(p, g.floor(MAX_DEPTH), { type: ITEM.RELIC });
  while (p.depth > 1) { g.ascend(p); idle(2); }
  for (let i = 0; i < p.bag.length; i++) {
    if (p.bag[i]?.item?.type === ITEM.RELIC) p.bag[i] = null;
  }
  g.ascend(p);
  check('and walking out without it does not', g.state === 'play');
}

// --- the challenges actually take something away -----------------------------
{
  const plain = run();
  const hungry = run([CHAL.HUNGRY]);
  for (const { p } of [plain, hungry]) {
    p.hunger = 0;
    const item = { type: ITEM.FOOD };
    p.bag[0] = { key: stackKey(item), item, count: 1 };
  }
  plain.g.useSlot(plain.p, 0);
  hungry.g.useSlot(hungry.p, 0);
  check('on empty: a ration feeds you half as much',
    hungry.p.hunger < plain.p.hunger, `${plain.p.hunger} -> ${hungry.p.hunger}`);
}
{
  const hit = (chal) => {
    const { g, p } = run(chal);
    p.equip.armor = { type: ITEM.ARMOR, tier: 1, upgrade: 0 };
    g.recalc(p);
    p.maxHp = 900; p.hp = 900; p.invuln = 0;
    g.hurtPlayer(p, 40, p.x + 30, p.y);
    return 900 - p.hp;
  };
  check('thin skinned: everything hurts more', hit([CHAL.FRAGILE]) > hit([]),
    `${hit([])} -> ${hit([CHAL.FRAGILE])}`);
}
{
  const { g, p, idle } = run([CHAL.DRY]);
  const f = g.floor(1);
  p.hp = 100;
  g.take(p, f, { type: ITEM.DEW });
  check('dry: dew does nothing at all', p.hp === 100 && !p.dew);
}
{
  const lit = (chal) => {
    const { g, p, idle } = run(chal);
    while (p.depth < 4) { g.descend(p, true); idle(4); }
    idle(6);
    const f = g.floor(4);
    p.x = 12 * 16; p.y = 14 * 16;
    const here = tileUnder(p, PLAYER_BOX);
    for (let dy = -10; dy <= 10; dy++) {
      for (let dx = -10; dx <= 10; dx++) {
        const x = tx(here) + dx, y = ty(here) + dy;
        if (x < 1 || y < 1 || x > 30 || y > 30) continue;
        f.set(idx(x, y), TT.FLOOR);
      }
    }
    f.feeling = 'none';
    p.fovTile = -1;
    g.refreshFov(p);
    let n = 0;
    for (let i = 0; i < p.fov.length; i++) n += p.fov[i];
    return n;
  };
  const open = lit([]);
  const dark = lit([CHAL.BLIND]);
  check('in the dark: you see less of everything', dark < open, `${open} -> ${dark}`);
}
// resolveMelee only does anything mid-swing, so drive a real attack rather
// than calling it directly
{
  const swing = (chal) => {
    const { g, p } = run(chal);
    p.equip.weapon = { type: ITEM.WEAPON, tier: 5, upgrade: 5 };
    g.recalc(p);
    p.maxHp = 900; p.hp = 900; p.invuln = 9999;
    const f = g.floor(1);
    for (const o of f.ents) if (isMob(o.kind) && !isNpc(o.kind)) o.dead = true;
    const mob = g.spawnMob(f, KIND.RAT, p.x, p.y - 14, { champion: null });
    mob.hp = mob.maxHp = 5000;
    mob.champ = undefined;
    let dealt = 0;
    for (let n = 0; n < 6; n++) {
      // stand below it and face north, the way the smoke test does
      p.x = mob.x; p.y = mob.y + 13; p.dir = 0;
      mob.flash = 0;
      const was = mob.hp;
      p.queue.push({ seq: ++p.seq, bits: IN.A });
      g.step(); g.clearTransient();
      p.queue.push({ seq: ++p.seq, bits: 0 });
      g.step(); g.clearTransient();
      dealt += Math.max(0, was - mob.hp);
    }
    return dealt;
  };
  const armed = swing([]);
  const bare = swing([CHAL.BARE]);
  check('bare handed: the best sword is no better than the worst',
    bare > 0 && bare < armed, `${armed} -> ${bare}`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall ascent checks passed');
process.exit(fails ? 1 : 0);
