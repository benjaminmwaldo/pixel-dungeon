// Badges and challenges.
//
// Badges are what a run is remembered for: earned in play, sent to the client
// on the end screen, and kept in the browser between runs. Nothing in the
// simulation reads them — they are a record, not a mechanic.
//
// Challenges are the opposite: chosen before the run starts, and read
// everywhere. Each one takes something away.

export const BADGE = {
  FIRST_BLOOD: 'firstBlood', FIRST_FLOOR: 'firstFloor',
  SEWERS: 'sewers', PRISON: 'prison', CAVES: 'caves', CITY: 'city', HALLS: 'halls',
  RICH: 'rich', HOARDER: 'hoarder', ARMED: 'armed',
  SCHOLAR: 'scholar', ALCHEMIST: 'alchemist', GARDENER: 'gardener',
  FAVOUR: 'favour', ALL_FAVOURS: 'allFavours',
  CHAMPION: 'champion', UNTOUCHED: 'untouched',
  AMULET: 'amulet', ASCENDED: 'ascended', DEFIANT: 'defiant',
};

export const BADGES = {
  [BADGE.FIRST_BLOOD]:  { name: 'FIRST BLOOD', how: 'KILL SOMETHING' },
  [BADGE.FIRST_FLOOR]:  { name: 'DOWN A FLOOR', how: 'TAKE THE STAIRS ONCE' },
  [BADGE.SEWERS]:       { name: 'PAST THE SEWERS', how: 'PUT GLUT DOWN' },
  [BADGE.PRISON]:       { name: 'PAST THE PRISON', how: 'PUT THE WARDEN DOWN' },
  [BADGE.CAVES]:        { name: 'PAST THE CAVES', how: 'PUT THE ORE TYRANT DOWN' },
  [BADGE.CITY]:         { name: 'PAST THE CITY', how: 'PUT THE BURIED KING DOWN' },
  [BADGE.HALLS]:        { name: 'PAST THE HALLS', how: 'WAKE THE UNSLEEPING FULLY' },
  [BADGE.RICH]:         { name: 'WELL OFF', how: 'CARRY A THOUSAND GOLD AT ONCE' },
  [BADGE.HOARDER]:      { name: 'HOARDER', how: 'FILL EVERY SLOT IN YOUR PACK' },
  [BADGE.ARMED]:        { name: 'WELL ARMED', how: 'WEAR SOMETHING AT +5 OR BETTER' },
  [BADGE.SCHOLAR]:      { name: 'SCHOLAR', how: 'LEARN TEN POTIONS OR SCROLLS' },
  [BADGE.ALCHEMIST]:    { name: 'ALCHEMIST', how: 'BREW FIVE POTIONS' },
  [BADGE.GARDENER]:     { name: 'GARDENER', how: 'SOW TEN SEEDS' },
  [BADGE.FAVOUR]:       { name: 'A FAVOUR DONE', how: 'FINISH AN ERRAND FOR SOMEBODY' },
  [BADGE.ALL_FAVOURS]:  { name: 'EVERY FAVOUR DONE', how: 'FINISH ALL FOUR' },
  [BADGE.CHAMPION]:     { name: 'GIANT KILLER', how: 'PUT DOWN TEN CHAMPIONS' },
  [BADGE.UNTOUCHED]:    { name: 'UNTOUCHED', how: 'CLEAR A FLOOR WITHOUT BEING HIT' },
  [BADGE.AMULET]:       { name: 'THE AMULET', how: 'TAKE IT OFF ITS PEDESTAL' },
  [BADGE.ASCENDED]:     { name: 'OUT ALIVE', how: 'CARRY IT ALL THE WAY BACK OUT' },
  [BADGE.DEFIANT]:      { name: 'DEFIANT', how: 'DO ANY OF IT UNDER A CHALLENGE' },
};

export const BADGE_IDS = Object.keys(BADGES);

const B_INDEX = new Map(BADGE_IDS.map((id, i) => [id, i + 1]));
export const badgeIndex = (id) => B_INDEX.get(id) ?? 0;
export const badgeById = (i) => BADGE_IDS[i - 1] ?? null;

// ---------------------------------------------------------------------------
// Challenges: chosen before the run, and each one takes something away.
// ---------------------------------------------------------------------------
export const CHAL = {
  HUNGRY: 'hungry', BARE: 'bare', BLIND: 'blind',
  FRAGILE: 'fragile', SWARM: 'swarm', DRY: 'dry',
};

export const CHALLENGES = {
  [CHAL.HUNGRY]: {
    name: 'ON EMPTY', blurb: 'RATIONS FEED YOU HALF AS MUCH',
  },
  [CHAL.BARE]: {
    name: 'BARE HANDED', blurb: 'NO WEAPON YOU FIND IS BETTER THAN YOUR FISTS',
  },
  [CHAL.BLIND]: {
    name: 'IN THE DARK', blurb: 'YOU SEE THREE TILES LESS, EVERYWHERE',
  },
  [CHAL.FRAGILE]: {
    name: 'THIN SKINNED', blurb: 'EVERYTHING HURTS HALF AGAIN AS MUCH',
  },
  [CHAL.SWARM]: {
    name: 'SWARM', blurb: 'HALF AGAIN AS MANY OF THEM, EVERYWHERE',
  },
  [CHAL.DRY]: {
    name: 'DRY', blurb: 'NOTHING LEAVES DEW BEHIND IT',
  },
};

export const CHAL_IDS = Object.keys(CHALLENGES);

const C_INDEX = new Map(CHAL_IDS.map((id, i) => [id, i]));
export const chalIndex = (id) => C_INDEX.get(id) ?? -1;
export const chalById = (i) => CHAL_IDS[i] ?? null;

/** Pack the chosen challenges into one number for the wire. */
export function packChallenges(list) {
  let bits = 0;
  for (const id of list || []) {
    const i = chalIndex(id);
    if (i >= 0) bits |= 1 << i;
  }
  return bits;
}

export function unpackChallenges(bits) {
  const out = [];
  for (let i = 0; i < CHAL_IDS.length; i++) if (bits & (1 << i)) out.push(CHAL_IDS[i]);
  return out;
}

/** A run with any of these on is a harder run. */
export const isHard = (list) => (list || []).length > 0;
