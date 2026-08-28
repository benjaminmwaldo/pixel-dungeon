// Loot. Potions and scrolls arrive unidentified: each run shuffles which
// colour of glass and which rune goes with which effect, and the party only
// learns by drinking, reading, or finding a scroll of identify.

import { rngFor } from './terrain.js';
import { dressGear, markName } from './enchants.js';
import { RINGS, RING_IDS, RING_LOOKS, rollRing } from './rings.js';
import { WANDS, WAND_IDS, WAND_LOOKS, rollWand } from './wands.js';
import { MISSILES, rollMissile } from './missiles.js';
import { PLANTS, rollSeed } from './plants.js';
import { ARTIFACTS, rollArtifact } from './artifacts.js';

export const ITEM = {
  GOLD: 'gold', FOOD: 'food', POTION: 'potion', SCROLL: 'scroll',
  WEAPON: 'weapon', ARMOR: 'armor', KEY: 'key', GOLDKEY: 'goldkey',
  BOMB: 'bomb', RELIC: 'relic', RING: 'ring', WAND: 'wand', MISSILE: 'missile',
  ARTIFACT: 'artifact', QUEST: 'quest', SEED: 'seed', DEW: 'dew',
};

// The twelve the original carries.
export const POTION = {
  HEALING: 'healing', STRENGTH: 'strength', HASTE: 'haste', INVIS: 'invisibility',
  FLAME: 'liquid flame', FROST: 'frost', TOXIC: 'toxic gas', PARALYSIS: 'paralytic gas',
  EXPERIENCE: 'experience', LEVITATION: 'levitation', MIND_VISION: 'mind vision',
  PURITY: 'purity',
};
export const POTION_KINDS = Object.values(POTION);

export const SCROLL = {
  UPGRADE: 'upgrade', IDENTIFY: 'identify', MAPPING: 'magic mapping',
  TELEPORT: 'teleportation', TERROR: 'terror', RECHARGE: 'recharging', RAGE: 'rage',
  LULLABY: 'lullaby', RETRIBUTION: 'retribution', TRANSMUTATION: 'transmutation',
  REMOVE_CURSE: 'remove curse', MIRROR: 'mirror image',
};
export const SCROLL_KINDS = Object.values(SCROLL);

const POTION_LOOKS = ['CRIMSON', 'AZURE', 'GOLDEN', 'IVORY', 'JADE', 'AMBER', 'INDIGO',
                      'SILVER', 'ROSE', 'CHARCOAL', 'BISTRE', 'TURQUOISE'];
const SCROLL_LOOKS = ['KAUNAN', 'SOWILO', 'LAGUZ', 'YNGVI', 'GYFU', 'RAIDO', 'ISAZ',
                      'MANNAZ', 'NAUDIZ', 'BERKANAN', 'ODAL', 'TIWAZ'];

// The tint each glass colour is drawn in.
export const POTION_TINT = {
  CRIMSON: '#F83800', AZURE: '#0078F8', GOLDEN: '#F8B800', IVORY: '#FCFCFC',
  JADE: '#00A800', AMBER: '#FC9838', INDIGO: '#6844FC', SILVER: '#BCBCBC',
  ROSE: '#F878F8', CHARCOAL: '#585868', BISTRE: '#7C4A18', TURQUOISE: '#00E8D8',
};

export const WEAPONS = [
  { name: 'SHORT SWORD', dmg: 2, tier: 1 },
  { name: 'MACE', dmg: 4, tier: 2 },
  { name: 'SABRE', dmg: 6, tier: 3 },
  { name: 'WAR HAMMER', dmg: 8, tier: 4 },
  { name: 'GLAIVE', dmg: 11, tier: 5 },
];

export const ARMORS = [
  { name: 'CLOTH ARMOR', def: 0, tier: 1 },
  { name: 'LEATHER ARMOR', def: 2, tier: 2 },
  { name: 'MAIL ARMOR', def: 4, tier: 3 },
  { name: 'SCALE ARMOR', def: 6, tier: 4 },
  { name: 'PLATE ARMOR', def: 9, tier: 5 },
];

/** Shuffle the appearances for one run. */
export function makeAppearances(seed) {
  const rng = rngFor((seed ^ 0x5bf03635) >>> 0);
  const pots = rng.shuffle(POTION_LOOKS.slice());
  const scrs = rng.shuffle(SCROLL_LOOKS.slice());
  const rngs = rng.shuffle(RING_LOOKS.slice());
  const wnds = rng.shuffle(WAND_LOOKS.slice());
  const potionLook = {}, scrollLook = {}, ringLook = {}, wandLook = {};
  POTION_KINDS.forEach((k, i) => { potionLook[k] = pots[i % pots.length]; });
  SCROLL_KINDS.forEach((k, i) => { scrollLook[k] = scrs[i % scrs.length]; });
  RING_IDS.forEach((k, i) => { ringLook[k] = rngs[i % rngs.length]; });
  WAND_IDS.forEach((k, i) => { wandLook[k] = wnds[i % wnds.length]; });
  return { potionLook, scrollLook, ringLook, wandLook };
}

/** What the party should see this item called, given what they have learned. */
export function itemLabel(item, app, known) {
  switch (item.type) {
    case ITEM.GOLD: return `${item.amount} GOLD`;
    case ITEM.FOOD: return 'RATION';
    case ITEM.BOMB: return 'BOMB';
    case ITEM.KEY: return 'IRON KEY';
    case ITEM.GOLDKEY: return 'GOLDEN KEY';
    case ITEM.RELIC: return 'THE AMULET';
    case ITEM.WEAPON: {
      const w = WEAPONS[item.tier - 1];
      return gearName(item, w.name);
    }
    case ITEM.ARMOR: {
      const a = ARMORS[item.tier - 1];
      return gearName(item, a.name);
    }
    case ITEM.POTION:
      return known.potions.includes(item.kind)
        ? `POTION OF ${item.kind.toUpperCase()}`
        : `${app.potionLook[item.kind]} POTION`;
    case ITEM.SCROLL:
      return known.scrolls.includes(item.kind)
        ? `SCROLL OF ${item.kind.toUpperCase()}`
        : `SCROLL "${app.scrollLook[item.kind]}"`;
    case ITEM.SEED: {
      const def = PLANTS[item.kind];
      const n = item.amount || 1;
      const word = `${def ? def.name : 'PLAIN'} SEED`;
      return n > 1 ? `${n} ${word}S` : word;
    }
    case ITEM.DEW: return 'DEWDROP';
    case ITEM.QUEST: return item.name || 'SOMETHING SOMEBODY WANTS';
    case ITEM.ARTIFACT: {
      const def = ARTIFACTS[item.kind];
      if (!def) return 'A CURIOUS THING';
      return item.level ? `${def.name} +${item.level}` : def.name;
    }
    case ITEM.MISSILE: {
      const def = MISSILES[item.kind];
      const n = item.amount || 1;
      return n > 1 ? `${n} ${def.name}S` : def.name;
    }
    case ITEM.WAND: {
      const plus = item.upgrade ? `+${item.upgrade} ` : '';
      if (!item.known && !known.wands?.includes(item.kind)) {
        return `${app.wandLook?.[item.kind] || 'PLAIN'} WAND`;
      }
      return `${plus}WAND OF ${WANDS[item.kind].name}`;
    }
    case ITEM.RING: {
      const plus = item.upgrade ? `+${item.upgrade} ` : '';
      if (!item.known && !known.rings?.includes(item.kind)) {
        return `${app.ringLook?.[item.kind] || 'PLAIN'} RING`;
      }
      const word = item.cursed ? 'CURSED ' : '';
      return `${plus}${word}RING OF ${RINGS[item.kind].name}`;
    }
    default: return '?';
  }
}

/** "+2 BLAZING SABRE", or just "SABRE" while nobody has worked it out. */
function gearName(item, base) {
  const plus = item.upgrade ? `+${item.upgrade} ` : '';
  const mark = item.known ? markName(item) : null;
  return mark ? `${plus}${mark} ${base}` : `${plus}${base}`;
}

/** Is this something you keep in the quick bar rather than wear? */
export function isConsumable(item) {
  return item.type === ITEM.POTION || item.type === ITEM.SCROLL ||
         item.type === ITEM.FOOD || item.type === ITEM.BOMB ||
         item.type === ITEM.KEY || item.type === ITEM.GOLDKEY ||
         item.type === ITEM.MISSILE || item.type === ITEM.SEED;
}

/** Kept in the quick bar and pointed, but never used up. */
export function isPointed(item) {
  return item?.type === ITEM.WAND;
}

/** Something you put on rather than use up. */
export function isWorn(item) {
  return item?.type === ITEM.WEAPON || item?.type === ITEM.ARMOR ||
         item?.type === ITEM.RING || item?.type === ITEM.ARTIFACT;
}

/** A stack key, so five rations occupy one slot. */
export function stackKey(item) {
  if (item.type === ITEM.POTION || item.type === ITEM.SCROLL) return `${item.type}:${item.kind}`;
  if (item.type === ITEM.MISSILE) return `missile:${item.kind}`;
  if (item.type === ITEM.SEED) return `seed:${item.kind}`;
  if (item.type === ITEM.RING) return `ring:${item.kind}:${item.upgrade || 0}`;
  if (item.type === ITEM.WAND) return `wand:${item.kind}:${item.upgrade || 0}:${item.serial || 0}`;
  if (item.type === ITEM.ARTIFACT) return `artifact:${item.kind}`;
  if (item.type === ITEM.QUEST) return `quest:${item.kind}`;
  return item.type;
}

// ---------------------------------------------------------------------------
// What drops where
// ---------------------------------------------------------------------------
const COMMON_POTIONS = [
  POTION.HEALING, POTION.HEALING, POTION.HEALING, POTION.HASTE, POTION.INVIS,
  POTION.FLAME, POTION.FROST, POTION.TOXIC, POTION.PARALYSIS,
  POTION.EXPERIENCE, POTION.LEVITATION, POTION.MIND_VISION, POTION.PURITY,
];
const COMMON_SCROLLS = [
  SCROLL.UPGRADE, SCROLL.IDENTIFY, SCROLL.IDENTIFY, SCROLL.MAPPING,
  SCROLL.TELEPORT, SCROLL.TERROR, SCROLL.RAGE, SCROLL.RECHARGE,
  SCROLL.LULLABY, SCROLL.RETRIBUTION, SCROLL.TRANSMUTATION, SCROLL.REMOVE_CURSE,
];

/** A random floor drop for this depth. */
export function rollLoot(depth, rng, { rich = false } = {}) {
  const r = rng.next();
  if (!rich && r < 0.30) return { type: ITEM.GOLD, amount: rng.range(5, 15 + depth * 4) };
  if (!rich && r < 0.42) return { type: ITEM.FOOD };
  if (r < 0.60) return { type: ITEM.POTION, kind: rng.pick(COMMON_POTIONS) };
  if (r < 0.74) return { type: ITEM.SCROLL, kind: rng.pick(COMMON_SCROLLS) };
  if (r < 0.78) return { type: ITEM.BOMB, amount: rng.range(1, 3) };
  if (r < 0.81) return rollMissile(depth, rng);
  if (r < 0.84) return rollSeed(depth, rng);
  if (r < 0.87) return rollRing(depth, rng);
  if (r < 0.90) return rollWand(depth, rng);
  const tier = clampTier(Math.ceil(depth / 5) + (rng.chance(0.25) ? 1 : 0));
  if (r < 0.95) {
    return dressGear({ type: ITEM.WEAPON, tier, upgrade: rng.chance(0.25) ? 1 : 0 }, depth, rng);
  }
  return dressGear({ type: ITEM.ARMOR, tier, upgrade: rng.chance(0.25) ? 1 : 0 }, depth, rng);
}

/** Something worth the walk — used for pedestals, vaults and bosses. */
export function rollPrize(depth, rng, seen = []) {
  const r = rng.next();
  const tier = clampTier(Math.ceil(depth / 5) + 1);
  if (r < 0.28) return blessed({ type: ITEM.WEAPON, tier, upgrade: rng.range(1, 2) }, depth, rng);
  if (r < 0.56) return blessed({ type: ITEM.ARMOR, tier, upgrade: rng.range(1, 2) }, depth, rng);
  if (r < 0.64) return { type: ITEM.SCROLL, kind: SCROLL.UPGRADE };
  if (r < 0.70) return { ...rollRing(depth, rng), cursed: false };
  if (r < 0.76) return rollWand(depth, rng);
  if (r < 0.86 && depth >= 4) {
    // one of these is worth more than anything else on the pedestal
    const art = rollArtifact(depth, rng, seen);
    if (art) return art;
  }
  if (r < 0.92) return { type: ITEM.POTION, kind: POTION.STRENGTH };
  return { type: ITEM.GOLD, amount: rng.range(60, 60 + depth * 12) };
}

/** What an enemy leaves behind, most of the time a drop of dew. */
export function rollDrop(depth, rng) {
  const r = rng.next();
  if (r < 0.30) return { type: ITEM.DEW };
  if (r < 0.55) return null;
  if (r < 0.78) return { type: ITEM.GOLD, amount: rng.range(3, 8 + depth * 3) };
  if (r < 0.86) return { type: ITEM.FOOD };
  if (r < 0.93) return { type: ITEM.POTION, kind: rng.pick(COMMON_POTIONS) };
  if (r < 0.98) return { type: ITEM.SCROLL, kind: rng.pick(COMMON_SCROLLS) };
  return { type: ITEM.BOMB, amount: 1 };
}

/** A prize is worth the walk: often marked, never cursed. */
function blessed(item, depth, rng) {
  for (let n = 0; n < 6; n++) {
    const tryIt = dressGear({ ...item }, depth, rng);
    if (!tryIt.curse) return tryIt;
  }
  return item;
}

function clampTier(t) { return t < 1 ? 1 : t > 5 ? 5 : t; }

/** Roughly what a shopkeeper thinks something is worth. */
export function itemValue(item) {
  if (!item) return 0;
  switch (item.type) {
    case ITEM.GOLD: return item.amount || 0;
    case ITEM.FOOD: return 25;
    case ITEM.BOMB: return 30 * (item.amount || 1);
    case ITEM.KEY: case ITEM.GOLDKEY: return 0;
    case ITEM.POTION: return item.kind === POTION.STRENGTH ? 300 : 45;
    case ITEM.SCROLL: return item.kind === SCROLL.UPGRADE ? 300 : 45;
    case ITEM.QUEST: return 0;          // nobody but its owner wants it
    case ITEM.ARTIFACT: return 400 + (item.level || 0) * 80;
    case ITEM.DEW: return 0;            // it is gone the moment you touch it
    case ITEM.SEED: return 30 * (item.amount || 1);
    case ITEM.MISSILE: return (MISSILES[item.kind]?.dmg || 3) * 5 * (item.amount || 1);
    case ITEM.RING: return 200 + (item.upgrade || 0) * 60;
    case ITEM.WAND: return 220 + (item.upgrade || 0) * 70;
    case ITEM.WEAPON:
    case ITEM.ARMOR: {
      const t = item.tier || 1;
      return 25 * t * t + (item.upgrade || 0) * 45;
    }
    default: return 20;
  }
}

export const buyPrice = (item) => Math.max(10, Math.round(itemValue(item) * 1.6));
export const sellPrice = (item) => Math.round(itemValue(item) * 0.4);

/** What a shop at this depth has on its shelves. */
export function rollStock(depth, rng) {
  const tier = clampTier(Math.ceil(depth / 5));
  const stock = [
    { type: ITEM.FOOD },
    { type: ITEM.FOOD },
    { type: ITEM.BOMB, amount: 2 },
    { type: ITEM.POTION, kind: POTION.HEALING },
    { type: ITEM.POTION, kind: rng.pick(COMMON_POTIONS) },
    { type: ITEM.SCROLL, kind: SCROLL.IDENTIFY },
    { type: ITEM.SCROLL, kind: rng.pick(COMMON_SCROLLS) },
    { type: ITEM.WEAPON, tier: clampTier(tier + 1), upgrade: 0 },
    { type: ITEM.ARMOR, tier: clampTier(tier + 1), upgrade: 0 },
  ];
  if (rng.chance(0.5)) stock.push({ type: ITEM.SCROLL, kind: SCROLL.UPGRADE });
  if (rng.chance(0.35)) stock.push({ type: ITEM.POTION, kind: POTION.STRENGTH });
  return rng.shuffle(stock);
}
