# Bringing the rest of Pixel Dungeon across

Taken from the actual Shattered Pixel Dungeon source tree (buffs, items, rooms,
mobs, traps, plants, enchantments, glyphs, NPCs), not from summaries. Everything
below is a system the original has that this game does not yet.

The ordering is not arbitrary: almost every item and trap in Pixel Dungeon is
really "apply a timed effect to an actor", so the buff framework comes first and
everything else plugs into it.

Where a mechanic assumes turns, it is restated for real time — noted inline.

---

## Wave 1 — the buff framework (foundation) — **done**

SPD has ~70 buffs. They are the substrate: enchantments, glyphs, traps, potions,
wands and mob abilities all just apply one.

- A generic timed-effect system on every actor (heroes and mobs alike), read in
  one place per tick.
- Roughly 25 effects worth having: burning, chill, frost, poison, bleeding,
  corrosion, ooze, paralysis, roots, cripple, slow, haste, blindness, terror,
  amok, charm, sleep, weakness, hex, bless, fury, barkskin, barrier, healing,
  regeneration, recharging, invisibility, levitation, mind vision, magical
  sight, light, doom.
- Hooks: damage over time, damage dealt, damage taken, move speed, sight
  radius, and AI override (flee / attack anything / stand still).
- The hero's own movement multiplier rides in the snapshot so client prediction
  stays exact.
- Buff icons along the status bar.

## Wave 2 — the item classes that are missing — **done**

**Rings** — *shipped: 12.* Two slots. Each nudges the same stat block the perk
trees write into, so rings and perks simply add up. Which stone means which
ring is shuffled per run; you learn by wearing one long enough, which is also
long enough for a cursed one to have been a bad idea.

**Wands** — *shipped: 12.* Charges that refill while you carry them, faster
with a ring of energy, all at once from a scroll of recharging. Pointed with
your facing rather than a cursor. Living earth was dropped; warding leaves a
shard behind that shoots for you, which covers the same ground better.

**Artifacts** — *shipped: 12.* One slot, fired with its own key, and no scroll
will improve them: each grows on what you feed it — charges spent, grass walked
through, secrets found, blood given, gold counted. Only one of each per run.
The alchemist's toolkit waits on Wave 5's alchemy.

**Missile weapons** — *shipped: 10.* Thrown where you face. A missile is a real
object: it flies, it lands, and you walk over and pick it up again, or find it
snapped in half. A boomerang lands back in your hand instead.

**Enchantments and glyphs** — *shipped: 13 and 13.* Each is a hook called at
one moment — a blow landing, a blow taken, or the thing simply being worn —
and most do their work by applying a buff.

**Curses** — *shipped: 12.* Six for weapons, six for armour, and cursed rings
run their own effect backwards. None of it comes off until a scroll of remove
curse lifts it, or an upgrade happens to loosen it.

**The rest of the potion and scroll lists** — *shipped in Wave 1.* Both are at
the full twelve.

## Wave 3 — the floors themselves — **done**

**Special rooms** — *shipped: 14.* Treasure, library, garden, magic well,
statuary, vault, shop, armory, crypt, pool, trap room, storage, laboratory,
weak floor. Each is furnished when the floor wakes: grave goods and the
skeletons that came with them, a prize ringed by live traps, a floor that gives
way. Not doing: sentry, runestone, sacrifice, crystal path, demon spawner.

**Shops and a shopkeeper** — *shipped.* One shop on the floor that opens each
chapter after the sewers (6, 11, 16, 21). Stock laid out with price tags, E to
buy what is under your feet, drop something inside to sell it, and a shopkeeper
who vanishes with the entire stock if you raise a hand to him.

**Traps** — *shipped: 24,* gated by depth so the nastier ones stay deep, each
floor recording which trap sits where so a revealed one shows what it will do.
The ones that differ only in flavour were folded together.

**Mimics** — *shipped.* No chests in this game, so a mimic waits as a piece of
loot instead, and gives back what it was pretending to be when it dies.

**Chasms you can jump down** — *shipped.* Stand at the lip and press E. Weak
floors give way on their own and leave a hole behind them.

**Secret doors and searching** — *shipped.* Only ever on a dead-end special
room, so nothing you need can be sealed away. Stand still to search; a rogue
finds them while walking.

**Level feelings** — *shipped: four.* Dangerous (half again as many monsters),
treasure (extra drops and a prize), trapped (a second helping of traps), and
dark (sight radius cut by three, which now bites indoors too — a lit room no
longer reveals further than you can see).

## Wave 4 — actors — **next**

**A mob roster that matches the source** per chapter, including the variants:
albino rat, caustic slime, hermit crab, great crab, armoured brute, gnoll
trickster/geomancer/guard/sapper, spectral necromancer, ghoul, DM-100/200/201,
acidic scorpio, ripper demon, phantom piranha, rot heart and lasher, bees.

**Champion enemies** — the occasional monster wearing a modifier: blazing,
projecting, armoured, blessed, growing, halo.

**Boss mechanics with phases**, not just a bigger health bar. Goo's pump-up,
Tengu's phase jumps and trap grids, DM-300's pylons and collapsing floor, the
Dwarf King's summoned court, Yog-Dzewa's fists.

**NPCs and their quests.** The sad ghost (fetid rat / gnoll trickster / great
crab), the old wandmaker (corpse dust / rotberry / elemental embers), the
blacksmith (dark gold ore, reforging), the ambitious imp, the rat king,
wandering sheep.

## Wave 5 — the long tail

**Alchemy.** A pot in the laboratory: seeds into potions, potions into exotic
potions, scrolls into exotic scrolls, plus bombs and elixirs.

**Seeds and plants** (13). Firebloom, icecap, sorrowmoss, blindweed, sungrass,
fadeleaf, earthroot, rotberry, starflower, swiftthistle, stormvine, mageroyal,
blandfruit — each triggered by stepping on it or thrown as a seed.

**Dew drops and the dew vial.**

**Badges**, **challenges** (run modifiers), and the **ascension** — carrying the
amulet back up through twenty-five floors of everything that is now awake.

---

## What real time changes

- **Turn-scaled durations become ticks.** Everything in SPD is measured in
  turns; here a turn is roughly a third of a second of walking.
- **Aimed items are aimed with your facing**, not a cursor on a grid. Wands,
  thrown weapons and rays fire the way you are looking.
- **Nothing may pause.** Three other people are playing, so shops, alchemy and
  the item panels all run with the floor still moving.
- **Anything that reads "the hero" becomes "a hero"** — buffs, shops, quests
  and boss aggro all have to cope with up to four of them.

## Deliberately not doing

- **Hero unlocking and rankings.** Everyone picks any class in co-op, and a
  shared run has no single scoreboard.
- **The full 33 traps and 24 special rooms** as separate classes. The ones that
  differ only in flavour collapse into a handful that take a parameter.
- **Turn-based tactical depth that depends on turns** — SPD's careful
  step-by-step positioning does not survive the port, and pretending otherwise
  would make a worse game rather than a more faithful one.
