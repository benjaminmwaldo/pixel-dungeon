// Things you throw. Unlike a wand, a missile is a real object: it flies, it
// lands, and you can walk over and pick it up again — or find it snapped in
// half, because throwing things at people is hard on the things.
//
// Aimed with your facing, like everything else here.

export const MISSILE = {
  STONE: 'stone', KNIFE: 'throwing knife', SPEAR: 'throwing spear',
  SHURIKEN: 'shuriken', JAVELIN: 'javelin', BOLAS: 'bolas',
  TOMAHAWK: 'tomahawk', TRIDENT: 'trident', FORCE_CUBE: 'force cube',
  BOOMERANG: 'boomerang',
};

// dmg:     before depth scaling
// tier:    how deep it starts turning up
// keep:    chance the thing survives the throw
// speed:   px per tick
export const MISSILES = {
  [MISSILE.STONE]: {
    name: 'STONE', tier: 1, dmg: 3, keep: 0.6, speed: 3.6, range: 130,
    blurb: 'A ROCK. IT IS BETTER THAN NOTHING',
  },
  [MISSILE.KNIFE]: {
    name: 'THROWING KNIFE', tier: 1, dmg: 5, keep: 0.8, speed: 4.6, range: 150,
    blurb: 'QUICK, AND USUALLY SURVIVES THE TRIP',
  },
  [MISSILE.SHURIKEN]: {
    name: 'SHURIKEN', tier: 2, dmg: 6, keep: 0.75, speed: 5.2, range: 170,
    blurb: 'FAST ENOUGH THAT THEY RARELY SEE IT',
  },
  [MISSILE.SPEAR]: {
    name: 'THROWING SPEAR', tier: 2, dmg: 8, keep: 0.7, speed: 4.0, range: 160,
    pierce: 1,
    blurb: 'GOES THROUGH THE FIRST ONE',
  },
  [MISSILE.BOLAS]: {
    name: 'BOLAS', tier: 2, dmg: 3, keep: 0.85, speed: 3.8, range: 140,
    roots: 180,
    blurb: 'WRAPS THEIR LEGS AND HOLDS THEM',
  },
  [MISSILE.JAVELIN]: {
    name: 'JAVELIN', tier: 3, dmg: 11, keep: 0.7, speed: 4.4, range: 190,
    pierce: 1, cripple: 200,
    blurb: 'HEAVY, AND THEY LIMP AFTERWARDS',
  },
  [MISSILE.TOMAHAWK]: {
    name: 'TOMAHAWK', tier: 3, dmg: 13, keep: 0.6, speed: 4.0, range: 150,
    bleed: 200,
    blurb: 'LEAVES THEM BLEEDING',
  },
  [MISSILE.FORCE_CUBE]: {
    name: 'FORCE CUBE', tier: 4, dmg: 9, keep: 0.5, speed: 3.4, range: 120,
    burst: 46, knock: 24,
    blurb: 'GOES OFF, AND EVERYTHING NEAR GOES BACKWARDS',
  },
  [MISSILE.TRIDENT]: {
    name: 'TRIDENT', tier: 4, dmg: 16, keep: 0.75, speed: 4.2, range: 180,
    pierce: 2,
    blurb: 'GOES THROUGH TWO OF THEM',
  },
  [MISSILE.BOOMERANG]: {
    name: 'BOOMERANG', tier: 5, dmg: 12, keep: 1.0, speed: 4.6, range: 170,
    returns: true,
    blurb: 'COMES BACK, WHICH IS THE WHOLE POINT',
  },
};

export const MISSILE_IDS = Object.keys(MISSILES);

const INDEX = new Map(MISSILE_IDS.map((id, i) => [id, i + 1]));
export const missileIndex = (id) => INDEX.get(id) ?? 0;
export const missileById = (i) => MISSILE_IDS[i - 1] ?? null;

/** Which missiles a floor at this depth may hand out. */
export function missilesForDepth(depth) {
  const tier = Math.max(1, Math.min(5, Math.ceil(depth / 5)));
  return MISSILE_IDS.filter(id => MISSILES[id].tier <= tier);
}

/** How hard one hits, thrown at this depth by a hero with this much behind it. */
export function missilePower(def, depth, bonus = 0) {
  return Math.round(def.dmg + depth * 0.4 + bonus);
}

/** A bundle of something throwable for this depth. */
export function rollMissile(depth, rng) {
  const pool = missilesForDepth(depth);
  const kind = pool[rng.int(pool.length)];
  const def = MISSILES[kind];
  // the cheap ones come in handfuls, the heavy ones one or two at a time
  const many = def.tier <= 1 ? rng.range(4, 8) : def.tier <= 2 ? rng.range(2, 5) : rng.range(1, 3);
  return { type: 'missile', kind, amount: many };
}
