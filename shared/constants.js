// Shared constants — imported by BOTH the Node server and the browser client.
// Keep this file free of any platform-specific API.

export const TILE = 16;

// A room is one screen, exactly like the original: 16x11 tiles of 16px.
export const ROOM_W = 16;
export const ROOM_H = 11;
export const PLAY_W = ROOM_W * TILE; // 256
export const PLAY_H = ROOM_H * TILE; // 176

// NES-shaped screen: 256x240, with a 64px status bar on top.
export const HUD_H = 64;
export const SCREEN_W = 256;
export const SCREEN_H = HUD_H + PLAY_H; // 240

// Simulation runs at a fixed 30Hz on the server; the client renders at 60.
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const SNAPSHOT_EVERY = 1; // send a snapshot every N ticks

export const MAX_PLAYERS = 4;

// ---------------------------------------------------------------------------
// Directions: N, E, S, W  (index order matters — it is on the wire)
// ---------------------------------------------------------------------------
export const N = 0, E = 1, S = 2, W = 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const OPPOSITE = [S, W, N, E];
export const DIR_NAME = ['n', 'e', 's', 'w'];

// ---------------------------------------------------------------------------
// Tiles
// ---------------------------------------------------------------------------
export const T = {
  FLOOR: 0,
  FLOOR_ALT: 1,   // patterned floor
  WALL: 2,        // dungeon brick
  BLOCK: 3,       // decorative solid block
  STATUE_L: 4,    // gargoyle statue facing right
  STATUE_R: 5,    // gargoyle statue facing left
  WATER: 6,       // impassable to walkers, passable to flyers/shots
  STAIRS: 7,      // level exit / secret stair
  PUSH: 8,        // pushable block
  CRACK: 9,       // cracked floor decoration
  DOORWAY: 10,    // the passable gap in a wall; behaviour comes from door state
  RUBBLE: 11,
  ALTAR: 12,
  SAND: 13,
};

// Tiles a walking entity cannot enter.
export const SOLID = new Set([T.WALL, T.BLOCK, T.STATUE_L, T.STATUE_R, T.WATER, T.PUSH]);
// Tiles that stop a projectile.
export const SHOT_SOLID = new Set([T.WALL, T.BLOCK, T.STATUE_L, T.STATUE_R, T.PUSH]);
// Tiles a flying enemy cannot enter (flyers cross water and blocks, not walls).
export const FLY_SOLID = new Set([T.WALL]);

// ---------------------------------------------------------------------------
// Doors
// ---------------------------------------------------------------------------
export const DOOR = {
  NONE: 0,   // solid wall, no doorway drawn
  OPEN: 1,   // always passable
  SHUT: 2,   // barred until every enemy in the room is dead
  LOCK: 3,   // needs a small key
  BOMB: 4,   // cracked wall — needs a bomb
  BOSS: 5,   // needs the Skull Key
};

// Doorway tile coordinates within a room, per direction.
// North/South doorways are 2 tiles wide; East/West are 1 tile tall.
export const DOOR_TILES = {
  [N]: [[7, 0], [8, 0]],
  [S]: [[7, ROOM_H - 1], [8, ROOM_H - 1]],
  [E]: [[ROOM_W - 1, 5]],
  [W]: [[0, 5]],
};

// Where a player is placed after walking through a door into the next room.
export const ENTRY_POS = {
  [N]: { x: 7 * TILE + 8, y: 1 * TILE + 4 },              // came in through the north door
  [S]: { x: 7 * TILE + 8, y: (ROOM_H - 2) * TILE - 4 },
  [E]: { x: (ROOM_W - 2) * TILE, y: 5 * TILE },
  [W]: { x: 1 * TILE, y: 5 * TILE },
};

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------
export const KIND = {
  PLAYER: 0,
  BAT: 1,          // erratic flyer, crosses water
  SLIME: 2,        // slow hopper, splits when struck
  SLIMELET: 3,     // the halves
  BONEWALKER: 4,   // tile-grid walker
  HURLER: 5,       // throws a returning blade
  IRONCLAD: 6,     // armoured front, must be hit from the side or behind
  WISP: 7,         // teleports, fires magic
  GRABHAND: 8,     // creeps out of the wall and drags you back to the entrance
  WYRM: 9,         // boss
  // projectiles
  FIREBALL: 20,
  MAGIC: 21,
  BLADE: 22,       // hurler's thrown blade
  BOOMERANG: 23,   // the player's boomerang
  BEAM: 24,        // the sword beam thrown at full hearts
  BOMB: 25,
  BLAST: 26,       // explosion
  // pickups
  DROP: 30,
  // decoration
  POOF: 40,
};

export const PICKUP = {
  HEART: 0,
  GEM: 1,
  GEM_BIG: 2,
  BOMB: 3,
  KEY: 4,
  FAIRY: 5,
  CLOCK: 6,
  MAP: 7,
  COMPASS: 8,
  BOOMERANG: 9,
  BOMBBAG: 10,
  HEART_CONTAINER: 11,
  SKULL_KEY: 12,
  RELIC: 13,
  POTION: 14,
};

// A pickup that belongs to the whole party and never disappears.
export const PERMANENT = new Set([
  PICKUP.MAP, PICKUP.COMPASS, PICKUP.BOOMERANG, PICKUP.BOMBBAG,
  PICKUP.HEART_CONTAINER, PICKUP.SKULL_KEY, PICKUP.RELIC,
]);

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------
export const PLAYER_SPEED = 2.0;       // px per tick (60 px/s)
export const PLAYER_BOX = { x: 2, y: 4, w: 12, h: 11 }; // hitbox inside the 16x16 sprite
export const ATTACK_TICKS = 9;         // sword out for 9 ticks
export const ATTACK_LOCK = 4;          // ticks of held-still before the swing lands
export const INVULN_TICKS = 45;        // 1.5s of mercy after taking a hit
export const KNOCKBACK_TICKS = 6;
export const KNOCKBACK_SPEED = 5;
export const TRANSITION_TICKS = 24;    // room scroll length
export const REVIVE_TICKS = 60;        // 2s standing on a downed ally
export const GHOST_AUTO_REVIVE = 900;  // 30s and you come back on your own

export const START_HEARTS = 3;
export const MAX_HEARTS = 16;

// Input bit flags (kept tiny — this goes over the wire 30x a second).
export const IN = {
  UP: 1, RIGHT: 2, DOWN: 4, LEFT: 8, A: 16, B: 32,
};

export const PLAYER_COLORS = ['green', 'blue', 'red', 'violet'];

export function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

export function rectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && bx < ax + aw && ay < by + bh && by < ay + ah;
}

// Deterministic RNG so the server can be replayed/debugged.
export function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function rng() {
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
