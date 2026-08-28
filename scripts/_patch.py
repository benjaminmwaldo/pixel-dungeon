import io

def edit(path, *pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n%s' % (path, old[:220]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched', path)

# a ward is a thing you leave behind, not a creature
edit('shared/constants.js',
  ("  ITEM: 60, BOMB: 61, BLAST: 62, POOF: 63, GAS: 64,",
   "  ITEM: 60, BOMB: 61, BLAST: 62, POOF: 63, GAS: 64, WARD: 65,"))

edit('shared/game.js',
  ("  itemLabel, buyPrice, sellPrice, rollStock, isWorn,\n} from './items.js';",
   "  itemLabel, buyPrice, sellPrice, rollStock, isWorn, isPointed,\n} from './items.js';\nimport { WANDS, wandPower, tickWand, refill } from './wands.js';"),

  # pointing one
  ("    if (isWorn(it)) { this.equipFrom(p, n); return; }",
   "    if (isWorn(it)) { this.equipFrom(p, n); return; }\n    if (isPointed(it)) { this.pointWand(p, f, it); return; }"),
)

edit('shared/game.js',
  ("""  /** Somewhere on this floor a hero could stand. */""",
   """  /**
   * Spend a charge and point the thing. Everything is aimed with your facing,
   * so there is no cursor and no pause — you turn, and you fire.
   */
  pointWand(p, f, item) {
    const def = WANDS[item.kind];
    if (!def) return;
    if ((item.charges || 0) <= 0) {
      this.banner('THE WAND IS SPENT', 1200);
      return;
    }
    item.charges--;
    if (!item.known) {
      item.known = true;
      if (!this.known.wands.includes(item.kind)) this.known.wands.push(item.kind);
      this.banner(`IT IS A WAND OF ${def.name}`, 1800);
    }
    this.metaDirty = true;

    const dmg = wandPower(def, f.depth, item.upgrade || 0);
    const dx = DX[p.dir], dy = DY[p.dir];
    const cx = p.x + 8, cy = p.y + 8;

    switch (def.effect) {
      case 'bolt': {
        this.fx(f, 'bolt', cx, cy);
        f.ents.push({
          id: this.entSeq++, kind: KIND.BOLT, x: p.x, y: p.y, dir: p.dir,
          box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, aimed: true,
          vx: dx * 4.4, vy: dy * 4.4, speed: 4.4, range: 190, travelled: 0,
          dmg, owner: p.id, friendly: true,
          freeze: def.freeze || 0, burn: def.burn || 0,
        });
        break;
      }
      case 'cone': {
        // three tiles of flame straight ahead
        for (let step = 1; step <= 3; step++) {
          const x = cx + dx * step * TILE, y = cy + dy * step * TILE;
          this.fx(f, 'fire', x, y);
          const at = tileUnder({ x: x - 8, y: y - 8 }, PLAYER_BOX);
          if (!passable(f.tiles[at])) break;
          if (f.tiles[at] === TT.GRASS || f.tiles[at] === TT.HIGH_GRASS) f.set(at, TT.EMBERS);
          for (const e of f.ents) {
            if (e.dead || !isMob(e.kind)) continue;
            if (dist2(e.x + 8, e.y + 8, x, y) > 14 * 14) continue;
            this.hurtMob(e, dmg, p.dir, f, p);
            if (def.burn) this.afflict(e, B.BURNING, def.burn, 1, f);
          }
        }
        break;
      }
      case 'beam': {
        // a line that does not stop at the first thing it meets
        this.fx(f, 'beam', cx, cy);
        for (let step = 1; step <= 10; step++) {
          const x = cx + dx * step * TILE, y = cy + dy * step * TILE;
          const at = tileUnder({ x: x - 8, y: y - 8 }, PLAYER_BOX);
          if (!inBounds(tx(at), ty(at)) || blocksShot(f.tiles[at])) break;
          this.fx(f, 'spark', x, y);
          for (const e of f.ents) {
            if (e.dead || !isMob(e.kind)) continue;
            if (dist2(e.x + 8, e.y + 8, x, y) > 12 * 12) continue;
            this.hurtMob(e, dmg, p.dir, f, p);
          }
        }
        break;
      }
      case 'chain': {
        // hits what is ahead, then jumps between whatever is standing close
        const first = this.nearestAhead(p, f, 120);
        if (!first) { this.fx(f, 'spark', cx + dx * 20, cy + dy * 20); break; }
        const struck = new Set([first]);
        let from = first;
        this.hurtMob(first, dmg, p.dir, f, p);
        this.fx(f, 'spark', first.x + 8, first.y + 8);
        for (let jump = 0; jump < 3; jump++) {
          let next = null, best = Infinity;
          for (const e of f.ents) {
            if (e.dead || !isMob(e.kind) || struck.has(e)) continue;
            const d = dist2(e.x, e.y, from.x, from.y);
            if (d < best && d <= def.arc * def.arc) { best = d; next = e; }
          }
          if (!next) break;
          struck.add(next);
          this.hurtMob(next, Math.max(1, Math.round(dmg * 0.7)), p.dir, f, p);
          this.fx(f, 'spark', next.x + 8, next.y + 8);
          from = next;
        }
        break;
      }
      case 'gas': {
        const x = cx + dx * 30, y = cy + dy * 30;
        this.cloud(f, x, y, def.radius, B.CORROSION, def.corrode, p);
        break;
      }
      case 'burst': {
        this.fx(f, 'blast', cx, cy);
        for (const e of f.ents) {
          if (e.dead || !isMob(e.kind)) continue;
          const d2 = dist2(e.x + 8, e.y + 8, cx, cy);
          if (d2 > def.radius * def.radius) continue;
          this.hurtMob(e, dmg, p.dir, f, p);
          const d = Math.max(1, Math.sqrt(d2));
          e.knockX = ((e.x + 8 - cx) / d) * def.knock;
          e.knockY = ((e.y + 8 - cy) / d) * def.knock;
          e.knockT = 8;
        }
        break;
      }
      case 'drain': {
        const target = this.nearestAhead(p, f, 130);
        if (!target) { this.banner('NOTHING IN FRONT OF YOU', 1100); break; }
        this.hurtMob(target, dmg, p.dir, f, p);
        this.healPlayer(p, Math.max(1, Math.round(dmg * 0.6)));
        this.fx(f, 'heal', p.x + 8, p.y + 8);
        break;
      }
      case 'grow': {
        for (let step = 1; step <= def.reach; step++) {
          const at = tileUnder({ x: cx + dx * step * TILE - 8, y: cy + dy * step * TILE - 8 }, PLAYER_BOX);
          const t = f.tiles[at];
          if (t === TT.FLOOR || t === TT.FLOOR_DECO || t === TT.EMBERS) f.set(at, TT.HIGH_GRASS);
          else if (t === TT.GRASS) f.set(at, TT.HIGH_GRASS);
          else if (!passable(t)) break;
        }
        this.fx(f, 'heal', cx + dx * 20, cy + dy * 20);
        break;
      }
      case 'charm': {
        const target = this.nearestAhead(p, f, 130);
        if (!target) { this.banner('NOTHING IN FRONT OF YOU', 1100); break; }
        this.afflict(target, B.CHARM, def.charm, 1, f);
        this.fx(f, 'poof', target.x + 8, target.y + 8);
        break;
      }
      case 'ward': {
        const at = tileUnder({ x: cx + dx * TILE - 8, y: cy + dy * TILE - 8 }, PLAYER_BOX);
        if (!passable(f.tiles[at])) { this.banner('NO ROOM FOR IT THERE', 1200); break; }
        const spot = tileToPixel(at, { x: 4, y: 4, w: 8, h: 8 });
        f.ents.push({
          id: this.entSeq++, kind: KIND.WARD, x: spot.x, y: spot.y, dir: p.dir,
          box: { x: 4, y: 4, w: 8, h: 8 }, t: 0,
          life: def.life, cd: 0, dmg, owner: p.id,
        });
        this.fx(f, 'poof', spot.x + 8, spot.y + 8);
        break;
      }
      case 'flash': {
        this.fx(f, 'blast', cx, cy);
        for (const e of f.ents) {
          if (e.dead || !isMob(e.kind)) continue;
          if (dist2(e.x + 8, e.y + 8, cx, cy) > def.radius * def.radius) continue;
          this.hurtMob(e, dmg, p.dir, f, p);
          this.afflict(e, B.BLINDNESS, def.blind, 1, f);
        }
        this.afflict(p, B.LIGHT, 400, 1, f);
        break;
      }
      default: break;
    }
  }

  /** The nearest monster roughly in front of the hero. */
  nearestAhead(p, f, reach) {
    const dx = DX[p.dir], dy = DY[p.dir];
    const cx = p.x + 8, cy = p.y + 8;
    let best = null, bd = Infinity;
    for (const e of f.ents) {
      if (e.dead || !isMob(e.kind)) continue;
      const ox = e.x + 8 - cx, oy = e.y + 8 - cy;
      if (ox * dx + oy * dy <= 0) continue;             // behind you
      const off = Math.abs(ox * dy - oy * dx);          // how far off the line
      if (off > 26) continue;
      const d = ox * ox + oy * oy;
      if (d > reach * reach || d >= bd) continue;
      bd = d; best = e;
    }
    return best;
  }

  /** A ward sits where you left it and shoots whatever comes past. */
  stepWard(e, f) {
    if (--e.life <= 0) { e.dead = true; this.fx(f, 'poof', e.x + 8, e.y + 8); return; }
    if (e.cd > 0) { e.cd--; return; }
    let best = null, bd = Infinity;
    for (const o of f.ents) {
      if (o.dead || !isMob(o.kind)) continue;
      const d = dist2(o.x, o.y, e.x, e.y);
      if (d < bd && d < 130 * 130) { bd = d; best = o; }
    }
    if (!best) return;
    e.cd = 40;
    const dx = best.x - e.x, dy = best.y - e.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    f.ents.push({
      id: this.entSeq++, kind: KIND.BOLT, x: e.x, y: e.y, dir: e.dir,
      box: { x: 4, y: 4, w: 8, h: 8 }, t: 0, aimed: true,
      vx: (dx / d) * 3.8, vy: (dy / d) * 3.8, speed: 3.8, range: 150, travelled: 0,
      dmg: e.dmg, owner: e.owner, friendly: true,
    });
    this.fx(f, 'bolt', e.x + 8, e.y + 8);
  }

  /** Somewhere on this floor a hero could stand. */"""))

edit('shared/game.js',
  ("      case KIND.BLAST: if (--e.life <= 0) e.dead = true; return;",
   "      case KIND.BLAST: if (--e.life <= 0) e.dead = true; return;\n      case KIND.WARD: return this.stepWard(e, f);"),
)

print('done')
