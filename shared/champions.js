// Champions. Now and then something down here is more than its kind — a rat
// that will not stop burning, a brute whose reach is wrong, a skeleton that
// keeps getting bigger while you fight it.
//
// A champion is an ordinary monster with one modifier bolted on. The modifier
// is read in the same places the base stats are, so nothing else in the
// simulation has to know champions exist.

export const CHAMP = {
  BLAZING: 'blazing', PROJECTING: 'projecting', ARMOURED: 'armoured',
  BLESSED: 'blessed', GROWING: 'growing', HALO: 'halo', GIANT: 'giant',
};

// hp/dmg/speed multiply the base. `title` goes in front of the name.
export const CHAMPIONS = {
  [CHAMP.BLAZING]: {
    title: 'BLAZING', colour: '#F86018',
    hp: 1.0, dmg: 1.0, speed: 1.0,
    burns: 200,        // sets you alight on contact
    pyre: 60,          // and goes up when it dies
  },
  [CHAMP.PROJECTING]: {
    title: 'PROJECTING', colour: '#B8B8F8',
    hp: 1.0, dmg: 1.1, speed: 1.0,
    reach: 1.9,        // hits from further away than it looks like it can
  },
  [CHAMP.ARMOURED]: {
    title: 'ARMOURED', colour: '#909098',
    hp: 1.6, dmg: 0.7, speed: 0.85,
    armour: 8,
  },
  [CHAMP.BLESSED]: {
    title: 'BLESSED', colour: '#F8F0A0',
    hp: 1.0, dmg: 1.0, speed: 1.15,
    evade: 0.35,       // shrugs off a share of what you land
  },
  [CHAMP.GROWING]: {
    title: 'GROWING', colour: '#58C038',
    hp: 1.0, dmg: 1.0, speed: 1.0,
    grows: 0.0022,     // per tick, on damage and size, while it is awake
  },
  [CHAMP.HALO]: {
    title: 'HALOED', colour: '#FCFCFC',
    hp: 1.2, dmg: 1.0, speed: 1.0,
    blinds: 200,       // the light off it is hard to look at
    mends: 40,         // and it knits its neighbours back together
  },
  [CHAMP.GIANT]: {
    title: 'GIANT', colour: '#C88030',
    hp: 2.2, dmg: 1.4, speed: 0.8,
    knock: 20,
  },
};

export const CHAMP_IDS = Object.keys(CHAMPIONS);

const INDEX = new Map(CHAMP_IDS.map((id, i) => [id, i + 1]));
export const champIndex = (id) => INDEX.get(id) ?? 0;
export const champById = (i) => CHAMP_IDS[i - 1] ?? null;

/**
 * How often the dungeon promotes something. Rare in the sewers, common enough
 * by the halls that you plan around it.
 */
export function champChance(depth) {
  if (depth < 3) return 0;
  return Math.min(0.14, 0.015 + depth * 0.005);
}

/** Pick a modifier for a monster on this floor. */
export function rollChampion(depth, rng) {
  // giants stay out of the shallows; a giant rat on floor three is not funny
  const pool = depth < 8 ? CHAMP_IDS.filter(id => id !== CHAMP.GIANT) : CHAMP_IDS;
  return pool[rng.int(pool.length)];
}
