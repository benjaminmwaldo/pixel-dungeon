import io

# ---------------------------------------------------------------------------
# a harmless sheep, so the flock trap has something to summon
# ---------------------------------------------------------------------------
p = 'shared/constants.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace("  DEMON: 18, EYE: 19, SCORPIO: 20,",
              "  DEMON: 18, EYE: 19, SCORPIO: 20,\n  SHEEP: 21,")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

p = 'shared/mobs.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace(
    "  // ---- the five chapter bosses -----------------------------------------",
    "  // ---- harmless -----------------------------------------------------------\n"
    "  [KIND.SHEEP]:    { name: 'SHEEP', sprite: 'SHEEP', hp: 4, dmg: 0, speed: 1.1, xp: 0, ai: 'wander', box: BOX, harmless: true },\n\n"
    "  // ---- the five chapter bosses -----------------------------------------")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('sheep added')

# ---------------------------------------------------------------------------
# sheep bother nobody and nobody bothers about them
# ---------------------------------------------------------------------------
p = 'shared/game.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace(
    "      if (e.dead || !isMob(e.kind) || e.frozen > 0 || e.hidden) continue;\n      if (e.effects?.frozen || e.effects?.ai === 'flee') continue;\n      const st = MOBS[e.kind];",
    "      if (e.dead || !isMob(e.kind) || e.frozen > 0 || e.hidden) continue;\n      if (e.effects?.frozen || e.effects?.ai === 'flee') continue;\n      const st = MOBS[e.kind];\n      if (st.harmless) continue;")

# the floor packet carries what each revealed trap actually is
s = s.replace(
    "      entrance: f.level.entrance,\n      exit: f.level.exit,",
    "      entrance: f.level.entrance,\n      exit: f.level.exit,\n      traps: Object.fromEntries(\n        Object.entries(f.level.traps || {}).map(([i, k]) => [i, trapIndex(k)])),")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('floor packet carries trap kinds')

# ---------------------------------------------------------------------------
# client: remember them and paint a revealed one in its own colour
# ---------------------------------------------------------------------------
p = 'client/net.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace(
    "    this.entrance = m.entrance;\n    this.exit = m.exit;",
    "    this.entrance = m.entrance;\n    this.exit = m.exit;\n    this.traps = m.traps || {};")
s = s.replace(
    "      tiles: this.tiles,\n      explored: this.explored,\n      fov: this.fov,",
    "      tiles: this.tiles,\n      explored: this.explored,\n      fov: this.fov,\n      traps: this.traps || {},")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)

p = 'client/render.js'
s = io.open(p, encoding='utf-8').read()
s = s.replace(
    "import { BUFFS } from '../shared/buffs.js';",
    "import { BUFFS } from '../shared/buffs.js';\nimport { TRAPS, trapById } from '../shared/traps.js';")
s = s.replace(
    """        const img = t === TT.WATER ? (visible ? water : waterDim)
                                   : (visible ? lit[t] : remembered[t]);
        if (img) g.drawImage(img, x * TILE, y * TILE);""",
    """        const img = t === TT.WATER ? (visible ? water : waterDim)
                                   : (visible ? lit[t] : remembered[t]);
        if (img) g.drawImage(img, x * TILE, y * TILE);
        // a revealed trap wears the colour of what it will do to you
        if (t === TT.TRAP && st.traps) {
          const def = TRAPS[trapById(st.traps[i])];
          if (def) {
            g.fillStyle = def.colour;
            g.globalAlpha = visible ? 1 : 0.4;
            g.fillRect(x * TILE + 6, y * TILE + 6, 4, 4);
            g.globalAlpha = 1;
          }
        }""")
io.open(p, 'w', encoding='utf-8', newline='\n').write(s)
print('client paints revealed traps')
