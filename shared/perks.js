// Perk trees. One point per hero level, spent on nodes that unlock further
// nodes — three trees everyone shares, and one that only your class can enter.
//
// Every perk folds into a flat `stats` object that the simulation reads, so
// adding a perk never means touching the combat code.

export const TREES = [
  { id: 'vitality', name: 'VITALITY', blurb: 'STAYING ALIVE' },
  { id: 'prowess',  name: 'PROWESS',  blurb: 'HITTING THINGS' },
  { id: 'fortune',  name: 'FORTUNE',  blurb: 'FINDING THINGS' },
  { id: 'warrior',  name: 'WARRIOR',  blurb: 'THE SHIELD', cls: 'warrior' },
  { id: 'mage',     name: 'MAGE',     blurb: 'THE STAFF', cls: 'mage' },
  { id: 'rogue',    name: 'ROGUE',    blurb: 'THE SHADOW', cls: 'rogue' },
  { id: 'ranger',   name: 'RANGER',   blurb: 'THE BOW', cls: 'ranger' },
];

/**
 * col/row place the node in its tree's graph; `req` is the perk (and rank)
 * that must already be taken. `apply` folds rank into the stat block.
 */
export const PERKS = {
  // ---- VITALITY ---------------------------------------------------------
  tough: {
    tree: 'vitality', name: 'TOUGH', ranks: 3, col: 1, row: 0,
    text: '+5 MAXIMUM HIT POINTS PER RANK',
    apply: (s, r) => { s.maxHp += 5 * r; },
  },
  thickSkin: {
    tree: 'vitality', name: 'THICK SKIN', ranks: 2, col: 0, row: 1, req: ['tough', 1],
    text: 'BLOWS LAND SOFTER. +2 ARMOUR PER RANK',
    apply: (s, r) => { s.armour += 2 * r; },
  },
  ironStomach: {
    tree: 'vitality', name: 'IRON STOMACH', ranks: 2, col: 2, row: 1, req: ['tough', 1],
    text: 'HUNGER CREEPS UP 30% SLOWER PER RANK',
    apply: (s, r) => { s.hungerMult *= Math.pow(0.7, r); },
  },
  secondWind: {
    tree: 'vitality', name: 'SECOND WIND', ranks: 2, col: 1, row: 2, req: ['tough', 2],
    text: 'MEND 1 HIT POINT EVERY FEW SECONDS',
    apply: (s, r) => { s.regen = r === 1 ? 210 : 120; },
  },
  lastStand: {
    tree: 'vitality', name: 'LAST STAND', ranks: 1, col: 0, row: 3, req: ['thickSkin', 1],
    text: 'BELOW A QUARTER HEALTH, TAKE A THIRD LESS',
    apply: (s) => { s.lastStand = 0.65; },
  },
  resilient: {
    tree: 'vitality', name: 'RESILIENT', ranks: 1, col: 1, row: 4, req: ['secondWind', 1],
    text: 'MERCY AFTER A HIT LASTS HALF AGAIN AS LONG',
    apply: (s) => { s.invulnMult = 1.5; },
  },

  // ---- PROWESS ----------------------------------------------------------
  strongArm: {
    tree: 'prowess', name: 'STRONG ARM', ranks: 3, col: 1, row: 0,
    text: '+2 MELEE DAMAGE PER RANK',
    apply: (s, r) => { s.melee += 2 * r; },
  },
  quickBlade: {
    tree: 'prowess', name: 'QUICK BLADE', ranks: 2, col: 0, row: 1, req: ['strongArm', 1],
    text: 'RECOVER FROM A SWING 20% FASTER PER RANK',
    apply: (s, r) => { s.swingMult *= Math.pow(0.8, r); },
  },
  wideArc: {
    tree: 'prowess', name: 'WIDE ARC', ranks: 2, col: 2, row: 1, req: ['strongArm', 2],
    text: 'YOUR REACH GROWS BY A QUARTER PER RANK',
    apply: (s, r) => { s.reachMult *= (1 + 0.25 * r); },
  },
  critical: {
    tree: 'prowess', name: 'CRITICAL', ranks: 2, col: 0, row: 2, req: ['quickBlade', 1],
    text: '12% CHANCE PER RANK TO STRIKE DOUBLE',
    apply: (s, r) => { s.crit += 0.12 * r; },
  },
  brutal: {
    tree: 'prowess', name: 'BRUTAL', ranks: 1, col: 2, row: 3, req: ['wideArc', 1],
    text: 'YOUR BLOWS THROW ENEMIES BACK AND DAZE THEM',
    apply: (s) => { s.knock = 3; s.daze = 20; },
  },
  executioner: {
    tree: 'prowess', name: 'EXECUTIONER', ranks: 1, col: 1, row: 4, req: ['critical', 1],
    text: 'HALF AGAIN AS MUCH DAMAGE TO WOUNDED FOES',
    apply: (s) => { s.execute = 1.5; },
  },

  // ---- FORTUNE ----------------------------------------------------------
  keenEye: {
    tree: 'fortune', name: 'KEEN EYE', ranks: 2, col: 1, row: 0,
    text: 'YOU SEE ONE TILE FURTHER PER RANK',
    apply: (s, r) => { s.sight += r; },
  },
  trapwise: {
    tree: 'fortune', name: 'TRAPWISE', ranks: 2, col: 0, row: 1, req: ['keenEye', 1],
    text: 'THE FLOOR GIVES UP ITS TRAPS NEARBY',
    apply: (s, r) => { s.search = Math.max(s.search, 1 + r); },
  },
  scavenger: {
    tree: 'fortune', name: 'SCAVENGER', ranks: 2, col: 2, row: 1, req: ['keenEye', 1],
    text: 'COIN FINDS YOU. +35% GOLD PER RANK',
    apply: (s, r) => { s.goldMult += 0.35 * r; },
  },
  packRat: {
    tree: 'fortune', name: 'PACK RAT', ranks: 2, col: 2, row: 2, req: ['scavenger', 1],
    text: 'FOUR MORE PLACES TO PUT THINGS PER RANK',
    apply: (s, r) => { s.bagBonus += 4 * r; },
  },
  alchemist: {
    tree: 'fortune', name: 'ALCHEMIST', ranks: 1, col: 0, row: 3, req: ['trapwise', 1],
    text: 'POTIONS WORK HALF AGAIN AS WELL',
    apply: (s) => { s.potionMult = 1.5; },
  },
  quickStudy: {
    tree: 'fortune', name: 'QUICK STUDY', ranks: 2, col: 1, row: 4, req: ['alchemist', 1],
    text: '+25% EXPERIENCE PER RANK',
    apply: (s, r) => { s.xpMult += 0.25 * r; },
  },

  // ---- WARRIOR ----------------------------------------------------------
  shieldWall: {
    tree: 'warrior', name: 'SHIELD WALL', ranks: 2, col: 1, row: 0,
    text: 'BRACING TURNS AWAY FAR MORE OF A BLOW',
    apply: (s, r) => { s.guard = r === 1 ? 0.22 : 0.12; },
  },
  heavyHitter: {
    tree: 'warrior', name: 'HEAVY HITTER', ranks: 2, col: 2, row: 1, req: ['shieldWall', 1],
    text: '+3 MELEE DAMAGE PER RANK',
    apply: (s, r) => { s.melee += 3 * r; },
  },
  bulwark: {
    tree: 'warrior', name: 'BULWARK', ranks: 1, col: 0, row: 1, req: ['shieldWall', 1],
    text: 'WHAT YOU BRACE AGAINST TAKES SOME BACK',
    apply: (s) => { s.reflect = 0.35; },
  },
  unstoppable: {
    tree: 'warrior', name: 'UNSTOPPABLE', ranks: 1, col: 2, row: 2, req: ['heavyHitter', 1],
    text: 'NOTHING KNOCKS YOU BACK OR HOLDS YOU',
    apply: (s) => { s.steady = true; },
  },
  warlord: {
    tree: 'warrior', name: 'WARLORD', ranks: 1, col: 0, row: 3, req: ['bulwark', 1],
    text: 'ALLIES BESIDE YOU TAKE A FIFTH LESS',
    apply: (s) => { s.aura = 0.8; },
  },
  berserk: {
    tree: 'warrior', name: 'BERSERK', ranks: 1, col: 1, row: 4, req: ['unstoppable', 1],
    text: 'WOUNDED, YOU HIT 40% HARDER',
    apply: (s) => { s.berserk = 1.4; },
  },

  // ---- MAGE -------------------------------------------------------------
  arcanePower: {
    tree: 'mage', name: 'ARCANE POWER', ranks: 3, col: 1, row: 0,
    text: '+3 BOLT DAMAGE PER RANK',
    apply: (s, r) => { s.ranged += 3 * r; },
  },
  rapidCast: {
    tree: 'mage', name: 'RAPID CAST', ranks: 2, col: 0, row: 1, req: ['arcanePower', 1],
    text: 'BOLTS COME A QUARTER FASTER PER RANK',
    apply: (s, r) => { s.cdMult *= Math.pow(0.75, r); },
  },
  piercing: {
    tree: 'mage', name: 'PIERCING BOLT', ranks: 1, col: 2, row: 1, req: ['arcanePower', 2],
    text: 'YOUR BOLTS PASS THROUGH WHAT THEY KILL',
    apply: (s) => { s.pierce = 2; },
  },
  manaShield: {
    tree: 'mage', name: 'MANA SHIELD', ranks: 1, col: 0, row: 2, req: ['rapidCast', 1],
    text: 'A CHARGED STAFF TURNS AWAY A FIFTH OF HARM',
    apply: (s) => { s.manaShield = 0.8; },
  },
  chainBolt: {
    tree: 'mage', name: 'CHAIN BOLT', ranks: 1, col: 2, row: 3, req: ['piercing', 1],
    text: 'BOLTS SPLIT INTO THREE',
    apply: (s) => { s.spread = 3; },
  },
  scholar: {
    tree: 'mage', name: 'SCHOLAR', ranks: 1, col: 1, row: 4, req: ['manaShield', 1],
    text: 'YOU KNOW A SCROLL BY ITS RUNE ON SIGHT',
    apply: (s) => { s.scholar = true; },
  },

  // ---- ROGUE ------------------------------------------------------------
  lightStep: {
    tree: 'rogue', name: 'LIGHT STEP', ranks: 2, col: 1, row: 0,
    text: 'YOU MOVE 12% FASTER PER RANK',
    apply: (s, r) => { s.speedMult *= (1 + 0.12 * r); },
  },
  backstab: {
    tree: 'rogue', name: 'BACKSTAB', ranks: 2, col: 0, row: 1, req: ['lightStep', 1],
    text: 'DOUBLE DAMAGE TO ANYTHING THAT HAS NOT SEEN YOU',
    apply: (s, r) => { s.backstab = 1 + r; },
  },
  deepPockets: {
    tree: 'rogue', name: 'DEEP POCKETS', ranks: 2, col: 2, row: 1, req: ['lightStep', 1],
    text: 'FOUR MORE PLACES TO PUT THINGS PER RANK',
    apply: (s, r) => { s.bagBonus += 4 * r; },
  },
  shadowCloak: {
    tree: 'rogue', name: 'SHADOW CLOAK', ranks: 2, col: 0, row: 2, req: ['backstab', 1],
    text: 'THE CLOAK HOLDS LONGER AND RETURNS SOONER',
    apply: (s, r) => { s.cloakMult = 1 + 0.6 * r; s.cdMult *= Math.pow(0.8, r); },
  },
  lockpick: {
    tree: 'rogue', name: 'LOCKPICK', ranks: 1, col: 2, row: 3, req: ['deepPockets', 1],
    text: 'LOCKED DOORS OPEN TO YOU WITHOUT A KEY',
    apply: (s) => { s.lockpick = true; },
  },
  ambusher: {
    tree: 'rogue', name: 'AMBUSHER', ranks: 1, col: 1, row: 4, req: ['shadowCloak', 1],
    text: 'A STRIKE FROM THE CLOAK ALWAYS TELLS',
    apply: (s) => { s.ambush = true; },
  },

  // ---- RANGER -----------------------------------------------------------
  trueShot: {
    tree: 'ranger', name: 'TRUE SHOT', ranks: 3, col: 1, row: 0,
    text: '+2 ARROW DAMAGE PER RANK',
    apply: (s, r) => { s.ranged += 2 * r; },
  },
  rapidFire: {
    tree: 'ranger', name: 'RAPID FIRE', ranks: 2, col: 0, row: 1, req: ['trueShot', 1],
    text: 'DRAW 30% FASTER PER RANK',
    apply: (s, r) => { s.cdMult *= Math.pow(0.7, r); },
  },
  longShot: {
    tree: 'ranger', name: 'LONG SHOT', ranks: 2, col: 2, row: 1, req: ['trueShot', 1],
    text: 'ARROWS CARRY HALF AGAIN AS FAR PER RANK',
    apply: (s, r) => { s.rangeMult *= (1 + 0.5 * r); },
  },
  huntersEye: {
    tree: 'ranger', name: "HUNTER'S EYE", ranks: 1, col: 2, row: 2, req: ['longShot', 1],
    text: 'YOU FEEL WHAT MOVES BEYOND THE WALL',
    apply: (s) => { s.senseMobs = 7; },
  },
  volley: {
    tree: 'ranger', name: 'VOLLEY', ranks: 1, col: 0, row: 2, req: ['rapidFire', 1],
    text: 'LOOSE THREE ARROWS AT ONCE',
    apply: (s) => { s.spread = 3; },
  },
  snare: {
    tree: 'ranger', name: 'SNARE', ranks: 1, col: 1, row: 4, req: ['volley', 1],
    text: 'STRUCK ENEMIES STUMBLE AND SLOW',
    apply: (s) => { s.snare = 60; },
  },
};

/** Which trees this class may spend in. */
export function treesFor(cls) {
  return TREES.filter(t => !t.cls || t.cls === cls);
}

export function perksInTree(treeId) {
  return Object.entries(PERKS)
    .filter(([, p]) => p.tree === treeId)
    .map(([id, p]) => ({ id, ...p }));
}

/** A fresh, unmodified stat block. */
export function baseStats() {
  return {
    maxHp: 0, armour: 0, melee: 0, ranged: 0,
    crit: 0, execute: 1, berserk: 1, backstab: 1,
    reachMult: 1, swingMult: 1, speedMult: 1, cdMult: 1, rangeMult: 1,
    sight: 0, search: 0, regen: 0,
    hungerMult: 1, goldMult: 1, xpMult: 1, potionMult: 1,
    bagBonus: 0, knock: 0, daze: 0,
    guard: 0.35, reflect: 0, aura: 1, lastStand: 1, invulnMult: 1,
    manaShield: 1, pierce: 0, spread: 1, cloakMult: 1,
    steady: false, lockpick: false, scholar: false, ambush: false,
    senseMobs: 0, snare: 0,
  };
}

/** Fold a hero's taken perks into a stat block. */
export function computeStats(perks) {
  const s = baseStats();
  for (const [id, rank] of Object.entries(perks || {})) {
    const def = PERKS[id];
    if (!def || rank <= 0) continue;
    def.apply(s, Math.min(rank, def.ranks));
  }
  return s;
}

/** Can this hero take another rank of this perk right now? */
export function canTake(perkId, perks, cls, points) {
  const def = PERKS[perkId];
  if (!def) return { ok: false, why: 'NO SUCH PERK' };
  const tree = TREES.find(t => t.id === def.tree);
  if (tree?.cls && tree.cls !== cls) return { ok: false, why: 'NOT YOUR DISCIPLINE' };
  const have = perks[perkId] || 0;
  if (have >= def.ranks) return { ok: false, why: 'ALREADY MASTERED' };
  if (points <= 0) return { ok: false, why: 'NO POINTS TO SPEND' };
  if (def.req) {
    const [needId, needRank] = def.req;
    if ((perks[needId] || 0) < needRank) {
      return { ok: false, why: `NEEDS ${PERKS[needId].name} ${needRank}` };
    }
  }
  return { ok: true };
}

/** The mods the client needs to predict movement and swings correctly. */
export function clientMods(stats) {
  return {
    speedMult: stats.speedMult,
    swingMult: stats.swingMult,
    reachMult: stats.reachMult,
    cdMult: stats.cdMult,
  };
}
