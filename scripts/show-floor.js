// Print a floor as ASCII so a layout can be judged at a glance.
//   node scripts/show-floor.js [depth] [seed]
import { generate } from '../shared/levelgen.js';
import { TT, LEVEL_W, LEVEL_H, idx, regionOf } from '../shared/terrain.js';

const depth = Number(process.argv[2] || 1);
const seed = Number(process.argv[3] || 1);
const lv = generate(depth, seed);

const CH = {
  [TT.WALL]: '#', [TT.WALL_DECO]: 'T', [TT.FLOOR]: '.', [TT.FLOOR_DECO]: ',',
  [TT.GRASS]: '"', [TT.HIGH_GRASS]: '%', [TT.WATER]: '~', [TT.CHASM]: ' ',
  [TT.DOOR]: '+', [TT.OPEN_DOOR]: '/', [TT.LOCKED_DOOR]: 'L', [TT.BARRICADE]: '=',
  [TT.ENTRANCE]: '<', [TT.EXIT]: '>', [TT.LOCKED_EXIT]: 'X', [TT.EMBERS]: '*',
  [TT.TRAP_HIDDEN]: '.', [TT.TRAP]: '^', [TT.TRAP_SPENT]: '.', [TT.STATUE]: 'I',
  [TT.BOOKSHELF]: 'B', [TT.PEDESTAL]: 'P', [TT.WELL]: 'O', [TT.SIGN]: '!',
  [TT.RUBBLE]: ':',
};

const r = regionOf(depth);
console.log(`\ndepth ${depth} — ${r.name}${lv.boss ? '  (BOSS)' : ''}   seed ${seed}`);
console.log(`${lv.rooms.length} rooms, ${lv.openTiles} open tiles, ${lv.spawnPoints.length} spawn spots` +
  (lv.vaultRoom !== null ? ', locked vault' : ''));
console.log('-'.repeat(LEVEL_W));
for (let y = 0; y < LEVEL_H; y++) {
  let row = '';
  for (let x = 0; x < LEVEL_W; x++) row += CH[lv.tiles[idx(x, y)]] ?? '?';
  console.log(row);
}
console.log('-'.repeat(LEVEL_W));
console.log('< stairs up   > stairs down   + door   L locked   ~ water   % high grass   I statue   B shelf   P pedestal   O well   (blank) chasm');
