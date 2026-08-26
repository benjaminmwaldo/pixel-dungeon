// Builds the five chapter bosses at 32x32 and writes client/art/bosses.js.
// They are composed from shape primitives rather than typed row by row, so a
// 32-wide sprite can never drift out of alignment.
import { writeFileSync } from 'node:fs';

const W = 32, H = 32;

function blank() { return Array.from({ length: H }, () => new Array(W).fill('.')); }
function px(g, x, y, c) { if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = c; }
function rect(g, x0, y0, x1, y1, c) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(g, x, y, c);
}
function ellipse(g, cx, cy, rx, ry, c) {
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx, dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) px(g, x, y, c);
    }
  }
}
/** Trace a one-pixel outline around every run of non-'.' pixels. */
function outline(g, c = '0') {
  const src = g.map(r => r.slice());
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (src[y][x] !== '.') continue;
      let touch = false;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (src[ny][nx] !== '.' && src[ny][nx] !== c) touch = true;
      }
      if (touch) g[y][x] = c;
    }
  }
}
function eyes(g, xs, y, sclera, pupil, wide = 2) {
  for (const x of xs) {
    rect(g, x, y, x + wide, y + wide, sclera);
    px(g, x + 1, y + 1, pupil);
    if (wide > 2) px(g, x + 2, y + 1, pupil);
  }
}
function render(g) { return g.map(r => r.join('')).join('\n'); }

// ---------------------------------------------------------------------------
// GLUT — a swollen sewer slime
// ---------------------------------------------------------------------------
function glut(open) {
  const g = blank();
  ellipse(g, 16, 17, 13, 11, '7');
  ellipse(g, 16, 15, 11, 8, '9');
  ellipse(g, 16, 17, 13, 11, '7');
  // wobbling highlight
  ellipse(g, 11, 11, 3, 2, '9');
  // drips
  for (const x of [7, 13, 20, 26]) rect(g, x, 27, x + 1, open ? 30 : 29, '7');
  rect(g, 4, 24, 27, 27, '8');
  eyes(g, [10, 19], 12, '1', '0', 3);
  if (open) rect(g, 13, 20, 18, 23, '0');
  else rect(g, 13, 21, 18, 22, '8');
  outline(g);
  return render(g);
}

// ---------------------------------------------------------------------------
// THE WARDEN — a gaoler of bone and iron
// ---------------------------------------------------------------------------
function warden(swing) {
  const g = blank();
  rect(g, 8, 14, 23, 29, '4');       // robe
  rect(g, 6, 16, 25, 24, '4');
  rect(g, 10, 24, 21, 29, '3');
  rect(g, 11, 3, 20, 13, '1');       // skull
  rect(g, 12, 12, 19, 15, '1');
  rect(g, 9, 12, 22, 14, '2');       // collar
  eyes(g, [12, 17], 6, '0', 'd', 2);
  rect(g, 13, 10, 18, 11, '0');      // teeth
  for (const x of [14, 16, 18]) px(g, x, 10, '1');
  // shoulders
  rect(g, 5, 15, 8, 20, '3');
  rect(g, 23, 15, 26, 20, '3');
  // lantern, swinging between frames
  const lx = swing ? 3 : 27;
  rect(g, lx, 21, lx + 2, 25, 'g');
  px(g, lx + 1, 23, '1');
  rect(g, swing ? 5 : 26, 19, swing ? 6 : 27, 21, '2');
  outline(g);
  return render(g);
}

// ---------------------------------------------------------------------------
// THE ORE TYRANT — a mountain that got up
// ---------------------------------------------------------------------------
function tyrant(raised) {
  const g = blank();
  rect(g, 7, 8, 24, 27, 'V');        // torso
  rect(g, 5, 12, 26, 22, 'V');
  rect(g, 9, 3, 22, 9, 'V');         // head
  rect(g, 11, 5, 20, 8, 'X');
  eyes(g, [12, 17], 5, 'f', '0', 2);
  // glowing seams
  for (const [x, y] of [[10, 14], [11, 15], [12, 16], [19, 13], [20, 14], [21, 15], [15, 20], [16, 21]]) {
    px(g, x, y, 'f');
  }
  rect(g, 8, 17, 23, 19, 'X');
  // arms
  if (raised) { rect(g, 2, 6, 6, 18, 'V'); rect(g, 25, 6, 29, 18, 'V'); }
  else { rect(g, 2, 12, 6, 24, 'V'); rect(g, 25, 12, 29, 24, 'V'); }
  rect(g, 9, 27, 14, 30, 'X');       // legs
  rect(g, 17, 27, 22, 30, 'X');
  outline(g);
  return render(g);
}

// ---------------------------------------------------------------------------
// THE BURIED KING — crowned, armoured, furious
// ---------------------------------------------------------------------------
function king(strike) {
  const g = blank();
  rect(g, 6, 26, 25, 30, 'e');       // cloak hem
  rect(g, 8, 13, 23, 28, 'e');
  rect(g, 10, 14, 21, 26, '2');      // breastplate
  rect(g, 12, 17, 19, 22, 'g');
  rect(g, 11, 5, 20, 13, '5');       // face
  rect(g, 11, 10, 20, 13, '2');      // beard
  eyes(g, [12, 17], 7, '1', '0', 2);
  // crown
  rect(g, 9, 2, 22, 4, 'g');
  for (const x of [10, 13, 16, 19, 21]) rect(g, x, 0, x + 1, 2, 'g');
  // arms + weapon
  rect(g, 4, 15, 9, 24, '2');
  rect(g, 22, 15, 27, 24, '2');
  if (strike) { rect(g, 27, 2, 29, 16, '1'); rect(g, 26, 15, 30, 17, 'g'); }
  else { rect(g, 27, 10, 29, 24, '1'); rect(g, 26, 9, 30, 11, 'g'); }
  outline(g);
  return render(g);
}

// ---------------------------------------------------------------------------
// THE UNSLEEPING — an eye that fills the room
// ---------------------------------------------------------------------------
function unsleeping(narrow) {
  const g = blank();
  // tendrils first so the eye sits on top of them
  for (const [x0, y0, dx] of [[2, 6, 1], [4, 24, 1], [28, 6, -1], [26, 24, -1]]) {
    let x = x0, y = y0;
    for (let i = 0; i < 8; i++) {
      rect(g, x, y, x + 1, y + 1, 'j');
      x += dx * (i % 2 ? 1 : 2);
      y += (y0 < 16 ? -1 : 1) * (i % 3 === 0 ? 1 : 0);
    }
  }
  ellipse(g, 16, 16, 14, 13, 'e');
  ellipse(g, 16, 16, 12, 11, '1');
  ellipse(g, 16, 16, narrow ? 6 : 8, narrow ? 6 : 8, 'd');
  ellipse(g, 16, 16, narrow ? 2 : 4, narrow ? 3 : 5, '0');
  ellipse(g, 13, 12, 2, 2, '1');
  outline(g);
  return render(g);
}

// ---------------------------------------------------------------------------
const sprites = {
  BOSS_GLUT1: glut(false), BOSS_GLUT2: glut(true),
  BOSS_WARDEN1: warden(false), BOSS_WARDEN2: warden(true),
  BOSS_TYRANT1: tyrant(false), BOSS_TYRANT2: tyrant(true),
  BOSS_KING1: king(false), BOSS_KING2: king(true),
  BOSS_UNSLEEPING1: unsleeping(false), BOSS_UNSLEEPING2: unsleeping(true),
};

let out = `// The five chapter bosses, 32x32. Generated by scripts/gen-bosses.js from
// shape primitives — edit that script and re-run it rather than these rows.

`;
for (const [name, art] of Object.entries(sprites)) {
  const rows = art.split('\n');
  if (rows.length !== H) throw new Error(`${name}: ${rows.length} rows`);
  for (const r of rows) if (r.length !== W) throw new Error(`${name}: row width ${r.length}`);
  out += `export const ${name} = \`\n${art}\`;\n\n`;
}
writeFileSync(new URL('../client/art/bosses.js', import.meta.url), out);
console.log(`wrote ${Object.keys(sprites).length} boss sprites`);
