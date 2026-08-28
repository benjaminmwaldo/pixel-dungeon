import io

def edit(path, *pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n%s' % (path, old[:220]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched', path)

# ---------------------------------------------------------------------------
# Marked gear turns up in the world
# ---------------------------------------------------------------------------
edit('shared/items.js',
  ("import { rngFor } from './terrain.js';",
   "import { rngFor } from './terrain.js';\nimport { dressGear, markName } from './enchants.js';"),

  ("""  const tier = clampTier(Math.ceil(depth / 5) + (rng.chance(0.25) ? 1 : 0));
  if (r < 0.92) return { type: ITEM.WEAPON, tier, upgrade: rng.chance(0.25) ? 1 : 0 };
  return { type: ITEM.ARMOR, tier, upgrade: rng.chance(0.25) ? 1 : 0 };""",
   """  const tier = clampTier(Math.ceil(depth / 5) + (rng.chance(0.25) ? 1 : 0));
  if (r < 0.92) {
    return dressGear({ type: ITEM.WEAPON, tier, upgrade: rng.chance(0.25) ? 1 : 0 }, depth, rng);
  }
  return dressGear({ type: ITEM.ARMOR, tier, upgrade: rng.chance(0.25) ? 1 : 0 }, depth, rng);"""),

  # a prize is worth walking to: marked, never cursed
  ("""  if (r < 0.28) return { type: ITEM.WEAPON, tier, upgrade: rng.range(1, 2) };
  if (r < 0.56) return { type: ITEM.ARMOR, tier, upgrade: rng.range(1, 2) };""",
   """  if (r < 0.28) return blessed({ type: ITEM.WEAPON, tier, upgrade: rng.range(1, 2) }, depth, rng);
  if (r < 0.56) return blessed({ type: ITEM.ARMOR, tier, upgrade: rng.range(1, 2) }, depth, rng);"""),

  ("function clampTier(t) { return t < 1 ? 1 : t > 5 ? 5 : t; }",
   """/** A prize is worth the walk: often marked, never cursed. */
function blessed(item, depth, rng) {
  for (let n = 0; n < 6; n++) {
    const tryIt = dressGear({ ...item }, depth, rng);
    if (!tryIt.curse) return tryIt;
  }
  return item;
}

function clampTier(t) { return t < 1 ? 1 : t > 5 ? 5 : t; }"""),

  # the name carries the mark once the party knows it
  ("""    case ITEM.WEAPON: {
      const w = WEAPONS[item.tier - 1];
      return item.upgrade ? `+${item.upgrade} ${w.name}` : w.name;
    }
    case ITEM.ARMOR: {
      const a = ARMORS[item.tier - 1];
      return item.upgrade ? `+${item.upgrade} ${a.name}` : a.name;
    }""",
   """    case ITEM.WEAPON: {
      const w = WEAPONS[item.tier - 1];
      return gearName(item, w.name);
    }
    case ITEM.ARMOR: {
      const a = ARMORS[item.tier - 1];
      return gearName(item, a.name);
    }"""),

  ("/** Is this something you keep in the quick bar rather than wear? */",
   """/** "+2 BLAZING SABRE", or just "SABRE" while nobody has worked it out. */
function gearName(item, base) {
  const plus = item.upgrade ? `+${item.upgrade} ` : '';
  const mark = item.known ? markName(item) : null;
  return mark ? `${plus}${mark} ${base}` : `${plus}${base}`;
}

/** Is this something you keep in the quick bar rather than wear? */"""),
)

# ---------------------------------------------------------------------------
# Armour speaks when it is struck, and cursed gear will not come off
# ---------------------------------------------------------------------------
edit('shared/game.js',
  ("""  /** Wear something from the bag, putting whatever you had back. */
  equipFrom(p, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const it = slot.item;
    if (it.type !== ITEM.WEAPON && it.type !== ITEM.ARMOR) return;
    const which = it.type === ITEM.WEAPON ? 'weapon' : 'armor';
    const old = p.equip[which];
    p.equip[which] = { type: it.type, tier: it.tier, upgrade: it.upgrade || 0 };""",
   """  /** Wear something from the bag, putting whatever you had back. */
  equipFrom(p, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const it = slot.item;
    if (it.type !== ITEM.WEAPON && it.type !== ITEM.ARMOR) return;
    const which = it.type === ITEM.WEAPON ? 'weapon' : 'armor';
    const old = p.equip[which];
    if (old.cursed) {
      this.banner(`THE ${which === 'weapon' ? 'WEAPON' : 'ARMOUR'} WILL NOT COME OFF`, 1800);
      if (!old.known) this.learnGear(p, old, which);
      return;
    }
    p.equip[which] = { ...it };
    if (p.equip[which].cursed) {
      this.learnGear(p, p.equip[which], which);
    }"""),
)

print('done')
