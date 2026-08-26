// The palette every sprite in this game is drawn from — a curated NES-style
// ramp. Sprites are authored as plain text (one character per pixel) so they
// can be read and edited as pictures rather than as data.

export const PAL = {
  '.': null,          // transparent

  '0': '#000000',     // outline black
  '1': '#FCFCFC',     // white
  '2': '#BCBCBC',     // light grey
  '3': '#7C7C7C',     // grey
  '4': '#3C3C3C',     // dark grey

  '5': '#FCD8A8',     // skin
  '6': '#D89060',     // skin shadow

  '7': '#00A800',     // tunic mid      \
  '8': '#005800',     // tunic dark      | swapped per player
  '9': '#B8F818',     // tunic light    /

  'a': '#0078F8',     // blue
  'b': '#0000BC',     // dark blue
  'c': '#3CBCFC',     // light blue

  'd': '#F83800',     // red
  'e': '#A81000',     // dark red
  'f': '#FC9838',     // orange

  'g': '#F8B800',     // gold
  'h': '#FCE0A8',     // pale gold

  'i': '#6844FC',     // violet
  'j': '#38087C',     // dark violet

  'k': '#8C4A10',     // brown
  'l': '#C88030',     // light brown

  'm': '#00E8D8',     // cyan
  'n': '#D800CC',     // magenta
  'o': '#F878F8',     // pink

  'A': '#0A0A12',     // dungeon floor
  'B': '#16162A',     // floor grout
  'C': '#26264A',     // floor edge

  'F': '#C89858',     // sand
  'G': '#E8D0A0',     // sand light

  'H': '#101830',     // water dark
  'I': '#1848A8',     // water
  'J': '#2878E0',     // water light
  'K': '#A0F0FF',     // water sparkle

  'U': '#C0C0D8',     // stone light
  'V': '#808098',     // stone
  'X': '#404058',     // stone dark

  'Y': '#F8F0C0',     // relic glow
  'Z': '#806000',     // gold shadow
};

// Per-player tunic ramps. The hero is authored with 7/8/9 and recoloured here.
export const TUNICS = {
  green:  { '7': '#00A800', '8': '#005800', '9': '#B8F818' },
  blue:   { '7': '#0078F8', '8': '#0000BC', '9': '#3CBCFC' },
  red:    { '7': '#F83800', '8': '#A81000', '9': '#FC9838' },
  violet: { '7': '#9840F8', '8': '#4818A0', '9': '#E080FC' },
};

/**
 * Parse an authored sprite string into { w, h, rows[] }.
 * Blank leading/trailing lines are ignored so sprites can be written as
 * template literals that start on their own line.
 */
export function parse(str, name = 'sprite') {
  const rows = str.split('\n').map(r => r.replace(/\r$/, '')).filter(r => r.length > 0);
  if (!rows.length) throw new Error(`${name}: empty sprite`);
  const w = rows[0].length;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].length !== w) {
      throw new Error(`${name}: row ${i} is ${rows[i].length}px, expected ${w} ("${rows[i]}")`);
    }
    for (const ch of rows[i]) {
      if (!(ch in PAL)) throw new Error(`${name}: row ${i} uses unknown colour "${ch}"`);
    }
  }
  return { w, h: rows.length, rows };
}
