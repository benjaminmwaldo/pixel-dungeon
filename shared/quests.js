// The people you meet down here, and the one thing each of them wants.
//
// One per chapter, on a random floor within it, and each asks for exactly one
// favour. There is no dialogue tree: you walk up, press the same key you use
// for everything else, and they tell you the next thing. That is the whole
// interface, because nothing may pause while three other people are playing.

export const QUEST = {
  GHOST: 'ghost', WANDMAKER: 'wandmaker', BLACKSMITH: 'blacksmith', IMP: 'imp',
};

// where:  the floors this one may stand on
// ask:    what they say when you first walk up
// nag:    what they say while you are still working on it
// done:   what they say when you bring it back
// kind:   'slay' — kill the marked creature; 'fetch' — bring the thing back
export const QUESTS = {
  [QUEST.GHOST]: {
    name: 'A SAD GHOST', npc: 'GHOST', where: [2, 3, 4], kind: 'slay',
    ask: 'SOMETHING WEARS MY FACE. END IT',
    nag: 'IT IS STILL WEARING MY FACE',
    done: 'TAKE WHAT I NO LONGER NEED',
    quarry: 'THE FETID RAT',
    reward: 'gear',
  },
  [QUEST.WANDMAKER]: {
    name: 'THE OLD WANDMAKER', npc: 'WANDMAKER', where: [7, 8, 9], kind: 'fetch',
    ask: 'CORPSE DUST. IT IS ON THIS FLOOR',
    nag: 'NO DUST, NO WORK',
    done: 'THIS ONE HAS BEEN WAITING',
    item: 'CORPSE DUST',
    reward: 'wand',
  },
  [QUEST.BLACKSMITH]: {
    name: 'THE BLACKSMITH', npc: 'BLACKSMITH', where: [12, 13, 14], kind: 'fetch',
    ask: 'DARK GOLD ORE, FROM THIS FLOOR',
    nag: 'NO ORE, NO WORK',
    done: 'HOLD STILL. ONE MOMENT',
    item: 'DARK GOLD ORE',
    reward: 'reforge',
  },
  [QUEST.IMP]: {
    name: 'AN AMBITIOUS IMP', npc: 'IMP', where: [17, 18, 19], kind: 'slay',
    ask: 'SIX BIG ONES. I AM COUNTING',
    nag: 'KEEP GOING. I SAID SIX',
    done: 'A PLEASURE. HERE',
    quarry: 'SIX OF THEM',
    need: 6,
    reward: 'ring',
  },
};

export const QUEST_IDS = Object.keys(QUESTS);

const INDEX = new Map(QUEST_IDS.map((id, i) => [id, i + 1]));
export const questIndex = (id) => INDEX.get(id) ?? 0;
export const questById = (i) => QUEST_IDS[i - 1] ?? null;

/** Which quest, if any, belongs on this floor. */
export function questForDepth(depth, rng) {
  for (const id of QUEST_IDS) {
    const q = QUESTS[id];
    if (!q.where.includes(depth)) continue;
    // one floor out of the chapter's three gets the visitor
    return q.where[rng.int(q.where.length)] === depth ? id : null;
  }
  return null;
}

/** How far along a quest is. */
export const QSTATE = { OFFER: 0, TAKEN: 1, DONE: 2 };
