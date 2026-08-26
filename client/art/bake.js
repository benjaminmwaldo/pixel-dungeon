// Turns the authored text sprites into offscreen canvases once at boot:
// the tileset baked in every chapter's palette (plus a dimmed copy for
// remembered ground), the bestiary, the bosses, loot, and one composed hero
// per class. Everything downstream just blits.

import { PAL, TUNICS, parse } from './palette.js';
import { GLYPHS, FONT_W, FONT_H } from './font.js';
import * as HERO from './sprites.js';
import * as MOB from './mobs.js';
import * as BOSS from './bosses.js';
import * as GEAR from './gear.js';
import * as FX from './items.js';
import { TILE_ART, WATER_2, REGION_PALETTE } from './dungeon-tiles.js';
import { TT } from '../../shared/terrain.js';
import { CLASS_ORDER, CLASSES } from '../../shared/constants.js';

export const IMG = {};                 // mobs, effects, gear, projectiles
export const TILE_IMG = {};            // region -> tile id -> canvas
export const TILE_DIM = {};            // region -> tile id -> dimmed canvas
export const WATER_IMG = {};           // region -> [frame0, frame1]
export const WATER_DIM = {};
export const HERO_IMG = {};            // class -> frame -> canvas
export const FONT_IMG = {};

const cache = new Map();
let idSeq = 0;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Paint one authored sprite onto a fresh canvas, optionally recolouring. */
export function bake(art, name, override = null) {
  const { w, h, rows } = parse(art, name);
  const c = canvas(w, h);
  const ctx = c.getContext('2d');
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const col = (override && override[ch]) || PAL[ch];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  c.__id = idSeq++;
  return c;
}

/** A darker copy, for ground the party remembers but cannot currently see. */
function dim(src, amount = 0.72) {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillStyle = `rgba(0,6,16,${amount})`;
  ctx.fillRect(0, 0, c.width, c.height);
  c.__id = idSeq++;
  return c;
}

/** A solid-colour silhouette — hit flashes, spirits, frozen mobs. */
export function silhouette(src, colour) {
  const key = `${src.__id}:${colour}`;
  if (cache.has(key)) return cache.get(key);
  const c = canvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, c.width, c.height);
  c.__id = idSeq++;
  cache.set(key, c);
  return c;
}

function composite(base, overlay) {
  const c = canvas(base.width, base.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(base, 0, 0);
  ctx.drawImage(overlay, 0, 0);
  c.__id = idSeq++;
  return c;
}

const HERO_FRAMES = ['HERO_S1', 'HERO_S2', 'HERO_N1', 'HERO_N2', 'HERO_E1', 'HERO_E2',
                     'HERO_ATK_S', 'HERO_ATK_N', 'HERO_ATK_E'];

const HEAD_FOR = {
  warrior: { S: 'HEAD_WARRIOR_S', N: 'HEAD_WARRIOR_N', E: 'HEAD_WARRIOR_E' },
  mage:    { S: 'HEAD_MAGE_S', N: 'HEAD_MAGE_N', E: 'HEAD_MAGE_E' },
  rogue:   { S: 'HEAD_ROGUE_S', N: 'HEAD_ROGUE_N', E: 'HEAD_ROGUE_E' },
  ranger:  { S: 'HEAD_RANGER_S', N: 'HEAD_RANGER_N', E: 'HEAD_RANGER_E' },
};

export function bakeAll() {
  // --- tiles, once per chapter ------------------------------------------
  for (const [region, ramp] of Object.entries(REGION_PALETTE)) {
    TILE_IMG[region] = {};
    TILE_DIM[region] = {};
    for (const [id, art] of Object.entries(TILE_ART)) {
      const img = bake(art, `tile${id}:${region}`, ramp);
      TILE_IMG[region][id] = img;
      TILE_DIM[region][id] = dim(img);
    }
    const w1 = bake(WATER_2, `water2:${region}`, ramp);
    WATER_IMG[region] = [TILE_IMG[region][TT.WATER], w1];
    WATER_DIM[region] = [TILE_DIM[region][TT.WATER], dim(w1)];
  }

  // --- creatures, bosses, loot, effects ---------------------------------
  for (const src of [MOB, BOSS, GEAR, FX, HERO]) {
    for (const [name, art] of Object.entries(src)) {
      if (typeof art !== 'string') continue;
      IMG[name] = bake(art, name);
    }
  }

  // --- one hero per class: tunic recolour plus the class head -----------
  for (const cls of CLASS_ORDER) {
    const ramp = TUNICS[CLASSES[cls].colour] || TUNICS.green;
    const heads = HEAD_FOR[cls];
    HERO_IMG[cls] = {};
    for (const frame of HERO_FRAMES) {
      const body = bake(HERO[frame], `${frame}:${cls}`, ramp);
      const facing = frame.includes('_N') ? 'N' : frame.includes('_E') ? 'E' : 'S';
      const head = bake(MOB[heads[facing]], heads[facing], ramp);
      HERO_IMG[cls][frame] = composite(body, head);
    }
  }

  // A few creatures are the same drawing in another chapter's colours.
  IMG.FLY1 = bake(HERO.BAT1, 'fly1', { i: '#8CC030', j: '#3C6010', d: '#F8F800' });
  IMG.FLY2 = bake(HERO.BAT2, 'fly2', { i: '#8CC030', j: '#3C6010', d: '#F8F800' });
  IMG.WARLOCK1 = bake(MOB.WRAITH1, 'warlock1', { c: '#8858FC', 1: '#FCE0A8' });
  IMG.WARLOCK2 = bake(MOB.WRAITH2, 'warlock2', { c: '#8858FC', 1: '#FCE0A8' });

  IMG.POTION_TINTS = {};

  for (const [key, colour] of Object.entries({
    white: '#FCFCFC', gold: '#F8B800', red: '#F83800', grey: '#8890A0',
    green: '#40E060', blue: '#58C0FC', black: '#000000', dark: '#404858',
  })) {
    FONT_IMG[key] = bakeFont(colour);
  }
}

/** A potion drawn in the colour this run gave that glass. */
export function potionImg(tint) {
  IMG.POTION_TINTS ??= {};
  if (!IMG.POTION_TINTS[tint]) {
    IMG.POTION_TINTS[tint] = bake(GEAR.POTION, `potion:${tint}`, { W: tint });
  }
  return IMG.POTION_TINTS[tint];
}

const CHARS = Object.keys(GLYPHS);
const CHAR_INDEX = new Map(CHARS.map((c, i) => [c, i]));

function bakeFont(colour) {
  const c = canvas(CHARS.length * FONT_W, FONT_H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = colour;
  CHARS.forEach((ch, i) => {
    const rows = GLYPHS[ch].split('/');
    for (let y = 0; y < FONT_H; y++) {
      for (let x = 0; x < FONT_W; x++) {
        if (rows[y][x] === '#') ctx.fillRect(i * FONT_W + x, y, 1, 1);
      }
    }
  });
  return c;
}

export function text(ctx, str, x, y, colour = 'white', spacing = FONT_W) {
  const atlas = FONT_IMG[colour] || FONT_IMG.white;
  const s = String(str).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const idx = CHAR_INDEX.get(s[i]);
    if (idx === undefined) continue;
    ctx.drawImage(atlas, idx * FONT_W, 0, FONT_W, FONT_H,
      Math.round(x) + i * spacing, Math.round(y), FONT_W, FONT_H);
  }
}

export function textWidth(str, spacing = FONT_W) { return String(str).length * spacing; }

export function textCentered(ctx, str, cx, y, colour = 'white', spacing = FONT_W) {
  text(ctx, str, Math.round(cx - textWidth(str, spacing) / 2), y, colour, spacing);
}

export function blit(ctx, img, x, y, flipX = false, flipY = false) {
  if (!img) return;
  if (!flipX && !flipY) { ctx.drawImage(img, Math.round(x), Math.round(y)); return; }
  ctx.save();
  ctx.translate(Math.round(x) + (flipX ? img.width : 0), Math.round(y) + (flipY ? img.height : 0));
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}
