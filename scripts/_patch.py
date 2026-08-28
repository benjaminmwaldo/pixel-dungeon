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
  ("  ITEM: 80, BOMB: 81, BLAST: 82, POOF: 83, GAS: 84, WARD: 85, THROWN: 86,\n  SPIRIT: 87,",
   "  ITEM: 80, BOMB: 81, BLAST: 82, POOF: 83, GAS: 84, WARD: 85, THROWN: 86,\n  SPIRIT: 87, PLANT: 88,"))

edit('shared/items.js',
  ("  ARTIFACT: 'artifact', QUEST: 'quest',\n};",
   "  ARTIFACT: 'artifact', QUEST: 'quest', SEED: 'seed',\n};"),
  ("import { MISSILES, rollMissile } from './missiles.js';",
   "import { MISSILES, rollMissile } from './missiles.js';\nimport { PLANTS, rollSeed } from './plants.js';"),
  ("    case ITEM.QUEST: return item.name || 'SOMETHING SOMEBODY WANTS';",
   """    case ITEM.SEED: {
      const def = PLANTS[item.kind];
      const n = item.amount || 1;
      const word = `${def ? def.name : 'PLAIN'} SEED`;
      return n > 1 ? `${n} ${word}S` : word;
    }
    case ITEM.QUEST: return item.name || 'SOMETHING SOMEBODY WANTS';"""),
  ("         item.type === ITEM.KEY || item.type === ITEM.GOLDKEY ||\n         item.type === ITEM.MISSILE;",
   "         item.type === ITEM.KEY || item.type === ITEM.GOLDKEY ||\n         item.type === ITEM.MISSILE || item.type === ITEM.SEED;"),
  ("  if (item.type === ITEM.MISSILE) return `missile:${item.kind}`;",
   "  if (item.type === ITEM.MISSILE) return `missile:${item.kind}`;\n  if (item.type === ITEM.SEED) return `seed:${item.kind}`;"),
  ("  if (r < 0.84) return rollMissile(depth, rng);",
   "  if (r < 0.81) return rollMissile(depth, rng);\n  if (r < 0.84) return rollSeed(depth, rng);"),
  ("    case ITEM.MISSILE: return (MISSILES[item.kind]?.dmg || 3) * 5 * (item.amount || 1);",
   "    case ITEM.SEED: return 30 * (item.amount || 1);\n    case ITEM.MISSILE: return (MISSILES[item.kind]?.dmg || 3) * 5 * (item.amount || 1);"))

edit('shared/game.js',
  ("import { rollRing } from './rings.js';",
   "import { rollRing } from './rings.js';\nimport { PLANTS, PLANT, PLANT_IDS, rollPlant, plantIndex } from './plants.js';"),

  # sowing one from the pack
  ("    if (it.type === ITEM.MISSILE) { this.throwMissile(p, f, n); return; }",
   "    if (it.type === ITEM.MISSILE) { this.throwMissile(p, f, n); return; }\n    if (it.type === ITEM.SEED) { this.sow(p, f, n); return; }"),
)

edit('shared/game.js',
  ("""  /** The nearest monster roughly in front of the hero. */""",
   """  /** Put a seed in the ground one tile ahead of you. */
  sow(p, f, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const kind = slot.item.kind;
    const dx = DX[p.dir], dy = DY[p.dir];
    const at = tileUnder({ x: p.x + dx * TILE, y: p.y + dy * TILE }, PLAYER_BOX);
    const here = tileUnder(p, PLAYER_BOX);
    const spot = this.sowable(f, at) ? at : this.sowable(f, here) ? here : null;
    if (spot === null) { this.banner('NOTHING WILL TAKE ROOT THERE', 1300); return; }

    if (--slot.count <= 0) p.bag[n] = null;
    this.plant(f, spot, kind);
    this.fx(f, 'heal', tx(spot) * TILE + 8, ty(spot) * TILE + 8);
    this.banner(`${PLANTS[kind].name} TAKES ROOT`, 1400);
    this.metaDirty = true;
  }

  /** Will anything grow on this tile? */
  sowable(f, i) {
    if (i === null || i === undefined) return false;
    const t = f.tiles[i];
    if (t !== TT.FLOOR && t !== TT.FLOOR_DECO && t !== TT.GRASS && t !== TT.EMBERS) return false;
    return !f.ents.some(e => !e.dead && e.kind === KIND.PLANT && tileUnder(e, e.box) === i);
  }

  /** Grow one, wherever it came from. */
  plant(f, tile, kind) {
    const px = tileToPixel(tile, { x: 4, y: 4, w: 8, h: 8 });
    const e = {
      id: this.entSeq++, kind: KIND.PLANT, x: px.x, y: px.y, dir: 0,
      box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, plant: kind,
    };
    f.ents.push(e);
    return e;
  }

  /** Something stood on it. It does its one thing and is gone. */
  trample(e, f, who, isHero) {
    const def = PLANTS[e.plant];
    if (!def) { e.dead = true; return; }
    e.dead = true;
    const x = e.x + 8, y = e.y + 8;
    this.fx(f, 'poof', x, y);
    this.banner(def.name, 1200);

    if (def.buff) this.afflict(who, def.buff[0], def.buff[1], 1, f);
    if (def.cloud) this.cloud(f, x, y, def.cloud[2], def.cloud[0], def.cloud[1], null);
    if (def.teleport && isHero) {
      const spot = this.randomSpot(f);
      if (spot) { who.x = spot.x; who.y = spot.y; who.fovTile = -1; }
      this.fx(f, 'teleport', who.x + 8, who.y + 8);
    } else if (def.teleport) {
      const spot = this.randomSpot(f);
      if (spot) { who.x = spot.x; who.y = spot.y; }
    }
    if (def.shout) {
      for (const o of f.ents) {
        if (o.dead || !isMob(o.kind) || isNpc(o.kind)) continue;
        o.alerted = def.shout;
      }
    }
    if (def.feeds && isHero) {
      who.hunger = HUNGER_MAX;
      this.healPlayer(who, 3);
      this.fx(f, 'eat', x, y);
    }
    this.metaDirty = true;
  }

  /** The nearest monster roughly in front of the hero. */"""),
)

print('done')
