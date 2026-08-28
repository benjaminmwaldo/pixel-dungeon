// Secret doors, mimics, chasm leaps, and how a floor feels when you arrive.
import { Game } from '../shared/game.js';
import { generate } from '../shared/levelgen.js';
import { TT, LEVEL_LEN, idx, tx, ty } from '../shared/terrain.js';
import { KIND, PLAYER_BOX, DX, DY } from '../shared/constants.js';
import { tileUnder } from '../shared/physics.js';
import { ITEM } from '../shared/items.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

function fresh(code = 'SECR', depth = 1) {
  const g = new Game(code);
  const p = g.addPlayer(1, 'BEN');
  g.begin();
  const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
  idle(4);
  while (p.depth < depth) { g.descend(p, true); idle(4); }
  idle(8);
  return { g, p, f: g.floor(p.depth), idle };
}

// --- secret doors get built, and never seal anything important --------------
let withSecrets = 0, stranded = 0;
for (let seed = 1; seed <= 40; seed++) {
  for (const d of [2, 5, 9, 14, 22]) {
    const lv = generate(d, seed);
    const secrets = lv.secrets || [];
    if (secrets.length) withSecrets++;
    for (const i of secrets) {
      if (lv.tiles[i] !== TT.SECRET_DOOR) { stranded++; continue; }
    }
    // the stairs must still be reachable with every secret door treated as wall
    const walled = lv.tiles.slice();
    for (const i of secrets) walled[i] = TT.WALL;
    if (!reaches(walled, lv.entrance, lv.exit)) stranded++;
  }
}
check('floors hide doors', withSecrets > 40, `${withSecrets}/200 floors`);
check('but never the way down', stranded === 0, `${stranded} bad floors`);

function reaches(tiles, from, to) {
  const seen = new Uint8Array(LEVEL_LEN);
  const q = [from];
  seen[from] = 1;
  const open = (t) => t !== TT.WALL && t !== TT.WALL_DECO && t !== TT.STATUE &&
                      t !== TT.BOOKSHELF && t !== TT.CHASM;
  while (q.length) {
    const i = q.pop();
    if (i === to) return true;
    const x = tx(i), y = ty(i);
    for (let d = 0; d < 4; d++) {
      const nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx > 31 || ny > 31) continue;
      const j = idx(nx, ny);
      if (seen[j] || !open(tiles[j])) continue;
      seen[j] = 1;
      q.push(j);
    }
  }
  return false;
}

// --- searching finds one ----------------------------------------------------
{
  const { g, p, f, idle } = fresh('SRCH');
  // put a secret door right beside the hero
  const here = tileUnder(p, PLAYER_BOX);
  const beside = idx(tx(here) + 1, ty(here));
  f.set(beside, TT.SECRET_DOOR);
  g.searchAround(p, f, here, 1);
  check('standing still turns a wall into a door', f.tiles[beside] === TT.DOOR);
}

// --- mimics -----------------------------------------------------------------
{
  const { g, p, f, idle } = fresh('MIMC', 6);
  const loot = f.ents.find(e => e.kind === KIND.ITEM && !e.price);
  loot.mimic = true;
  loot.item = { type: ITEM.POTION, kind: 'healing' };
  p.x = loot.x; p.y = loot.y;
  p.invuln = 0;
  // anything else lying on the same tile would land in the pack and muddy this
  for (const e of f.ents) {
    if (e === loot || e.kind !== KIND.ITEM) continue;
    if (Math.abs(e.x - loot.x) < 14 && Math.abs(e.y - loot.y) < 14) e.dead = true;
  }
  const bagBefore = p.bag.filter(Boolean).length;
  g.pickups(p, f);
  check('reaching for a mimic does not fill your pack',
    p.bag.filter(Boolean).length === bagBefore);
  check('it was never loot', loot.dead);
  const mimic = f.ents.find(e => e.kind === KIND.MIMIC && !e.dead);
  check('and something is standing where it was', !!mimic);
  check('holding onto what you came for', mimic?.hoard?.type === ITEM.POTION);

  // kill it and the loot comes back
  const at = f.ents.length;
  mimic.hp = 1;
  g.hurtMob(mimic, 50, 0, f, p);
  idle(3);
  check('killing it gives the loot back',
    f.ents.some(e => e.kind === KIND.ITEM && e.item?.type === ITEM.POTION && !e.dead));
}

// --- leaping into a chasm ---------------------------------------------------
{
  const { g, p, f } = fresh('LEAP');
  const here = tileUnder(p, PLAYER_BOX);
  f.set(idx(tx(here) + 1, ty(here)), TT.CHASM);
  p.invuln = 0;
  const hp = p.hp;
  check('the game notices the edge', g.chasmBeside(f, here));
  g.interact(p);
  check('and E takes you over it', p.depth === 2, `floor ${p.depth}`);
  check('at a cost', p.hp < hp, `${hp} -> ${p.hp}`);
}

// --- level feelings ---------------------------------------------------------
{
  const seen = new Set();
  for (const code of ['FEEA', 'FEEB', 'FEEC', 'FEED', 'FEEE', 'FEEF']) {
    const g = new Game(code);
    const p = g.addPlayer(1, 'BEN');
    g.begin();
    const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
    idle(4);
    for (let d = 2; d <= 20; d++) {
      g.descend(p, true);
      idle(4);
      seen.add(g.floor(p.depth).feeling);
    }
  }
  check('floors come with a character',
    seen.has('dangerous') && seen.has('treasure') && seen.has('trapped') && seen.has('dark'),
    [...seen].join(','));
  check('and most of them are ordinary', seen.has('none'));
}

// --- a dark floor really is darker ------------------------------------------
// Two traps here: a floor may have rolled 'dark' on its own, so the baseline
// has to be forced; and in a tight corridor the walls bound the view before
// the radius does, so open the ground around the hero first.
{
  const { g, p, f } = fresh('DARK', 4);
  const here = tileUnder(p, PLAYER_BOX);
  const cx = tx(here), cy = ty(here);
  for (let y = cy - 10; y <= cy + 10; y++) {
    for (let x = cx - 10; x <= cx + 10; x++) {
      if (x < 1 || y < 1 || x > 30 || y > 30) continue;
      f.set(idx(x, y), TT.FLOOR);
    }
  }
  const lit = () => {
    p.fovTile = -1;
    g.refreshFov(p);
    let n = 0;
    for (let i = 0; i < p.fov.length; i++) n += p.fov[i];
    return n;
  };
  f.feeling = 'none';
  const normal = lit();
  f.feeling = 'dark';
  const dim = lit();
  check('you see less on a dark floor', dim < normal, `${normal} -> ${dim} tiles`);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall secret checks passed');
process.exit(fails ? 1 : 0);
