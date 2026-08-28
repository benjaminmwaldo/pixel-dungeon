// Shops, and the other special rooms. Does gold finally buy anything?
import { Game } from '../shared/game.js';
import { generate, ROOM, shopDepth } from '../shared/levelgen.js';
import { TT } from '../shared/terrain.js';
import { KIND, PLAYER_BOX } from '../shared/constants.js';
import { tileUnder } from '../shared/physics.js';
import { ITEM, buyPrice, sellPrice, itemValue } from '../shared/items.js';

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- prices -----------------------------------------------------------------
check('a shopkeeper sells dearer than he buys',
  buyPrice({ type: ITEM.FOOD }) > sellPrice({ type: ITEM.FOOD }));
check('better gear costs more',
  itemValue({ type: ITEM.WEAPON, tier: 4 }) > itemValue({ type: ITEM.WEAPON, tier: 1 }));
check('and upgrades count',
  itemValue({ type: ITEM.WEAPON, tier: 2, upgrade: 3 }) >
  itemValue({ type: ITEM.WEAPON, tier: 2, upgrade: 0 }));
check('nothing is ever free', buyPrice({ type: ITEM.FOOD }) >= 10);

// --- where the shops are ----------------------------------------------------
let shops = 0, misplaced = 0;
for (let seed = 1; seed <= 30; seed++) {
  for (let d = 1; d <= 25; d++) {
    const lv = generate(d, seed);
    if (lv.shopRoom !== null && lv.shopRoom !== undefined) {
      shops++;
      if (!shopDepth(d)) misplaced++;
    }
  }
}
check('shops turn up where a chapter begins', shops > 90, `${shops} in 30 runs`);
check('and nowhere else', misplaced === 0);

// --- special rooms get built ------------------------------------------------
const seen = new Set();
for (let seed = 1; seed <= 40; seed++) {
  for (const d of [2, 4, 8, 13, 19, 23]) {
    for (const r of generate(d, seed).rooms) if (r.type !== ROOM.TUNNEL) seen.add(r.type);
  }
}
const wanted = [ROOM.ARMORY, ROOM.CRYPT, ROOM.POOL, ROOM.TRAP_ROOM,
                ROOM.STORAGE, ROOM.LABORATORY, ROOM.WEAK_FLOOR];
check('every new special room gets built somewhere',
  wanted.every(w => seen.has(w)),
  wanted.filter(w => !seen.has(w)).join(',') || `${seen.size} kinds seen`);

// --- a live shop ------------------------------------------------------------
// Not every layout leaves a room big enough, so take the first party code that
// lands on one.
function descendToShop() {
  for (const code of ['SHOP', 'SHPA', 'SHPB', 'SHPC', 'SHPD', 'SHPE', 'SHPF', 'SHPG']) {
    const g = new Game(code);
    const p = g.addPlayer(1, 'BEN');
    g.begin();
    const idle = (n) => { for (let i = 0; i < n; i++) { g.step(); g.clearTransient(); } };
    idle(4);
    while (p.depth < 6) { g.descend(p, true); idle(3); }
    idle(10);
    const f = g.floor(6);
    if (f.level.shopRoom !== null && f.level.shopRoom !== undefined) return { g, p, f };
  }
  return null;
}

const found = descendToShop();
check('a sixth floor with a shop turns up', !!found);
if (!found) { console.log('no shop floor in eight runs'); process.exit(1); }
const { g, p, f } = found;

const goods = f.ents.filter(e => e.kind === KIND.ITEM && e.price);
check('with stock on the shelves', goods.length >= 6, `${goods.length} items`);
check('and a shopkeeper behind them', f.ents.some(e => e.kind === KIND.SHOPKEEPER));
check('everything priced is inside the shop room',
  goods.every(e => g.inShop(f, tileUnder(e, e.box))));

// --- buying -----------------------------------------------------------------
const good = goods[0];
p.x = good.x; p.y = good.y;
p.gold = 0;
g.interact(p);
check('you cannot buy what you cannot afford', !good.dead && p.gold === 0);

p.gold = good.price + 50;
g.interact(p);
check('with gold in hand the sale goes through', good.dead, `paid ${good.price}`);
check('and the gold actually leaves your purse', p.gold === 50, `${p.gold} left`);

// --- walking over stock is not shoplifting ----------------------------------
const other = f.ents.find(e => e.kind === KIND.ITEM && e.price && !e.dead);
p.x = other.x; p.y = other.y;
p.gold = 0;
g.pickups(p, f);
check('walking over the stock does not take it', !other.dead && p.gold === 0);

// --- selling ----------------------------------------------------------------
const loose = () => f.ents.filter(e => !e.dead && e.kind === KIND.ITEM && !e.price).length;
p.bag[0] = { key: 'food', item: { type: ITEM.FOOD }, count: 1 };
const purse = p.gold, littered = loose();
g.dropSlot(p, 0);
check('and you can sell into the shop', p.gold > purse, `+${p.gold - purse} gold`);
check('the sold item does not also land on the floor', loose() === littered);
check('the bag slot empties', !p.bag[0]);

// --- robbery ----------------------------------------------------------------
const keeper = f.ents.find(e => e.kind === KIND.SHOPKEEPER && !e.dead);
g.hurtMob(keeper, 5, 0, f, p);
check('hit the shopkeeper and he leaves', keeper.dead);
check('taking the stock with him',
  !f.ents.some(e => !e.dead && e.kind === KIND.ITEM && e.price));

// --- weak floors ------------------------------------------------------------
{
  const g2 = new Game('WEAK');
  const q = g2.addPlayer(1, 'BEN');
  g2.begin();
  for (let i = 0; i < 4; i++) { g2.step(); g2.clearTransient(); }
  const fl = g2.floor(1);
  const here = tileUnder(q, PLAYER_BOX);
  fl.set(here, TT.CRACKED);
  q.invuln = 0;
  g2.underfoot(q, fl);
  check('a cracked floor drops you to the next one', q.depth === 2, `floor ${q.depth}`);
  check('and leaves a hole behind', fl.tiles[here] === TT.CHASM);
}

console.log(fails ? `\n${fails} FAILURES` : '\nall shop checks passed');
process.exit(fails ? 1 : 0);
