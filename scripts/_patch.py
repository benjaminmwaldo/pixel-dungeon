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
  ("import { QUEST, QUESTS, QUEST_IDS, QSTATE, questForDepth } from './quests.js';",
   "import { QUEST, QUESTS, QUEST_IDS, QSTATE, questForDepth } from './quests.js';\nimport {\n  BADGE, BADGES, BADGE_IDS, CHAL, CHALLENGES, badgeIndex, isHard,\n} from './badges.js';"),

  ("    this.ascending = false;       // carrying it back out",
   "    this.badges = [];             // what this run will be remembered for\n    this.challenges = [];         // what it took away to begin with\n    this.brewed = 0;\n    this.sown = 0;\n    this.champsFelled = 0;\n    this.ascending = false;       // carrying it back out"),
)

edit('shared/game.js',
  ("""  /** Is anybody in the party actually holding the thing? */""",
   """  /** Note something worth remembering. Says so once, and only once. */
  earn(id) {
    if (!BADGES[id] || this.badges.includes(id)) return;
    this.badges.push(id);
    this.banner(`BADGE - ${BADGES[id].name}`, 2200);
    if (isHard(this.challenges)) this.earn(BADGE.DEFIANT);
    this.metaDirty = true;
  }

  /** Is this challenge on for this run? */
  hard(id) { return this.challenges.includes(id); }

  /** Everything worth noticing about the state of a hero, checked now and then. */
  checkBadges(p) {
    if (p.gold >= 1000) this.earn(BADGE.RICH);
    if (p.bag.length && p.bag.every(Boolean)) this.earn(BADGE.HOARDER);
    if ((p.equip.weapon.upgrade || 0) >= 5 || (p.equip.armor.upgrade || 0) >= 5) {
      this.earn(BADGE.ARMED);
    }
    if (this.known.potions.length + this.known.scrolls.length >= 10) {
      this.earn(BADGE.SCHOLAR);
    }
    if (this.brewed >= 5) this.earn(BADGE.ALCHEMIST);
    if (this.sown >= 10) this.earn(BADGE.GARDENER);
    if (this.champsFelled >= 10) this.earn(BADGE.CHAMPION);
    const done = QUEST_IDS.filter(id => this.quests[id] === QSTATE.DONE).length;
    if (done >= 1) this.earn(BADGE.FAVOUR);
    if (done === QUEST_IDS.length) this.earn(BADGE.ALL_FAVOURS);
  }

  /** Is anybody in the party actually holding the thing? */"""),
)

# --- the moments worth a badge ---------------------------------------------
edit('shared/game.js',
  ("""  killMob(e, f, byPlayer) {
    e.dead = true;
    this.kills++;
    const st = MOBS[e.kind];""",
   """  killMob(e, f, byPlayer) {
    e.dead = true;
    this.kills++;
    const st = MOBS[e.kind];
    if (byPlayer && !isNpc(e.kind)) this.earn(BADGE.FIRST_BLOOD);
    if (e.champ) {
      this.champsFelled++;
      if (this.champsFelled >= 10) this.earn(BADGE.CHAMPION);
    }"""),

  ("""    if (isBoss(e.kind)) {
      f.bossDead = true;""",
   """    if (isBoss(e.kind)) {
      f.bossDead = true;
      this.earn({
        [KIND.BOSS_GLUT]: BADGE.SEWERS, [KIND.BOSS_WARDEN]: BADGE.PRISON,
        [KIND.BOSS_TYRANT]: BADGE.CAVES, [KIND.BOSS_KING]: BADGE.CITY,
        [KIND.BOSS_UNSLEEPING]: BADGE.HALLS,
      }[e.kind]);"""),

  ("""    this.addToBag(p, { type: ITEM.RELIC });
      this.beginAscent();""",
   """    this.addToBag(p, { type: ITEM.RELIC });
      this.earn(BADGE.AMULET);
      this.beginAscent();"""),

  ("""      if (this.ascending && this.hasAmulet()) {
        this.state = 'win';""",
   """      if (this.ascending && this.hasAmulet()) {
        this.earn(BADGE.ASCENDED);
        this.state = 'win';"""),

  ("    this.deepest = Math.max(this.deepest, p.depth);",
   "    this.deepest = Math.max(this.deepest, p.depth);\n    this.earn(BADGE.FIRST_FLOOR);"),
)

print('done')
