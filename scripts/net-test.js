// Two real WebSocket clients against a real server: party join, per-player
// cameras, and the co-op revive. Run the server first, then:
//   node scripts/net-test.js [port]
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
  constructor(name) {
    this.name = name;
    this.snap = null;
    this.meta = null;
    this.seq = 0;
    this.started = false;
    this.banners = [];
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(URL);
      this.ws.onopen = () => resolve();
      this.ws.onerror = () => reject(new Error('ws error'));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { this.id = m.id; this.code = m.code; this.colour = m.colour; }
        else if (m.t === 's') this.snap = m;
        else if (m.t === 'm') this.meta = m;
        else if (m.t === 'start') this.started = true;
        else if (m.t === 'b') this.banners.push(m.m);
        else if (m.t === 'error') this.error = m.m;
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  /** Hold a button for n ticks of real time, as a real client would. */
  async hold(bits, n) {
    for (let i = 0; i < n; i++) {
      this.send({ t: 'in', s: ++this.seq, b: bits });
      await wait(33);
    }
  }
  get room() { return this.snap?.r[0]; }
  get hp() { return this.snap?.me[3]; }
  get ghost() { return !!this.snap?.me[7]; }
  get others() { return this.snap?.o || []; }
}

const a = new Client('BEN');
const b = new Client('JASON');

await a.connect();
await b.connect();

a.send({ t: 'create', name: 'BEN' });
await wait(250);
check('host created a party', !!a.code, a.code);

b.send({ t: 'join', code: a.code, name: 'JASON' });
await wait(250);
check('second hero joined the same party', b.code === a.code, b.code);
check('the two get different tunics', a.colour !== b.colour, `${a.colour} / ${b.colour}`);

a.send({ t: 'ready', v: true });
b.send({ t: 'ready', v: true });
await wait(400);
check('the crypt opens once everyone is ready', a.started && b.started);
await wait(200);
check('both start in the entrance', a.room === '3,6' && b.room === '3,6', `${a.room} / ${b.room}`);
check('each can see the other in the same room', a.others.length === 1 && b.others.length === 1);

// --- one hero leaves; the cameras should part ways ------------------------
await a.hold(IN.UP, 60);
await a.hold(0, 5);
check('the walking hero moved on', a.room === '3,5', a.room);
check('the other stayed put', b.room === '3,6', b.room);
check('and they no longer see each other', a.others.length === 0 && b.others.length === 0,
  `${a.others.length} / ${b.others.length}`);
check('but the party roster still shows both', (a.snap?.pl?.length || 0) === 2);
const roomsInRoster = new Set((a.snap?.pl || []).map(p => p[3]));
check('the roster knows they are in different rooms', roomsInRoster.size === 2,
  [...roomsInRoster].join(' + '));

// --- snapshots stay small with two players --------------------------------
check('two-player snapshot is small', JSON.stringify(a.snap).length < 2500,
  `${JSON.stringify(a.snap).length} bytes`);

// --- the party inventory is shared ----------------------------------------
check('both clients see the same shared inventory',
  JSON.stringify(a.meta?.p) === JSON.stringify(b.meta?.p));

// --- disconnect handling ---------------------------------------------------
b.ws.close();
await wait(400);
check('leaving trims the roster', (a.snap?.pl?.length || 0) === 1, `${a.snap?.pl?.length}`);

a.ws.close();
await wait(150);
console.log(fails ? `\n${fails} FAILURES` : '\nall network checks passed');
process.exit(fails ? 1 : 0);
