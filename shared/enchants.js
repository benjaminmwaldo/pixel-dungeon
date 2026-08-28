// What a weapon does besides hitting, and what armour does besides stopping.
//
// Every entry here is a small hook the simulation calls at one of three
// moments: a weapon landing a blow, armour taking one, or a piece of gear
// simply being worn. Most of them do their work by applying a buff, which is
// why this file has almost no logic of its own.
//
// Curses live here too. They are the same shape, just unwelcome, and the
// wearer cannot take the thing off until somebody lifts it.

import { B } from './buffs.js';

// ---------------------------------------------------------------------------
// Weapon enchantments
// ---------------------------------------------------------------------------
export const ENCH = {
  BLAZING: 'blazing', CHILLING: 'chilling', SHOCKING: 'shocking',
  VAMPIRIC: 'vampiric', GRIM: 'grim', LUCKY: 'lucky', PROJECTING: 'projecting',
  ELASTIC: 'elastic', KINETIC: 'kinetic', BLOOMING: 'blooming',
  CORRUPTING: 'corrupting', BLOCKING: 'blocking', UNSTABLE: 'unstable',
};

// chance: how often it fires on a landed blow.
export const ENCHANTS = {
  [ENCH.BLAZING]:    { name: 'BLAZING', chance: 0.30, buff: [B.BURNING, 180], colour: '#F86018' },
  [ENCH.CHILLING]:   { name: 'CHILLING', chance: 0.35, buff: [B.SLOW, 200], colour: '#9CE0FC' },
  [ENCH.SHOCKING]:   { name: 'SHOCKING', chance: 0.30, arc: 40, colour: '#F8F858' },
  [ENCH.VAMPIRIC]:   { name: 'VAMPIRIC', chance: 1.00, drain: 0.15, colour: '#C02040' },
  [ENCH.GRIM]:       { name: 'GRIM', chance: 0.12, reap: 0.35, colour: '#602060' },
  [ENCH.LUCKY]:      { name: 'LUCKY', chance: 0.25, gold: true, colour: '#F8B800' },
  [ENCH.PROJECTING]: { name: 'PROJECTING', chance: 0, reach: 1.35, colour: '#B8B8F8' },
  [ENCH.ELASTIC]:    { name: 'ELASTIC', chance: 0.40, knock: 10, colour: '#78C878' },
  [ENCH.KINETIC]:    { name: 'KINETIC', chance: 1.00, stores: true, colour: '#F8A020' },
  [ENCH.BLOOMING]:   { name: 'BLOOMING', chance: 0.30, grass: true, colour: '#58C038' },
  [ENCH.CORRUPTING]: { name: 'CORRUPTING', chance: 0.15, buff: [B.CHARM, 240], colour: '#A050F8' },
  [ENCH.BLOCKING]:   { name: 'BLOCKING', chance: 1.00, shield: 3, colour: '#C0C0D8' },
  [ENCH.UNSTABLE]:   { name: 'UNSTABLE', chance: 1.00, unstable: true, colour: '#E0E0E0' },
};
export const ENCH_IDS = Object.keys(ENCHANTS);

// ---------------------------------------------------------------------------
// Armour glyphs
// ---------------------------------------------------------------------------
export const GLYPH = {
  ANTIMAGIC: 'antimagic', THORNS: 'thorns', STONE: 'stone',
  ENTANGLEMENT: 'entanglement', REPULSION: 'repulsion', CAMOUFLAGE: 'camouflage',
  FLOW: 'flow', OBFUSCATION: 'obfuscation', POTENTIAL: 'potential',
  SWIFTNESS: 'swiftness', VISCOSITY: 'viscosity', AFFECTION: 'affection',
  BRIMSTONE: 'brimstone',
};

export const GLYPHS = {
  [GLYPH.ANTIMAGIC]:    { name: 'ANTIMAGIC', soak: 0.35, magicOnly: true, colour: '#8888F8' },
  [GLYPH.THORNS]:       { name: 'THORNS', chance: 0.45, thorns: 0.5, colour: '#C82828' },
  [GLYPH.STONE]:        { name: 'STONE', soak: 0.25, slow: true, colour: '#909098' },
  [GLYPH.ENTANGLEMENT]: { name: 'ENTANGLEMENT', chance: 0.30, buff: [B.ROOTS, 150], colour: '#40A040' },
  [GLYPH.REPULSION]:    { name: 'REPULSION', chance: 0.40, knock: 14, colour: '#78B8F8' },
  [GLYPH.CAMOUFLAGE]:   { name: 'CAMOUFLAGE', grassHide: true, colour: '#58A838' },
  [GLYPH.FLOW]:         { name: 'FLOW', waterSpeed: 1.8, colour: '#3CA0FC' },
  [GLYPH.OBFUSCATION]:  { name: 'OBFUSCATION', quiet: 0.6, colour: '#585868' },
  [GLYPH.POTENTIAL]:    { name: 'POTENTIAL', chance: 0.35, recharge: true, colour: '#F8F0A0' },
  [GLYPH.SWIFTNESS]:    { name: 'SWIFTNESS', calmSpeed: 1.2, colour: '#B8F818' },
  [GLYPH.VISCOSITY]:    { name: 'VISCOSITY', defer: true, colour: '#98C048' },
  [GLYPH.AFFECTION]:    { name: 'AFFECTION', chance: 0.20, buff: [B.CHARM, 220], colour: '#F878F8' },
  [GLYPH.BRIMSTONE]:    { name: 'BRIMSTONE', fireproof: true, colour: '#F87038' },
};
export const GLYPH_IDS = Object.keys(GLYPHS);

// ---------------------------------------------------------------------------
// Curses. Same shape, opposite intent, and you cannot take the thing off.
// ---------------------------------------------------------------------------
export const CURSE = {
  // weapons
  ANNOYING: 'annoying', DISPLACING: 'displacing', EXHAUSTING: 'exhausting',
  SACRIFICIAL: 'sacrificial', WAYWARD: 'wayward', FRIENDLY: 'friendly',
  // armour
  ANTI_ENTROPY: 'anti-entropy', BULK: 'bulk', METABOLISM: 'metabolism',
  MULTIPLICITY: 'multiplicity', OVERGROWTH: 'overgrowth', STENCH: 'stench',
};

export const CURSES = {
  [CURSE.ANNOYING]:     { name: 'ANNOYING', on: 'weapon', chance: 0.25, wake: true },
  [CURSE.DISPLACING]:   { name: 'DISPLACING', on: 'weapon', chance: 0.10, blink: true },
  [CURSE.EXHAUSTING]:   { name: 'EXHAUSTING', on: 'weapon', chance: 0.20, buff: [B.WEAKNESS, 200] },
  [CURSE.SACRIFICIAL]:  { name: 'SACRIFICIAL', on: 'weapon', chance: 0.25, bleed: true },
  [CURSE.WAYWARD]:      { name: 'WAYWARD', on: 'weapon', chance: 0.30, miss: true },
  [CURSE.FRIENDLY]:     { name: 'FRIENDLY', on: 'weapon', chance: 0.15, pacify: true },
  [CURSE.ANTI_ENTROPY]: { name: 'ANTI-ENTROPY', on: 'armor', chance: 0.25, chill: true },
  [CURSE.BULK]:         { name: 'BULK', on: 'armor', heavy: true },
  [CURSE.METABOLISM]:   { name: 'METABOLISM', on: 'armor', chance: 0.20, hungry: true },
  [CURSE.MULTIPLICITY]: { name: 'MULTIPLICITY', on: 'armor', chance: 0.08, summon: true },
  [CURSE.OVERGROWTH]:   { name: 'OVERGROWTH', on: 'armor', chance: 0.15, sprout: true },
  [CURSE.STENCH]:       { name: 'STENCH', on: 'armor', chance: 0.15, stink: true },
};
export const CURSE_IDS = Object.keys(CURSES);
export const WEAPON_CURSES = CURSE_IDS.filter(id => CURSES[id].on === 'weapon');
export const ARMOR_CURSES = CURSE_IDS.filter(id => CURSES[id].on === 'armor');

// ---------------------------------------------------------------------------
// The wire. Indices rather than strings, and 0 means "nothing".
// ---------------------------------------------------------------------------
const E_INDEX = new Map(ENCH_IDS.map((id, i) => [id, i + 1]));
const G_INDEX = new Map(GLYPH_IDS.map((id, i) => [id, i + 1]));
const C_INDEX = new Map(CURSE_IDS.map((id, i) => [id, i + 1]));
export const enchIndex = (id) => E_INDEX.get(id) ?? 0;
export const enchById = (i) => ENCH_IDS[i - 1] ?? null;
export const glyphIndex = (id) => G_INDEX.get(id) ?? 0;
export const glyphById = (i) => GLYPH_IDS[i - 1] ?? null;
export const curseIndex = (id) => C_INDEX.get(id) ?? 0;
export const curseById = (i) => CURSE_IDS[i - 1] ?? null;

// ---------------------------------------------------------------------------
// Rolling gear
// ---------------------------------------------------------------------------
/** Decide what, if anything, is written on a piece of gear found at this depth. */
export function dressGear(item, depth, rng) {
  const weapon = item.type === 'weapon';
  const cursedChance = 0.12 + Math.min(0.13, depth * 0.005);
  const markedChance = 0.10 + Math.min(0.25, depth * 0.012);

  if (rng.chance(cursedChance)) {
    const pool = weapon ? WEAPON_CURSES : ARMOR_CURSES;
    item.curse = pool[rng.int(pool.length)];
    item.cursed = true;
    item.known = false;
    return item;
  }
  if (rng.chance(markedChance)) {
    if (weapon) item.ench = ENCH_IDS[rng.int(ENCH_IDS.length)];
    else item.glyph = GLYPH_IDS[rng.int(GLYPH_IDS.length)];
    item.known = false;
  }
  return item;
}

/** The word that goes in front of the item's name, once the party knows it. */
export function markName(item) {
  if (!item) return null;
  if (item.curse) return CURSES[item.curse]?.name ?? null;
  if (item.ench) return ENCHANTS[item.ench]?.name ?? null;
  if (item.glyph) return GLYPHS[item.glyph]?.name ?? null;
  return null;
}

export const markColour = (item) => {
  if (!item) return null;
  if (item.curse) return '#A02020';
  if (item.ench) return ENCHANTS[item.ench]?.colour ?? null;
  if (item.glyph) return GLYPHS[item.glyph]?.colour ?? null;
  return null;
};
