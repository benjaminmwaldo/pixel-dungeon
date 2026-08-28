// The hero's own motion, run identically by the server and by the client's
// prediction. Anything that decides an outcome (damage, loot, doors) lives on
// the server; this only moves the body and runs the swing timer.

import { IN, N, E, S, W, PLAYER_BOX, ATTACK_TICKS, CLASSES } from './constants.js';
import { moveActor, MODE, tileUnder, terrainFactor } from './physics.js';

/** Perk multipliers. The client is told these so its prediction matches. */
export const NO_MODS = { speedMult: 1, swingMult: 1, reachMult: 1, cdMult: 1 };

export function newPlayerState() {
  return {
    x: 0, y: 0, dir: S,
    atk: 0,
    knockT: 0, knockX: 0, knockY: 0,
    stun: 0,
    walk: 0,
    prev: 0,
    ghost: false,
    abilityCd: 0,
    guarding: false,
  };
}

/**
 * Advance one tick. `bits` is this frame's input.
 * Returns what the caller may need to act on.
 */
export function playerStep(p, bits, tiles, cls, mods = NO_MODS) {
  const ev = { attacked: false, ability: false, moved: false, blockedBy: -1 };
  const pressed = bits & ~p.prev;
  p.prev = bits;

  if (p.abilityCd > 0) p.abilityCd--;
  p.guarding = false;

  if (p.stun > 0) { p.stun--; return ev; }

  if (p.knockT > 0) {
    p.knockT--;
    moveActor(p, p.knockX, p.knockY, tiles, PLAYER_BOX, MODE.WALK, false);
    return ev;
  }

  if (p.atk > 0) { p.atk--; return ev; }

  const def = CLASSES[cls] || CLASSES.warrior;

  if (!p.ghost) {
    if (pressed & IN.A) {
      p.atk = Math.max(3, Math.round(ATTACK_TICKS * mods.swingMult));
      ev.attacked = true;
      return ev;
    }
    if (bits & IN.B) {
      if (def.ranged) {
        if (p.abilityCd <= 0) {
          p.abilityCd = Math.max(4, Math.round(def.ranged.cd * mods.cdMult));
          p.atk = 5;
          ev.ability = true;
          return ev;
        }
      } else if (cls === 'warrior') {
        // hold to brace: slower, but blows glance off
        p.guarding = true;
      } else if (cls === 'rogue' && (pressed & IN.B) && p.abilityCd <= 0) {
        p.abilityCd = Math.max(40, Math.round(240 * mods.cdMult));
        ev.ability = true;
      }
    }
  }

  let dx = 0, dy = 0;
  if (bits & IN.LEFT) dx = -1;
  if (bits & IN.RIGHT) dx = 1;
  if (bits & IN.UP) dy = -1;
  if (bits & IN.DOWN) dy = 1;

  // Four-way only: keep the axis you are already facing.
  if (dx !== 0 && dy !== 0) {
    if (p.dir === N || p.dir === S) dx = 0; else dy = 0;
  }

  if (dx !== 0 || dy !== 0) {
    p.dir = dx < 0 ? W : dx > 0 ? E : dy < 0 ? N : S;
    const under = tiles[tileUnder(p, PLAYER_BOX)];
    let speed = (p.ghost ? 2.6 : def.speed * mods.speedMult) * terrainFactor(under);
    if (p.guarding) speed *= 0.45;
    const r = moveActor(p, dx * speed, dy * speed, tiles,
      PLAYER_BOX, p.ghost ? MODE.FLY : MODE.WALK, true);
    ev.blockedBy = r.blockedBy;
    p.walk = (p.walk + 1) % 16;
    p.still = 0;
    ev.moved = true;
  } else {
    p.walk = 0;
    p.still = (p.still || 0) + 1;
  }
  return ev;
}

/** The swing's hitbox for this frame, or null. */
export function meleeBox(p, reach = 18) {
  if (p.atk <= 0 || p.ghost) return null;
  const cx = p.x + 8, cy = p.y + 8;
  const half = 7;
  switch (p.dir) {
    case N: return { x: cx - half, y: cy - reach, w: half * 2, h: reach - 2 };
    case S: return { x: cx - half, y: cy + 2, w: half * 2, h: reach - 2 };
    case E: return { x: cx + 2, y: cy - half, w: reach - 2, h: half * 2 };
    default: return { x: cx - reach, y: cy - half, w: reach - 2, h: half * 2 };
  }
}
