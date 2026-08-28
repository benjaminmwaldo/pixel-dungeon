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
  ("""  stepBoss(e, f, st, target) {
    if (target) this.stepChase(e, f, st.speed, MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);

    if (--e.cd <= 0) {
      e.cd = 70 + ((Math.random() * 40) | 0);
      e.mouth = 14;
      if (target) {
        if (st.fan) for (const spread of [-0.45, 0, 0.45]) this.bossShot(e, f, target, st, spread);
        else this.bossShot(e, f, target, st, 0);
      }
      if (st.summons && f.ents.filter(x => isMob(x.kind) && !isBoss(x.kind)).length < 6) {
        const pts = f.level.spawnPoints;
        if (pts.length) {
          const spot = tileToPixel(pts[(Math.random() * pts.length) | 0], MOBS[st.summons].box);
          this.spawnMob(f, st.summons, spot.x, spot.y);
          this.fx(f, 'summon', e.x + 16, e.y + 16);
        }
      }
    }
    if (e.mouth > 0) e.mouth--;
  }""",
   """  /**
   * A boss is not just a bigger health bar. Each one is a short sequence of
   * fights: the phase changes when it is hurt past a threshold, and the change
   * is announced so the party knows the rules moved.
   */
  stepBoss(e, f, st, target) {
    this.bossPhase(e, f, st);

    // the shared skeleton: walk at them, and every so often do something
    const fight = st.fight ? this[`fight_${st.fight}`] : null;
    if (fight) fight.call(this, e, f, st, target);
    else this.fightPlain(e, f, st, target);

    if (e.mouth > 0) e.mouth--;
    if (e.untouchable > 0) e.untouchable--;
    if (e.windup > 0) e.windup--;
  }

  /** Move the boss into whichever phase its health now says it is in. */
  bossPhase(e, f, st) {
    const list = st.phases;
    if (!list) return;
    const frac = e.hp / Math.max(1, e.maxHp);
    let want = 0;
    for (let i = 0; i < list.length; i++) if (frac <= list[i].at) want = i;
    if (want === (e.phase2 ?? -1)) return;
    e.phase2 = want;
    e.cd = 20;
    this.banner(list[want].say, 2600);
    this.fx(f, 'roar', e.x + 16, e.y + 16);
  }

  /** What a boss does with no particular script: chase and shoot. */
  fightPlain(e, f, st, target) {
    if (target) this.stepChase(e, f, st.speed, MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);
    if (--e.cd > 0) return;
    e.cd = 70 + ((Math.random() * 40) | 0);
    e.mouth = 14;
    if (target) {
      if (st.fan) for (const spread of [-0.45, 0, 0.45]) this.bossShot(e, f, target, st, spread);
      else this.bossShot(e, f, target, st, 0);
    }
    this.bossSummon(e, f, st.summons, 6);
  }

  /** Call something up, if the floor is not already crowded. */
  bossSummon(e, f, kind, cap) {
    if (!kind) return null;
    if (f.ents.filter(x => isMob(x.kind) && !isBoss(x.kind) && !x.dead).length >= cap) return null;
    const pts = f.level.spawnPoints;
    if (!pts.length) return null;
    const spot = tileToPixel(pts[(Math.random() * pts.length) | 0], MOBS[kind].box);
    const m = this.spawnMob(f, kind, spot.x, spot.y, { champion: null });
    if (m) m.alerted = 900;
    this.fx(f, 'summon', e.x + 16, e.y + 16);
    return m;
  }

  // -------------------------------------------------------------------------
  // The five fights
  // -------------------------------------------------------------------------

  /** Glut swells up and bursts, and the water is on its side. */
  fight_glut(e, f, st, target) {
    const swollen = (e.phase2 || 0) >= 1;

    // it mends in water, so fighting it in the shallows is a mistake
    const under = f.tiles[tileUnder(e, e.box)];
    if (under === TT.WATER && (this.tick & 31) === 0) {
      e.hp = Math.min(e.maxHp, e.hp + (swollen ? 2 : 1));
    }

    if (e.windup > 0) {
      // holding its breath: it does not move, and then it lets go
      e.mouth = 14;
      if (e.windup === 1) {
        this.fx(f, 'blast', e.x + 16, e.y + 16);
        const r = 62;
        for (const p of this.livingOn(f.depth)) {
          if (dist2(p.x + 8, p.y + 8, e.x + 16, e.y + 16) > r * r) continue;
          this.hurtPlayer(p, Math.round(e.dmg * 1.8), e.x + 16, e.y + 16, e, true);
          this.afflict(p, B.OOZE, 240, 1, f);
        }
        // and it leaves the floor wet where it stood
        this.puddle(f, e.x + 16, e.y + 16, 2);
      }
      return;
    }

    if (target) this.stepChase(e, f, st.speed * (swollen ? 1.25 : 1), MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);

    if (--e.cd > 0) return;
    e.cd = swollen ? 60 : 80;
    e.mouth = 14;
    if (swollen && target && Math.random() < 0.5) {
      e.windup = 40;                       // the pump-up
      this.banner('IT DRAWS ITSELF IN', 1200);
      return;
    }
    if (target) this.bossShot(e, f, target, st, 0);
  }

  /** The Warden stops walking and starts appearing, leaving traps behind. */
  fight_warden(e, f, st, target) {
    const blinking = (e.phase2 || 0) >= 1;

    if (!blinking) {
      if (target) this.stepChase(e, f, st.speed, MODE.WALK);
      else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);
      if (--e.cd > 0) return;
      e.cd = 70;
      e.mouth = 14;
      if (target) this.bossShot(e, f, target, st, 0);
      this.bossSummon(e, f, st.summons, 5);
      return;
    }

    // in the second half it does not walk at all
    if (--e.cd > 0) return;
    e.cd = 55;
    e.mouth = 14;

    // leave something nasty where it was standing
    const was = tileUnder(e, e.box);
    if (f.tiles[was] === TT.FLOOR || f.tiles[was] === TT.FLOOR_DECO) {
      f.level.traps ??= {};
      f.set(was, TT.TRAP_HIDDEN);
      f.level.traps[was] = rollTrap(f.depth, f.rng);
    }

    // and turn up somewhere else
    const pts = f.level.spawnPoints;
    if (pts.length) {
      for (let n = 0; n < 20; n++) {
        const i = pts[(Math.random() * pts.length) | 0];
        if (!passable(f.tiles[i])) continue;
        const spot = tileToPixel(i, e.box);
        if (boxBlocked(f.tiles, spot.x + e.box.x, spot.y + e.box.y, e.box.w, e.box.h, MODE.WALK)) continue;
        e.x = spot.x; e.y = spot.y;
        break;
      }
    }
    e.untouchable = 18;                     // briefly nothing lands on it
    this.fx(f, 'poof', e.x + 16, e.y + 16);
    if (target) {
      for (const spread of [-0.35, 0, 0.35]) this.bossShot(e, f, target, st, spread);
    }
  }

  /** The Tyrant hides behind its pylons and breaks the floor as it goes. */
  fight_tyrant(e, f, st, target) {
    const raised = (e.phase2 || 0) >= 1;
    const pylons = f.ents.filter(x => x.kind === KIND.PYLON && !x.dead);

    if (raised && !e.pylonsUp) {
      e.pylonsUp = true;
      const at = [[-3, -3], [3, -3], [-3, 3], [3, 3]];
      for (const [dx, dy] of at) {
        const px = tx(tileUnder(e, e.box)) + dx, py = ty(tileUnder(e, e.box)) + dy;
        if (!inBounds(px, py) || !passable(f.tiles[idx(px, py)])) continue;
        const spot = tileToPixel(idx(px, py), MOBS[KIND.PYLON].box);
        this.spawnMob(f, KIND.PYLON, spot.x, spot.y, { champion: null });
      }
      this.fx(f, 'summon', e.x + 16, e.y + 16);
    }

    // while a pylon stands, most of what you land on it does not take
    e.shielded = raised && pylons.length > 0;

    if (target) this.stepChase(e, f, st.speed * (raised ? 0.8 : 1), MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);

    if (--e.cd > 0) return;
    e.cd = raised ? 55 : 75;
    e.mouth = 14;
    if (target) this.bossShot(e, f, target, st, 0);

    if (raised) {
      // it breaks the ground it walks over
      const here = tileUnder(e, e.box);
      const cx = tx(here), cy = ty(here);
      for (let n = 0; n < 3; n++) {
        const nx = cx + (f.rng.int(7) - 3), ny = cy + (f.rng.int(7) - 3);
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (f.tiles[j] === TT.FLOOR || f.tiles[j] === TT.FLOOR_DECO) f.set(j, TT.RUBBLE);
      }
    }
  }

  /** The King calls his court, and then comes back without his skin. */
  fight_king(e, f, st, target) {
    const phase = e.phase2 || 0;

    if (phase >= 2 && !e.risen) {
      e.risen = true;
      e.dmg = Math.round(e.dmg * 1.5);
      e.untouchable = 40;
      this.fx(f, 'blast', e.x + 16, e.y + 16);
      // his court goes down with him, and he comes back alone
      for (const o of f.ents) {
        if (o.dead || !isMob(o.kind) || isBoss(o.kind)) continue;
        this.hurtMob(o, 9999, S, f, null);
      }
    }

    if (target) this.stepChase(e, f, st.speed * (e.risen ? 1.3 : 1), MODE.WALK);
    else this.stepWander(e, f, st.speed * 0.6, MODE.WALK);

    if (--e.cd > 0) return;
    e.cd = e.risen ? 45 : 70;
    e.mouth = 14;
    if (target) this.bossShot(e, f, target, st, e.risen ? 0.3 : 0);
    if (target && e.risen) this.bossShot(e, f, target, st, -0.3);
    if (phase >= 1 && !e.risen) this.bossSummon(e, f, st.summons, 5);
  }

  /** It does not move. It reaches, and you have to take the hands off first. */
  fight_unsleeping(e, f, st, target) {
    const fists = f.ents.filter(x => x.kind === KIND.FIST && !x.dead);

    if (!e.handsOut) {
      e.handsOut = true;
      for (let n = 0; n < 2; n++) {
        const m = this.bossSummon(e, f, KIND.FIST, 99);
        if (m) m.alerted = 900;
      }
    }

    // nothing touches it while a fist still stands
    e.shielded = fists.length > 0;

    // it never walks
    if (--e.cd > 0) return;
    e.cd = fists.length ? 60 : 40;
    e.mouth = 14;
    if (target) {
      for (const spread of [-0.45, 0, 0.45]) this.bossShot(e, f, target, st, spread);
    }
    // it keeps putting hands back out, more slowly once it is awake
    if (fists.length < 2 && Math.random() < ((e.phase2 || 0) >= 2 ? 0.25 : 0.5)) {
      this.bossSummon(e, f, KIND.FIST, 99);
    }
    if ((e.phase2 || 0) >= 2) this.bossSummon(e, f, st.summons, 4);
  }

  /** Leave water where something wet has been. */
  puddle(f, x, y, radius) {
    const c = tileUnder({ x: x - 8, y: y - 8 }, PLAYER_BOX);
    const cx = tx(c), cy = ty(c);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (!inBounds(nx, ny)) continue;
        const j = idx(nx, ny);
        if (f.tiles[j] === TT.FLOOR || f.tiles[j] === TT.FLOOR_DECO ||
            f.tiles[j] === TT.EMBERS) f.set(j, TT.WATER);
      }
    }
  }"""),
)

# a shielded or untouchable boss is exactly that
edit('shared/game.js',
  ("""    const champ = e.champ ? CHAMPIONS[e.champ] : null;
    if (champ?.evade && !overTime && Math.random() < champ.evade) {""",
   """    if (e.untouchable > 0 && !overTime) { this.fx(f, 'clang', e.x + 8, e.y + 8); return; }
    if (e.shielded && !overTime) {
      // it is standing behind something; take most of the blow off
      dmg = Math.max(1, Math.round(dmg * 0.15));
      this.fx(f, 'clang', e.x + 8, e.y + 8);
    }
    const champ = e.champ ? CHAMPIONS[e.champ] : null;
    if (champ?.evade && !overTime && Math.random() < champ.evade) {"""),
)

print('done')
