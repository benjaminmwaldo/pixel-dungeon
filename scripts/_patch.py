import io

def edit(path, *pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n%s' % (path, old[:220]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched', path)

edit('shared/mobs.js',
  # ---- the sewers get somebody who fights back --------------------------
  ("  [KIND.FLY]:      { name: 'SWARM OF FLIES', sprite: 'FLY', hp: 6, dmg: 2, speed: 2.6, xp: 3, ai: 'flyer', box: BOX },",
   "  [KIND.FLY]:      { name: 'SWARM OF FLIES', sprite: 'FLY', hp: 6, dmg: 2, speed: 2.6, xp: 3, ai: 'flyer', box: BOX },\n  [KIND.GNOLL]:    { name: 'GNOLL SCOUT', sprite: 'GNOLL', hp: 14, dmg: 3, speed: 1.9, xp: 6, ai: 'chase', box: BIG },"),

  # ---- the prison ---------------------------------------------------------
  ("  // ---- the caves",
   """  [KIND.TRICKSTER]: {
    name: 'GNOLL TRICKSTER', sprite: 'TRICKSTER', hp: 22, dmg: 5, speed: 2.0, xp: 11,
    ai: 'shooter', box: BIG, shot: KIND.DART, keeps: 70,
  },
  [KIND.LASHER]: {
    name: 'ROT LASHER', sprite: 'LASHER', hp: 45, dmg: 9, speed: 0, xp: 14,
    ai: 'idle', box: BIG, armour: 3, reach: 30, rooted: true,
  },

  // ---- the caves"""),
)

print('done')
