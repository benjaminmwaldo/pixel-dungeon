// Movement and collision. This module is the single source of truth for how an
// actor moves through a room — the server runs it authoritatively and the
// client runs the exact same code to predict the local player, so the two agree.

import {
  TILE, ROOM_W, ROOM_H, PLAY_W, PLAY_H, T, SOLID, SHOT_SOLID, FLY_SOLID,
  N, E, S, W, DOOR_TILES,
} from './constants.js';

// Runtime door state (what the server tracks per room, per direction).
export const DS = { SOLID: 0, OPEN: 1, BARRED: 2 };

export const MODE = { WALK: 'walk', FLY: 'fly', SHOT: 'shot' };

function solidSetFor(mode) {
  if (mode === MODE.FLY) return FLY_SOLID;
  if (mode === MODE.SHOT) return SHOT_SOLID;
  return SOLID;
}

/** Tile id at a room-local pixel, or WALL when outside the room. */
export function tileAtPixel(tiles, px, py) {
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  if (tx < 0 || ty < 0 || tx >= ROOM_W || ty >= ROOM_H) return T.WALL;
  return tiles[ty * ROOM_W + tx];
}

/** Is the tile at (tx,ty) blocking for this mode, given live door state? */
export function tileBlocks(tiles, doorState, tx, ty, mode) {
  if (tx < 0 || ty < 0 || tx >= ROOM_W || ty >= ROOM_H) return true;
  const t = tiles[ty * ROOM_W + tx];
  if (t === T.DOORWAY) {
    const dir = doorDirOfTile(tx, ty);
    if (dir < 0) return true;
    return doorState[dir] !== DS.OPEN;
  }
  return solidSetFor(mode).has(t);
}

/** Which door a doorway tile belongs to, or -1. */
export function doorDirOfTile(tx, ty) {
  for (let dir = 0; dir < 4; dir++) {
    for (const [dx, dy] of DOOR_TILES[dir]) {
      if (dx === tx && dy === ty) return dir;
    }
  }
  return -1;
}

/** Does an axis-aligned box overlap anything solid? */
export function boxBlocked(tiles, doorState, x, y, w, h, mode) {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 1) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 1) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (tileBlocks(tiles, doorState, tx, ty, mode)) return true;
    }
  }
  return false;
}

/**
 * Move an actor with per-axis collision and the little corner-assist nudge the
 * original game used: if you walk into a wall but only part of your body is
 * blocked, you slide along until you clear it.
 *
 * `a` is mutated: { x, y } are the sprite's top-left corner.
 * `box` is the hitbox offset/size inside the 16x16 sprite.
 * Returns { hitX, hitY } — whether the move was stopped on each axis.
 */
export function moveActor(a, dx, dy, tiles, doorState, box, mode = MODE.WALK, assist = true) {
  let hitX = false, hitY = false;

  if (dx !== 0) {
    const nx = a.x + dx;
    if (!boxBlocked(tiles, doorState, nx + box.x, a.y + box.y, box.w, box.h, mode)) {
      a.x = nx;
    } else {
      hitX = true;
      if (assist) {
        // Try easing up or down a few pixels to round the corner. The range is
        // what makes walking into a one-tile side doorway feel forgiving.
        for (const nudge of [-2, 2, -4, 4, -6, 6]) {
          if (!boxBlocked(tiles, doorState, nx + box.x, a.y + nudge + box.y, box.w, box.h, mode) &&
              !boxBlocked(tiles, doorState, a.x + box.x, a.y + nudge + box.y, box.w, box.h, mode)) {
            a.y += nudge;
            hitX = false;
            break;
          }
        }
      }
    }
  }

  if (dy !== 0) {
    const ny = a.y + dy;
    if (!boxBlocked(tiles, doorState, a.x + box.x, ny + box.y, box.w, box.h, mode)) {
      a.y = ny;
    } else {
      hitY = true;
      if (assist) {
        for (const nudge of [-2, 2, -4, 4, -6, 6]) {
          if (!boxBlocked(tiles, doorState, a.x + nudge + box.x, ny + box.y, box.w, box.h, mode) &&
              !boxBlocked(tiles, doorState, a.x + nudge + box.x, a.y + box.y, box.w, box.h, mode)) {
            a.x += nudge;
            hitY = false;
            break;
          }
        }
      }
    }
  }

  return { hitX, hitY };
}

/**
 * Has this actor walked far enough into an open doorway to leave the room?
 * Returns a direction or -1.
 */
export function doorwayExit(a, box, doorState) {
  const cx = a.x + box.x + box.w / 2;
  const cy = a.y + box.y + box.h / 2;
  if (cy < 10 && doorState[N] === DS.OPEN && inDoorSpan(cx, N)) return N;
  if (cy > PLAY_H - 10 && doorState[S] === DS.OPEN && inDoorSpan(cx, S)) return S;
  if (cx > PLAY_W - 10 && doorState[E] === DS.OPEN && inDoorSpan(cy, E)) return E;
  if (cx < 10 && doorState[W] === DS.OPEN && inDoorSpan(cy, W)) return W;
  return -1;
}

function inDoorSpan(v, dir) {
  const tiles = DOOR_TILES[dir];
  if (dir === N || dir === S) {
    const lo = tiles[0][0] * TILE, hi = (tiles[tiles.length - 1][0] + 1) * TILE;
    return v >= lo - 2 && v <= hi + 2;
  }
  const lo = tiles[0][1] * TILE, hi = (tiles[tiles.length - 1][1] + 1) * TILE;
  return v >= lo - 2 && v <= hi + 2;
}

/** Keep an actor inside the room bounds (used for enemies, which never leave). */
export function clampToRoom(a, box) {
  const minX = TILE - box.x, maxX = PLAY_W - TILE - box.x - box.w;
  const minY = TILE - box.y, maxY = PLAY_H - TILE - box.y - box.h;
  if (a.x < minX) a.x = minX;
  if (a.x > maxX) a.x = maxX;
  if (a.y < minY) a.y = minY;
  if (a.y > maxY) a.y = maxY;
}

/** Snap a value to the nearest 8px sub-grid — how the original aligned its enemies. */
export function snap8(v) { return Math.round(v / 8) * 8; }

export function centerOf(a, box) {
  return { x: a.x + box.x + box.w / 2, y: a.y + box.y + box.h / 2 };
}
