// Assembles the static site GitHub Pages serves.
//
// There is no bundler and nothing to compile — the game is plain ES modules —
// so "building" means copying the client and the shared simulation next to an
// index.html at the root, with every path relative so it works whether the
// site lives at / or at /pixel-dungeon/.
//
//   node scripts/build-pages.js [outDir]

import { cp, mkdir, rm, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, process.argv[2] || 'dist');

async function bytes(dir) {
  let total = 0, files = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await bytes(p);
      total += sub.total; files += sub.files;
    } else {
      total += (await stat(p)).size; files++;
    }
  }
  return { total, files };
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await cp(join(ROOT, 'client'), join(OUT, 'client'), { recursive: true });
await cp(join(ROOT, 'shared'), join(OUT, 'shared'), { recursive: true });

// index.html moves to the root; it already refers to ./client/... relatively
await cp(join(ROOT, 'client', 'index.html'), join(OUT, 'index.html'));

// Pages would otherwise run the upload through Jekyll and eat directories
await writeFile(join(OUT, '.nojekyll'), '');

// a 404 that is just the game, so a stale deep link still lands somewhere sane
await cp(join(OUT, 'index.html'), join(OUT, '404.html'));

const { total, files } = await bytes(OUT);
console.log(`built ${OUT}`);
console.log(`${files} files, ${(total / 1024).toFixed(0)} KB`);
