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
  ("import { CHAMPIONS, CHAMP, champChance, rollChampion, champIndex } from './champions.js';",
   "import { CHAMPIONS, CHAMP, champChance, rollChampion, champIndex } from './champions.js';\nimport { QUEST, QUESTS, QUEST_IDS, QSTATE, questForDepth } from './quests.js';"),

  # the run remembers which favours have been asked and finished
  ("    this.artifactsSeen = [];",
   "    this.artifactsSeen = [];\n    this.quests = {};            // id -> QSTATE"),

  # somebody may be waiting on this floor
  ("    this.stockShop(f);\n    this.furnish(f);",
   "    this.stockShop(f);\n    this.furnish(f);\n    this.placeQuest(f);"),
)

edit('shared/game.js',
  ("""  /** Fill the special rooms with whatever it is they promise. */""",
   """  /** If somebody is due on this floor, stand them somewhere sensible. */
  placeQuest(f) {
    const id = questForDepth(f.depth, f.rng);
    if (!id) return;
    if (this.quests[id] !== undefined) return;      // already asked, elsewhere
    const q = QUESTS[id];
    const kind = KIND[q.npc.replace('NPC_', '').replace('GHOST', 'GHOST')] ??
                 { ghost: KIND.GHOST, wandmaker: KIND.WANDMAKER,
                   blacksmith: KIND.BLACKSMITH, imp: KIND.IMP }[id];
    const pts = f.level.itemPoints || [];
    let spot = null;
    for (const i of pts) {
      if (passable(f.tiles[i])) { spot = i; break; }
    }
    if (spot === null) return;

    this.quests[id] = QSTATE.OFFER;
    f.questId = id;
    const at = tileToPixel(spot, MOBS[kind].box);
    const npc = this.spawnMob(f, kind, at.x, at.y, { champion: null });
    if (npc) npc.quest = id;

    // and set out whatever the favour actually involves
    if (q.kind === 'slay') this.markQuarry(f, id, q);
    else this.hideQuestItem(f, id, q);
  }

  /** Mark one creature on the floor as the one they want dealt with. */
  markQuarry(f, id, q) {
    if (q.need) { f.questCount = 0; return; }        // a tally, not a target
    const mobs = f.ents.filter(e => isMob(e.kind) && !isNpc(e.kind) && !isBoss(e.kind) && !e.dead);
    const pick = mobs.length ? mobs[f.rng.int(mobs.length)] : this.spawnRandomMob(f);
    if (!pick) return;
    pick.quarry = id;
    this.promote(pick, CHAMP.GROWING);
    pick.maxHp = Math.round(pick.maxHp * 1.5);
    pick.hp = pick.maxHp;
    f.quarryId = pick.id;
  }

  /** Put the thing they asked for somewhere on the floor. */
  hideQuestItem(f, id, q) {
    const pts = f.level.itemPoints || [];
    const spot = pts[Math.max(0, pts.length - 1)];
    if (spot === undefined) return;
    this.dropItem(f, spot, { type: ITEM.QUEST, kind: id, name: q.item });
  }

  /** Walking up to somebody and pressing the same key you press for everything. */
  talkTo(p, f, npc) {
    const id = npc.quest;
    const q = QUESTS[id];
    if (!q) { this.banner('THEY HAVE NOTHING TO SAY', 1200); return true; }
    const state = this.quests[id] ?? QSTATE.OFFER;

    if (state === QSTATE.DONE) { this.banner('THAT IS ALL OF IT. GO ON', 1400); return true; }

    if (state === QSTATE.OFFER) {
      this.quests[id] = QSTATE.TAKEN;
      this.banner(`${q.name}: ${q.ask}`, 3200);
      this.metaDirty = true;
      return true;
    }

    // taken: is it done?
    if (q.kind === 'slay') {
      const need = q.need || 1;
      const got = q.need ? (f.questCount || 0)
                         : (f.quarrySlain ? 1 : 0);
      if (got < need) {
        this.banner(`${q.name}: ${q.nag}${q.need ? ` (${got}/${need})` : ''}`, 2400);
        return true;
      }
    } else {
      const slot = p.bag.findIndex(s => s?.item?.type === ITEM.QUEST && s.item.kind === id);
      if (slot < 0) { this.banner(`${q.name}: ${q.nag}`, 2400); return true; }
      p.bag[slot] = null;
    }

    this.quests[id] = QSTATE.DONE;
    this.banner(`${q.name}: ${q.done}`, 3000);
    this.payQuest(p, f, q);
    this.metaDirty = true;
    return true;
  }

  /** What they give you for it. */
  payQuest(p, f, q) {
    const give = (item) => { if (!this.take(p, f, item)) this.dropItem(f, tileUnder(p, PLAYER_BOX), item); };
    switch (q.reward) {
      case 'gear':
        give(rollPrize(f.depth, f.rng, this.artifactsSeen));
        break;
      case 'wand':
        give(rollWand(f.depth, f.rng));
        break;
      case 'ring':
        give({ ...rollRing(f.depth, f.rng), cursed: false, known: true });
        p.gold += 100 + f.depth * 10;
        break;
      case 'reforge': {
        // he puts two upgrades into whichever of your two is behind
        const w = p.equip.weapon, a = p.equip.armor;
        const into = (w.tier * 3 + w.upgrade <= a.tier * 3 + a.upgrade) ? w : a;
        into.upgrade += 2;
        if (into.cursed) { into.cursed = false; into.curse = null; }
        this.recalc(p);
        this.fx(f, 'equip', p.x + 8, p.y + 8);
        break;
      }
      default:
        break;
    }
    this.fx(f, 'gold', p.x + 8, p.y + 8);
  }

  /** Fill the special rooms with whatever it is they promise. */"""),
)

# talking is part of interacting
edit('shared/game.js',
  ("""    // a price tag under your feet""",
   """    // somebody standing close enough to talk to
    const who = f.ents.find(e => !e.dead && isNpc(e.kind) && e.quest &&
      rectsOverlap(p.x - 6, p.y - 6, 28, 28, e.x + e.box.x, e.y + e.box.y, e.box.w, e.box.h));
    if (who) return void this.talkTo(p, f, who);

    // a price tag under your feet"""),
)

# and the tally is kept where things die
edit('shared/game.js',
  ("""    if (e.hoard) this.dropItem(f, at, e.hoard);""",
   """    if (e.quarry) f.quarrySlain = true;
    if (!isNpc(e.kind) && !isBoss(e.kind) && f.questId && QUESTS[f.questId]?.need) {
      // the imp is counting, and only the big ones count
      if (MOBS[e.kind].hp >= 18) f.questCount = (f.questCount || 0) + 1;
    }
    if (e.hoard) this.dropItem(f, at, e.hoard);"""),
)

print('done')
