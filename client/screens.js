// The two full-screen panels: your pack, and your perk trees.
// Both draw over the running world — nothing pauses, because three other
// people are still playing.

import { SCREEN_W, SCREEN_H, CLASSES, CLASS_ORDER } from '../shared/constants.js';
import { ITEM, POTION_TINT, WEAPONS, ARMORS, itemLabel, isConsumable } from '../shared/items.js';
import { ENCHANTS, GLYPHS, CURSES } from '../shared/enchants.js';
import { RINGS, RING_TINT } from '../shared/rings.js';
import { WANDS, WAND_TINT } from '../shared/wands.js';
import { MISSILES, missilePower } from '../shared/missiles.js';
import { ARTIFACTS, artMax } from '../shared/artifacts.js';
import { PLANTS } from '../shared/plants.js';
import { TREES, PERKS, perksInTree, treesFor, canTake } from '../shared/perks.js';
import { IMG, blit, text, textCentered, textWidth, potionImg, ringImg, wandImg, seedImg } from './art/bake.js';

const C = {
  panel: '#0B0E18', frame: '#39405C', dim: '#1A2032',
  gold: '#F8B800', white: '#FCFCFC', grey: '#7C8494', dark: '#4A5268',
  green: '#40C040', red: '#F83800', blue: '#3CA0FC',
};

const COLS = 8;
const CELL = 19;

function box(g, x, y, w, h, fill = C.panel, edge = C.frame) {
  g.fillStyle = fill; g.fillRect(x, y, w, h);
  g.fillStyle = edge;
  g.fillRect(x, y, w, 1); g.fillRect(x, y + h - 1, w, 1);
  g.fillRect(x, y, 1, h); g.fillRect(x + w - 1, y, 1, h);
}

/** The icon a bag entry shows. */
export function iconFor(item, st) {
  if (!item) return null;
  switch (item.type) {
    case ITEM.GOLD: return IMG.GOLD_PILE;
    case ITEM.FOOD: return IMG.RATION;
    case ITEM.BOMB: return IMG.ITEM_BOMB;
    case ITEM.KEY: return IMG.ITEM_KEY;
    case ITEM.GOLDKEY: return IMG.GOLD_KEY;
    case ITEM.RELIC: return IMG.AMULET;
    case ITEM.WEAPON: return IMG.SWORD_ICON;
    case ITEM.ARMOR: return IMG.ARMOR_ICON;
    case ITEM.SCROLL: return IMG.SCROLL;
    case ITEM.POTION:
      return potionImg(POTION_TINT[st.app?.potionLook?.[item.kind]] || '#FCFCFC');
    case ITEM.RING:
      return ringImg(RING_TINT[st.app?.ringLook?.[item.kind]] || '#FCFCFC');
    case ITEM.WAND:
      return wandImg(WAND_TINT[st.app?.wandLook?.[item.kind]] || '#FCFCFC');
    case ITEM.MISSILE: return IMG.MISSILE;
    case ITEM.SEED: return seedImg(PLANTS[item.kind]?.colour || '#58C038');
    case ITEM.DEW: return IMG.DEW;
    case ITEM.ARTIFACT: return IMG.ARTIFACT;
    case ITEM.QUEST: return IMG.AMULET;
    default: return null;
  }
}

/** A line of flavour telling you what the thing actually does. */
/** What the writing on a piece of gear does, once somebody has worked it out. */
const MARK_TEXT = {
  blazing: 'SETS THEM ALIGHT', chilling: 'SLOWS WHAT IT HITS',
  shocking: 'ARCS TO WHAT IS NEAR', vampiric: 'GIVES BACK WHAT IT TAKES',
  grim: 'FINISHES THE WOUNDED', lucky: 'SHAKES COINS LOOSE',
  projecting: 'REACHES FURTHER', elastic: 'SENDS THEM FLYING',
  kinetic: 'BANKS A BLOW FOR THE NEXT', blooming: 'GRASS FOLLOWS IT',
  corrupting: 'TURNS THEM ON EACH OTHER', blocking: 'SHIELDS AS YOU SWING',
  unstable: 'NEVER THE SAME TWICE',
  antimagic: 'BLUNTS MAGIC', thorns: 'ANSWERS THE ATTACKER',
  stone: 'SOAKS BLOWS, SLOWS YOU', entanglement: 'ROOTS THEM WHERE THEY STAND',
  repulsion: 'PUSHES THEM BACK', camouflage: 'HIDES YOU IN GRASS',
  flow: 'SWIFT THROUGH WATER', obfuscation: 'MUFFLES YOUR STEP',
  potential: 'RECHARGES WHEN STRUCK', swiftness: 'QUICK WHILE UNHURT',
  viscosity: 'SPREADS THE PAIN OUT', affection: 'CHARMS WHAT STRIKES YOU',
  brimstone: 'YOU WILL NOT BURN',
  annoying: 'WAKES THE WHOLE FLOOR', displacing: 'THROWS YOU ACROSS THE FLOOR',
  exhausting: 'WEARS YOU DOWN', sacrificial: 'DRAWS YOUR OWN BLOOD',
  wayward: 'MISSES WHEN IT MATTERS', friendly: 'CALMS WHAT YOU HIT',
  'anti-entropy': 'CHILLS THE WEARER', bulk: 'HEAVY AND SLOW',
  metabolism: 'BURNS THROUGH RATIONS', multiplicity: 'CALLS THEM TO YOU',
  overgrowth: 'GRASS SWALLOWS YOUR FEET', stench: 'FOULS THE AIR AROUND YOU',
};

/** Trim a line to what will actually fit in the space it is given. */
function fit(str, px, size) {
  if (!str) return '';
  let out = str;
  while (out.length > 1 && textWidth(out, size) > px) out = out.slice(0, -1);
  return out;
}

function mark(item) {
  if (!item?.known) return '';
  const id = item.curse || item.ench || item.glyph;
  const text = MARK_TEXT[id];
  return text ? `  -  ${text}` : '';
}

function describe(item, st, short = false) {
  if (!item) return '';
  switch (item.type) {
    case ITEM.WEAPON: {
      const w = WEAPONS[item.tier - 1];
      return `+${w.dmg + (item.upgrade || 0) * 2} DAMAGE${short ? '' : mark(item)}`;
    }
    case ITEM.ARMOR: {
      const a = ARMORS[item.tier - 1];
      return `+${a.def + (item.upgrade || 0) * 1.5} ARMOUR${short ? '' : mark(item)}`;
    }
    case ITEM.FOOD: return 'FILLS YOU UP AND MENDS A LITTLE';
    case ITEM.BOMB: return 'SET IT DOWN AND STEP BACK';
    case ITEM.KEY: return 'OPENS ONE LOCKED DOOR ON THIS FLOOR';
    case ITEM.POTION:
      return st.known?.potions?.includes(item.kind)
        ? potionText(item.kind) : 'YOU HAVE NOT DRUNK ONE OF THESE';
    case ITEM.SCROLL:
      return st.known?.scrolls?.includes(item.kind)
        ? scrollText(item.kind) : 'THE RUNE MEANS NOTHING TO YOU YET';
    case ITEM.MISSILE: {
      const def = MISSILES[item.kind];
      return def ? `${missilePower(def, st.depth || 1, 0)} DAMAGE  -  ${def.blurb}` : '';
    }
    case ITEM.SEED: return PLANTS[item.kind]?.blurb || '';
    case ITEM.DEW: return 'A LITTLE HEALTH, OR A LITTLE PUT BY';
    case ITEM.QUEST: return 'SOMEBODY ON THIS FLOOR IS WAITING FOR THIS';
    case ITEM.ARTIFACT: {
      const def = ARTIFACTS[item.kind];
      if (!def) return '';
      const bar = def.max ? `${item.charge ?? 0}/${artMax(def, item.level || 0)}  -  ` : '';
      return `${bar}${def.blurb}`;
    }
    case ITEM.WAND: {
      const def = WANDS[item.kind];
      const max = (def?.max || 0) + (item.upgrade || 0);
      const charge = `${item.charges ?? 0}/${max} CHARGES`;
      const shown = item.known || st.known?.wands?.includes(item.kind);
      return shown ? `${charge}  -  ${def.blurb}` : `${charge}  -  UNTRIED`;
    }
    case ITEM.RING: {
      const shown = item.known || st.known?.rings?.includes(item.kind);
      if (!shown) return 'YOU HAVE NOT WORN IT LONG ENOUGH';
      const word = RINGS[item.kind]?.blurb || '';
      return item.cursed ? `${word}  -  BACKWARDS, AND STUCK` : word;
    }
    default: return '';
  }
}

const potionText = (k) => ({
  healing: 'CLOSES YOUR WOUNDS', strength: 'RAISES YOUR MAXIMUM HEALTH',
  haste: 'QUICKENS YOU', invis: 'HIDES YOU FROM SIGHT',
  might: 'YOUR BLOWS LAND HARDER', fire: 'BURSTS INTO FLAME',
  frost: 'FREEZES WHAT IS NEAR', toxic: 'A CHOKING CLOUD',
  paralysis: 'HOLDS EVERYTHING NEARBY STILL',
}[k] || '');

const scrollText = (k) => ({
  upgrade: 'IMPROVES YOUR WEAKER PIECE OF GEAR',
  identify: 'NAMES SOMETHING IN YOUR PACK',
  mapping: 'DRAWS THE WHOLE FLOOR',
  teleport: 'THROWS YOU SOMEWHERE ELSE',
  terror: 'THE FLOOR FLEES FROM YOU',
  recharge: 'YOUR ABILITY IS READY AT ONCE',
  rage: 'YOU HIT MUCH HARDER FOR A WHILE',
}[k] || '');

// ===========================================================================
// The pack
// ===========================================================================
export function drawInventory(R, st, ui) {
  const g = R.ctx;
  g.fillStyle = 'rgba(2,4,10,0.94)';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);

  text(g, 'YOUR PACK', 10, 6, 'gold', 7);
  blit(g, IMG.GOLD_PILE, 232, 0);
  text(g, String(st.me.gold), 248, 6, 'gold', 7);

  // --- the grid: the top row is what 1-8 reach ---------------------------
  const gx = 10, gy = 26;
  const bag = st.bag || [];
  const rows = Math.ceil(Math.max(bag.length, 8) / COLS);
  for (let i = 0; i < rows * COLS; i++) {
    const cx = gx + (i % COLS) * CELL;
    const cy = gy + ((i / COLS) | 0) * CELL;
    const exists = i < bag.length;
    const slot = exists ? bag[i] : undefined;
    const sel = ui.cursor === i;
    box(g, cx, cy, CELL - 1, CELL - 1,
      exists ? (sel ? '#243055' : C.dim) : '#080A10',
      sel ? C.gold : (ui.held === i ? C.blue : C.frame));
    if (slot) {
      const img = iconFor(slot.item, st);
      if (img) blit(g, img, cx + 1, cy + 1);
      if (slot.count > 1) text(g, String(slot.count), cx + 9, cy + 11, 'white', 5);
    }
    if (i < 8) text(g, String(i + 1), cx + 1, cy - 7, sel ? 'gold' : 'dark', 5);
  }

  // --- what you are wearing ----------------------------------------------
  const ex = 174, ey = 22;
  text(g, 'WORN', ex, ey - 8, 'grey', 6);
  const worn = [
    ['weapon', st.equip?.weapon, ITEM.WEAPON, IMG.SWORD_ICON],
    ['armor', st.equip?.armor, ITEM.ARMOR, IMG.ARMOR_ICON],
    ['ring1', st.equip?.ring1, ITEM.RING, null],
    ['ring2', st.equip?.ring2, ITEM.RING, null],
    ['artifact', st.equip?.artifact, ITEM.ARTIFACT, IMG.ARTIFACT],
  ];
  const ROW = 17;   // five slots and a hero summary have to share the column
  worn.forEach(([which, item, kind, icon], i) => {
    const y = ey + i * ROW;
    const sel = ui.cursor === -1 - i;
    box(g, ex, y, 136, 16, sel ? '#243055' : C.dim, sel ? C.gold : C.frame);
    const slotIcon = icon || (item
      ? ringImg(RING_TINT[st.app?.ringLook?.[item.kind]] || '#FCFCFC')
      : null);
    if (slotIcon) blit(g, slotIcon, ex + 2, y + 2);
    if (!item) {
      text(g, kind === ITEM.RING ? 'NO RING' : kind === ITEM.ARTIFACT ? 'NO ARTIFACT' : '',
        ex + 20, y + 4, 'dark', 6);
      return;
    }
    {
      const full = { ...item, type: kind };
      const name = itemLabel(full, st.app, st.known || { potions: [], scrolls: [] });
      const tint = item.known && item.curse ? 'red' : (sel ? 'white' : 'grey');
      text(g, fit(name, 136 - 22, 6), ex + 20, y + 1, tint, 6);
      text(g, fit(describe(full, st, true), 136 - 22, 5), ex + 20, y + 9, 'dark', 5);
    }
  });

  // --- a quick read on the hero ------------------------------------------
  const sy = ey + worn.length * ROW + 2;
  text(g, `${CLASSES[st.me.cls]?.name || ''}  LEVEL ${st.me.level}`, ex, sy, 'blue', 6);
  text(g, `HEALTH   ${st.me.hp}/${st.me.maxHp}`, ex, sy + 8, 'white', 6);
  text(g, `PERK POINTS  ${st.perkPoints || 0}`, ex, sy + 16,
    (st.perkPoints || 0) > 0 ? 'gold' : 'grey', 6);

  // --- the selected thing -------------------------------------------------
  const cur = selectedItem(st, ui);
  box(g, 10, 132, SCREEN_W - 20, 52);
  if (cur) {
    const label = itemLabel(cur, st.app, st.known || { potions: [], scrolls: [] });
    text(g, fit(label, SCREEN_W - 32, 7), 16, 138, cur.known && cur.curse ? 'red' : 'gold', 7);
    text(g, fit(describe(cur, st), SCREEN_W - 32, 6), 16, 150, 'white', 6);
    text(g, actionHint(cur, ui), 16, 162, 'grey', 6);
  } else {
    text(g, ui.held !== null ? 'PICK A SLOT TO DROP IT INTO' : 'NOTHING THERE', 16, 138, 'grey', 7);
  }

  textCentered(g, 'ARROWS MOVE   ENTER USE OR EQUIP   X DROP', SCREEN_W / 2, 196, 'grey', 6);
  textCentered(g, 'C PICK UP AND MOVE   I OR ESC CLOSE', SCREEN_W / 2, 206, 'grey', 6);
  textCentered(g, 'THE DUNGEON DOES NOT WAIT WHILE YOU RUMMAGE', SCREEN_W / 2, 222, 'red', 6);
}

function actionHint(item, ui) {
  if (ui.held !== null) return 'C AGAIN TO PLACE IT';
  if (item.type === ITEM.WEAPON || item.type === ITEM.ARMOR) return 'ENTER TO WEAR IT';
  if (item.type === ITEM.KEY || item.type === ITEM.GOLDKEY) return 'USED BY WALKING INTO A LOCKED DOOR';
  if (item.type === ITEM.SEED) return 'ENTER TO SOW IT WHERE YOU FACE';
  if (item.type === ITEM.QUEST) return 'CARRY IT BACK TO WHOEVER ASKED';
  if (item.type === ITEM.MISSILE) return 'ENTER TO THROW ONE WHERE YOU FACE';
  if (item.type === ITEM.ARTIFACT) {
    return ARTIFACTS[item.kind]?.active ? 'Q USES IT, WHEREVER YOU ARE' : 'IT WORKS ON ITS OWN';
  }
  if (item.type === ITEM.WAND) {
    return (item.charges ?? 0) > 0 ? 'ENTER TO POINT IT WHERE YOU FACE' : 'SPENT - IT WILL FILL BACK UP';
  }
  return 'ENTER TO USE IT';
}

// The four worn slots sit at cursor -1 through -4, in the order they are drawn.
export const WORN_SLOTS = [
  ['weapon', ITEM.WEAPON], ['armor', ITEM.ARMOR],
  ['ring1', ITEM.RING], ['ring2', ITEM.RING],
  ['artifact', ITEM.ARTIFACT],
];

export function selectedItem(st, ui) {
  if (ui.cursor < 0) {
    const entry = WORN_SLOTS[-1 - ui.cursor];
    if (!entry) return null;
    const item = st.equip?.[entry[0]];
    return item ? { ...item, type: entry[1] } : null;
  }
  const slot = (st.bag || [])[ui.cursor];
  return slot ? slot.item : null;
}

// ===========================================================================
// The perk trees
// ===========================================================================
const NODE = 20;
const COL_X = [104, 178, 252];
const ROW_Y = [30, 54, 78, 102, 126];

export function drawPerks(R, st, ui) {
  const g = R.ctx;
  g.fillStyle = 'rgba(2,4,10,0.94)';
  g.fillRect(0, 0, SCREEN_W, SCREEN_H);

  const trees = treesFor(st.me.cls);
  const tree = trees[Math.min(ui.tree, trees.length - 1)];
  const nodes = perksInTree(tree.id);
  const perks = st.perks || {};
  const points = st.perkPoints || 0;

  text(g, 'SKILLS', 10, 6, 'gold', 7);
  text(g, `POINTS ${points}`, 236, 6, points > 0 ? 'gold' : 'grey', 7);

  // --- which tree ---------------------------------------------------------
  trees.forEach((t, i) => {
    const y = 26 + i * 20;
    const sel = t.id === tree.id;
    box(g, 6, y, 88, 18, sel ? '#243055' : C.dim, sel ? C.gold : C.frame);
    text(g, t.name, 10, y + 3, sel ? 'gold' : 'white', 6);
    text(g, t.blurb, 10, y + 11, sel ? 'white' : 'dark', 5);
    const spent = perksInTree(t.id).reduce((n, p) => n + (perks[p.id] || 0), 0);
    if (spent) text(g, String(spent), 84, y + 6, 'blue', 6);
  });

  // --- the branches -------------------------------------------------------
  g.strokeStyle = C.frame;
  for (const node of nodes) {
    if (!node.req) continue;
    const from = nodes.find(n => n.id === node.req[0]);
    if (!from) continue;
    const ax = COL_X[from.col] + NODE / 2, ay = ROW_Y[from.row] + NODE / 2;
    const bx = COL_X[node.col] + NODE / 2, by = ROW_Y[node.row] + NODE / 2;
    const met = (perks[node.req[0]] || 0) >= node.req[1];
    g.fillStyle = met ? '#6E7A4A' : C.dim;
    line(g, ax, ay, bx, by);
  }

  // --- the nodes ----------------------------------------------------------
  nodes.forEach((node) => {
    const x = COL_X[node.col], y = ROW_Y[node.row];
    const rank = perks[node.id] || 0;
    const verdict = canTake(node.id, perks, st.me.cls, points);
    const open = rank > 0 || verdict.ok || !node.req || (perks[node.req[0]] || 0) >= node.req[1];
    const sel = ui.node === node.id;
    const fill = rank >= node.ranks ? '#7A5E10' : rank > 0 ? '#4A3C10' : open ? C.dim : '#0E1018';
    box(g, x, y, NODE, NODE, sel ? '#243055' : fill, sel ? C.gold : (open ? C.frame : C.dim));
    text(g, node.name.slice(0, 2), x + 3, y + 3,
      rank > 0 ? 'gold' : open ? 'white' : 'dark', 7);
    // rank pips
    for (let r = 0; r < node.ranks; r++) {
      g.fillStyle = r < rank ? C.gold : C.dark;
      g.fillRect(x + 2 + r * 5, y + NODE - 5, 4, 3);
    }
  });

  // --- the selected perk --------------------------------------------------
  const node = nodes.find(n => n.id === ui.node) || nodes[0];
  const rank = perks[node.id] || 0;
  const verdict = canTake(node.id, perks, st.me.cls, points);
  box(g, 6, 152, SCREEN_W - 12, 58);
  text(g, node.name, 12, 158, 'gold', 7);
  text(g, `RANK ${rank}/${node.ranks}`, 232, 158, rank ? 'gold' : 'grey', 6);
  text(g, node.text, 12, 170, 'white', 5);
  if (node.req) {
    const met = (perks[node.req[0]] || 0) >= node.req[1];
    text(g, `NEEDS ${PERKS[node.req[0]].name} ${node.req[1]}`, 12, 180, met ? 'green' : 'red', 5);
  }
  text(g, verdict.ok ? 'ENTER TO LEARN IT' : verdict.why, 12, 192,
    verdict.ok ? 'green' : 'grey', 6);

  textCentered(g, 'ARROWS MOVE   TAB SWITCHES TREE   K OR ESC CLOSE', SCREEN_W / 2, 220, 'grey', 6);
}

function line(g, ax, ay, bx, by) {
  // axis-aligned elbow, so it stays crisp at one pixel
  const midY = (ay + by) >> 1;
  rect(g, Math.min(ax, ax), Math.min(ay, midY), 2, Math.abs(midY - ay) || 1);
  rect(g, Math.min(ax, bx), midY, Math.abs(bx - ax) || 1, 2);
  rect(g, bx, Math.min(midY, by), 2, Math.abs(by - midY) || 1);
}
function rect(g, x, y, w, h) { g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }

/** Move the selection to whichever node lies that way. */
export function moveNode(st, ui, dx, dy) {
  const trees = treesFor(st.me.cls);
  const tree = trees[Math.min(ui.tree, trees.length - 1)];
  const nodes = perksInTree(tree.id);
  const cur = nodes.find(n => n.id === ui.node) || nodes[0];
  let best = null, bestScore = Infinity;
  for (const n of nodes) {
    if (n.id === cur.id) continue;
    const ddx = n.col - cur.col, ddy = n.row - cur.row;
    if (dx && Math.sign(ddx) !== Math.sign(dx)) continue;
    if (dy && Math.sign(ddy) !== Math.sign(dy)) continue;
    const score = Math.abs(ddx) * (dx ? 1 : 4) + Math.abs(ddy) * (dy ? 1 : 4);
    if (score < bestScore) { bestScore = score; best = n; }
  }
  if (best) ui.node = best.id;
}

export function firstNode(st, ui) {
  const trees = treesFor(st.me.cls);
  const tree = trees[Math.min(ui.tree, trees.length - 1)];
  const nodes = perksInTree(tree.id);
  ui.node = nodes[0]?.id;
}
