import io

def edit(path, *pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n%s' % (path, old[:220]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched', path)

edit('shared/game.js',
  ("""  /**
   * Throw one of whatever is in that slot.""",
   """  /** Put an artifact on, swapping out whatever was there. */
  wearArtifact(p, n) {
    const slot = p.bag[n];
    if (!slot) return;
    const art = slot.item;
    const old = p.equip.artifact;
    p.equip.artifact = { ...art };
    p.bag[n] = old ? { key: stackKey(old), item: old, count: 1 } : null;
    this.fx(this.floor(p.depth), 'equip', p.x + 8, p.y + 8);
    this.banner(`${p.name} TAKES UP THE ${ARTIFACTS[art.kind].name}`, 1800);
    this.recalc(p);
  }

  /** Feed the worn artifact whatever it lives on, and say so if it grows. */
  growArtifact(p, what, amount = 1) {
    const art = p.equip.artifact;
    if (!art) return;
    if (feed(art, what, amount)) {
      this.banner(`THE ${ARTIFACTS[art.kind].name} IS STRONGER`, 1800);
      this.metaDirty = true;
    }
  }

  /**
   * The one thing you carry that answers to its own key. Everything here is
   * instant — nothing may pause, because three other people are playing.
   */
  useArtifact(p) {
    if (p.ghost || this.state !== 'play') return;
    const art = p.equip.artifact;
    if (!art) { this.banner('YOU ARE CARRYING NO SUCH THING', 1200); return; }
    const def = ARTIFACTS[art.kind];
    if (!def.active) { this.banner(`THE ${def.name} WORKS ON ITS OWN`, 1400); return; }
    if ((art.charge || 0) <= 0) { this.banner(`THE ${def.name} IS SPENT`, 1200); return; }

    const f = this.floor(p.depth);
    const lv = art.level;
    art.charge--;
    this.growArtifact(p, 'use');
    this.metaDirty = true;

    switch (art.kind) {
      case ART.CLOAK:
        p.invis = Math.max(p.invis, 160 + lv * 30);
        this.afflict(p, B.INVISIBLE, 160 + lv * 30, 1, f);
        this.fx(f, 'cloak', p.x + 8, p.y + 8);
        this.banner(`${p.name} STEPS OUT OF SIGHT`, 1400);
        break;

      case ART.HORN:
        p.hunger = HUNGER_MAX;
        this.healPlayer(p, 4 + lv);
        this.fx(f, 'eat', p.x + 8, p.y + 8);
        this.banner('A MEAL OUT OF NOTHING', 1400);
        break;

      case ART.CHALICE: {
        // it wants your blood, and pays for it afterwards
        const cost = Math.max(2, Math.round(p.maxHp * 0.18));
        this.hurtPlayer(p, cost, p.x + 8, p.y + 8, null, true);
        if (!p.ghost) {
          this.growArtifact(p, 'blood');
          this.afflict(p, B.REGEN, 600 + lv * 120, 1 + Math.floor(lv / 3), f);
          this.banner('THE CHALICE DRINKS, AND THEN GIVES BACK', 1800);
        }
        break;
      }

      case ART.TALISMAN: {
        const reach = 4 + lv;
        const here = tileUnder(p, PLAYER_BOX);
        const cx = tx(here), cy = ty(here);
        let found = 0;
        for (let dy = -reach; dy <= reach; dy++) {
          for (let dx = -reach; dx <= reach; dx++) {
            const nx = cx + dx, ny = cy + dy;
            if (!inBounds(nx, ny)) continue;
            const j = idx(nx, ny);
            if (f.tiles[j] === TT.TRAP_HIDDEN) { f.set(j, TT.TRAP); found++; }
            else if (f.tiles[j] === TT.SECRET_DOOR) { f.set(j, TT.DOOR); found++; }
          }
        }
        if (found) this.growArtifact(p, 'search', found);
        this.banner(found ? `THE FLOOR GIVES UP ${found} SECRETS` : 'NOTHING IS HIDDEN HERE', 1600);
        break;
      }

      case ART.HOURGLASS: {
        const ticks = 90 + lv * 20;
        for (const e of f.ents) {
          if (e.dead || !isMob(e.kind) || isNpc(e.kind)) continue;
          this.afflict(e, B.FROZEN, ticks, 1, f);
        }
        this.fx(f, 'freeze', p.x + 8, p.y + 8);
        this.banner('EVERYTHING BUT YOU STOPS', 1800);
        break;
      }

      case ART.CAPE:
        this.afflict(p, B.BARKSKIN, 260 + lv * 40, 1, f);
        p.thorns = 260 + lv * 40;
        this.fx(f, 'guard', p.x + 8, p.y + 8);
        this.banner('THE CAPE BRISTLES', 1500);
        break;

      case ART.ROSE: {
        const spot = tileToPixel(tileUnder(p, PLAYER_BOX), { x: 4, y: 4, w: 8, h: 8 });
        f.ents.push({
          id: this.entSeq++, kind: KIND.SPIRIT, x: spot.x, y: spot.y, dir: p.dir,
          box: { x: 3, y: 5, w: 10, h: 10 }, t: 0,
          life: 500 + lv * 100, cd: 0,
          dmg: 4 + lv * 2, owner: p.id,
        });
        this.fx(f, 'poof', p.x + 8, p.y + 8);
        this.banner('SOMEONE NOT QUITE GONE STEPS OUT', 1800);
        break;
      }

      case ART.CHAINS: {
        // grab the nearest thing ahead and haul it in
        const target = this.nearestAhead(p, f, 140 + lv * 10);
        if (target) {
          const dx = p.x - target.x, dy = p.y - target.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          target.knockX = (dx / d) * 26;
          target.knockY = (dy / d) * 26;
          target.knockT = 8;
          this.afflict(target, B.CRIPPLE, 120, 1, f);
          this.fx(f, 'clang', target.x + 8, target.y + 8);
          this.banner('THE CHAINS TAKE HOLD', 1400);
        } else {
          // nothing there: haul yourself instead
          const dxx = DX[p.dir], dyy = DY[p.dir];
          for (let step = 6; step >= 1; step--) {
            const at = tileUnder({ x: p.x + dxx * step * TILE, y: p.y + dyy * step * TILE }, PLAYER_BOX);
            if (!passable(f.tiles[at])) continue;
            const spot = tileToPixel(at, PLAYER_BOX);
            p.x = spot.x; p.y = spot.y;
            p.fovTile = -1;
            break;
          }
          this.fx(f, 'poof', p.x + 8, p.y + 8);
          this.banner('YOU HAUL YOURSELF ACROSS', 1400);
        }
        break;
      }

      case ART.BEACON: {
        if (!art.beacon || art.beacon.depth !== p.depth) {
          art.beacon = { depth: p.depth, x: Math.round(p.x), y: Math.round(p.y) };
          art.charge++;                          // setting it is free
          this.fx(f, 'poof', p.x + 8, p.y + 8);
          this.banner('THIS PLACE IS REMEMBERED', 1600);
        } else {
          p.x = art.beacon.x; p.y = art.beacon.y;
          p.fovTile = -1;
          this.fx(f, 'teleport', p.x + 8, p.y + 8);
          this.banner('THE BEACON PULLS YOU BACK', 1600);
        }
        break;
      }

      case ART.SPELLBOOK: {
        const pool = [SCROLL.MAPPING, SCROLL.TERROR, SCROLL.RAGE, SCROLL.LULLABY,
                      SCROLL.RECHARGE, SCROLL.MIRROR, SCROLL.TELEPORT];
        const pick = pool[Math.floor(Math.random() * pool.length)];
        this.banner('THE BOOK FALLS OPEN SOMEWHERE', 1400);
        this.read(p, f, pick);
        break;
      }

      default:
        break;
    }
  }

  /** A spirit called up by the rose: it fights beside you, then fades. */
  stepSpirit(e, f) {
    if (--e.life <= 0) { e.dead = true; this.fx(f, 'poof', e.x + 8, e.y + 8); return; }
    let best = null, bd = Infinity;
    for (const o of f.ents) {
      if (o.dead || !isMob(o.kind) || isNpc(o.kind)) continue;
      const d = dist2(o.x, o.y, e.x, e.y);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best) {
      // nothing to fight: drift back to whoever called you
      const owner = this.players.get(e.owner);
      if (owner && dist2(owner.x, owner.y, e.x, e.y) > 40 * 40) {
        const dx = owner.x - e.x, dy = owner.y - e.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        moveActor(e, (dx / d) * 1.8, (dy / d) * 1.8, f.tiles, e.box, MODE.FLY, true);
      }
      return;
    }
    const dx = best.x - e.x, dy = best.y - e.y;
    const d = Math.max(1, Math.hypot(dx, dy));
    e.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? E : W) : (dy > 0 ? S : N);
    if (bd > 16 * 16) {
      moveActor(e, (dx / d) * 2.1, (dy / d) * 2.1, f.tiles, e.box, MODE.FLY, true);
      clampToLevel(e, e.box);
    } else if (e.cd <= 0) {
      e.cd = 26;
      this.hurtMob(best, e.dmg, e.dir, f, this.players.get(e.owner));
      this.fx(f, 'clang', best.x + 8, best.y + 8);
    }
    if (e.cd > 0) e.cd--;
  }

  /**
   * Throw one of whatever is in that slot."""),

  ("      case KIND.THROWN: return this.stepThrown(e, f, players);",
   "      case KIND.THROWN: return this.stepThrown(e, f, players);\n      case KIND.SPIRIT: return this.stepSpirit(e, f);"),
)

print('done')
