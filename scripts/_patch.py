import io

def edit(path, *pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n%s' % (path, old[:220]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched', path)

edit('shared/constants.js',
  ("  ITEM: 60, BOMB: 61, BLAST: 62, POOF: 63, GAS: 64, WARD: 65,",
   "  ITEM: 60, BOMB: 61, BLAST: 62, POOF: 63, GAS: 64, WARD: 65, THROWN: 66,"))

edit('shared/items.js',
  ("  BOMB: 'bomb', RELIC: 'relic', RING: 'ring', WAND: 'wand',\n};",
   "  BOMB: 'bomb', RELIC: 'relic', RING: 'ring', WAND: 'wand', MISSILE: 'missile',\n};"),

  ("import { WANDS, WAND_IDS, WAND_LOOKS, rollWand } from './wands.js';",
   "import { WANDS, WAND_IDS, WAND_LOOKS, rollWand } from './wands.js';\nimport { MISSILES, rollMissile } from './missiles.js';"),

  # you can see what a stone is by looking at it
  ("""    case ITEM.WAND: {
      const plus = item.upgrade ? `+${item.upgrade} ` : '';""",
   """    case ITEM.MISSILE: {
      const def = MISSILES[item.kind];
      const n = item.amount || 1;
      return n > 1 ? `${n} ${def.name}S` : def.name;
    }
    case ITEM.WAND: {
      const plus = item.upgrade ? `+${item.upgrade} ` : '';"""),

  # they stack, and they live in the quick bar
  ("""export function isConsumable(item) {
  return item.type === ITEM.POTION || item.type === ITEM.SCROLL ||
         item.type === ITEM.FOOD || item.type === ITEM.BOMB ||
         item.type === ITEM.KEY || item.type === ITEM.GOLDKEY;
}""",
   """export function isConsumable(item) {
  return item.type === ITEM.POTION || item.type === ITEM.SCROLL ||
         item.type === ITEM.FOOD || item.type === ITEM.BOMB ||
         item.type === ITEM.KEY || item.type === ITEM.GOLDKEY ||
         item.type === ITEM.MISSILE;
}"""),

  ("  if (item.type === ITEM.POTION || item.type === ITEM.SCROLL) return `${item.type}:${item.kind}`;",
   "  if (item.type === ITEM.POTION || item.type === ITEM.SCROLL) return `${item.type}:${item.kind}`;\n  if (item.type === ITEM.MISSILE) return `missile:${item.kind}`;"),

  ("  if (r < 0.83) return rollRing(depth, rng);",
   "  if (r < 0.79) return rollMissile(depth, rng);\n  if (r < 0.83) return rollRing(depth, rng);"),

  ("    case ITEM.RING: return 200 + (item.upgrade || 0) * 60;",
   "    case ITEM.MISSILE: return (MISSILES[item.kind]?.dmg || 3) * 5 * (item.amount || 1);\n    case ITEM.RING: return 200 + (item.upgrade || 0) * 60;"),
)

edit('shared/game.js',
  ("import { WANDS, wandPower, tickWand, refill } from './wands.js';",
   "import { WANDS, wandPower, tickWand, refill } from './wands.js';\nimport { MISSILES, missilePower } from './missiles.js';"),

  ("    if (isPointed(it)) { this.pointWand(p, f, it); return; }",
   "    if (isPointed(it)) { this.pointWand(p, f, it); return; }\n    if (it.type === ITEM.MISSILE) { this.throwMissile(p, f, n); return; }"),
)

edit('shared/game.js',
  ("""  /** The nearest monster roughly in front of the hero. */""",
   """  /**
   * Throw one of whatever is in that slot. It flies where you face, and what
   * is left of it lands on the floor for you to pick up on the way past.
   */
  throwMissile(p, f, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const item = slot.item;
    const def = MISSILES[item.kind];
    if (!def) return;

    if (--slot.count <= 0) p.bag[n] = null;
    this.metaDirty = true;

    const dmg = missilePower(def, f.depth, p.stats.ranged);
    const dx = DX[p.dir], dy = DY[p.dir];
    f.ents.push({
      id: this.entSeq++, kind: KIND.THROWN, x: p.x, y: p.y, dir: p.dir,
      box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, aimed: true,
      vx: dx * def.speed, vy: dy * def.speed, speed: def.speed,
      range: def.range * p.stats.rangeMult, travelled: 0,
      dmg, owner: p.id, friendly: true,
      missile: item.kind,
      pierce: def.pierce || 0,
      hitIds: [],
      homeX: p.x, homeY: p.y, coming: false,
    });
    this.fx(f, 'arrow', p.x + 8, p.y + 8);
  }

  /** A thrown thing in flight: it hits, it lands, or it comes back. */
  stepThrown(e, f, players) {
    const def = MISSILES[e.missile];
    e.x += e.vx; e.y += e.vy;
    e.travelled += Math.hypot(e.vx, e.vy);

    // a boomerang turns round at the far end and flies home
    if (def.returns && !e.coming && e.travelled >= e.range * 0.5) {
      e.coming = true;
      e.hitIds = [];
      const dx = e.homeX - e.x, dy = e.homeY - e.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      e.vx = (dx / d) * e.speed;
      e.vy = (dy / d) * e.speed;
    }

    for (const m of f.ents) {
      if (m.dead || !isMob(m.kind) || e.hitIds.includes(m.id)) continue;
      if (!rectsOverlap(e.x + 4, e.y + 4, 8, 8,
                        m.x + m.box.x, m.y + m.box.y, m.box.w, m.box.h)) continue;
      e.hitIds.push(m.id);
      this.hurtMob(m, e.dmg, e.dir, f, this.players.get(e.owner));
      if (def.roots) this.afflict(m, B.ROOTS, def.roots, 1, f);
      if (def.cripple) this.afflict(m, B.CRIPPLE, def.cripple, 1, f);
      if (def.bleed) this.afflict(m, B.BLEEDING, def.bleed, 1, f);
      if (def.burst) {
        this.fx(f, 'blast', e.x + 8, e.y + 8);
        for (const o of f.ents) {
          if (o.dead || !isMob(o.kind) || o === m) continue;
          const d2 = dist2(o.x + 8, o.y + 8, e.x + 8, e.y + 8);
          if (d2 > def.burst * def.burst) continue;
          this.hurtMob(o, Math.round(e.dmg * 0.6), e.dir, f, this.players.get(e.owner));
          const d = Math.max(1, Math.sqrt(d2));
          o.knockX = ((o.x - e.x) / d) * def.knock;
          o.knockY = ((o.y - e.y) / d) * def.knock;
          o.knockT = 8;
        }
      }
      if (e.pierce > 0 && !def.returns) { e.pierce--; continue; }
      if (def.returns) continue;      // it carries on and comes back
      return this.landMissile(e, f);
    }

    // a returning throw is caught rather than dropped
    if (def.returns && e.coming) {
      const owner = this.players.get(e.owner);
      if (owner && rectsOverlap(e.x + 4, e.y + 4, 8, 8,
                                owner.x + PLAYER_BOX.x, owner.y + PLAYER_BOX.y,
                                PLAYER_BOX.w, PLAYER_BOX.h)) {
        e.dead = true;
        this.addToBag(owner, { type: ITEM.MISSILE, kind: e.missile, amount: 1 });
        this.metaDirty = true;
        return;
      }
    }

    if (boxBlocked(f.tiles, e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h, MODE.SHOT) ||
        e.travelled > e.range * (def.returns ? 1.6 : 1) || e.t > 240) {
      return this.landMissile(e, f);
    }
  }

  /** What is left of a throw comes to rest on the floor. */
  landMissile(e, f) {
    e.dead = true;
    const def = MISSILES[e.missile];
    this.fx(f, 'fizzle', e.x + 8, e.y + 8);
    if (Math.random() > (def.keep ?? 0.7)) return;      // it broke
    const at = tileUnder(e, e.box);
    const spot = passable(f.tiles[at]) ? at : null;
    if (spot === null) return;
    this.dropItem(f, spot, { type: ITEM.MISSILE, kind: e.missile, amount: 1 });
  }

  /** The nearest monster roughly in front of the hero. */"""),

  ("      case KIND.WARD: return this.stepWard(e, f);",
   "      case KIND.WARD: return this.stepWard(e, f);\n      case KIND.THROWN: return this.stepThrown(e, f, players);"),
)

print('done')
