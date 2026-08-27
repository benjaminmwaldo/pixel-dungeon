# Bringing the rest of Pixel Dungeon across

Taken from the actual Shattered Pixel Dungeon source tree (buffs, items, rooms,
mobs, traps, plants, enchantments, glyphs, NPCs), not from summaries. Everything
below is a system the original has that this game does not yet.

The ordering is not arbitrary: almost every item and trap in Pixel Dungeon is
really "apply a timed effect to an actor", so the buff framework comes first and
everything else plugs into it.

Where a mechanic assumes turns, it is restated for real time — noted inline.

---

## Wave 1 — the buff framework (foundation)

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

## Wave 2 — the item classes that are missing

**Rings** (12 in SPD). Two ring slots, unidentified until worn a while,
upgradeable, sometimes cursed. Accuracy, evasion, elements, energy, force,
furor, haste, might, sharpshooting, tenacity, wealth, arcana.

**Wands** (14). Charges that refill over time, aimed in a direction. Magic
missile, fireblast, frost, lightning, disintegration, corrosion, blast wave,
living earth, transfusion, regrowth, corruption, warding, prismatic light.

**Artifacts** (15). One slot, level up through use rather than scrolls. Cloak of
shadows, horn of plenty, chalice of blood, talisman of foresight, timekeeper's
hourglass, cape of thorns, dried rose, ethereal chains, alchemist's toolkit,
lloyd's beacon, master thief's armband, sandals of nature, unstable spellbook.

**Missile weapons** (16). Thrown, with durability. Stones, knives, spears,
spikes, shuriken, javelins, bolas, tomahawks, tridents, force cubes,
boomerangs.

**Enchantments** (13) **and glyphs** (13). Blazing, chilling, shocking,
vampiric, grim, lucky, projecting, elastic, kinetic, blooming, corrupting,
blocking, unstable — and antimagic, thorns, stone, entanglement, repulsion,
camouflage, flow, obfuscation, potential, swiftness, viscosity, affection,
brimstone.

**Curses.** Cursed gear that cannot be removed and misbehaves, plus the scroll
that lifts them.

**The rest of the potion and scroll lists.** Missing: experience, levitation,
liquid flame, mind vision, purity — and identify variants, lullaby, mirror
image, retribution, transmutation, remove curse.

## Wave 3 — the floors themselves

**Special rooms** (24 kinds; this game has 6). Shop, laboratory, treasury,
armory, library, garden, magic well, pool, statuary, crypt, pit, weak floor,
traps, storage, sentry, magical fire, toxic gas, runestone, sacrifice, crystal
vault/choice/path, demon spawner.

**Shops and a shopkeeper.** Gold currently has nothing to buy. A shop floor per
chapter, an NPC who sells and buys, and prices that scale with depth.

**Traps** (33 kinds; this game has one). Worn dart, poison dart, alarm, gripping,
summoning, teleportation, ooze, burning, blazing, chilling, frost, shocking,
storm, toxic, corrosion, flock, guardian, pitfall, rockfall, disarming,
weakening, confusion, flashing, warping, distortion, grim, cursing,
disintegration, explosive, geyser, gateway.

**Mimics.** Chests that are not chests. Regular, golden, ebony, crystal.

**Chasms you can jump down**, falling to the next floor and taking the drop.

**Secret doors and searching.** Rooms you only find by looking.

**Level feelings** — the floor announcing itself as unusually large, dark,
overgrown, watery, trapped, or hiding something.

## Wave 4 — actors

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
