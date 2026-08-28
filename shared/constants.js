// Shared constants — imported by BOTH the Node server and the browser client.

export const TILE = 16;

// The screen. A 4:3 retro frame: status bar on top, the floor below it.
export const HUD_H = 48;
export const SCREEN_W = 320;
export const SCREEN_H = 240;
export const VIEW_W = SCREEN_W;          // 20 tiles across
export const VIEW_H = SCREEN_H - HUD_H;  // 12 tiles down

// Simulation runs at a fixed 30Hz on the server; the client renders at 60.
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const MAX_PLAYERS = 4;

// ---------------------------------------------------------------------------
// Directions: N, E, S, W
// ---------------------------------------------------------------------------
export const N = 0, E = 1, S = 2, W = 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const OPPOSITE = [S, W, N, E];

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
export const KIND = {
  // mobs 1..39
  RAT: 1, SNAKE: 2, CRAB: 3, SLIME: 4, FLY: 5,
  SKELETON: 6, THIEF: 7, GUARD: 8, SHAMAN: 9, WRAITH: 10,
  BAT: 11, BRUTE: 12, SPIDER: 13, GOLEM: 14,
  MONK: 15, WARLOCK: 16, ELEMENTAL: 17,
  DEMON: 18, EYE: 19, SCORPIO: 20,
  SHEEP: 21,

  // townsfolk, who happen to live very far underground
  SHOPKEEPER: 22,

  MIMIC: 26,
  BOSS_GLUT: 30, BOSS_WARDEN: 31, BOSS_TYRANT: 32, BOSS_KING: 33, BOSS_UNSLEEPING: 34,

  // projectiles 40..59
  ARROW: 40, BOLT: 41, FIREBALL: 42, DART: 43, WEB: 44, ACID: 45, BEAM: 46,

  // world 60+
  ITEM: 60, BOMB: 61, BLAST: 62, POOF: 63, GAS: 64, WARD: 65,
};

export const MOB_MIN = 1, MOB_MAX = 39;
export const isMob = (k) => k >= MOB_MIN && k <= MOB_MAX;
export const isBoss = (k) => k >= 30 && k <= 39;
// Somebody who talks rather than bites.
export const NPC_MIN = 22, NPC_MAX = 25;
export const isNpc = (k) => k >= NPC_MIN && k <= NPC_MAX;

// ---------------------------------------------------------------------------
// Hero classes — one per player slot, so a full party covers every role.
// ---------------------------------------------------------------------------
export const CLASSES = {
  warrior: {
    name: 'WARRIOR', colour: 'red', hp: 25, speed: 1.9, melee: 4, reach: 20,
    sight: 8, ranged: null,
    blurb: 'TOUGH. HITS HARDEST IN REACH.',
  },
  mage: {
    name: 'MAGE', colour: 'blue', hp: 16, speed: 2.0, melee: 1, reach: 16,
    sight: 9, ranged: { kind: KIND.BOLT, dmg: 4, cd: 22, speed: 4.2, range: 150 },
    blurb: 'ARCANE BOLTS. FRAIL.',
  },
  rogue: {
    name: 'ROGUE', colour: 'violet', hp: 19, speed: 2.4, melee: 3, reach: 18,
    sight: 8, ranged: null, sneak: true,
    blurb: 'QUICK. SEES TRAPS AND SECRETS.',
  },
  ranger: {
    name: 'RANGER', colour: 'green', hp: 19, speed: 2.0, melee: 2, reach: 17,
    sight: 10, ranged: { kind: KIND.ARROW, dmg: 3, cd: 16, speed: 5, range: 190 },
    blurb: 'ARROWS AT RANGE. KEEN EYES.',
  },
};
export const CLASS_ORDER = ['warrior', 'mage', 'rogue', 'ranger'];

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
export const PLAYER_BOX = { x: 3, y: 5, w: 10, h: 10 };
export const ATTACK_TICKS = 9;
export const INVULN_TICKS = 30;
export const KNOCKBACK_TICKS = 5;
export const KNOCKBACK_SPEED = 4;
export const REVIVE_TICKS = 60;
export const GHOST_TICKS = 1200;      // 40s as a spirit before you are pulled back
export const WATER_SLOW = 0.55;       // wading costs you speed
export const GRASS_SLOW = 0.85;

export const XP_PER_LEVEL = (lvl) => 8 + lvl * 6;
export const HP_PER_LEVEL = 4;

export const HUNGER_MAX = 5400;       // 3 minutes of walking per ration
export const HUNGER_HURT = 90;        // ticks between starvation damage

// Input bit flags.
export const IN = { UP: 1, RIGHT: 2, DOWN: 4, LEFT: 8, A: 16, B: 32 };

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

export function dist2(ax, ay, bx, by) {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
}
