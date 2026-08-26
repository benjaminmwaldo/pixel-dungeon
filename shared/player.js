// The player's own motion. Run identically by the server (authoritative) and
// by the client (prediction), so the two only ever differ by unacked input.

import {
  IN, N, E, S, W, PLAYER_SPEED, PLAYER_BOX, ATTACK_TICKS,
} from './constants.js';
import { moveActor, MODE } from './physics.js';

export function newPlayerState() {
  return {
    x: 120, y: 140, dir: S,
    atk: 0,          // sword-out countdown
    knockT: 0, knockX: 0, knockY: 0,
    trans: 0,        // room-transition freeze
    walk: 0,         // animation phase
    prev: 0,         // previous input bits, for edge detection
    ghost: false,
    stun: 0,
  };
}

/**
 * Advance one tick. Returns the events the caller may want to act on.
 * `bits` is the input bitmask for this tick.
 */
export function playerStep(p, bits, tiles, doorState) {
  const ev = { attacked: false, useItem: false, moved: false };
  const pressed = bits & ~p.prev;
  p.prev = bits;

  if (p.trans > 0) { p.trans--; return ev; }
  if (p.stun > 0) { p.stun--; return ev; }

  if (p.knockT > 0) {
    p.knockT--;
    moveActor(p, p.knockX, p.knockY, tiles, doorState, PLAYER_BOX, MODE.WALK, false);
    return ev;
  }

  if (p.atk > 0) { p.atk--; return ev; }

  if (!p.ghost) {
    if (pressed & IN.A) { p.atk = ATTACK_TICKS; ev.attacked = true; return ev; }
    if (pressed & IN.B) { ev.useItem = true; }
  }

  let dx = 0, dy = 0;
  if (bits & IN.LEFT) dx = -1;
  if (bits & IN.RIGHT) dx = 1;
  if (bits & IN.UP) dy = -1;
  if (bits & IN.DOWN) dy = 1;

  // Four-way only, like the original: keep the axis you are already facing.
  if (dx !== 0 && dy !== 0) {
    if (p.dir === N || p.dir === S) dx = 0; else dy = 0;
  }

  if (dx !== 0 || dy !== 0) {
    p.dir = dx < 0 ? W : dx > 0 ? E : dy < 0 ? N : S;
    moveActor(p, dx * PLAYER_SPEED, dy * PLAYER_SPEED, tiles, doorState, PLAYER_BOX, MODE.WALK, true);
    p.walk = (p.walk + 1) % 16;
    ev.moved = true;
  } else {
    p.walk = 0;
  }
  return ev;
}

/** The sword's hitbox for the current swing, or null. */
export function swordBox(p) {
  if (p.atk <= 0 || p.ghost) return null;
  // The blade only counts for the first part of the swing.
  if (p.atk < ATTACK_TICKS - 6) return null;
  const cx = p.x + 8, cy = p.y + 8;
  switch (p.dir) {
    case N: return { x: cx - 5, y: cy - 20, w: 10, h: 18 };
    case S: return { x: cx - 5, y: cy + 2, w: 10, h: 18 };
    case E: return { x: cx + 2, y: cy - 5, w: 18, h: 10 };
    default: return { x: cx - 20, y: cy - 5, w: 18, h: 10 };
  }
}
