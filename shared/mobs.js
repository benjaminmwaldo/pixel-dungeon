// Who lives on which floor, and how they behave. Stats climb by region so a
// creature you shrugged off in the sewers is not the one waiting in the halls.

import { KIND } from './constants.js';

const BOX = { x: 3, y: 5, w: 10, h: 10 };
const BIG = { x: 1, y: 3, w: 14, h: 13 };
const HUGE = { x: 3, y: 6, w: 26, h: 24 };

// ai: how it decides where to go
//   chase   — walks at the nearest hero it can see, hits on contact
//   wander  — mills about until it notices you
//   flyer   — ignores water and chasms, moves erratically
//   shooter — closes to a comfortable range, then throws something
//   caster  — blinks about the floor and casts
//   ambush  — sits still in cover until you are close, then bursts out
//   thief   — hits, steals gold, then runs for the stairs
export const MOBS = {
  // ---- the sewers -------------------------------------------------------
  [KIND.RAT]:      { name: 'ALBINO RAT', sprite: 'RAT', hp: 8, dmg: 2, speed: 1.5, xp: 2, ai: 'chase', box: BOX },
  [KIND.SNAKE]:    { name: 'SEWER SNAKE', sprite: 'SNAKE', hp: 7, dmg: 2, speed: 2.2, xp: 3, ai: 'chase', box: BOX, evasive: true },
  [KIND.CRAB]:     { name: 'SEWER CRAB', sprite: 'CRAB', hp: 16, dmg: 4, speed: 1.2, xp: 5, ai: 'chase', box: BOX, armour: 2 },
  [KIND.SLIME]:    { name: 'MARSH SLIME', sprite: 'SLIME', hp: 12, dmg: 3, speed: 1.0, xp: 4, ai: 'chase', box: BOX, splits: true },
  [KIND.FLY]:      { name: 'SWARM OF FLIES', sprite: 'FLY', hp: 6, dmg: 2, speed: 2.6, xp: 3, ai: 'flyer', box: BOX },

  // ---- the prison -------------------------------------------------------
  [KIND.SKELETON]: { name: 'SKELETON', sprite: 'BONE', hp: 24, dmg: 6, speed: 1.4, xp: 9, ai: 'chase', box: BIG, bursts: true },
  [KIND.THIEF]:    { name: 'CRAZED THIEF', sprite: 'THIEF', hp: 20, dmg: 4, speed: 2.3, xp: 8, ai: 'thief', box: BIG },
  [KIND.GUARD]:    { name: 'PRISON GUARD', sprite: 'GUARD', hp: 30, dmg: 7, speed: 1.5, xp: 12, ai: 'chase', box: BIG, armour: 4 },
  [KIND.SHAMAN]:   { name: 'NECROMANCER', sprite: 'SHAMAN', hp: 18, dmg: 5, speed: 1.2, xp: 10, ai: 'caster', box: BIG, shot: KIND.BOLT },
  [KIND.WRAITH]:   { name: 'WRAITH', sprite: 'WRAITH', hp: 16, dmg: 7, speed: 2.0, xp: 11, ai: 'flyer', box: BIG, phasing: true },

  // ---- the caves --------------------------------------------------------
  [KIND.BAT]:      { name: 'VAMPIRE BAT', sprite: 'BAT', hp: 22, dmg: 6, speed: 2.8, xp: 13, ai: 'flyer', box: BOX, drains: true },
  [KIND.BRUTE]:    { name: 'GNOLL BRUTE', sprite: 'BRUTE', hp: 45, dmg: 11, speed: 1.6, xp: 20, ai: 'chase', box: BIG, enrages: true },
  [KIND.SPIDER]:   { name: 'CAVE SPINNER', sprite: 'SPIDER', hp: 30, dmg: 8, speed: 1.9, xp: 18, ai: 'shooter', box: BIG, shot: KIND.WEB, range: 110 },
  [KIND.GOLEM]:    { name: 'STONE GOLEM', sprite: 'GOLEM', hp: 60, dmg: 12, speed: 1.0, xp: 24, ai: 'chase', box: BIG, armour: 8 },

  // ---- the metropolis ---------------------------------------------------
  [KIND.MONK]:     { name: 'DWARF MONK', sprite: 'MONK', hp: 40, dmg: 12, speed: 2.4, xp: 28, ai: 'chase', box: BIG, disarms: true },
  [KIND.WARLOCK]:  { name: 'DWARF WARLOCK', sprite: 'WARLOCK', hp: 38, dmg: 12, speed: 1.4, xp: 30, ai: 'caster', box: BIG, shot: KIND.BOLT },
  [KIND.ELEMENTAL]:{ name: 'FIRE ELEMENTAL', sprite: 'ELEMENTAL', hp: 34, dmg: 11, speed: 2.0, xp: 29, ai: 'shooter', box: BOX, shot: KIND.FIREBALL, range: 130, burns: true },

  // ---- the demon halls --------------------------------------------------
  [KIND.DEMON]:    { name: 'SUCCUBUS', sprite: 'DEMON', hp: 50, dmg: 16, speed: 2.3, xp: 40, ai: 'chase', box: BIG, blinks: true },
  [KIND.EYE]:      { name: 'EVIL EYE', sprite: 'EYE', hp: 44, dmg: 18, speed: 1.3, xp: 42, ai: 'shooter', box: BIG, shot: KIND.BEAM, range: 170 },
  [KIND.SCORPIO]:  { name: 'SCORPIO', sprite: 'SCORPIO', hp: 46, dmg: 15, speed: 1.6, xp: 41, ai: 'shooter', box: BIG, shot: KIND.DART, range: 150, keepsAway: true },

  // ---- the five chapter bosses -----------------------------------------
  [KIND.BOSS_GLUT]: {
    name: 'GLUT, THE SWOLLEN', sprite: 'BOSS_GLUT', hp: 90, dmg: 8, speed: 1.1, xp: 60,
    ai: 'boss', box: HUGE, w: 32, h: 32, shot: KIND.ACID, splitsOnDeath: KIND.SLIME,
  },
  [KIND.BOSS_WARDEN]: {
    name: 'THE WARDEN', sprite: 'BOSS_WARDEN', hp: 150, dmg: 12, speed: 1.8, xp: 120,
    ai: 'boss', box: HUGE, w: 32, h: 32, shot: KIND.DART, summons: KIND.SKELETON,
  },
  [KIND.BOSS_TYRANT]: {
    name: 'THE ORE TYRANT', sprite: 'BOSS_TYRANT', hp: 230, dmg: 16, speed: 1.4, xp: 200,
    ai: 'boss', box: HUGE, w: 32, h: 32, shot: KIND.FIREBALL, charges: true,
  },
  [KIND.BOSS_KING]: {
    name: 'THE BURIED KING', sprite: 'BOSS_KING', hp: 320, dmg: 20, speed: 1.5, xp: 300,
    ai: 'boss', box: HUGE, w: 32, h: 32, shot: KIND.BOLT, summons: KIND.GOLEM,
  },
  [KIND.BOSS_UNSLEEPING]: {
    name: 'THE UNSLEEPING', sprite: 'BOSS_UNSLEEPING', hp: 450, dmg: 24, speed: 0.9, xp: 500,
    ai: 'boss', box: HUGE, w: 32, h: 32, shot: KIND.BEAM, summons: KIND.DEMON, fan: true,
  },
};

/** Who can turn up on a given floor. */
export const SPAWNS = {
  sewers: [KIND.RAT, KIND.RAT, KIND.SNAKE, KIND.FLY, KIND.SLIME, KIND.CRAB],
  prison: [KIND.SKELETON, KIND.SKELETON, KIND.THIEF, KIND.GUARD, KIND.SHAMAN, KIND.WRAITH],
  caves:  [KIND.BAT, KIND.BAT, KIND.BRUTE, KIND.SPIDER, KIND.GOLEM],
  city:   [KIND.MONK, KIND.WARLOCK, KIND.ELEMENTAL, KIND.GOLEM, KIND.MONK],
  halls:  [KIND.DEMON, KIND.EYE, KIND.SCORPIO, KIND.DEMON],
};

export const BOSS_OF = {
  sewers: KIND.BOSS_GLUT,
  prison: KIND.BOSS_WARDEN,
  caves: KIND.BOSS_TYRANT,
  city: KIND.BOSS_KING,
  halls: KIND.BOSS_UNSLEEPING,
};

/** How many wander a floor at once, and how fast the floor refills. */
export function mobBudget(depth) {
  return 8 + Math.floor(depth / 2);
}

/** How close something has to be before it hears you through a wall. */
export const HEARING = 6 * 16;

/** Deeper floors make even the same creature meaner. */
export function scaleFor(depth, region) {
  const within = depth - region.from;      // 0..4 inside the chapter
  return 1 + within * 0.09;
}
