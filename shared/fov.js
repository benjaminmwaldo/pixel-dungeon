// Field of view: recursive shadowcasting over the eight octants, plus the
// courtesy the game this follows extends — step into a room and the whole room
// lights up, so you are never peering around your own doorway.

import { LEVEL_W, LEVEL_H, LEVEL_LEN, TT, idx, tx, ty, inBounds, blocksSight, passable } from './terrain.js';

export const SIGHT = 8;

// octant transforms: xx, xy, yx, yy
const OCT = [
  [1, 0, 0, 1], [0, 1, 1, 0], [0, -1, 1, 0], [-1, 0, 0, 1],
  [-1, 0, 0, -1], [0, -1, -1, 0], [0, 1, -1, 0], [1, 0, 0, -1],
];

/**
 * Fill `out` (a Uint8Array of LEVEL_LEN) with 1 for every tile visible from
 * (cx, cy). `out` is cleared first. Returns `out`.
 */
export function computeFov(tiles, cx, cy, radius, out) {
  out.fill(0);
  if (!inBounds(cx, cy)) return out;
  out[idx(cx, cy)] = 1;
  for (const [xx, xy, yx, yy] of OCT) {
    cast(tiles, out, cx, cy, 1, 1.0, 0.0, radius, xx, xy, yx, yy);
  }
  return out;
}

function cast(tiles, out, cx, cy, row, start, end, radius, xx, xy, yx, yy) {
  if (start < end) return;
  const r2 = radius * radius;
  let newStart = 0;

  for (let i = row; i <= radius; i++) {
    let dx = -i - 1;
    const dy = -i;
    let blocked = false;

    while (dx <= 0) {
      dx++;
      const X = cx + dx * xx + dy * xy;
      const Y = cy + dx * yx + dy * yy;
      const lSlope = (dx - 0.5) / (dy + 0.5);
      const rSlope = (dx + 0.5) / (dy - 0.5);

      if (start < rSlope) continue;
      if (end > lSlope) break;

      const within = (dx * dx + dy * dy) <= r2;
      const ok = inBounds(X, Y);
      if (within && ok) out[idx(X, Y)] = 1;

      const wall = !ok || blocksSight(tiles[idx(X, Y)]);
      if (blocked) {
        if (wall) { newStart = rSlope; continue; }
        blocked = false;
        start = newStart;
      } else if (wall && i < radius) {
        blocked = true;
        cast(tiles, out, cx, cy, i + 1, start, lSlope, radius, xx, xy, yx, yy);
        newStart = rSlope;
      }
    }
    if (blocked) break;
  }
}

/**
 * Light the whole room the viewer is standing in. Only the room's own open
 * tiles and the wall ring around them are revealed, so a corridor "room" does
 * not give away the map.
 */
export function lightRoom(level, cx, cy, out) {
  const room = roomAt(level, cx, cy);
  if (!room || room.type === 'tunnel') return;
  for (let y = room.t; y <= room.b; y++) {
    for (let x = room.l; x <= room.r; x++) {
      if (!inBounds(x, y)) continue;
      const i = idx(x, y);
      // interiors always; the surrounding wall only so the room reads as closed
      if (x > room.l && x < room.r && y > room.t && y < room.b) out[i] = 1;
      else if (blocksSight(level.tiles[i])) out[i] = 1;
    }
  }
}

export function roomAt(level, x, y) {
  for (const r of level.rooms) {
    if (x >= r.l && x <= r.r && y >= r.t && y <= r.b) return r;
  }
  return null;
}

/** Everything a viewer at this tile can see, room courtesy included. */
export function viewFrom(level, tile, radius, out) {
  const x = tx(tile), y = ty(tile);
  computeFov(level.tiles, x, y, radius, out);
  lightRoom(level, x, y, out);
  return out;
}

/** Cheap line-of-sight test between two tiles — used by mobs deciding to chase. */
export function hasLine(tiles, ax, ay, bx, by, maxDist = 12) {
  let dx = bx - ax, dy = by - ay;
  const dist = Math.max(Math.abs(dx), Math.abs(dy));
  if (dist === 0) return true;
  if (dist > maxDist) return false;
  const sx = dx / dist, sy = dy / dist;
  let x = ax + 0.5, y = ay + 0.5;
  for (let i = 0; i < dist; i++) {
    x += sx; y += sy;
    const tX = Math.floor(x), tY = Math.floor(y);
    if (!inBounds(tX, tY)) return false;
    if (tX === bx && tY === by) return true;
    if (blocksSight(tiles[idx(tX, tY)])) return false;
  }
  return true;
}
