// What is written on a weapon, what is written on armour, and what will not
// come off.
import { Game } from '../shared/game.js';
import {
  ENCH, ENCHANTS, ENCH_IDS, GLYPH, GLYPHS, GLYPH_IDS,
  CURSE, CURSES, CURSE_IDS, WEAPON_CURSES, ARMOR_CURSES,
  dressGear, markName, enchIndex, enchById, glyphIndex, glyphById,
  curseIndex, curseById,
} from '../shared/enchants.js';
import { ITEM, itemLabel, rollLoot, rollPrize, makeAppearances } from '../shared/items.js';
import { rngFor } from '../shared/terrain.js';
import { isMob, PLAYER_BOX } from '../shared/constants.js';
import * as BF from '../shared/buffs.js';
import { B } from '../shared/buffs.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- the tables -------------------------------------------------------------
check('thirteen enchantments, thirteen glyphs', ENCH_IDS.length === 13 && GLYPH_IDS.length === 13);
check('every entry is named and coloured',
  ENCH_IDS.every(i => ENCHANTS[i].name && ENCHANTS[i].colour) &&
  GLYPH_IDS.every(i => GLYPHS[i].name && GLYPHS[i].colour));
check('curses are split between the two slots',
  WEAPON_CURSES.length >= 5 && ARMOR_CURSES.length >= 5,
  `${WEAPON_CURSES.length} weapon, ${ARMOR_CURSES.length} armour`);
check('all three survive the round trip to the wire',
  ENCH_IDS.every(i => enchById(enchIndex(i)) === i) &&
  GLYPH_IDS.every(i => glyphById(glyphIndex(i)) === i) &&
  CURSE_IDS.every(i => curseById(curseIndex(i)) === i));
check('and nothing maps to the empty slot',
  enchById(0) === null && glyphById(0) === null && curseById(0) === null);

// --- what turns up in the world ---------------------------------------------
{
  const rng = rngFor(12345);
  let marked = 0, cursed = 0, plain = 0;
  for (let n = 0; n < 4000; n++) {
    const it = dressGear({ type: ITEM.WEAPON, tier: 3, upgrade: 0 }, 12, rng);
    if (it.curse) cursed++;
    else if (it.ench) marked++;
    else plain++;
  }
  check('some gear is marked', marked > 300, `${marked}/4000`);
  check('some gear is cursed', cursed > 300, `${cursed}/4000`);
  check('and most of it is plain', plain > marked + cursed, `${plain}/4000`);
}
{
  const rng = rngFor(999);
  let cursedPrizes = 0;
  for (let n = 0; n < 800; n++) {
    const it = rollPrize(15, rng);
    if (it.curse) cursedPrizes++;
  }
  check('a prize is never cursed', cursedPrizes === 0, `${cursedPrizes} of 800`);
}

// --- naming -----------------------------------------------------------------
{
  const app = makeAppearances(1);
  const known = { potions: [], scrolls: [] };
  const w = { type: ITEM.WEAPON, tier: 3, upgrade: 2, ench: ENCH.BLAZING, known: false };
  check('an unknown mark stays out of the name',
    !itemLabel(w, app, known).includes('BLAZING'), itemLabel(w, app, known));
  w.known = true;
  check('a known one goes in front of it',
    itemLabel(w, app, known) === '+2 BLAZING SABRE', itemLabel(w, app, known));
  check('and markName reads it back', markName(w) === 'BLAZING');
}

// --- a live hero ------------------------------------------------------------
function hero(setup) {
  const g = new Game('ENCH');
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
  idle(4);
  const f = g.floor(1);
  p.hp = p.maxHp = 300;
  p.invuln = 0;
  setup?.(g, p, f);
  return { g, p, f, idle };
}

function victim(f, g) {
  const e = f.ents.find(x => isMob(x.kind) && !x.dead);
  e.hp = e.maxHp = 400;
  e.buffs = {};
  return e;
}

// blazing sets things alight
{
  const { g, p, f } = hero((gg, pl) => {
    pl.equip.weapon = { type: ITEM.WEAPON, tier: 3, upgrade: 0, ench: ENCH.BLAZING, known: true };
  });
  const e = victim(f, g);
  let lit = false;
  for (let n = 0; n < 60 && !lit; n++) {
    g.procEnchant(p, p.equip.weapon, ENCHANTS[ENCH.BLAZING], e, f, 10);
    lit = BF.has(e, B.BURNING);
  }
  check('a blazing weapon sets what it hits on fire', lit);
}

// vampiric gives back what it takes
{
  const { g, p, f } = hero((gg, pl) => {
    pl.equip.weapon = { type: ITEM.WEAPON, tier: 3, upgrade: 0, ench: ENCH.VAMPIRIC, known: true };
  });
  const e = victim(f, g);
  p.hp = 100;
  g.procEnchant(p, p.equip.weapon, ENCHANTS[ENCH.VAMPIRIC], e, f, 40);
  check('a vampiric one heals the wielder', p.hp > 100, `hp ${p.hp}`);
}

// grim finishes the badly wounded
{
  const { g, p, f } = hero();
  const e = victim(f, g);
  e.hp = 20;   // well under the third it reaps at
  let reaped = false;
  for (let n = 0; n < 200 && !reaped; n++) {
    e.hp = 20; e.flash = 0;
    g.procEnchant(p, {}, ENCHANTS[ENCH.GRIM], e, f, 5);
    reaped = e.dead;
  }
  check('a grim one finishes the badly wounded', reaped);
}

// kinetic banks damage rather than spending it
{
  const { g, p, f } = hero();
  const e = victim(f, g);
  const w = { type: ITEM.WEAPON, tier: 3, upgrade: 0, ench: ENCH.KINETIC };
  g.procEnchant(p, w, ENCHANTS[ENCH.KINETIC], e, f, 50);
  check('a kinetic one banks part of the blow', (w.kinetic || 0) > 0, `${w.kinetic} stored`);
}

// projecting reaches further
{
  const { g, p, f } = hero((gg, pl) => {
    pl.equip.weapon = { type: ITEM.WEAPON, tier: 3, upgrade: 0, ench: ENCH.PROJECTING, known: true };
  });
  check('projecting is a reach bonus, not a proc',
    ENCHANTS[ENCH.PROJECTING].reach > 1 && !ENCHANTS[ENCH.PROJECTING].chance);
}

// --- glyphs -----------------------------------------------------------------
{
  const { g, p, f } = hero((gg, pl) => {
    pl.equip.armor = { type: ITEM.ARMOR, tier: 3, upgrade: 0, glyph: GLYPH.STONE, known: true };
  });
  const plain = g.procGlyph({ ...p, equip: { armor: { type: ITEM.ARMOR, tier: 3 } } }, 40, null, f);
  const soaked = g.procGlyph(p, 40, null, f);
  check('stone armour soaks part of the blow', soaked < plain, `${plain} -> ${soaked}`);
}
{
  const { g, p, f } = hero((gg, pl) => {
    pl.equip.armor = { type: ITEM.ARMOR, tier: 3, upgrade: 0, glyph: GLYPH.THORNS, known: true };
  });
  const e = victim(f, g);
  let hurt = false;
  for (let n = 0; n < 60 && !hurt; n++) {
    e.hp = 400; e.flash = 0;
    g.procGlyph(p, 20, e, f);
    hurt = e.hp < 400;
  }
  check('thorns answers the attacker', hurt);
}
{
  const { g, p, f } = hero((gg, pl) => {
    pl.equip.armor = { type: ITEM.ARMOR, tier: 3, upgrade: 0, glyph: GLYPH.ENTANGLEMENT, known: true };
  });
  const e = victim(f, g);
  let rooted = false;
  for (let n = 0; n < 80 && !rooted; n++) {
    g.procGlyph(p, 10, e, f);
    rooted = BF.has(e, B.ROOTS);
  }
  check('entanglement roots them where they stand', rooted);
}
{
  const { g, p, f, idle } = hero((gg, pl) => {
    pl.equip.armor = { type: ITEM.ARMOR, tier: 3, upgrade: 0, glyph: GLYPH.BRIMSTONE, known: true };
  });
  BF.apply(p, B.BURNING, 300);
  idle(3);
  check('brimstone will not let you burn', !BF.has(p, B.BURNING));
}

// --- curses -----------------------------------------------------------------
{
  const { g, p, f } = hero((gg, pl) => {
    pl.equip.weapon = { type: ITEM.WEAPON, tier: 1, upgrade: 0, curse: CURSE.SACRIFICIAL, cursed: true, known: true };
  });
  p.bag[0] = { key: 'weapon', item: { type: ITEM.WEAPON, tier: 5, upgrade: 3 }, count: 1 };
  g.equipFrom(p, 0);
  check('a cursed weapon will not come off', p.equip.weapon.tier === 1);
  check('and the better one stays in the pack', p.bag[0]?.item.tier === 5);

  g.uncurse(p);
  check('a scroll of remove curse lifts it', !p.equip.weapon.cursed && !p.equip.weapon.curse);
  g.equipFrom(p, 0);
  check('and then it comes off', p.equip.weapon.tier === 5);
}
{
  const { g, p, f } = hero();
  const e = victim(f, g);
  const w = { type: ITEM.WEAPON, tier: 3, curse: CURSE.ANNOYING, cursed: true };
  for (const o of f.ents) if (isMob(o.kind)) o.alerted = 0;
  for (let n = 0; n < 40; n++) g.procWeaponCurse(p, w, CURSES[CURSE.ANNOYING], e, f);
  check('an annoying weapon wakes the floor',
    f.ents.filter(o => isMob(o.kind) && o.alerted > 0).length > 1);
}
{
  const { g, p, f } = hero();
  const w = { type: ITEM.WEAPON, tier: 3, curse: CURSE.EXHAUSTING, cursed: true };
  const e = victim(f, g);
  let weak = false;
  for (let n = 0; n < 80 && !weak; n++) {
    g.procWeaponCurse(p, w, CURSES[CURSE.EXHAUSTING], e, f);
    weak = BF.has(p, B.WEAKNESS);
  }
  check('an exhausting one wears you down', weak);
}

// --- learning what you are holding -------------------------------------------
{
  const { g, p, f } = hero((gg, pl) => {
    pl.equip.weapon = { type: ITEM.WEAPON, tier: 3, upgrade: 0, ench: ENCH.LUCKY, known: false };
  });
  g.learnGear(p, p.equip.weapon, 'weapon');
  check('using a marked weapon teaches you what it is', p.equip.weapon.known === true);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall enchantment checks passed');
process.exit(fails ? 1 : 0);
