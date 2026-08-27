// Floor generation. Rooms are carved by recursive binary splitting, connected
// through doors on shared walls, and the leftover rooms become the corridors
// that tie the floor together — the same shape of generator the game this is
// modelled on uses, written from scratch here.
//
// A floor is 32x32 tiles. Rooms share their boundary walls, so a door is
// always a single cell on the line between two rooms.

import {
  LEVEL_W, LEVEL_H, LEVEL_LEN, TT, idx, tx, ty, inBounds,
  passable, spawnable, regionOf, isBossDepth, rngFor,
} from './terrain.js';
import { rollTrap } from './traps.js';

const MIN_SIZE = 7;
const MAX_SIZE = 9;

export const ROOM = {
  STANDARD: 'standard',
  ENTRANCE: 'entrance',
  EXIT: 'exit',
  TUNNEL: 'tunnel',
  TREASURE: 'treasure',
  LIBRARY: 'library',
  GARDEN: 'garden',
  WELL: 'well',
  STATUARY: 'statuary',
  VAULT: 'vault',
  ARENA: 'arena',
};

// Special rooms only ever go in dead ends, so they never block the way down.
const SPECIALS = [ROOM.TREASURE, ROOM.LIBRARY, ROOM.GARDEN, ROOM.WELL, ROOM.STATUARY];

// ---------------------------------------------------------------------------
export function generate(depth, seed) {
  const rng = rngFor((seed * 2654435761 + depth * 40503) >>> 0);
  return isBossDepth(depth) ? bossFloor(depth, rng) : regularFloor(depth, rng);
}

// ---------------------------------------------------------------------------
// Regular floors
// ---------------------------------------------------------------------------
function regularFloor(depth, rng) {
  const region = regionOf(depth);
  const tiles = new Uint8Array(LEVEL_LEN).fill(TT.WALL);

  // 1. carve the space into rooms
  const rooms = [];
  split({ l: 0, t: 0, r: LEVEL_W - 1, b: LEVEL_H - 1 }, rooms, rng, 0);
  for (const r of rooms) {
    r.type = ROOM.TUNNEL;
    r.doors = [];
    r.links = new Set();
  }

  // 2. work out who touches whom
  const edges = [];
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      const e = sharedWall(rooms[i], rooms[j]);
      if (e) edges.push({ a: i, b: j, ...e });
    }
  }
  const adj = rooms.map(() => []);
  for (let k = 0; k < edges.length; k++) {
    adj[edges[k].a].push(k);
    adj[edges[k].b].push(k);
  }

  // 3. the way in and the way down: big rooms, as far apart as we can manage
  const big = rooms.map((r, i) => i).filter(i => roomW(rooms[i]) >= 5 && roomH(rooms[i]) >= 5);
  if (big.length < 2) return regularFloor(depth, rngFor(rng.int(1 << 30) + 7));
  let entrance = big[0], exit = big[1], best = -1;
  for (const a of big) {
    for (const b of big) {
      if (a === b) continue;
      const d = Math.abs(centreX(rooms[a]) - centreX(rooms[b])) + Math.abs(centreY(rooms[a]) - centreY(rooms[b]));
      if (d > best) { best = d; entrance = a; exit = b; }
    }
  }
  rooms[entrance].type = ROOM.ENTRANCE;
  rooms[exit].type = ROOM.EXIT;

  // 4. connect everything, then add a few loops so it is not a pure tree
  const used = new Set();
  connectAll(rooms, edges, adj, entrance, used, rng);
  for (let k = 0; k < edges.length; k++) {
    if (!used.has(k) && rng.chance(0.28)) used.add(k);
  }
  for (const k of used) {
    const e = edges[k];
    rooms[e.a].links.add(e.b);
    rooms[e.b].links.add(e.a);
  }

  // 5. decide what each room is
  const deadEnds = rooms.map((r, i) => i)
    .filter(i => rooms[i].links.size === 1 && rooms[i].type === ROOM.TUNNEL &&
                 roomW(rooms[i]) >= 4 && roomH(rooms[i]) >= 4);
  rng.shuffle(deadEnds);

  let vault = null;
  if (deadEnds.length && depth > 1 && rng.chance(0.5)) {
    vault = deadEnds.pop();
    rooms[vault].type = ROOM.VAULT;
  }
  const nSpecial = Math.min(deadEnds.length, rng.range(1, 2));
  for (let n = 0; n < nSpecial; n++) {
    rooms[deadEnds.pop()].type = rng.pick(SPECIALS);
  }
  for (const r of rooms) {
    if (r.type === ROOM.TUNNEL && roomW(r) >= 4 && roomH(r) >= 4 && rng.chance(0.55)) {
      r.type = ROOM.STANDARD;
    }
  }

  // 6. paint
  for (const r of rooms) {
    if (r.type === ROOM.TUNNEL) continue;
    fillRect(tiles, r.l + 1, r.t + 1, r.r - 1, r.b - 1, TT.FLOOR);
  }
  for (const k of used) placeDoor(tiles, rooms, edges[k], rng);
  for (const r of rooms) {
    if (r.type === ROOM.TUNNEL) carveTunnel(tiles, r, rng);
  }

  // 7. dress the floor for its region
  paintTerrain(tiles, rooms, region, depth, rng);
  for (const r of rooms) decorateRoom(tiles, r, region, rng);

  // 8. stairs up, then everything else is placed against a real flood fill so
  //    a quirk in the room graph can never strand the way down or a key.
  const entIdx = freeSpotIn(tiles, rooms[entrance], rng) ?? centreIdx(rooms[entrance]);
  tiles[entIdx] = TT.ENTRANCE;

  let reach = floodFrom(tiles, entIdx);
  const exIdx = tx(entIdx), eyIdx = ty(entIdx);

  let exitIdx = freeSpotIn(tiles, rooms[exit], rng);
  if (exitIdx === null || !reach[exitIdx]) {
    // fall back to the reachable tile furthest from the way in
    let bestD = -1;
    for (let i = 0; i < LEVEL_LEN; i++) {
      if (!reach[i] || !spawnable(tiles[i])) continue;
      const d = Math.abs(tx(i) - exIdx) + Math.abs(ty(i) - eyIdx);
      if (d > bestD) { bestD = d; exitIdx = i; }
    }
  }
  if (exitIdx === null) return regularFloor(depth, rngFor(rng.int(1 << 30) + 13));
  tiles[exitIdx] = TT.EXIT;

  // 9. the vault door needs this floor's iron key, which must lie outside it
  let keySpot = null;
  if (vault !== null) {
    const door = rooms[vault].doors[0];
    if (door !== undefined) {
      tiles[door] = TT.LOCKED_DOOR;
      reach = floodFrom(tiles, entIdx);
      const candidates = [];
      for (let i = 0; i < LEVEL_LEN; i++) {
        if (reach[i] && (tiles[i] === TT.FLOOR || tiles[i] === TT.FLOOR_DECO || tiles[i] === TT.GRASS)) {
          candidates.push(i);
        }
      }
      keySpot = candidates.length ? rng.pick(candidates) : null;
      if (keySpot === null) { tiles[door] = TT.DOOR; rooms[vault].type = ROOM.STANDARD; vault = null; }
    } else {
      rooms[vault].type = ROOM.STANDARD;
      vault = null;
    }
  }

  // 10. traps, only where someone can actually walk into one
  const traps = {};
  const trapCount = Math.min(14, 2 + Math.floor(depth * 0.8));
  for (let n = 0; n < trapCount; n++) {
    const i = randomFloor(tiles, rng, rooms, entrance);
    if (i !== null && reach[i] && tiles[i] === TT.FLOOR) {
      tiles[i] = TT.TRAP_HIDDEN;
      traps[i] = rollTrap(depth, rng);
    }
  }

  return finish({
    depth, region: region.key, tiles, rooms,
    entrance: entIdx, exit: exitIdx,
    vaultRoom: vault, keySpot, boss: false, traps,
  }, rng);
}

// ---------------------------------------------------------------------------
// Boss floors: one arena, one approach, and a sealed way down.
// ---------------------------------------------------------------------------
function bossFloor(depth, rng) {
  const region = regionOf(depth);
  const tiles = new Uint8Array(LEVEL_LEN).fill(TT.WALL);

  const arena = { l: 4, t: 2, r: 27, b: 19, type: ROOM.ARENA, doors: [], links: new Set() };
  const approach = { l: 11, t: 19, r: 20, b: 29, type: ROOM.ENTRANCE, doors: [], links: new Set() };
  fillRect(tiles, arena.l + 1, arena.t + 1, arena.r - 1, arena.b - 1, TT.FLOOR);
  fillRect(tiles, approach.l + 1, approach.t + 1, approach.r - 1, approach.b - 1, TT.FLOOR);

  const gate = idx(15, arena.b);
  tiles[gate] = TT.OPEN_DOOR;
  tiles[idx(16, arena.b)] = TT.OPEN_DOOR;

  // pillars, so the arena is not a bare box
  for (const [px, py] of [[9, 6], [22, 6], [9, 15], [22, 15]]) {
    tiles[idx(px, py)] = TT.STATUE;
    tiles[idx(px + 1, py)] = TT.STATUE;
  }
  paintTerrain(tiles, [arena, approach], region, depth, rng);

  const entIdx = idx(15, 27);
  tiles[entIdx] = TT.ENTRANCE;
  const exitIdx = idx(15, 4);
  tiles[exitIdx] = depth >= 25 ? TT.PEDESTAL : TT.LOCKED_EXIT;

  return finish({
    depth, region: region.key, tiles, rooms: [arena, approach],
    entrance: entIdx, exit: exitIdx,
    vaultRoom: null, keySpot: null, boss: true, traps: {},
    arena: { x: 15 * 16, y: 8 * 16 },
  }, rng);
}

// ---------------------------------------------------------------------------
// Shared tail: pick the spots mobs and loot may use.
// ---------------------------------------------------------------------------
function finish(level, rng) {
  const { tiles } = level;
  const reach = floodFrom(tiles, level.entrance);
  const open = [];
  for (let i = 0; i < LEVEL_LEN; i++) if (reach[i] && spawnable(tiles[i])) open.push(i);
  rng.shuffle(open);

  const ex = tx(level.entrance), ey = ty(level.entrance);
  const farFromEntrance = open.filter(i =>
    Math.abs(tx(i) - ex) + Math.abs(ty(i) - ey) > 8);

  level.spawnPoints = (farFromEntrance.length > 12 ? farFromEntrance : open).slice(0, 200);
  level.itemPoints = open.slice(0, 60);
  level.openTiles = open.length;
  return level;
}

// ---------------------------------------------------------------------------
// Splitting
// ---------------------------------------------------------------------------
function split(rect, out, rng, guard) {
  const w = rect.r - rect.l;
  const h = rect.b - rect.t;
  const canV = w >= MIN_SIZE;
  const canH = h >= MIN_SIZE;

  if (guard > 20 || (!canV && !canH)) { out.push(rect); return; }

  if (w > MAX_SIZE && h < MIN_SIZE) return splitV(rect, out, rng, guard);
  if (h > MAX_SIZE && w < MIN_SIZE) return splitH(rect, out, rng, guard);

  if (w <= MAX_SIZE && h <= MAX_SIZE && rng.next() <= (MIN_SIZE * MIN_SIZE) / (w * h)) {
    out.push(rect);
    return;
  }
  const preferV = rng.next() < (w - 2) / (w + h - 4);
  if (preferV && canV) return splitV(rect, out, rng, guard);
  if (canH) return splitH(rect, out, rng, guard);
  return splitV(rect, out, rng, guard);
}

function splitV(rect, out, rng, guard) {
  const x = rng.range(rect.l + 3, rect.r - 3);
  split({ l: rect.l, t: rect.t, r: x, b: rect.b }, out, rng, guard + 1);
  split({ l: x, t: rect.t, r: rect.r, b: rect.b }, out, rng, guard + 1);
}

function splitH(rect, out, rng, guard) {
  const y = rng.range(rect.t + 3, rect.b - 3);
  split({ l: rect.l, t: rect.t, r: rect.r, b: y }, out, rng, guard + 1);
  split({ l: rect.l, t: y, r: rect.r, b: rect.b }, out, rng, guard + 1);
}

const roomW = (r) => r.r - r.l;
const roomH = (r) => r.b - r.t;
const centreX = (r) => (r.l + r.r) >> 1;
const centreY = (r) => (r.t + r.b) >> 1;
const centreIdx = (r) => idx(centreX(r), centreY(r));

/** The wall two rooms share, if it is long enough to hold a door. */
function sharedWall(a, b) {
  if (a.r === b.l || b.r === a.l) {
    const x = a.r === b.l ? a.r : b.r;
    const lo = Math.max(a.t, b.t), hi = Math.min(a.b, b.b);
    if (hi - lo >= 3) return { axis: 'v', x, lo, hi };
  }
  if (a.b === b.t || b.b === a.t) {
    const y = a.b === b.t ? a.b : b.b;
    const lo = Math.max(a.l, b.l), hi = Math.min(a.r, b.r);
    if (hi - lo >= 3) return { axis: 'h', y, lo, hi };
  }
  return null;
}

/** Random spanning walk from the entrance so every room is reachable. */
function connectAll(rooms, edges, adj, start, used, rng) {
  const seen = new Set([start]);
  const frontier = [start];
  while (frontier.length) {
    const i = frontier.splice(rng.int(frontier.length), 1)[0];
    const options = rng.shuffle(adj[i].slice());
    for (const k of options) {
      const e = edges[k];
      const other = e.a === i ? e.b : e.a;
      if (seen.has(other)) continue;
      seen.add(other);
      used.add(k);
      frontier.push(other);
    }
  }
  // A room whose only shared walls were too short for a door can be left out
  // of the walk. Pull those in one at a time, always attaching to a room that
  // is already connected, until nothing more can be reached.
  let progress = true;
  while (progress) {
    progress = false;
    for (let i = 0; i < rooms.length; i++) {
      if (seen.has(i)) continue;
      for (const k of adj[i]) {
        const e = edges[k];
        const other = e.a === i ? e.b : e.a;
        if (!seen.has(other)) continue;
        used.add(k);
        seen.add(i);
        progress = true;
        break;
      }
    }
  }
  return seen;
}

function placeDoor(tiles, rooms, e, rng) {
  let i;
  if (e.axis === 'v') i = idx(e.x, rng.range(e.lo + 1, e.hi - 1));
  else i = idx(rng.range(e.lo + 1, e.hi - 1), e.y);
  tiles[i] = rng.chance(0.35) ? TT.OPEN_DOOR : TT.DOOR;
  rooms[e.a].doors.push(i);
  rooms[e.b].doors.push(i);
  return i;
}

function doorBetween(rooms, edges, used, roomIndex) {
  for (const k of used) {
    const e = edges[k];
    if (e.a === roomIndex || e.b === roomIndex) {
      const d = rooms[roomIndex].doors[0];
      if (d !== undefined) return d;
    }
  }
  return rooms[roomIndex].doors[0] ?? null;
}

/** Tunnel rooms are corridors: carve from the middle out to each door. */
function carveTunnel(tiles, room, rng) {
  const cx = clamp(centreX(room), room.l + 1, room.r - 1);
  const cy = clamp(centreY(room), room.t + 1, room.b - 1);
  if (!room.doors.length) {
    tiles[idx(cx, cy)] = TT.FLOOR;
    return;
  }
  for (const d of room.doors) {
    const dxp = tx(d), dyp = ty(d);
    const ax = clamp(dxp, room.l + 1, room.r - 1);
    const ay = clamp(dyp, room.t + 1, room.b - 1);
    if (rng.chance(0.5)) {
      carveH(tiles, cx, ax, cy);
      carveV(tiles, cy, ay, ax);
    } else {
      carveV(tiles, cy, ay, cx);
      carveH(tiles, cx, ax, ay);
    }
  }
}

function carveH(tiles, x0, x1, y) {
  for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
    if (tiles[idx(x, y)] === TT.WALL) tiles[idx(x, y)] = TT.FLOOR;
  }
}
function carveV(tiles, y0, y1, x) {
  for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
    if (tiles[idx(x, y)] === TT.WALL) tiles[idx(x, y)] = TT.FLOOR;
  }
}

function fillRect(tiles, l, t, r, b, tile) {
  for (let y = t; y <= b; y++) {
    for (let x = l; x <= r; x++) {
      if (inBounds(x, y)) tiles[idx(x, y)] = tile;
    }
  }
}

// ---------------------------------------------------------------------------
// Terrain dressing
// ---------------------------------------------------------------------------
function paintTerrain(tiles, rooms, region, depth, rng) {
  // Water and grass grow as blobs from a handful of seeds, so they read as
  // puddles and thickets rather than noise.
  blobs(tiles, rng, region.wet * 9, TT.WATER, (t) => t === TT.FLOOR);
  blobs(tiles, rng, region.green * 8, TT.GRASS, (t) => t === TT.FLOOR);

  for (let i = 0; i < tiles.length; i++) {
    if (tiles[i] === TT.GRASS && rng.chance(0.34)) tiles[i] = TT.HIGH_GRASS;
  }

  if (region.key === 'caves' || region.key === 'halls') {
    chasms(tiles, rooms, rng, region.key === 'halls' ? 3 : 2);
  }
  if (region.key === 'halls' || region.key === 'city') {
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === TT.FLOOR && rng.chance(0.03)) tiles[i] = TT.EMBERS;
    }
  }
  if (region.key === 'caves') {
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === TT.FLOOR && rng.chance(0.04)) tiles[i] = TT.RUBBLE;
    }
  }
  // torches / vents set into the walls
  for (let y = 1; y < LEVEL_H - 1; y++) {
    for (let x = 1; x < LEVEL_W - 1; x++) {
      const i = idx(x, y);
      if (tiles[i] !== TT.WALL) continue;
      if (passable(tiles[idx(x, y + 1)]) && rng.chance(0.06)) tiles[i] = TT.WALL_DECO;
    }
  }
  // flagstone under some rooms
  for (const r of rooms) {
    if (r.type !== ROOM.STANDARD || !rng.chance(0.3)) continue;
    for (let y = r.t + 1; y <= r.b - 1; y++) {
      for (let x = r.l + 1; x <= r.r - 1; x++) {
        if (tiles[idx(x, y)] === TT.FLOOR) tiles[idx(x, y)] = TT.FLOOR_DECO;
      }
    }
  }
}

function blobs(tiles, rng, count, tile, ok) {
  const n = Math.round(count);
  for (let b = 0; b < n; b++) {
    let x = rng.range(2, LEVEL_W - 3), y = rng.range(2, LEVEL_H - 3);
    let size = rng.range(6, 26);
    for (let s = 0; s < size; s++) {
      const i = idx(x, y);
      if (inBounds(x, y) && ok(tiles[i])) tiles[i] = tile;
      x += rng.int(3) - 1;
      y += rng.int(3) - 1;
      x = clamp(x, 1, LEVEL_W - 2);
      y = clamp(y, 1, LEVEL_H - 2);
    }
  }
}

/** Chasms only ever open inside a room, never on its edge, so a walkable ring
 *  around them always survives and the floor cannot be cut in two. */
function chasms(tiles, rooms, rng, count) {
  const big = rooms.filter(r => r.type === ROOM.STANDARD && roomW(r) >= 6 && roomH(r) >= 6);
  rng.shuffle(big);
  for (const r of big.slice(0, count)) {
    const l = r.l + 2, t = r.t + 2, rr = r.r - 2, bb = r.b - 2;
    if (rr - l < 1 || bb - t < 1) continue;
    for (let y = t; y <= bb; y++) {
      for (let x = l; x <= rr; x++) {
        if (tiles[idx(x, y)] === TT.FLOOR && rng.chance(0.75)) tiles[idx(x, y)] = TT.CHASM;
      }
    }
  }
}

function decorateRoom(tiles, room, region, rng) {
  const inner = (fn) => {
    for (let y = room.t + 1; y <= room.b - 1; y++) {
      for (let x = room.l + 1; x <= room.r - 1; x++) fn(x, y, idx(x, y));
    }
  };
  switch (room.type) {
    case ROOM.LIBRARY:
      inner((x, y, i) => {
        const edge = x === room.l + 1 || x === room.r - 1 || y === room.t + 1 || y === room.b - 1;
        if (edge && tiles[i] === TT.FLOOR && rng.chance(0.7)) tiles[i] = TT.BOOKSHELF;
        else if (tiles[i] === TT.FLOOR) tiles[i] = TT.FLOOR_DECO;
      });
      break;
    case ROOM.GARDEN:
      inner((x, y, i) => {
        if (tiles[i] === TT.FLOOR || tiles[i] === TT.GRASS) {
          tiles[i] = rng.chance(0.55) ? TT.HIGH_GRASS : TT.GRASS;
        }
      });
      break;
    case ROOM.WELL: {
      const i = centreIdx(room);
      if (passable(tiles[i]) || tiles[i] === TT.FLOOR) tiles[i] = TT.WELL;
      inner((x, y, t) => { if (tiles[t] === TT.FLOOR) tiles[t] = TT.FLOOR_DECO; });
      break;
    }
    case ROOM.STATUARY:
      inner((x, y, i) => {
        if (tiles[i] === TT.FLOOR && (x + y) % 3 === 0 && rng.chance(0.5)) tiles[i] = TT.STATUE;
      });
      break;
    case ROOM.TREASURE:
    case ROOM.VAULT: {
      inner((x, y, i) => { if (tiles[i] === TT.FLOOR) tiles[i] = TT.FLOOR_DECO; });
      const c = centreIdx(room);
      if (tiles[c] !== TT.WALL) tiles[c] = TT.PEDESTAL;
      break;
    }
    default:
      break;
  }
}

function freeSpotIn(tiles, room, rng) {
  const spots = [];
  for (let y = room.t + 1; y <= room.b - 1; y++) {
    for (let x = room.l + 1; x <= room.r - 1; x++) {
      const i = idx(x, y);
      if (tiles[i] === TT.FLOOR || tiles[i] === TT.FLOOR_DECO || tiles[i] === TT.GRASS) spots.push(i);
    }
  }
  return spots.length ? rng.pick(spots) : null;
}

function randomFloor(tiles, rng, rooms, skipRoom) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const r = rng.int(rooms.length);
    if (r === skipRoom) continue;
    const room = rooms[r];
    if (room.type === ROOM.TUNNEL) continue;
    const i = freeSpotIn(tiles, room, rng);
    if (i !== null) return i;
  }
  return null;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

/** Everything walkable from `start`. A shut door counts (you open it by
 *  walking into it); a locked door does not. */
function floodFrom(tiles, start) {
  const seen = new Uint8Array(LEVEL_LEN);
  const stack = [start];
  seen[start] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = tx(i), y = ty(i);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const j = idx(nx, ny);
      if (seen[j]) continue;
      const t = tiles[j];
      if (!passable(t) && t !== TT.DOOR) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
/** Flood fill from the entrance — used by the tests to prove a floor is sound. */
export function reachable(tiles, from) {
  const seen = new Uint8Array(LEVEL_LEN);
  const stack = [from];
  seen[from] = 1;
  let n = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = tx(i), y = ty(i);
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nx = x + dx, ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      const j = idx(nx, ny);
      if (seen[j]) continue;
      const t = tiles[j];
      // a shut door still counts as reachable; you open it by walking into it
      const gate = t === TT.DOOR || t === TT.LOCKED_DOOR || t === TT.LOCKED_EXIT;
      if (!passable(t) && !gate) continue;
      seen[j] = 1; n++;
      // you can stand at a locked door or a sealed stair, but not walk through
      if (t !== TT.LOCKED_DOOR && t !== TT.LOCKED_EXIT) stack.push(j);
    }
  }
  return { seen, count: n };
}
