// The four people down here, and the one thing each of them wants.
import { Game } from '../shared/game.js';
import { QUEST, QUESTS, QUEST_IDS, QSTATE, questForDepth, questIndex, questById } from '../shared/quests.js';
import { KIND, isMob, isNpc, isBoss, PLAYER_BOX } from '../shared/constants.js';
import { ITEM, stackKey } from '../shared/items.js';
import { rngFor, TT } from '../shared/terrain.js';
import { tileUnder } from '../shared/physics.js';
import { MOBS } from '../shared/mobs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the table --------------------------------------------------------------
check('four of them', QUEST_IDS.length === 4);
check('each has something to say at every stage',
  QUEST_IDS.every(id => {
    const q = QUESTS[id];
    return q.name && q.ask && q.nag && q.done && q.reward;
  }));
check('each asks for one thing or the other',
  QUEST_IDS.every(id => ['slay', 'fetch'].includes(QUESTS[id].kind)));
check('each belongs to one chapter',
  QUEST_IDS.every(id => QUESTS[id].where.length === 3));
check('and no two share a floor',
  new Set(QUEST_IDS.flatMap(id => QUESTS[id].where)).size ===
  QUEST_IDS.reduce((n, id) => n + QUESTS[id].where.length, 0));
check('they survive the round trip to the wire',
  QUEST_IDS.every(id => questById(questIndex(id)) === id) && questById(0) === null);

// --- where they turn up ------------------------------------------------------
{
  const rng = rngFor(1234);
  const onDepth = {};
  for (let n = 0; n < 3000; n++) {
    for (let d = 1; d <= 25; d++) {
      const id = questForDepth(d, rng);
      if (id) (onDepth[d] ??= new Set()).add(id);
    }
  }
  const floors = Object.keys(onDepth).map(Number).sort((a, b) => a - b);
  check('nobody waits outside their own chapter',
    floors.every(d => QUEST_IDS.some(id => QUESTS[id].where.includes(d))),
    `floors ${floors.join(',')}`);
  check('and every one of them can turn up somewhere',
    new Set(Object.values(onDepth).flatMap(s => [...s])).size === QUEST_IDS.length);
}

// --- a live floor ------------------------------------------------------------
/** Walk down until the named quest has actually been placed. */
function findNpc(id) {
  const q = QUESTS[id];
  for (const code of ['QST0', 'QST1', 'QST2', 'QST3', 'QST4', 'QST5', 'QST6', 'QST7']) {
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
    for (const depth of q.where) {
      while (p.depth < depth) { g.descend(p, true); idle(4); }
      idle(8);
      const f = g.floor(depth);
      const npc = f.ents.find(e => e.quest === id && !e.dead);
      if (npc) {
        p.maxHp = 900; p.hp = 900; p.invuln = 9999;
        return { g, p, f, npc, idle };
      }
    }
  }
  return null;
}

for (const id of QUEST_IDS) {
  const q = QUESTS[id];
  const found = findNpc(id);
  if (!found) { check(`${q.name} turns up somewhere in their chapter`, false); continue; }
  check(`${q.name} turns up somewhere in their chapter`, true, `floor ${found.f.depth}`);

  const { g, p, f, npc, idle } = found;
  check(`  they stand still and will not hurt you`,
    MOBS[npc.kind].harmless === true && MOBS[npc.kind].speed === 0);
  check(`  and are not counted as a monster to be cleared`, isNpc(npc.kind));

  // walk up and speak: the first time is the asking
  p.x = npc.x; p.y = npc.y;
  g.interact(p);
  check('  speaking to them takes the job on', g.quests[id] === QSTATE.TAKEN);

  // speaking again before it is done just gets you nagged
  g.interact(p);
  check('  and speaking again before it is done changes nothing',
    g.quests[id] === QSTATE.TAKEN);

  // now actually do it
  if (q.kind === 'fetch') {
    const item = { type: ITEM.QUEST, kind: id, name: q.item };
    p.bag[0] = { key: stackKey(item), item, count: 1 };
  } else if (q.need) {
    f.questCount = q.need;
  } else {
    f.quarrySlain = true;
  }

  // A fetch quest takes the item out of the pack and puts the reward in, so
  // counting slots nets to zero; compare what is actually in them.
  const snapshot = () => ({
    gold: p.gold,
    bag: JSON.stringify(p.bag.map(sl => sl && [sl.item.type, sl.item.kind, sl.count])),
    w: p.equip.weapon.upgrade,
    a: p.equip.armor.upgrade,
    floor: f.ents.filter(e => e.kind === KIND.ITEM && !e.dead).length,
  });
  const before = snapshot();
  g.interact(p);
  check('  bringing it back finishes the job', g.quests[id] === QSTATE.DONE);

  const after = snapshot();
  const paid = after.gold > before.gold || after.bag !== before.bag ||
               after.w > before.w || after.a > before.a ||
               after.floor > before.floor;
  check('  and they pay for it', paid);

  // and they have nothing more to say
  g.interact(p);
  check('  afterwards they are done with you', g.quests[id] === QSTATE.DONE);
}

// --- a fetch quest actually leaves the thing lying about ---------------------
{
  const found = findNpc(QUEST.WANDMAKER);
  if (found) {
    const { f } = found;
    check('the wandmaker leaves the dust somewhere on the floor',
      f.ents.some(e => e.item?.type === ITEM.QUEST && e.item.kind === QUEST.WANDMAKER));
  } else {
    check('the wandmaker leaves the dust somewhere on the floor', false, 'no wandmaker found');
  }
}

// --- a slay quest actually marks something ----------------------------------
{
  const found = findNpc(QUEST.GHOST);
  if (found) {
    const { g, f, p } = found;
    const quarry = f.ents.find(e => e.quarry === QUEST.GHOST && !e.dead);
    check('the ghost marks one creature as the one it wants', !!quarry);
    if (quarry) {
      check('and it is more than its kind', !!quarry.champ);
      quarry.flash = 0;
      g.hurtMob(quarry, 99999, 0, f, p);
      for (let i = 0; i < 4; i++) { g.step(); g.clearTransient(); }
      check('killing it is noticed', f.quarrySlain === true);
    }
  } else {
    check('the ghost marks one creature as the one it wants', false, 'no ghost found');
  }
}

// --- nobody asks the same favour twice --------------------------------------
{
  const found = findNpc(QUEST.GHOST);
  if (found) {
    const { g, p, idle } = found;
    const asked = Object.keys(g.quests).length;
    // walk the rest of the ghost's chapter; they should not reappear
    for (let d = p.depth + 1; d <= 4; d++) { g.descend(p, true); idle(10); }
    const npcs = [2, 3, 4].flatMap(d => g.floors.has(d)
      ? g.floor(d).ents.filter(e => e.quest === QUEST.GHOST && !e.dead) : []);
    check('the same ghost never turns up twice', npcs.length <= 1, `${npcs.length} of them`);
  }
}

console.log(fails ? `\n${fails} FAILURES` : '\nall quest checks passed');
process.exit(fails ? 1 : 0);
