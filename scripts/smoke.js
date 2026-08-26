// Headless checks on the real simulation: can a hero walk the dungeon, fight,
// take damage, open a shutter, and reach the boss door?
import { Game } from '../server/game.js';
import { IN, KIND, DOOR, N, E, S, W } from '../shared/constants.js';
import { DS } from '../shared/physics.js';

const g = new Game('TEST');
const p = g.addPlayer(1, 'BEN');
g.begin();

const hold = (bits, n) => { for (let i = 0; i < n; i++) { p.input = bits; g.step(); g.clearFx(); } };
const tap = (bits) => { p.input = bits; g.step(); p.input = 0; g.step(); g.clearFx(); };

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}

// --- walk north out of the entrance ---------------------------------------
hold(IN.UP, 80);
check('walked into the antechamber', p.room === '3,5', `room=${p.room}`);

// --- there should be enemies here, and they should move -------------------
const room = g.room('3,5');
const before = room.ents.filter(e => e.kind === KIND.SLIME).map(e => `${e.x},${e.y}`).join('|');
hold(0, 40);
const after = room.ents.filter(e => e.kind === KIND.SLIME).map(e => `${e.x},${e.y}`).join('|');
check('slimes are alive and moving', room.ents.length > 0 && before !== after,
  `${room.ents.length} entities`);

// --- the north door of the antechamber starts barred ----------------------
check('shutter starts closed', room.doorState()[N] === DS.BARRED);

// --- kill everything in the room ------------------------------------------
for (let i = 0; i < 900 && room.ents.some(e => e.kind === KIND.SLIME || e.kind === KIND.SLIMELET); i++) {
  const t = room.ents.find(e => e.kind === KIND.SLIME || e.kind === KIND.SLIMELET);
  if (t) {
    // stay inside the room: teleporting onto a doorway would scroll us out
    p.room = '3,5'; p.trans = 0; p.ghost = false;
    p.x = Math.max(32, Math.min(200, t.x));
    p.y = Math.max(36, Math.min(128, t.y + 14));
    p.dir = N; p.invuln = 60;
  }
  tap(IN.A);
}
check('room cleared by the sword', room.cleared, `left=${room.ents.length}`);
check('shutter opened on clear', room.doorState()[N] === DS.OPEN);

// --- the hero can take a hit ----------------------------------------------
p.invuln = 0;
const hp0 = p.hp;
g.hurtPlayer(p, 2, p.x + 20, p.y);
check('taking damage costs hearts', p.hp === hp0 - 2, `${hp0} -> ${p.hp}`);
check('and grants mercy frames', p.invuln > 0);

// --- locked door needs a key ----------------------------------------------
p.room = '2,5'; p.x = 24; p.y = 80; p.dir = W; p.trans = 0;
g.step();
check('locked door stays shut with no key', g.room('2,5').doorState()[W] === DS.BARRED);
g.party.keys = 1;
hold(IN.LEFT, 12);
check('locked door opens with a key', g.room('2,5').doorState()[W] === DS.OPEN);
check('the key was spent', g.party.keys === 0);

// --- bombs blow open a cracked wall ---------------------------------------
p.room = '5,4'; p.x = 40; p.y = 80; p.dir = W; p.trans = 0; p.prev = 0;
g.step();
g.room('5,4').ents.length = 0;   // clear the hurlers so only the bomb is in play
g.party.bombs = 5;
p.sel = 'bomb';
tap(IN.B);
hold(0, 80);
check('bomb opened the cracked wall', g.room('5,4').doorState()[W] === DS.OPEN);

// --- bombs must not hurt the hero who set them ----------------------------
check('own bomb left the hero unharmed', p.hp === hp0 - 2, `hp=${p.hp}`);

// --- the boss room --------------------------------------------------------
p.hp = p.maxHp;
p.room = '3,1'; p.x = 32; p.y = 140; p.trans = 0;   // out of the wyrm's lane
g.step();
const boss = g.room('3,1').ents.find(e => e.kind === KIND.WYRM);
check('the wyrm is waiting', !!boss, boss ? `hp=${boss.hp}` : '');
let breathed = 0;
for (let i = 0; i < 260; i++) {
  p.input = 0; p.invuln = 60; g.step(); g.clearFx();
  if (g.room('3,1').ents.some(e => e.kind === KIND.FIREBALL)) breathed++;
}
check('the wyrm breathes fire', breathed > 0, `${breathed} ticks with fire in the air`);

// --- snapshot size --------------------------------------------------------
const snap = JSON.stringify(g.snapshotFor(p));
check('snapshot stays small', snap.length < 2000, `${snap.length} bytes`);

// --- every room is reachable through its declared doors -------------------
import('../shared/dungeon.js').then(({ ROOMS, ROOM_BY_ID, START_ROOM }) => {
  const seen = new Set([START_ROOM]);
  const queue = [START_ROOM];
  while (queue.length) {
    const def = ROOM_BY_ID.get(queue.shift());
    for (let d = 0; d < 4; d++) {
      if (def.doors[d] === DOOR.NONE) continue;
      const dx = [0, 1, 0, -1][d], dy = [-1, 0, 1, 0][d];
      const id = `${def.gx + dx},${def.gy + dy}`;
      if (ROOM_BY_ID.has(id) && !seen.has(id)) { seen.add(id); queue.push(id); }
    }
  }
  check('every room is reachable', seen.size === ROOMS.length, `${seen.size}/${ROOMS.length}`);
  console.log(fails ? `\n${fails} FAILURES` : '\nall checks passed');
  process.exit(fails ? 1 : 0);
});
