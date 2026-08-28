// Terrain for a full 32x32 floor. Modelled on the tile vocabulary Pixel
// Dungeon uses — passability and line-of-sight are separate properties, which
// is what makes high grass and doorways interesting.

export const LEVEL_W = 32;
export const LEVEL_H = 32;
export const LEVEL_LEN = LEVEL_W * LEVEL_H;

export const TT = {
  WALL: 0,
  FLOOR: 1,
  FLOOR_DECO: 2,     // patterned flagstone
  GRASS: 3,
  HIGH_GRASS: 4,     // blocks sight until trampled
  WATER: 5,          // wade through it slowly
  CHASM: 6,          // fall to the next floor
  DOOR: 7,           // shut; opens when you walk into it
  OPEN_DOOR: 8,
  LOCKED_DOOR: 9,    // needs this floor's iron key
  BARRICADE: 10,     // breaks to a bomb or fire
  ENTRANCE: 11,      // stairs up
  EXIT: 12,          // stairs down
  LOCKED_EXIT: 13,   // boss floors: sealed until the boss falls
  EMBERS: 14,
  TRAP_HIDDEN: 15,
  TRAP: 16,          // revealed and armed
  TRAP_SPENT: 17,
  STATUE: 18,
  BOOKSHELF: 19,
  PEDESTAL: 20,
  WELL: 21,
  WALL_DECO: 22,     // torch bracket / vent, still a wall
  SIGN: 23,
  RUBBLE: 24,
  CRACKED: 25,     // gives way the moment you stand on it
  SECRET_DOOR: 26, // reads as wall until somebody searches it
  POT: 27,         // the alchemy pot in a laboratory
};

// A tile you can walk onto.
const PASSABLE = new Set([
  TT.FLOOR, TT.FLOOR_DECO, TT.GRASS, TT.HIGH_GRASS, TT.WATER, TT.OPEN_DOOR,
  TT.ENTRANCE, TT.EXIT, TT.EMBERS, TT.TRAP_HIDDEN, TT.TRAP, TT.TRAP_SPENT,
  TT.PEDESTAL, TT.SIGN, TT.RUBBLE, TT.CRACKED, TT.POT,
]);

// A tile that stops you seeing past it.
const LOS_BLOCK = new Set([
  TT.WALL, TT.WALL_DECO, TT.DOOR, TT.LOCKED_DOOR, TT.BARRICADE,
  TT.HIGH_GRASS, TT.BOOKSHELF, TT.STATUE, TT.LOCKED_EXIT, TT.SECRET_DOOR,
]);

// A tile a flying creature can cross that a walker cannot.
const FLYABLE = new Set([TT.CHASM, TT.WATER]);

// A tile a projectile passes over.
const SHOT_PASS = new Set([
  TT.FLOOR, TT.FLOOR_DECO, TT.GRASS, TT.HIGH_GRASS, TT.WATER, TT.CHASM,
  TT.OPEN_DOOR, TT.ENTRANCE, TT.EXIT, TT.EMBERS, TT.TRAP_HIDDEN, TT.TRAP,
  TT.TRAP_SPENT, TT.PEDESTAL, TT.SIGN, TT.RUBBLE, TT.WELL, TT.CRACKED, TT.POT,
]);

const FLAMMABLE = new Set([TT.GRASS, TT.HIGH_GRASS, TT.DOOR, TT.OPEN_DOOR, TT.BARRICADE, TT.BOOKSHELF]);

export function passable(t) { return PASSABLE.has(t); }
export function blocksSight(t) { return LOS_BLOCK.has(t); }
export function flyable(t) { return PASSABLE.has(t) || FLYABLE.has(t); }
export function shotPasses(t) { return SHOT_PASS.has(t); }
export function flammable(t) { return FLAMMABLE.has(t); }
export function isDoor(t) { return t === TT.DOOR || t === TT.OPEN_DOOR || t === TT.LOCKED_DOOR; }
export function isTrap(t) { return t === TT.TRAP_HIDDEN || t === TT.TRAP; }

/** Tiles a mob or item may be dropped on. */
export function spawnable(t) {
  return t === TT.FLOOR || t === TT.FLOOR_DECO || t === TT.GRASS ||
         t === TT.HIGH_GRASS || t === TT.EMBERS || t === TT.RUBBLE ||
         t === TT.CRACKED;
}

export const idx = (x, y) => y * LEVEL_W + x;
export const tx = (i) => i % LEVEL_W;
export const ty = (i) => (i / LEVEL_W) | 0;
export const inBounds = (x, y) => x >= 0 && y >= 0 && x < LEVEL_W && y < LEVEL_H;

// ---------------------------------------------------------------------------
// Regions — five chapters of five floors, a boss on every fifth.
// ---------------------------------------------------------------------------
export const REGIONS = [
  { key: 'sewers', name: 'THE SEWERS',      from: 1,  to: 5,  boss: 'GLUT',        wet: 0.55, green: 0.60 },
  { key: 'prison', name: 'THE PRISON',      from: 6,  to: 10, boss: 'THE WARDEN',  wet: 0.20, green: 0.25 },
  { key: 'caves',  name: 'THE CAVES',       from: 11, to: 15, boss: 'ORE TYRANT',  wet: 0.25, green: 0.35 },
  { key: 'city',   name: 'THE METROPOLIS',  from: 16, to: 20, boss: 'THE KING',    wet: 0.15, green: 0.20 },
  { key: 'halls',  name: 'THE DEMON HALLS', from: 21, to: 25, boss: 'THE UNSLEEPING', wet: 0.10, green: 0.10 },
];

export const MAX_DEPTH = 25;

export function regionOf(depth) {
  for (const r of REGIONS) if (depth >= r.from && depth <= r.to) return r;
  return REGIONS[REGIONS.length - 1];
}

export function isBossDepth(depth) {
  return regionOf(depth).to === depth;
}

// ---------------------------------------------------------------------------
// A small seeded RNG so a floor can be regenerated exactly.
// ---------------------------------------------------------------------------
export function rngFor(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return {
    next() {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) { return Math.floor(this.next() * n); },
    range(a, b) { return a + Math.floor(this.next() * (b - a + 1)); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
    chance(p) { return this.next() < p; },
    shuffle(arr) {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(this.next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}
