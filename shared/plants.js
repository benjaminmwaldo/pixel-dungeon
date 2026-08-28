// Things that grow down here, and the seeds they came from.
//
// A plant sits on the floor and does nothing until something stands on it.
// Then it does its one thing and is gone. That works for you and against you
// in equal measure: a sorrowmoss under a charging brute is worth more than one
// under your own feet.
//
// Every plant has a seed. Seeds are throwable, plantable, and the raw material
// for the alchemy pot.

export const PLANT = {
  FIREBLOOM: 'firebloom', ICECAP: 'icecap', SORROWMOSS: 'sorrowmoss',
  BLINDWEED: 'blindweed', SUNGRASS: 'sungrass', FADELEAF: 'fadeleaf',
  EARTHROOT: 'earthroot', ROTBERRY: 'rotberry', STARFLOWER: 'starflower',
  SWIFTTHISTLE: 'swiftthistle', STORMVINE: 'stormvine', MAGEROYAL: 'mageroyal',
  BLANDFRUIT: 'blandfruit',
};

// `on` is what happens to whoever stood on it: a buff, a cloud, or something
// stranger. `colour` is the flower; the stem is always green.
export const PLANTS = {
  [PLANT.FIREBLOOM]: {
    name: 'FIREBLOOM', colour: '#F83800', cloud: ['burning', 220, 34],
    blurb: 'IT GOES UP, AND SO DOES WHATEVER IS STANDING ON IT',
  },
  [PLANT.ICECAP]: {
    name: 'ICECAP', colour: '#9CE0FC', cloud: ['frozen', 130, 34],
    blurb: 'EVERYTHING NEAR IT STOPS',
  },
  [PLANT.SORROWMOSS]: {
    name: 'SORROWMOSS', colour: '#58C038', buff: ['poison', 280],
    blurb: 'A LONG SLOW UNPLEASANTNESS',
  },
  [PLANT.BLINDWEED]: {
    name: 'BLINDWEED', colour: '#FCFCFC', cloud: ['blindness', 240, 40],
    blurb: 'A FLASH, AND NOBODY SEES ANYTHING FOR A WHILE',
  },
  [PLANT.SUNGRASS]: {
    name: 'SUNGRASS', colour: '#F8F058', buff: ['healing', 300], friendly: true,
    blurb: 'IT KNITS YOU BACK TOGETHER WHERE YOU STAND',
  },
  [PLANT.FADELEAF]: {
    name: 'FADELEAF', colour: '#B048C8', teleport: true,
    blurb: 'YOU ARE SUDDENLY SOMEWHERE ELSE',
  },
  [PLANT.EARTHROOT]: {
    name: 'EARTHROOT', colour: '#8C4A10', buff: ['barkskin', 320], friendly: true,
    blurb: 'THE GROUND COMES UP AROUND YOU AND HOLDS',
  },
  [PLANT.ROTBERRY]: {
    name: 'ROTBERRY', colour: '#C02040', shout: 200,
    blurb: 'THE SMELL BRINGS EVERYTHING ON THE FLOOR RUNNING',
  },
  [PLANT.STARFLOWER]: {
    name: 'STARFLOWER', colour: '#F8B800', buff: ['bless', 400], friendly: true, rare: true,
    blurb: 'EVERYTHING GOES YOUR WAY FOR A WHILE',
  },
  [PLANT.SWIFTTHISTLE]: {
    name: 'SWIFTTHISTLE', colour: '#B8F818', buff: ['haste', 260], friendly: true,
    blurb: 'YOU LEAVE RATHER FASTER THAN YOU ARRIVED',
  },
  [PLANT.STORMVINE]: {
    name: 'STORMVINE', colour: '#6844FC', buff: ['amok', 240],
    blurb: 'NOTHING IS QUITE WHERE IT LOOKS',
  },
  [PLANT.MAGEROYAL]: {
    name: 'MAGEROYAL', colour: '#F878F8', buff: ['recharging', 320], friendly: true,
    blurb: 'WHATEVER YOU CARRY FILLS BACK UP FASTER',
  },
  [PLANT.BLANDFRUIT]: {
    name: 'BLANDFRUIT', colour: '#E8D0A0', feeds: true,
    blurb: 'IT TASTES OF NOTHING AT ALL, BUT IT IS FOOD',
  },
};

export const PLANT_IDS = Object.keys(PLANTS);

const INDEX = new Map(PLANT_IDS.map((id, i) => [id, i + 1]));
export const plantIndex = (id) => INDEX.get(id) ?? 0;
export const plantById = (i) => PLANT_IDS[i - 1] ?? null;

/** Which plants a floor at this depth may grow. */
export function plantsForDepth(depth) {
  return PLANT_IDS.filter(id => !PLANTS[id].rare || depth >= 10);
}

/** One at random, with the rare one staying rare. */
export function rollPlant(depth, rng) {
  const pool = plantsForDepth(depth);
  const weighted = [];
  for (const id of pool) {
    const n = PLANTS[id].rare ? 1 : 6;
    for (let i = 0; i < n; i++) weighted.push(id);
  }
  return weighted[rng.int(weighted.length)];
}

/** A handful of seeds. */
export function rollSeed(depth, rng) {
  return { type: 'seed', kind: rollPlant(depth, rng), amount: 1 + rng.int(2) };
}


// What each seed becomes in the pot. Three of the same kind gives you that
// potion for certain; a mixed handful gives you one of the three at random,
// which is the whole gamble.
export const BREWS = {
  [PLANT.FIREBLOOM]: 'liquid flame',
  [PLANT.ICECAP]: 'frost',
  [PLANT.SORROWMOSS]: 'toxic gas',
  [PLANT.BLINDWEED]: 'paralytic gas',
  [PLANT.SUNGRASS]: 'healing',
  [PLANT.FADELEAF]: 'invisibility',
  [PLANT.EARTHROOT]: 'purity',
  [PLANT.ROTBERRY]: 'strength',
  [PLANT.STARFLOWER]: 'experience',
  [PLANT.SWIFTTHISTLE]: 'haste',
  [PLANT.STORMVINE]: 'levitation',
  [PLANT.MAGEROYAL]: 'mind vision',
  [PLANT.BLANDFRUIT]: 'healing',
};

/** How many seeds one brew takes. */
export const BREW_COST = 3;
