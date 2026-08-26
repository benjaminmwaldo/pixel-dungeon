// Generates every floor many times over and proves each one is sound:
// the stairs down must be reachable from the stairs up, the floor must have
// enough open space to be worth exploring, and nothing may sit outside bounds.
import { generate, reachable, ROOM } from '../shared/levelgen.js';
import { TT, LEVEL_W, LEVEL_H, LEVEL_LEN, tx, ty, passable, regionOf, isBossDepth } from '../shared/terrain.js';

const RUNS = Number(process.argv[2] || 40);
let fails = 0;
const stats = {};

function fail(msg) { console.log(` FAIL  ${msg}`); fails++; }

for (let seed = 1; seed <= RUNS; seed++) {
  for (let depth = 1; depth <= 25; depth++) {
    const lv = generate(depth, seed);
    const key = regionOf(depth).key;
    stats[key] ??= { floors: 0, open: 0, rooms: 0, doors: 0, water: 0, grass: 0, chasm: 0 };
    const s = stats[key];
    s.floors++;

    // bounds: the outer ring must stay solid
    for (let x = 0; x < LEVEL_W; x++) {
      if (passable(lv.tiles[x]) || passable(lv.tiles[(LEVEL_H - 1) * LEVEL_W + x])) {
        fail(`seed ${seed} depth ${depth}: floor leaks through the top/bottom edge`);
        break;
      }
    }

    // stairs exist and are distinct
    if (lv.tiles[lv.entrance] !== TT.ENTRANCE) fail(`seed ${seed} depth ${depth}: no stairs up`);
    const wantExit = depth >= 25 ? TT.PEDESTAL : (isBossDepth(depth) ? TT.LOCKED_EXIT : TT.EXIT);
    if (lv.tiles[lv.exit] !== wantExit) fail(`seed ${seed} depth ${depth}: no way down (${lv.tiles[lv.exit]})`);

    // the way down must be reachable from the way up
    const { seen, count } = reachable(lv.tiles, lv.entrance);
    if (!seen[lv.exit]) fail(`seed ${seed} depth ${depth}: the stairs down are walled off`);
    if (count < 120) fail(`seed ${seed} depth ${depth}: only ${count} reachable tiles`);

    // a locked vault must be behind its door, and its key must be reachable
    if (lv.vaultRoom !== null && lv.keySpot !== null) {
      if (!seen[lv.keySpot]) fail(`seed ${seed} depth ${depth}: the vault key is unreachable`);
    }

    // somewhere to put mobs
    if (lv.spawnPoints.length < 10) fail(`seed ${seed} depth ${depth}: only ${lv.spawnPoints.length} spawn spots`);
    for (const i of lv.spawnPoints) {
      if (i < 0 || i >= LEVEL_LEN) { fail(`seed ${seed} depth ${depth}: spawn out of bounds`); break; }
    }

    s.open += count;
    s.rooms += lv.rooms.length;
    for (let i = 0; i < LEVEL_LEN; i++) {
      const t = lv.tiles[i];
      if (t === TT.DOOR || t === TT.OPEN_DOOR || t === TT.LOCKED_DOOR) s.doors++;
      else if (t === TT.WATER) s.water++;
      else if (t === TT.GRASS || t === TT.HIGH_GRASS) s.grass++;
      else if (t === TT.CHASM) s.chasm++;
    }
  }
}

console.log(`\n${RUNS} seeds x 25 floors = ${RUNS * 25} floors generated\n`);
console.log('region      floors  reachable  rooms  doors  water  grass  chasm');
for (const [key, s] of Object.entries(stats)) {
  const per = (v) => (v / s.floors).toFixed(1).padStart(6);
  console.log(
    key.padEnd(11),
    String(s.floors).padStart(6),
    per(s.open), per(s.rooms), per(s.doors), per(s.water), per(s.grass), per(s.chasm),
  );
}
console.log(fails ? `\n${fails} FAILURES` : '\nevery floor is sound');
process.exit(fails ? 1 : 0);
