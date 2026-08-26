# Status — Pixel Dungeon (real-time co-op)

**As of 2026-08-26: playable start to finish.**

Rebuilt from the earlier room-based Zelda-style game into a real-time
*Pixel Dungeon*: procedurally generated floors, a scrolling camera over the
whole level, fog of war, and twenty-five floors in five themed chapters.

## What works (verified)

- **Procedural floors.** 32x32, rooms carved by binary splitting, connected by
  doors on shared walls, leftover rooms painted as corridors. Special rooms in
  dead ends; a locked vault whose iron key is elsewhere on the floor.
  `scripts/levelgen-test.js` generates 1000 floors and proves the stairs down
  are always reachable and nothing is stranded.
- **Five chapters, five floors each, a boss on every fifth** — sewers, prison,
  caves, metropolis, demon halls. The way down is sealed until the boss falls.
- **Fog of war.** Recursive shadowcasting at radius 8, plus the whole-room
  reveal. Remembered ground is drawn dim; unseen ground is black. Monsters are
  filtered out of the snapshot server-side, so the fog is real, not painted on.
- **Four classes** with different hit points, speed, sight and abilities.
- **Real-time co-op** at 30 Hz, server-authoritative, with prediction, input
  queueing and entity interpolation. Per-player floors and cameras; the party
  shares its explored map, its gold and what it has identified.
- **Roguelike systems**: XP and levels, hunger, unidentified potions and
  scrolls whose appearances shuffle per run, upgradeable weapons and armour,
  iron keys, traps, wells, pedestals, chasms, water that slows you, high grass
  that blocks sight until you cut it.
- **All art hand-authored** — 148 sprites plus an 8x8 font, one tileset baked
  in five palettes, five 32x32 bosses generated from shape primitives.
- **Original chip audio** — a loop per chapter plus a boss theme.

## Notes for future work

- Difficulty is not yet playtested with real people. Contact damage, mercy
  frames and mob density were tuned against an automated player, which fights
  worse than a human and explores better.
- Ranged classes have not been played through a full run; the warrior has.
- No persistence: closing the tab ends the run.
- Special rooms are decorated but their contents are still mostly generic loot;
  libraries could guarantee scrolls, gardens could hide a seed cache.
- The old Zelda-style hand-built dungeon is gone (`shared/dungeon.js` and the
  room-transition code were deleted, not kept in parallel).

## Bugs found and fixed along the way

- **Doorways reported the wrong blocker.** Meeting a one-tile doorway at an
  angle made the collider report the wall beside the door, so the "walk into a
  door to open it" rule never fired and the hero was stuck against the frame
  forever. The collider now reports a door in preference to a wall. This one
  only showed up when an automated player tried to cross a whole floor.
- Room graph could strand a room whose only shared walls were too short for a
  door; connection now repeats until every room attaches to the connected set,
  and every placement (stairs, keys, traps, spawns) is validated against a real
  flood fill rather than trusting the graph.
- Boss floors reported their sealed exit as unreachable to the test harness;
  a locked stair is now "found but not passed" rather than skipped.
- Encounters were far too rare in real time — monsters only noticed you on
  line of sight. They now hear you within six tiles, and floors carry more
  monsters and more loot.
