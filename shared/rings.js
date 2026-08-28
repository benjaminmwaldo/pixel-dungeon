// Rings. Two on your hands at once, each one a quiet nudge to the same stat
// block the perk trees write into — so a ring and a perk that both sharpen
// your swing simply add up, and the simulation never has to know which is
// which.
//
// You do not learn what a ring does by looking at it. Wear it long enough and
// it tells you, which is also long enough for a cursed one to have been a bad
// idea.

export const RING = {
  ACCURACY: 'accuracy', EVASION: 'evasion', ELEMENTS: 'elements',
  ENERGY: 'energy', FORCE: 'force', FUROR: 'furor', HASTE: 'haste',
  MIGHT: 'might', SHARPSHOOTING: 'sharpshooting', TENACITY: 'tenacity',
  WEALTH: 'wealth', ARCANA: 'arcana',
};

// `apply(stats, level, cursed)` — level is 1 + upgrades, so a plain ring is 1.
// A cursed ring runs the same effect backwards.
export const RINGS = {
  [RING.ACCURACY]: {
    name: 'ACCURACY', blurb: 'YOUR BLOWS BITE DEEPER',
    apply: (s, n, bad) => { s.crit += (bad ? -0.03 : 0.05) * n; },
  },
  [RING.EVASION]: {
    name: 'EVASION', blurb: 'HARDER TO CATCH',
    apply: (s, n, bad) => { s.invulnMult *= bad ? 1 - 0.08 * n : 1 + 0.12 * n; },
  },
  [RING.ELEMENTS]: {
    name: 'ELEMENTS', blurb: 'FIRE AND FROST TROUBLE YOU LESS',
    apply: (s, n, bad) => { s.elements = (s.elements || 0) + (bad ? -0.12 : 0.15) * n; },
  },
  [RING.ENERGY]: {
    name: 'ENERGY', blurb: 'YOUR TRICK COMES BACK SOONER',
    apply: (s, n, bad) => { s.cdMult *= bad ? 1 + 0.15 * n : 1 - 0.12 * n; },
  },
  [RING.FORCE]: {
    name: 'FORCE', blurb: 'HIT HARDER IN CLOSE',
    apply: (s, n, bad) => { s.melee += (bad ? -1 : 2) * n; },
  },
  [RING.FUROR]: {
    name: 'FUROR', blurb: 'SWING FASTER',
    apply: (s, n, bad) => { s.swingMult *= bad ? 1 + 0.12 * n : 1 - 0.10 * n; },
  },
  [RING.HASTE]: {
    name: 'HASTE', blurb: 'MOVE QUICKER',
    apply: (s, n, bad) => { s.speedMult *= bad ? 1 - 0.08 * n : 1 + 0.09 * n; },
  },
  [RING.MIGHT]: {
    name: 'MIGHT', blurb: 'MORE OF YOU TO WEAR DOWN',
    apply: (s, n, bad) => { s.maxHp += (bad ? -3 : 5) * n; },
  },
  [RING.SHARPSHOOTING]: {
    name: 'SHARPSHOOTING', blurb: 'WHAT YOU THROW LANDS HARDER',
    apply: (s, n, bad) => { s.ranged += (bad ? -1 : 2) * n; s.rangeMult *= bad ? 0.9 : 1.1; },
  },
  [RING.TENACITY]: {
    name: 'TENACITY', blurb: 'THE WORSE IT GETS, THE LESS IT HURTS',
    apply: (s, n, bad) => { s.tenacity = (s.tenacity || 0) + (bad ? -0.1 : 0.14) * n; },
  },
  [RING.WEALTH]: {
    name: 'WEALTH', blurb: 'THE FLOOR GIVES UP MORE COIN',
    apply: (s, n, bad) => { s.goldMult *= bad ? 1 - 0.15 * n : 1 + 0.25 * n; },
  },
  [RING.ARCANA]: {
    name: 'ARCANA', blurb: 'POTIONS AND SCROLLS RUN STRONGER',
    apply: (s, n, bad) => { s.potionMult *= bad ? 1 - 0.12 * n : 1 + 0.20 * n; },
  },
};

export const RING_IDS = Object.keys(RINGS);

// The stones a ring may be cut from. Which stone means which ring is shuffled
// per run, exactly like potion glass and scroll runes.
export const RING_LOOKS = [
  'GARNET', 'AGATE', 'AMETHYST', 'ONYX', 'TOPAZ', 'OPAL',
  'TOURMALINE', 'EMERALD', 'SAPPHIRE', 'QUARTZ', 'DIAMOND', 'JADE',
];

export const RING_TINT = {
  GARNET: '#C82038', AGATE: '#C88030', AMETHYST: '#8858FC', ONYX: '#404058',
  TOPAZ: '#F8B800', OPAL: '#E8E8F8', TOURMALINE: '#F878B8', EMERALD: '#00A800',
  SAPPHIRE: '#0078F8', QUARTZ: '#BCBCBC', DIAMOND: '#9CE0FC', JADE: '#58C038',
};

const INDEX = new Map(RING_IDS.map((id, i) => [id, i + 1]));
export const ringIndex = (id) => INDEX.get(id) ?? 0;
export const ringById = (i) => RING_IDS[i - 1] ?? null;

/** How long you have to wear one before it admits what it is. */
export const RING_LEARN_TICKS = 600;

/** Fold whatever is on the hero's hands into the stat block perks already built. */
export function applyRings(stats, equip) {
  for (const slot of ['ring1', 'ring2']) {
    const r = equip?.[slot];
    if (!r || !r.kind) continue;
    const def = RINGS[r.kind];
    if (!def) continue;
    def.apply(stats, 1 + (r.upgrade || 0), !!r.cursed);
  }
  return stats;
}

/** A ring for this depth, sometimes cursed, never yet understood. */
export function rollRing(depth, rng) {
  return {
    type: 'ring',
    kind: RING_IDS[rng.int(RING_IDS.length)],
    upgrade: rng.chance(0.25) ? 1 : 0,
    cursed: rng.chance(0.18),
    known: false,
    worn: 0,
  };
}
