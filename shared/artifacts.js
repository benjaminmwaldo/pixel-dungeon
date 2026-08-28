// Artifacts. One slot, and unlike everything else in the dungeon a scroll of
// upgrade does nothing for them — an artifact gets better because you used it,
// and each one wants to be used in its own particular way.
//
// `charge` is spent by the active ones and comes back over time. `grow` names
// what feeds it: spending charges, walking through grass, finding hidden
// things, or bleeding into it.

export const ART = {
  CLOAK: 'cloak of shadows', HORN: 'horn of plenty', CHALICE: 'chalice of blood',
  TALISMAN: 'talisman of foresight', HOURGLASS: "timekeeper's hourglass",
  CAPE: 'cape of thorns', ROSE: 'dried rose', CHAINS: 'ethereal chains',
  BEACON: "lloyd's beacon", ARMBAND: "master thief's armband",
  SANDALS: 'sandals of nature', SPELLBOOK: 'unstable spellbook',
};

// active:  can be triggered; otherwise it just works
// grow:    what raises its level — 'use' | 'grass' | 'search' | 'blood' | 'gold'
// per:     how much of that it takes for one level
// max:     charges at level 0; every level adds one
// refill:  ticks per charge regained
export const ARTIFACTS = {
  [ART.CLOAK]: {
    name: 'CLOAK OF SHADOWS', active: true, grow: 'use', per: 3, max: 3, refill: 200,
    blurb: 'STEP OUT OF SIGHT FOR A WHILE',
  },
  [ART.HORN]: {
    name: 'HORN OF PLENTY', active: true, grow: 'use', per: 2, max: 2, refill: 500,
    blurb: 'A MEAL OUT OF NOTHING',
  },
  [ART.CHALICE]: {
    name: 'CHALICE OF BLOOD', active: true, grow: 'blood', per: 1, max: 1, refill: 900,
    blurb: 'FEED IT AND IT MENDS YOU EVER AFTER',
  },
  [ART.TALISMAN]: {
    name: 'TALISMAN OF FORESIGHT', active: true, grow: 'search', per: 4, max: 2, refill: 300,
    blurb: 'SHOWS YOU WHAT THE FLOOR IS HIDING',
  },
  [ART.HOURGLASS]: {
    name: "TIMEKEEPER'S HOURGLASS", active: true, grow: 'use', per: 2, max: 2, refill: 600,
    blurb: 'EVERYTHING BUT YOU STOPS FOR A MOMENT',
  },
  [ART.CAPE]: {
    name: 'CAPE OF THORNS', active: true, grow: 'use', per: 3, max: 2, refill: 400,
    blurb: 'FOR A WHILE, HITTING YOU HURTS THEM',
  },
  [ART.ROSE]: {
    name: 'DRIED ROSE', active: true, grow: 'use', per: 2, max: 1, refill: 700,
    blurb: 'CALLS SOMEONE WHO IS NOT QUITE GONE',
  },
  [ART.CHAINS]: {
    name: 'ETHEREAL CHAINS', active: true, grow: 'use', per: 3, max: 3, refill: 250,
    blurb: 'DRAGS THEM TO YOU, OR YOU TO THEM',
  },
  [ART.BEACON]: {
    name: "LLOYD'S BEACON", active: true, grow: 'use', per: 2, max: 2, refill: 500,
    blurb: 'SET A PLACE, THEN COME BACK TO IT',
  },
  [ART.ARMBAND]: {
    name: "MASTER THIEF'S ARMBAND", active: false, grow: 'gold', per: 120, max: 0, refill: 0,
    blurb: 'THE FLOOR GIVES UP MORE THAN IT MEANT TO',
  },
  [ART.SANDALS]: {
    name: 'SANDALS OF NATURE', active: false, grow: 'grass', per: 40, max: 0, refill: 0,
    blurb: 'GRASS UNDERFOOT MENDS YOU',
  },
  [ART.SPELLBOOK]: {
    name: 'UNSTABLE SPELLBOOK', active: true, grow: 'use', per: 2, max: 2, refill: 450,
    blurb: 'A PAGE AT RANDOM, AND WHATEVER IT SAYS',
  },
};

export const ART_IDS = Object.keys(ARTIFACTS);
export const MAX_ART_LEVEL = 10;

const INDEX = new Map(ART_IDS.map((id, i) => [id, i + 1]));
export const artIndex = (id) => INDEX.get(id) ?? 0;
export const artById = (i) => ART_IDS[i - 1] ?? null;

/** Charges this artifact holds at its current level. */
export const artMax = (def, level) => def.max + (def.max ? level : 0);

/** A fresh artifact, at the bottom of its own ladder. */
export function makeArtifact(kind) {
  const def = ARTIFACTS[kind];
  return {
    type: 'artifact',
    kind,
    level: 0,
    exp: 0,
    charge: def.max,
    cd: 0,
    known: true,          // an artifact is obvious; what it becomes is not
    beacon: null,
  };
}

/** One turns up rarely, and never twice in the same run if it can be helped. */
export function rollArtifact(depth, rng, taken = []) {
  const pool = ART_IDS.filter(id => !taken.includes(id));
  if (!pool.length) return null;
  return makeArtifact(pool[rng.int(pool.length)]);
}

/**
 * Feed it whatever it lives on. Returns true if it went up a level, which the
 * caller announces.
 */
export function feed(item, what, amount = 1) {
  const def = ARTIFACTS[item.kind];
  if (!def || def.grow !== what) return false;
  if (item.level >= MAX_ART_LEVEL) return false;
  item.exp = (item.exp || 0) + amount;
  if (item.exp < def.per * (item.level + 1)) return false;
  item.exp = 0;
  item.level++;
  if (def.max) item.charge = artMax(def, item.level);
  return true;
}

/** One tick of being worn: charges creep back. */
export function tickArtifact(item, speed = 1) {
  const def = ARTIFACTS[item.kind];
  if (!def || !def.refill) return false;
  const max = artMax(def, item.level);
  if (item.charge >= max) { item.cd = 0; return false; }
  item.cd = (item.cd || 0) + speed;
  if (item.cd < def.refill) return false;
  item.cd = 0;
  item.charge = Math.min(max, item.charge + 1);
  return true;
}
