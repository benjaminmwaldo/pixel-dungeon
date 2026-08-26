// Two real WebSocket clients against a real server: party join, class picking,
// per-player floors, shared exploration, and clean disconnect. Run the server
// first, then:  node scripts/net-test.js [port]
import { IN } from '../shared/constants.js';

const PORT = process.argv[2] || 5179;
const URL = `ws://127.0.0.1:${PORT}`;

let fails = 0;
function check(label, cond, extra = '') {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${label}${extra ? '  ' + extra : ''}`);
  if (!cond) fails++;
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.snap = null; this.meta = null; this.floor = null; this.seq = 0; this.started = false; }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('ws error'));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { this.id = m.id; this.code = m.code; this.cls = m.cls; }
        else if (m.t === 's') this.snap = m;
        else if (m.t === 'm') this.meta = m;
        else if (m.t === 'floor') this.floor = m;
        else if (m.t === 'start') this.started = true;
        else if (m.t === 'error') this.error = m.m;
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  async hold(bits, n) {
    for (let i = 0; i < n; i++) { this.send({ t: 'in', s: ++this.seq, b: bits }); await wait(33); }
  }
  get depth() { return this.snap?.d; }
  get hp() { return this.snap?.me[4]; }
  get others() { return this.snap?.o || []; }
}

const a = new Client('BEN');
const b = new Client('JASON');
await a.connect();
await b.connect();

a.send({ t: 'create', name: 'BEN', cls: 'warrior' });
await wait(250);
check('host created a party', !!a.code, a.code);

b.send({ t: 'join', code: a.code, name: 'JASON', cls: 'mage' });
await wait(250);
check('second hero joined the same party', b.code === a.code, b.code);
check('each got the class they asked for', a.cls === 'warrior' && b.cls === 'mage',
  `${a.cls} / ${b.cls}`);

b.send({ t: 'class', cls: 'warrior' });
await wait(200);
check('a class already taken is refused', b.cls === 'mage');

a.send({ t: 'ready', v: true });
b.send({ t: 'ready', v: true });
await wait(500);
check('the dungeon opens once everyone is ready', a.started && b.started);
await wait(300);

check('both start on floor 1', a.depth === 1 && b.depth === 1, `${a.depth} / ${b.depth}`);
check('each client was sent the floor map', !!a.floor && !!b.floor);
check('the map is a real 32x32 floor',
  a.floor && Buffer.from(a.floor.tiles, 'base64').length === 1024,
  a.floor ? `${Buffer.from(a.floor.tiles, 'base64').length} bytes` : '');
check('the party roster carries both heroes', (a.snap?.pl?.length || 0) === 2);

// --- fog: you are only sent what you can see ------------------------------
const seenByA = a.snap.e.length;
check('the snapshot only carries what is in sight', seenByA < 8, `${seenByA} entities`);
check('a two-player snapshot stays small', JSON.stringify(a.snap).length < 3000,
  `${JSON.stringify(a.snap).length} bytes`);

// --- the shared inventory / identification state --------------------------
check('both clients see the same appearances',
  JSON.stringify(a.meta?.app) === JSON.stringify(b.meta?.app));
check('nothing is identified at the start', (a.meta?.known.potions.length || 0) === 0);

// --- moving about ---------------------------------------------------------
const before = `${a.snap.me[0]},${a.snap.me[1]}`;
await a.hold(IN.RIGHT, 25);
await a.hold(IN.DOWN, 25);
await a.hold(0, 5);
const after = `${a.snap.me[0]},${a.snap.me[1]}`;
check('a hero can walk', before !== after, `${before} -> ${after}`);
check('the other hero stayed put', b.depth === 1);

// --- disconnect -----------------------------------------------------------
b.ws.close();
await wait(500);
check('leaving trims the roster', (a.snap?.pl?.length || 0) === 1, `${a.snap?.pl?.length}`);

a.ws.close();
await wait(150);
console.log(fails ? `\n${fails} FAILURES` : '\nall network checks passed');
process.exit(fails ? 1 : 0);
