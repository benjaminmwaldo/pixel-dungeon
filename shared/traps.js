// Traps. The original has thirty-odd; the ones that differ only in flavour are
// folded together here, leaving the ones that actually change what you do next.
//
// Each floor keeps a map of tile -> trap kind, so a revealed trap can show you
// what it is before you decide to walk over it anyway.

import { B } from './buffs.js';

export const TRAP = {
  DART: 'dart', POISON_DART: 'poisonDart', ALARM: 'alarm', GRIPPING: 'gripping',
  OOZE: 'ooze', BURNING: 'burning', FROST: 'frost', SHOCKING: 'shocking',
  TOXIC: 'toxic', CORROSION: 'corrosion', WEAKENING: 'weakening',
  FLASHING: 'flashing', CONFUSION: 'confusion', ROCKFALL: 'rockfall',
  SUMMONING: 'summoning', TELEPORT: 'teleport', PITFALL: 'pitfall',
  DISARMING: 'disarming', GUARDIAN: 'guardian', EXPLOSIVE: 'explosive',
  GEYSER: 'geyser', GRIM: 'grim', WARPING: 'warping', FLOCK: 'flock',
};

// dmg is scaled by depth by the caller. `buff` is [id, ticks, magnitude].
// `tier` gates how deep it starts appearing.
export const TRAPS = {
  [TRAP.DART]:        { name: 'WORN DART TRAP', tier: 1, dmg: 2, colour: '#B0A090' },
  [TRAP.ALARM]:       { name: 'ALARM TRAP', tier: 1, dmg: 0, alarm: true, colour: '#F8D030' },
  [TRAP.GRIPPING]:    { name: 'GRIPPING TRAP', tier: 1, dmg: 2, buff: [B.CRIPPLE, 260], colour: '#A07040' },
  [TRAP.OOZE]:        { name: 'OOZE TRAP', tier: 1, dmg: 0, buff: [B.OOZE, 300], colour: '#68A028' },
  [TRAP.POISON_DART]: { name: 'POISON DART TRAP', tier: 2, dmg: 2, buff: [B.POISON, 260], colour: '#58C038' },
  [TRAP.BURNING]:     { name: 'BURNING TRAP', tier: 2, dmg: 1, buff: [B.BURNING, 200], scorch: true, colour: '#F86018' },
  [TRAP.FROST]:       { name: 'FROST TRAP', tier: 2, dmg: 0, buff: [B.FROZEN, 110], colour: '#9CE0FC' },
  [TRAP.SHOCKING]:    { name: 'SHOCKING TRAP', tier: 2, dmg: 4, buff: [B.PARALYSIS, 50], colour: '#F8F858' },
  [TRAP.TOXIC]:       { name: 'TOXIC TRAP', tier: 2, dmg: 0, cloud: [B.POISON, 300, 56], colour: '#88C038' },
  [TRAP.FLASHING]:    { name: 'FLASHING TRAP', tier: 2, dmg: 0, buff: [B.BLINDNESS, 240], colour: '#FCFCFC' },
  [TRAP.SUMMONING]:   { name: 'SUMMONING TRAP', tier: 2, dmg: 0, summon: 3, colour: '#B048C8' },
  [TRAP.TELEPORT]:    { name: 'TELEPORTATION TRAP', tier: 2, dmg: 0, teleport: true, colour: '#68C8F8' },
  [TRAP.FLOCK]:       { name: 'FLOCK TRAP', tier: 2, dmg: 0, flock: true, colour: '#F0F0F0' },
  [TRAP.WEAKENING]:   { name: 'WEAKENING TRAP', tier: 3, dmg: 0, buff: [B.WEAKNESS, 400], colour: '#987848' },
  [TRAP.CONFUSION]:   { name: 'CONFUSION TRAP', tier: 3, dmg: 0, buff: [B.AMOK, 220], colour: '#F87038' },
  [TRAP.CORROSION]:   { name: 'CORROSION TRAP', tier: 3, dmg: 1, buff: [B.CORROSION, 300], colour: '#A8D018' },
  [TRAP.ROCKFALL]:    { name: 'ROCKFALL TRAP', tier: 3, dmg: 8, area: 40, colour: '#807868' },
  [TRAP.DISARMING]:   { name: 'DISARMING TRAP', tier: 3, dmg: 0, disarm: true, colour: '#C8C8D8' },
  [TRAP.GUARDIAN]:    { name: 'GUARDIAN TRAP', tier: 3, dmg: 0, guardian: true, colour: '#8890A8' },
  [TRAP.PITFALL]:     { name: 'PITFALL TRAP', tier: 3, dmg: 0, fall: true, colour: '#101018' },
  [TRAP.GEYSER]:      { name: 'GEYSER TRAP', tier: 4, dmg: 3, knock: 18, wet: true, colour: '#3CA0FC' },
  [TRAP.EXPLOSIVE]:   { name: 'EXPLOSIVE TRAP', tier: 4, dmg: 10, area: 48, blast: true, colour: '#F83800' },
  [TRAP.WARPING]:     { name: 'WARPING TRAP', tier: 4, dmg: 0, warp: true, colour: '#A050F8' },
  [TRAP.GRIM]:        { name: 'GRIM TRAP', tier: 5, dmg: 20, colour: '#802020' },
};

export const TRAP_IDS = Object.keys(TRAPS);
const INDEX = new Map(TRAP_IDS.map((id, i) => [id, i]));
export const trapIndex = (id) => INDEX.get(id) ?? 0;
export const trapById = (i) => TRAP_IDS[i] || TRAP.DART;

/** Which traps a floor at this depth may lay. */
export function trapsForDepth(depth) {
  const tier = Math.max(1, Math.min(5, Math.ceil(depth / 5)));
  return TRAP_IDS.filter(id => TRAPS[id].tier <= tier);
}

/** Pick one, weighted so the nastier ones stay rarer. */
export function rollTrap(depth, rng) {
  const pool = trapsForDepth(depth);
  const weighted = [];
  for (const id of pool) {
    const t = TRAPS[id];
    const weight = Math.max(1, 6 - (t.tier - 1) * 2);
    for (let i = 0; i < weight; i++) weighted.push(id);
  }
  return weighted[rng.int(weighted.length)];
}
