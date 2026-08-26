// Movement and collision across a whole 32x32 floor. The server runs this
// authoritatively and the client runs the identical code to predict the local
// hero, so the two only ever differ by unacknowledged input.

import {
  LEVEL_W, LEVEL_H, TT, idx, inBounds, passable, flyable, shotPasses,
} from './terrain.js';
import { TILE } from './constants.js';

export const MODE = { WALK: 'walk', FLY: 'fly', SHOT: 'shot' };

export function tileOpen(t, mode) {
  if (mode === MODE.FLY) return flyable(t);
  if (mode === MODE.SHOT) return shotPasses(t);
  return passable(t);
}

/**
 * A solid tile the box overlaps, or -1.
 *
 * A door is reported in preference to a plain wall. Brushing a doorway at an
 * angle would otherwise report the wall beside it, and the caller — who opens
 * doors by walking into them — would leave you stuck against the frame.
 */
export function boxBlocker(tiles, x, y, w, h, mode) {
  const x0 = Math.floor(x / TILE), x1 = Math.floor((x + w - 1) / TILE);
  const y0 = Math.floor(y / TILE), y1 = Math.floor((y + h - 1) / TILE);
  let first = -1;
  for (let ty2 = y0; ty2 <= y1; ty2++) {
    for (let tx2 = x0; tx2 <= x1; tx2++) {
      if (!inBounds(tx2, ty2)) {
        if (first === -1) {
          first = idx(Math.max(0, Math.min(LEVEL_W - 1, tx2)),
                      Math.max(0, Math.min(LEVEL_H - 1, ty2)));
        }
        continue;
      }
      const i = idx(tx2, ty2);
      const t = tiles[i];
      if (tileOpen(t, mode)) continue;
      if (t === TT.DOOR || t === TT.LOCKED_DOOR) return i;
      if (first === -1) first = i;
    }
  }
  return first;
}

export function boxBlocked(tiles, x, y, w, h, mode) {
  return boxBlocker(tiles, x, y, w, h, mode) !== -1;
}

/**
 * Move with per-axis collision and a small corner-assist nudge, so squeezing
 * into a one-tile doorway is forgiving.
 *
 * Returns { hitX, hitY, blockedBy } — blockedBy is the tile index that stopped
 * the move, which is how the caller knows to open a door.
 */
export function moveActor(a, dx, dy, tiles, box, mode = MODE.WALK, assist = true) {
  let hitX = false, hitY = false, blockedBy = -1;

  if (dx !== 0) {
    const nx = a.x + dx;
    const hit = boxBlocker(tiles, nx + box.x, a.y + box.y, box.w, box.h, mode);
    if (hit === -1) {
      a.x = nx;
    } else {
      hitX = true; blockedBy = hit;
      if (assist) {
        for (const nudge of [-2, 2, -4, 4, -6, 6]) {
          if (!boxBlocked(tiles, nx + box.x, a.y + nudge + box.y, box.w, box.h, mode) &&
              !boxBlocked(tiles, a.x + box.x, a.y + nudge + box.y, box.w, box.h, mode)) {
            a.y += nudge; hitX = false; blockedBy = -1;
            break;
          }
        }
      }
    }
  }

  if (dy !== 0) {
    const ny = a.y + dy;
    const hit = boxBlocker(tiles, a.x + box.x, ny + box.y, box.w, box.h, mode);
    if (hit === -1) {
      a.y = ny;
    } else {
      hitY = true; if (blockedBy === -1) blockedBy = hit;
      if (assist) {
        for (const nudge of [-2, 2, -4, 4, -6, 6]) {
          if (!boxBlocked(tiles, a.x + nudge + box.x, ny + box.y, box.w, box.h, mode) &&
              !boxBlocked(tiles, a.x + nudge + box.x, a.y + box.y, box.w, box.h, mode)) {
            a.x += nudge; hitY = false;
            break;
          }
        }
      }
    }
  }

  return { hitX, hitY, blockedBy };
}

/** The tile an actor's middle is standing on. */
export function tileUnder(a, box) {
  const cx = Math.floor((a.x + box.x + box.w / 2) / TILE);
  const cy = Math.floor((a.y + box.y + box.h / 2) / TILE);
  if (!inBounds(cx, cy)) return 0;
  return idx(cx, cy);
}

export function centreTile(a, box) {
  return {
    x: Math.floor((a.x + box.x + box.w / 2) / TILE),
    y: Math.floor((a.y + box.y + box.h / 2) / TILE),
  };
}

/** Wading slows you; long grass drags a little. */
export function terrainFactor(t) {
  if (t === TT.WATER) return 0.55;
  if (t === TT.HIGH_GRASS) return 0.8;
  if (t === TT.GRASS) return 0.92;
  return 1;
}

export function clampToLevel(a, box) {
  const min = TILE;
  const maxX = (LEVEL_W - 1) * TILE - box.x - box.w;
  const maxY = (LEVEL_H - 1) * TILE - box.y - box.h;
  if (a.x < min) a.x = min;
  if (a.y < min) a.y = min;
  if (a.x > maxX) a.x = maxX;
  if (a.y > maxY) a.y = maxY;
}

/** Pixel position of the centre of a tile, for placing an actor on it. */
export function tileToPixel(i, box = { x: 3, y: 5, w: 10, h: 10 }) {
  const x = (i % LEVEL_W) * TILE + TILE / 2;
  const y = ((i / LEVEL_W) | 0) * TILE + TILE / 2;
  return { x: Math.round(x - box.x - box.w / 2), y: Math.round(y - box.y - box.h / 2) };
}
