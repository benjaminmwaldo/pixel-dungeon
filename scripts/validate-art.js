// Checks every hand-drawn sprite is rectangular, the right size, and only uses
// colours that exist in the palette. Run: node scripts/validate-art.js
import { PAL } from '../client/art/palette.js';
import * as SPR from '../client/art/sprites.js';
import * as ITEMS from '../client/art/items.js';
import * as MOBART from '../client/art/mobs.js';
import * as BOSSART from '../client/art/bosses.js';
import * as GEAR from '../client/art/gear.js';
import { TILE_ART, WATER_2 } from '../client/art/dungeon-tiles.js';
import '../client/art/font.js';
import '../shared/terrain.js';

let bad = 0, checked = 0;

function check(name, str, wantW, wantH) {
  const rows = str.split('\n').filter(r => r.length > 0);
  checked++;
  const w = rows[0].length;
  let ok = true;
  rows.forEach((r, i) => {
    if (r.length !== w) {
      console.log(`  ${name}: row ${i} is ${r.length}px (first row is ${w}px)  "${r}"`);
      ok = false;
    }
    for (const ch of r) {
      if (!(ch in PAL)) {
        console.log(`  ${name}: row ${i} has unknown colour "${ch}"`);
        ok = false;
      }
    }
  });
  if (wantW && w !== wantW) { console.log(`  ${name}: width ${w}, expected ${wantW}`); ok = false; }
  if (wantH && rows.length !== wantH) { console.log(`  ${name}: height ${rows.length}, expected ${wantH}`); ok = false; }
  if (!ok) bad++;
  return ok;
}

console.log('sprites:');
for (const [name, art] of Object.entries(SPR)) {
  if (typeof art !== 'string') continue;
  const big = name.startsWith('WYRM');
  check(name, art, big ? 32 : 16, big ? 32 : 16);
}

console.log('mobs + class heads:');
for (const [name, art] of Object.entries(MOBART)) {
  if (typeof art !== 'string') continue;
  check(name, art, 16, 16);
}

console.log('bosses:');
for (const [name, art] of Object.entries(BOSSART)) {
  if (typeof art !== 'string') continue;
  check(name, art, 32, 32);
}

console.log('gear:');
for (const [name, art] of Object.entries(GEAR)) {
  if (typeof art !== 'string') continue;
  check(name, art, 16, 16);
}

console.log('items + effects:');
for (const [name, art] of Object.entries(ITEMS)) {
  if (typeof art !== 'string') continue;
  check(name, art, null, null);
}

console.log('tiles:');
for (const [id, art] of Object.entries(TILE_ART)) check(`tile ${id}`, art, 16, 16);
check('WATER_2', WATER_2, 16, 16);

console.log(`\n${checked - bad}/${checked} sprites ok`);
if (bad) { console.log(`${bad} BAD`); process.exit(1); }
