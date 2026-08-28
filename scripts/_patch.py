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
  ("import {\n  ARTIFACTS, ART, ART_IDS, artMax, makeArtifact, rollArtifact,\n  feed, tickArtifact, MAX_ART_LEVEL,\n} from './artifacts.js';",
   "import {\n  ARTIFACTS, ART, ART_IDS, artMax, makeArtifact, rollArtifact,\n  feed, tickArtifact, MAX_ART_LEVEL,\n} from './artifacts.js';\nimport { CHAMPIONS, CHAMP, champChance, rollChampion, champIndex } from './champions.js';"),

  # promotion happens at spawn
  ("""  spawnMob(f, kind, x, y) {
    const st = MOBS[kind];
    const scale = scaleFor(f.depth, regionOf(f.depth));
    const e = {""",
   """  spawnMob(f, kind, x, y, { champion = null } = {}) {
    const st = MOBS[kind];
    const scale = scaleFor(f.depth, regionOf(f.depth));
    const e = {"""),
)

edit('shared/game.js',
  ("""    f.ents.push(e);
    return e;
  }

  stepFloor(f) {""",
   """    // now and then the dungeon promotes one
    if (!isBoss(kind) && !isNpc(kind) && !st.harmless) {
      const id = champion ?? (f.rng.next() < champChance(f.depth) ? rollChampion(f.depth, f.rng) : null);
      if (id) this.promote(e, id);
    }
    f.ents.push(e);
    return e;
  }

  /** Bolt a modifier onto an ordinary monster. */
  promote(e, id) {
    const c = CHAMPIONS[id];
    if (!c) return e;
    e.champ = id;
    e.maxHp = Math.round(e.maxHp * c.hp);
    e.hp = e.maxHp;
    e.dmg = Math.round(e.dmg * c.dmg);
    e.champSpeed = c.speed;
    e.grown = 0;
    return e;
  }

  stepFloor(f) {"""),

  # what a champion does that its kind does not
  ("""    const mode = (st.ai === 'flyer' || st.phasing) ? MODE.FLY : MODE.WALK;
    const speed = st.speed * (e.enraged ? 1.4 : 1) * (e.effects?.move ?? 1);""",
   """    const mode = (st.ai === 'flyer' || st.phasing) ? MODE.FLY : MODE.WALK;
    const champ = e.champ ? CHAMPIONS[e.champ] : null;
    let speed = st.speed * (e.enraged ? 1.4 : 1) * (e.effects?.move ?? 1)
              * (champ?.speed ?? 1);

    if (champ) {
      // a growing one is worse every second you leave it standing
      if (champ.grows && e.alerted > 0 && e.grown < 1.5) {
        e.grown = (e.grown || 0) + champ.grows;
        e.dmg = Math.max(1, Math.round(e.dmg * (1 + champ.grows)));
      }
      // a haloed one knits its neighbours back together
      if (champ.mends && (this.tick % champ.mends) === 0) {
        for (const o of f.ents) {
          if (o === e || o.dead || !isMob(o.kind)) continue;
          if (dist2(o.x, o.y, e.x, e.y) > 44 * 44) continue;
          o.hp = Math.min(o.maxHp, o.hp + 1 + Math.floor(f.depth / 5));
        }
      }
    }"""),
)

edit('shared/game.js',
  # contact with a champion is its own event
  ("""        e.hitCd = 32;
        this.hurtPlayer(p, Math.round(e.dmg * (e.effects?.dealt ?? 1)), e.x + 8, e.y + 8, e);""",
   """        e.hitCd = 32;
        this.hurtPlayer(p, Math.round(e.dmg * (e.effects?.dealt ?? 1)), e.x + 8, e.y + 8, e);
        const champ = e.champ ? CHAMPIONS[e.champ] : null;
        if (champ?.burns) this.afflict(p, B.BURNING, champ.burns, 1, f);
        if (champ?.blinds) this.afflict(p, B.BLINDNESS, champ.blinds, 1, f);
        if (champ?.knock) {
          const dx = p.x - e.x, dy = p.y - e.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          p.knockX = (dx / d) * champ.knock;
          p.knockY = (dy / d) * champ.knock;
          p.knockT = KNOCKBACK_TICKS;
        }"""),

  # a champion's reach is not its sprite's reach
  ("""      const st = MOBS[e.kind];
      if (st.harmless) continue;
      for (const p of players) {
        if (p.invis > 0 && !isBoss(e.kind)) continue;
        if (e.hitCd > 0) break;
        if (!rectsOverlap(p.x + PLAYER_BOX.x, p.y + PLAYER_BOX.y, PLAYER_BOX.w, PLAYER_BOX.h,
                          e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h)) continue;""",
   """      const st = MOBS[e.kind];
      if (st.harmless) continue;
      const reach = CHAMPIONS[e.champ]?.reach ?? 1;
      const grow = (reach - 1) * 8;
      for (const p of players) {
        if (p.invis > 0 && !isBoss(e.kind)) continue;
        if (e.hitCd > 0) break;
        if (!rectsOverlap(p.x + PLAYER_BOX.x, p.y + PLAYER_BOX.y, PLAYER_BOX.w, PLAYER_BOX.h,
                          e.x + e.box.x - grow, e.y + e.box.y - grow,
                          e.box.w + grow * 2, e.box.h + grow * 2)) continue;"""),

  # armour and evasion, on the way in
  ("""  hurtMob(e, dmg, fromDir, f, byPlayer, overTime = false) {
    if (e.flash > 3 && !overTime) return;
    const st = MOBS[e.kind];""",
   """  hurtMob(e, dmg, fromDir, f, byPlayer, overTime = false) {
    if (e.flash > 3 && !overTime) return;
    const st = MOBS[e.kind];
    const champ = e.champ ? CHAMPIONS[e.champ] : null;
    if (champ?.evade && !overTime && Math.random() < champ.evade) {
      this.fx(f, 'clang', e.x + 8, e.y + 8);
      e.flash = 4;
      return;
    }"""),

  ("    const taken = Math.max(1, Math.round(scaled - (overTime ? 0 : (st.armour || 0))));",
   "    const armour = (st.armour || 0) + (overTime ? 0 : (champ?.armour || 0));\n    const taken = Math.max(1, Math.round(scaled - (overTime ? 0 : armour)));"),
)

print('done')
