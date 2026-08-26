// Turns the authored text sprites into offscreen canvases once at boot.
// Everything downstream just blits — no per-pixel work at runtime.

import { PAL, TUNICS, parse } from './palette.js';
import { GLYPHS, FONT_W, FONT_H } from './font.js';
import * as SPR from './sprites.js';
import * as ITEMS from './items.js';
import { TILE_ART, WATER_2 } from './tiles.js';
import { T } from '../../shared/constants.js';

export const IMG = {};        // name -> canvas
export const TILE_IMG = {};   // tile id -> canvas
export const HERO_IMG = {};   // colour -> { frameName -> canvas }
export const FONT_IMG = {};   // 'colourKey' -> canvas atlas

const cache = new Map();

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/** Paint one authored sprite onto a fresh canvas, optionally recolouring. */
export function bake(art, name, override = null) {
  const { w, h, rows } = parse(art, name);
  const c = makeCanvas(w, h);
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
  return c;
}

/** A solid-colour silhouette of a baked sprite — used for hit flashes. */
export function silhouette(src, colour) {
  const key = `${src.width}x${src.height}:${colour}:${src.__id}`;
  if (cache.has(key)) return cache.get(key);
  const c = makeCanvas(src.width, src.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = colour;
  ctx.fillRect(0, 0, c.width, c.height);
  cache.set(key, c);
  return c;
}

let idSeq = 0;

export function bakeAll() {
  // --- tiles ---------------------------------------------------------------
  for (const [id, art] of Object.entries(TILE_ART)) {
    TILE_IMG[id] = bake(art, `tile${id}`);
  }
  TILE_IMG.water2 = bake(WATER_2, 'water2');

  // --- characters, items, effects -----------------------------------------
  for (const [name, art] of Object.entries(SPR)) {
    if (typeof art !== 'string') continue;
    IMG[name] = bake(art, name);
    IMG[name].__id = idSeq++;
  }
  for (const [name, art] of Object.entries(ITEMS)) {
    if (typeof art !== 'string') continue;
    IMG[name] = bake(art, name);
    IMG[name].__id = idSeq++;
  }

  // --- the hero, once per tunic colour ------------------------------------
  const heroFrames = ['HERO_S1', 'HERO_S2', 'HERO_N1', 'HERO_N2', 'HERO_E1', 'HERO_E2',
                      'HERO_ATK_S', 'HERO_ATK_N', 'HERO_ATK_E', 'HERO_HOLD'];
  for (const [colour, ramp] of Object.entries(TUNICS)) {
    HERO_IMG[colour] = {};
    for (const f of heroFrames) {
      const img = bake(SPR[f], `${f}:${colour}`, ramp);
      img.__id = idSeq++;
      HERO_IMG[colour][f] = img;
    }
  }

  // --- font atlases --------------------------------------------------------
  for (const [key, colour] of Object.entries({
    white: '#FCFCFC', gold: '#F8B800', red: '#F83800', grey: '#7C7C7C',
    green: '#00E060', blue: '#3CBCFC', black: '#000000',
  })) {
    FONT_IMG[key] = bakeFont(colour);
  }
}

const CHARS = Object.keys(GLYPHS);
const CHAR_INDEX = new Map(CHARS.map((c, i) => [c, i]));

function bakeFont(colour) {
  const c = makeCanvas(CHARS.length * FONT_W, FONT_H);
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

/** Draw a string of the bitmap font. Unknown characters render as a space. */
export function text(ctx, str, x, y, colour = 'white', spacing = FONT_W) {
  const atlas = FONT_IMG[colour] || FONT_IMG.white;
  const s = String(str).toUpperCase();
  for (let i = 0; i < s.length; i++) {
    const idx = CHAR_INDEX.get(s[i]);
    if (idx === undefined) continue;
    ctx.drawImage(atlas, idx * FONT_W, 0, FONT_W, FONT_H, x + i * spacing, y, FONT_W, FONT_H);
  }
}

export function textWidth(str, spacing = FONT_W) { return String(str).length * spacing; }

export function textCentered(ctx, str, cx, y, colour = 'white', spacing = FONT_W) {
  text(ctx, str, Math.round(cx - textWidth(str, spacing) / 2), y, colour, spacing);
}

/** Blit a baked sprite, optionally mirrored. */
export function blit(ctx, img, x, y, flipX = false, flipY = false) {
  if (!img) return;
  if (!flipX && !flipY) { ctx.drawImage(img, Math.round(x), Math.round(y)); return; }
  ctx.save();
  ctx.translate(Math.round(x) + (flipX ? img.width : 0), Math.round(y) + (flipY ? img.height : 0));
  ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

export { T };
