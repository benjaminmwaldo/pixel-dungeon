// The dungeon. Hand-authored, one screen per room, exactly like Level 1 of the
// game this is modelled on. Every room interior is 14x9 tiles of ASCII art:
//
//   .  floor            #  brick block        ~  water
//   ,  patterned floor  <  statue (faces E)   >  statue (faces W)
//   B  pushable block   S  stairs             A  altar / dais
//   x  cracked floor    %  rubble             s  sand
//
// The outer ring of every room is wall; doorways are punched in by DOOR_TILES.

import { T, ROOM_W, ROOM_H, DOOR, N, E, S, W, DOOR_TILES, KIND, PICKUP } from './constants.js';

const CH = {
  '.': T.FLOOR, ',': T.FLOOR_ALT, '#': T.BLOCK, '<': T.STATUE_L, '>': T.STATUE_R,
  '~': T.WATER, 'B': T.PUSH, 'S': T.STAIRS, 'A': T.ALTAR, 'x': T.CRACK,
  '%': T.RUBBLE, 's': T.SAND,
};

export const DUNGEON_NAME = 'THE SUNKEN CRYPT';
export const GRID_W = 8;
export const GRID_H = 8;
export const START_ROOM = '3,6';

// ---------------------------------------------------------------------------
// Rooms
// ---------------------------------------------------------------------------
export const ROOMS = [
  {
    id: '3,6', gx: 3, gy: 6, name: 'ENTRANCE', start: true,
    art: [
      '..............',
      '...,,,,,,,,...',
      '...,......,...',
      '...,......,...',
      '...,......,...',
      '...,......,...',
      '...,,,,,,,,...',
      '..............',
      '......SS......',
    ],
    enemies: [],
  },
  {
    id: '3,5', gx: 3, gy: 5, name: 'ANTECHAMBER',
    art: [
      '..............',
      '.<..........>.',
      '..............',
      '.....####.....',
      '.....#..#.....',
      '.....####.....',
      '..............',
      '.<..........>.',
      '..............',
    ],
    enemies: [{ k: KIND.SLIME, n: 3 }],
  },
  {
    id: '2,5', gx: 2, gy: 5, name: 'WEST HALL',
    art: [
      '..............',
      '..##......##..',
      '..##......##..',
      '..............',
      '..............',
      '..............',
      '..##......##..',
      '..##......##..',
      '..............',
    ],
    enemies: [{ k: KIND.BAT, n: 3 }, { k: KIND.BONEWALKER, n: 2 }],
    reward: PICKUP.KEY,
  },
  {
    id: '1,5', gx: 1, gy: 5, name: 'BAT ROOST',
    art: [
      '..............',
      '.#.#.#..#.#.#.',
      '..............',
      '.#.#.#..#.#.#.',
      '..............',
      '.#.#.#..#.#.#.',
      '..............',
      '.#.#.#..#.#.#.',
      '..............',
    ],
    enemies: [{ k: KIND.BAT, n: 5 }],
    item: PICKUP.BOMBBAG,
  },
  {
    id: '4,5', gx: 4, gy: 5, name: 'EAST HALL',
    art: [
      '..............',
      '..............',
      '...~~~~~~~~...',
      '...~......~...',
      '..............',
      '...~......~...',
      '...~~~~~~~~...',
      '..............',
      '..............',
    ],
    enemies: [{ k: KIND.BONEWALKER, n: 3 }],
  },
  {
    id: '5,5', gx: 5, gy: 5, name: 'CISTERN',
    art: [
      '..~~......~~..',
      '..~~......~~..',
      '..............',
      '..............',
      '..............',
      '..............',
      '..............',
      '..~~......~~..',
      '..~~......~~..',
    ],
    enemies: [{ k: KIND.SLIME, n: 2 }, { k: KIND.BAT, n: 2 }],
    item: PICKUP.COMPASS,
  },
  {
    id: '5,4', gx: 5, gy: 4, name: 'FLOODED PASSAGE',
    art: [
      '..............',
      '.~~~~~..~~~~~.',
      '.~~~~~..~~~~~.',
      '..............',
      '..............',
      '..............',
      '.~~~~~..~~~~~.',
      '.~~~~~..~~~~~.',
      '..............',
    ],
    enemies: [{ k: KIND.HURLER, n: 2 }],
  },
  {
    id: '5,3', gx: 5, gy: 3, name: 'GUARD POST',
    art: [
      '..............',
      '.<..........>.',
      '..............',
      '..#........#..',
      '..............',
      '..#........#..',
      '..............',
      '.<..........>.',
      '..............',
    ],
    enemies: [{ k: KIND.IRONCLAD, n: 2 }, { k: KIND.BONEWALKER, n: 2 }],
    reward: PICKUP.KEY,
  },
  {
    id: '4,4', gx: 4, gy: 4, name: 'STOREROOM',
    art: [
      '..............',
      '..#.#.#.#.#...',
      '..............',
      '..#.#.#.#.#...',
      '..............',
      '..#.#.#.#.#...',
      '..............',
      '..#.#.#.#.#...',
      '..............',
    ],
    enemies: [{ k: KIND.SLIME, n: 4 }],
    item: PICKUP.GEM_BIG,
  },
  {
    id: '2,4', gx: 2, gy: 4, name: 'MAP ROOM',
    art: [
      '..............',
      '..............',
      '...##....##...',
      '...##....##...',
      '..............',
      '...##....##...',
      '...##....##...',
      '..............',
      '..............',
    ],
    enemies: [{ k: KIND.BONEWALKER, n: 2 }, { k: KIND.BAT, n: 2 }],
    item: PICKUP.MAP,
  },
  {
    id: '3,4', gx: 3, gy: 4, name: 'MOAT HALL',
    art: [
      '..............',
      '..~~~~..~~~~..',
      '..~........~..',
      '..~........~..',
      '.....,,,,.....',
      '..~........~..',
      '..~........~..',
      '..~~~~..~~~~..',
      '..............',
    ],
    enemies: [{ k: KIND.HURLER, n: 2 }, { k: KIND.BAT, n: 2 }],
  },
  {
    id: '3,3', gx: 3, gy: 3, name: 'CROSSROADS',
    art: [
      '..............',
      '.<..........>.',
      '..............',
      '..##########..',
      '..............',
      '..............',
      '..#BB####BB#..',
      '..............',
      '..............',
    ],
    enemies: [{ k: KIND.BONEWALKER, n: 3 }],
    // Pushing the correct block raises the west shutter.
    pushBlock: { ix: 9, iy: 6 },
    pushOpens: W,
  },
  {
    id: '2,3', gx: 2, gy: 3, name: 'VAULT OF THE BLADE',
    art: [
      '..............',
      '..~~~~~~~~~~..',
      '..~........~..',
      '..~........~..',
      '.....,AA,.....',
      '..~........~..',
      '..~........~..',
      '..~~~~~~~~~~..',
      '..............',
    ],
    enemies: [{ k: KIND.HURLER, n: 3 }],
    item: PICKUP.BOOMERANG,
    itemTile: { ix: 6, iy: 4 },
  },
  {
    id: '1,3', gx: 1, gy: 3, name: 'SEALED VAULT',
    art: [
      '..............',
      '.,,,,,,,,,,,,.',
      '.,,########,,.',
      '.,,#......#,,.',
      '.....,AA,.....',
      '.,,#......#,,.',
      '.,,########,,.',
      '.,,,,,,,,,,,,.',
      '..............',
    ],
    enemies: [],
    item: PICKUP.HEART_CONTAINER,
    itemTile: { ix: 6, iy: 4 },
  },
  {
    id: '4,3', gx: 4, gy: 3, name: 'BARRACKS',
    art: [
      '..............',
      '.<..........>.',
      '..............',
      '..............',
      '..............',
      '..............',
      '..............',
      '.<..........>.',
      '..............',
    ],
    enemies: [{ k: KIND.IRONCLAD, n: 3 }],
    reward: PICKUP.KEY,
  },
  {
    id: '3,2', gx: 3, gy: 2, name: 'HALL OF THE SKULL',
    art: [
      '..............',
      '.####....####.',
      '.#..........#.',
      '..............',
      '..............',
      '..............',
      '.#..........#.',
      '.####....####.',
      '..............',
    ],
    enemies: [{ k: KIND.GRABHAND, n: 2 }, { k: KIND.WISP, n: 1 }],
  },
  {
    id: '2,2', gx: 2, gy: 2, name: 'CORRIDOR OF HANDS',
    art: [
      '..............',
      '..............',
      '..#.#.#.#.#.#.',
      '..............',
      '..............',
      '..............',
      '..#.#.#.#.#.#.',
      '..............',
      '..............',
    ],
    enemies: [{ k: KIND.GRABHAND, n: 3 }, { k: KIND.SLIME, n: 2 }],
    reward: PICKUP.KEY,
  },
  {
    id: '4,2', gx: 4, gy: 2, name: 'WISP SANCTUM',
    art: [
      '..............',
      '.<...####...>.',
      '.....#..#.....',
      '.....####.....',
      '..............',
      '.....####.....',
      '.....#..#.....',
      '.<...####...>.',
      '..............',
    ],
    enemies: [{ k: KIND.WISP, n: 3 }],
    reward: PICKUP.SKULL_KEY,
  },
  {
    id: '3,1', gx: 3, gy: 1, name: 'THE DROWNED WYRM', boss: true,
    art: [
      '..............',
      '.,,,,,,,,,,,,.',
      '.,~~~~..~~~~,.',
      '.,~........~,.',
      '..............',
      '.,~........~,.',
      '.,~~~~..~~~~,.',
      '.,,,,,,,,,,,,.',
      '..............',
    ],
    enemies: [{ k: KIND.WYRM, n: 1 }],
    reward: PICKUP.HEART_CONTAINER,
  },
  {
    id: '3,0', gx: 3, gy: 0, name: 'RELIC CHAMBER',
    art: [
      '..............',
      '.,,,,,,,,,,,,.',
      '.,,,,,,,,,,,,.',
      '.,,,,,,,,,,,,.',
      '.,,,,,,,,,,,,.',
      '.,,,,,AA,,,,,.',
      '.,,,,,,,,,,,,.',
      '.,,,,,,,,,,,,.',
      '..............',
    ],
    enemies: [],
    item: PICKUP.RELIC,
    itemTile: { ix: 6, iy: 5 },
  },
];

// ---------------------------------------------------------------------------
// Links — defined once per doorway so the two sides can never disagree.
// ---------------------------------------------------------------------------
const LINKS = [
  { from: '3,6', dir: N, type: DOOR.OPEN },
  { from: '3,5', dir: W, type: DOOR.OPEN },
  { from: '3,5', dir: E, type: DOOR.OPEN },
  { from: '3,5', dir: N, type: DOOR.SHUT },
  { from: '2,5', dir: W, type: DOOR.LOCK },
  { from: '2,5', dir: N, type: DOOR.SHUT },
  { from: '4,5', dir: E, type: DOOR.OPEN },
  { from: '5,5', dir: N, type: DOOR.OPEN },
  { from: '5,4', dir: N, type: DOOR.SHUT },
  { from: '5,4', dir: W, type: DOOR.BOMB },
  { from: '4,4', dir: W, type: DOOR.OPEN },
  { from: '2,4', dir: E, type: DOOR.OPEN },
  { from: '3,4', dir: N, type: DOOR.OPEN },
  { from: '3,3', dir: W, type: DOOR.SHUT },
  { from: '3,3', dir: E, type: DOOR.OPEN },
  { from: '3,3', dir: N, type: DOOR.LOCK },
  { from: '2,3', dir: W, type: DOOR.BOMB },
  { from: '4,3', dir: N, type: DOOR.OPEN },
  { from: '5,3', dir: W, type: DOOR.OPEN },
  { from: '3,2', dir: W, type: DOOR.OPEN },
  { from: '3,2', dir: E, type: DOOR.OPEN },
  { from: '3,2', dir: N, type: DOOR.BOSS },
  { from: '3,1', dir: N, type: DOOR.SHUT },
];

// ---------------------------------------------------------------------------
// Build the lookup tables
// ---------------------------------------------------------------------------
export const ROOM_BY_ID = new Map();
for (const r of ROOMS) {
  r.doors = [DOOR.NONE, DOOR.NONE, DOOR.NONE, DOOR.NONE];
  ROOM_BY_ID.set(r.id, r);
}

function neighbourId(room, dir) {
  const dx = [0, 1, 0, -1][dir];
  const dy = [-1, 0, 1, 0][dir];
  return `${room.gx + dx},${room.gy + dy}`;
}

for (const link of LINKS) {
  const a = ROOM_BY_ID.get(link.from);
  if (!a) throw new Error(`link from unknown room ${link.from}`);
  const bid = neighbourId(a, link.dir);
  const b = ROOM_BY_ID.get(bid);
  if (!b) throw new Error(`link ${link.from} -> ${bid} has no room on the far side`);
  a.doors[link.dir] = link.type;
  b.doors[[S, W, N, E][link.dir]] = link.type;
}

// Cache the tile array for each room; doors are overlaid at runtime from state.
for (const r of ROOMS) r.tiles = buildTiles(r);

export function buildTiles(room) {
  const tiles = new Uint8Array(ROOM_W * ROOM_H);
  // Wall ring
  for (let y = 0; y < ROOM_H; y++) {
    for (let x = 0; x < ROOM_W; x++) {
      const edge = (x === 0 || y === 0 || x === ROOM_W - 1 || y === ROOM_H - 1);
      tiles[y * ROOM_W + x] = edge ? T.WALL : T.FLOOR;
    }
  }
  // Interior art
  for (let iy = 0; iy < 9; iy++) {
    const row = room.art[iy];
    if (row.length !== 14) {
      throw new Error(`room ${room.id} art row ${iy} is ${row.length} chars, expected 14`);
    }
    for (let ix = 0; ix < 14; ix++) {
      const t = CH[row[ix]];
      if (t === undefined) throw new Error(`room ${room.id}: unknown art char "${row[ix]}"`);
      tiles[(iy + 1) * ROOM_W + (ix + 1)] = t;
    }
  }
  // Punch the doorways
  for (let dir = 0; dir < 4; dir++) {
    if (room.doors[dir] === DOOR.NONE) continue;
    for (const [tx, ty] of DOOR_TILES[dir]) tiles[ty * ROOM_W + tx] = T.DOORWAY;
  }
  return tiles;
}

export function roomAt(gx, gy) { return ROOM_BY_ID.get(`${gx},${gy}`); }

export function neighbourOf(room, dir) { return ROOM_BY_ID.get(neighbourId(room, dir)); }

// Every tile a walker may stand on, for spawn placement.
export function freeTiles(room) {
  const out = [];
  for (let y = 2; y < ROOM_H - 2; y++) {
    for (let x = 2; x < ROOM_W - 2; x++) {
      const t = room.tiles[y * ROOM_W + x];
      if (t === T.FLOOR || t === T.FLOOR_ALT || t === T.SAND || t === T.CRACK || t === T.RUBBLE) {
        out.push([x, y]);
      }
    }
  }
  return out;
}
