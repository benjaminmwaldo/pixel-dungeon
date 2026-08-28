// Wands. A wand holds a few charges, spends one when you point it, and fills
// back up on its own while you carry it.
//
// In the original you tap a target on a grid. Here you point with your facing,
// like everything else — so a wand is either a projectile, a line, or a burst
// centred on you, and the aiming is free.
//
// Each entry names an `effect`, which shared/game.js dispatches. The table
// itself stays declarative so the balance is readable in one place.

export const WAND = {
  MAGIC_MISSILE: 'magic missile', FIREBLAST: 'fireblast', FROST: 'frost',
  LIGHTNING: 'lightning', DISINTEGRATION: 'disintegration', CORROSION: 'corrosion',
  BLAST_WAVE: 'blast wave', TRANSFUSION: 'transfusion', REGROWTH: 'regrowth',
  CORRUPTION: 'corruption', WARDING: 'warding', PRISMATIC: 'prismatic light',
};

// max:      charges when full
// recharge: ticks per charge regained
// dmg:      scaled by depth and upgrades where it applies
export const WANDS = {
  [WAND.MAGIC_MISSILE]: {
    name: 'MAGIC MISSILE', effect: 'bolt', max: 5, recharge: 150, dmg: 6,
    blurb: 'A PLAIN BOLT THAT NEVER MISSES ITS ARC',
  },
  [WAND.FIREBLAST]: {
    name: 'FIREBLAST', effect: 'cone', max: 3, recharge: 240, dmg: 8, burn: 200,
    blurb: 'A SHORT GOUT OF FLAME',
  },
  [WAND.FROST]: {
    name: 'FROST', effect: 'bolt', max: 4, recharge: 200, dmg: 4, freeze: 140,
    blurb: 'STOPS WHAT IT TOUCHES',
  },
  [WAND.LIGHTNING]: {
    name: 'LIGHTNING', effect: 'chain', max: 4, recharge: 200, dmg: 7, arc: 48,
    blurb: 'JUMPS BETWEEN WHATEVER IS STANDING CLOSE',
  },
  [WAND.DISINTEGRATION]: {
    name: 'DISINTEGRATION', effect: 'beam', max: 3, recharge: 260, dmg: 12,
    blurb: 'A LINE THROUGH EVERYTHING IN FRONT OF YOU',
  },
  [WAND.CORROSION]: {
    name: 'CORROSION', effect: 'gas', max: 3, recharge: 240, radius: 44, corrode: 320,
    blurb: 'A CLOUD THAT EATS AT THEM',
  },
  [WAND.BLAST_WAVE]: {
    name: 'BLAST WAVE', effect: 'burst', max: 4, recharge: 200, dmg: 5, radius: 52, knock: 22,
    blurb: 'SHOVES EVERYTHING AWAY FROM YOU',
  },
  [WAND.TRANSFUSION]: {
    name: 'TRANSFUSION', effect: 'drain', max: 3, recharge: 260, dmg: 9,
    blurb: 'TAKES THEIR BLOOD AND GIVES YOU SOME',
  },
  [WAND.REGROWTH]: {
    name: 'REGROWTH', effect: 'grow', max: 4, recharge: 180, reach: 6,
    blurb: 'TALL GRASS WHERE YOU POINT IT',
  },
  [WAND.CORRUPTION]: {
    name: 'CORRUPTION', effect: 'charm', max: 2, recharge: 320, charm: 400,
    blurb: 'TURNS ONE OF THEM AROUND',
  },
  [WAND.WARDING]: {
    name: 'WARDING', effect: 'ward', max: 3, recharge: 280, life: 900, dmg: 4,
    blurb: 'LEAVES SOMETHING BEHIND TO SHOOT FOR YOU',
  },
  [WAND.PRISMATIC]: {
    name: 'PRISMATIC LIGHT', effect: 'flash', max: 4, recharge: 200, dmg: 4,
    radius: 70, blind: 260,
    blurb: 'LIGHT ENOUGH TO BLIND A ROOM',
  },
};

export const WAND_IDS = Object.keys(WANDS);

// A wand looks like the wood it is cut from, shuffled per run.
export const WAND_LOOKS = [
  'HOLLY', 'YEW', 'EBONY', 'CHERRY', 'TEAK', 'ROWAN',
  'WILLOW', 'MAHOGANY', 'BIRCH', 'ELDER', 'ASH', 'PINE',
];

export const WAND_TINT = {
  HOLLY: '#2C8C2C', YEW: '#8C4A10', EBONY: '#303040', CHERRY: '#C02040',
  TEAK: '#C88030', ROWAN: '#D85830', WILLOW: '#98C048', MAHOGANY: '#A03818',
  BIRCH: '#E8D0A0', ELDER: '#585868', ASH: '#909098', PINE: '#164C18',
};

const INDEX = new Map(WAND_IDS.map((id, i) => [id, i + 1]));
export const wandIndex = (id) => INDEX.get(id) ?? 0;
export const wandById = (i) => WAND_IDS[i - 1] ?? null;

/** How hard a wand hits at this depth, with its upgrades counted. */
export function wandPower(def, depth, upgrade = 0) {
  if (!def.dmg) return 0;
  return Math.round(def.dmg + depth * 0.5 + upgrade * 3);
}

/** A wand for this depth. Wands are never cursed; a dud one is bad enough. */
let serial = 0;

export function rollWand(depth, rng) {
  const kind = WAND_IDS[rng.int(WAND_IDS.length)];
  const def = WANDS[kind];
  return {
    type: 'wand',
    kind,
    upgrade: rng.chance(0.2) ? 1 : 0,
    charges: def.max,
    cd: 0,
    known: false,
    serial: ++serial,      // two of the same wand keep their own charges
  };
}

/** Top a wand back up, the way a scroll of recharging does. */
export function refill(item) {
  const def = WANDS[item.kind];
  if (!def) return;
  item.charges = def.max + (item.upgrade || 0);
  item.cd = 0;
}

/**
 * One tick of sitting in the pack. `speed` lets a ring of energy or a scroll
 * of recharging hurry it along.
 */
export function tickWand(item, speed = 1) {
  const def = WANDS[item.kind];
  if (!def) return false;
  const max = def.max + (item.upgrade || 0);
  if (item.charges >= max) { item.cd = 0; return false; }
  item.cd = (item.cd || 0) + speed;
  if (item.cd < def.recharge) return false;
  item.cd = 0;
  item.charges = Math.min(max, (item.charges || 0) + 1);
  return true;
}
