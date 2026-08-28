# Status — Pixel Dungeon (real-time co-op)

**As of 2026-08-26: playable start to finish, and live at
<https://benjaminmwaldo.github.io/pixel-dungeon/>.**

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
- **Three ways to play, one simulation.** `shared/session.js` owns the tick loop
  and message pump and is handed `send`/`broadcast`, so it does not know its
  transport. Solo runs it in your own tab with no network at all; a hosted
  party runs it in the host's tab with guests on WebRTC data channels; and
  `node server/index.js` runs the same class for LAN play (`?lan=1`).
- **Deployed to GitHub Pages** by Actions on every push to main, the same shape
  as the dawnfall-protocol repo. No bundler and no base-path variable — every
  path in the page is relative, so the files work at the root or under a
  repo subpath.
- **Perk trees.** One point per level, three shared trees plus one per class,
  36 perks with prerequisite chains and multiple ranks. Every perk folds into a
  single stat block the simulation reads — there are no decorative perks.
- **A real inventory.** A 16-24 slot pack whose first eight slots are the quick
  bar. Gear waits in the pack rather than auto-equipping; you can equip, move
  between slots, and drop items on the floor to hand them to a teammate.
  Neither panel pauses the world, which is the honest answer in co-op.

## Notes for future work

- The public build depends on PeerJS's free broker for introductions only, and
  that broker offers STUN but no TURN relay. Strict corporate, school or
  symmetric-NAT networks may refuse the connection; home wifi and hotspots are
  the target. If that ever bites, the fix is a TURN server, not a rewrite.
- Difficulty is not yet playtested with real people. Contact damage, mercy
  frames and mob density were tuned against an automated player, which fights
  worse than a human and explores better.
- Ranged classes have not been played through a full run; the warrior has.
- No persistence: closing the tab ends the run.
- Libraries and magic wells are still decorated rather than furnished. Every
  other special room now gets its own contents; those two should be brought up
  to match.
- The game is much bigger than it was: five hundred-odd distinct things across
  buffs, traps, gear marks, rings, wands, missiles, artifacts, plants, badges
  and creatures. None of it has been balanced against real players — only
  against an automated one, which fights worse than a human and explores
  better.
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
- **A wiped party was never told the run had restarted.** The server's timer
  called `restart()` but only the explicit "play again" path broadcast the
  start message, so every client sat on the death screen forever while a fresh
  dungeon ran underneath them.
- **The intermittent smoke-test failure is diagnosed and fixed.** It was four
  separate pieces of test fragility, all of one kind: the harness kept acting
  on a party that had wiped. A wipe ends the run, so the simulation refuses
  every subsequent action, and the restart timer rebuilds the dungeon, leaving
  the captured floor object orphaned — which showed up as a cascade of
  unrelated-looking failures. The other three: an "invulnerable" hero still
  dying to traps and poison, `findIndex` grabbing the first potion or weapon in
  the pack rather than the one the check had just added, and the harness
  teleporting the hero onto a weak floor mid-fight. Six hundred consecutive
  runs are clean, and every suite now survives a hundred-run stress loop.
- **Two silent-disappearance bugs on the wire.** A non-finite coordinate JSON-
  encodes as null, and the client then draws that entity nowhere at all with
  nothing said about it; and `Math.max(0, NaN)` is NaN, so the client's
  interpolation put every entity at nowhere whenever it was handed a bad
  timestamp. Both are guarded, and the smoke test checks four hundred
  consecutive frames of wire traffic for non-finite positions.
- **The shopkeeper and the mimic had no sprites**, so both had been drawing as
  nothing at all since the day they were added.
- **A quest hook sat below an early return** in the kill handler, so a monster
  that splits when it dies — which the sewers are full of — never registered as
  the one the ghost wanted.
- **Beams and cones sampled only at tile centres**, so anything standing
  between two samples was passed straight over. Both now sweep the line in
  small steps and test against the real hitbox.
- **A lit room revealed more than you could see.** The whole-room reveal ignored
  the sight radius, so blindness and a dark floor did nothing indoors — which
  is most of the game. The reveal is now clipped to the radius.
- Encounters were far too rare in real time — monsters only noticed you on
  line of sight. They now hear you within six tiles, and floors carry more
  monsters and more loot.
