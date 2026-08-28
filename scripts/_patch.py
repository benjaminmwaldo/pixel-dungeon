import io

def edit(path, *pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n%s' % (path, old[:200]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched', path)

edit('shared/game.js',
  # ---- what a floor feels like when you arrive ----------------------------
  ("""    for (let n = 0; n < mobBudget(f.depth); n++) this.spawnRandomMob(f);

    const drops = 5 + f.rng.int(4);
    for (let n = 0; n < drops && n < f.level.itemPoints.length; n++) {
      this.dropItem(f, f.level.itemPoints[n], rollLoot(f.depth, f.rng));
    }""",
   """    f.feeling = this.rollFeeling(f);

    const budget = Math.round(mobBudget(f.depth) * (f.feeling === 'dangerous' ? 1.6 : 1));
    for (let n = 0; n < budget; n++) this.spawnRandomMob(f);

    let drops = 5 + f.rng.int(4);
    if (f.feeling === 'treasure') drops += 3;
    for (let n = 0; n < drops && n < f.level.itemPoints.length; n++) {
      this.dropItem(f, f.level.itemPoints[n], rollLoot(f.depth, f.rng));
    }
    if (f.feeling === 'treasure' && f.level.itemPoints.length > drops) {
      this.dropItem(f, f.level.itemPoints[drops], rollPrize(f.depth, f.rng));
    }
    if (f.feeling === 'trapped') this.sowTraps(f);
    this.sowMimics(f);"""),
)

edit('shared/game.js',
  ("""  /** Fill the special rooms with whatever it is they promise. */""",
   """  /**
   * Every floor has a character, and the party is told which as they arrive.
   * Each one changes something real, not just the wording of the banner.
   */
  rollFeeling(f) {
    if (f.depth <= 1) return 'none';
    const r = f.rng.next();
    if (r < 0.10) return 'dangerous';
    if (r < 0.20) return 'treasure';
    if (r < 0.28) return 'trapped';
    if (r < 0.36) return 'dark';
    return 'none';
  }

  /** Say it out loud when somebody first sets foot on the floor. */
  announceFeeling(f) {
    switch (f.feeling) {
      case 'dangerous': this.banner('SOMETHING IS BADLY WRONG DOWN HERE', 2600); break;
      case 'treasure': this.banner('SOMETHING VALUABLE IS CLOSE BY', 2600); break;
      case 'trapped': this.banner('THE FLOOR HERE HAS BEEN PREPARED', 2600); break;
      case 'dark': this.banner('IT IS VERY DARK ON THIS FLOOR', 2600); break;
      default: break;
    }
  }

  /** A trapped floor gets a second helping. */
  sowTraps(f) {
    f.level.traps ??= {};
    const pts = f.level.itemPoints;
    for (let n = 0; n < 14; n++) {
      const i = pts[f.rng.int(pts.length)];
      if (i === undefined || f.tiles[i] !== TT.FLOOR) continue;
      f.set(i, TT.TRAP_HIDDEN);
      f.level.traps[i] = rollTrap(f.depth, f.rng);
    }
  }

  /**
   * Some of what is lying about is not lying about. A mimic waits as a piece
   * of loot until somebody reaches for it.
   */
  sowMimics(f) {
    if (f.depth < 3) return;
    const loot = f.ents.filter(e => e.kind === KIND.ITEM && !e.price &&
      e.item.type !== ITEM.KEY && e.item.type !== ITEM.GOLDKEY);
    const want = f.rng.chance(0.55) ? 1 : 0;
    for (let n = 0; n < want && loot.length; n++) {
      const e = loot.splice(f.rng.int(loot.length), 1)[0];
      e.mimic = true;
    }
  }

  /** It stops pretending. */
  springMimic(p, f, e) {
    e.dead = true;
    const st = MOBS[KIND.MIMIC];
    const m = this.spawnMob(f, KIND.MIMIC, e.x - 4, e.y - 6);
    if (m) {
      m.alerted = 900;
      m.hoard = e.item;                 // it swallowed the thing you wanted
    }
    this.fx(f, 'poof', e.x + 8, e.y + 8);
    this.banner('IT WAS NEVER LOOT', 1800);
  }

  /** Fill the special rooms with whatever it is they promise. */"""))

# a mimic reveals itself when you reach for it, not when you brush past
edit('shared/game.js',
  ("""      if (e.price) continue;   // pay for it first
      if (this.take(p, f, e.item)) e.dead = true;""",
   """      if (e.price) continue;   // pay for it first
      if (e.mimic) { this.springMimic(p, f, e); continue; }
      if (this.take(p, f, e.item)) e.dead = true;"""))

# and it drops what it swallowed
edit('shared/game.js',
  ("""    if (e.loot) this.dropItem(f, at, { type: ITEM.GOLD, amount: e.loot });""",
   """    if (e.hoard) this.dropItem(f, at, e.hoard);
    if (e.loot) this.dropItem(f, at, { type: ITEM.GOLD, amount: e.loot });"""))

print('done')
