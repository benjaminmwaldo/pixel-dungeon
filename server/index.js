// One process: serves the client over HTTP and runs the authoritative game
// over WebSocket. No dependencies — `node server/index.js` and you're playing.

import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachWebSocket } from './ws.js';
import { Game } from './game.js';
import { TICK_MS, MAX_PLAYERS, IN } from '../shared/constants.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || argValue('--port') || 8080);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

// ---------------------------------------------------------------------------
// Static files
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

const ALLOWED_DIRS = ['client', 'shared'];

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/' || path === '/index.html') path = '/client/index.html';
  if (path.startsWith('/client/') === false && path.startsWith('/shared/') === false) {
    path = '/client' + path;
  }

  const rel = normalize(path).replace(/^([/\\])+/, '');
  const top = rel.split(/[/\\]/)[0];
  if (!ALLOWED_DIRS.includes(top) || rel.includes('..')) {
    res.writeHead(403).end('forbidden');
    return;
  }

  const file = join(ROOT, rel);
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('not a file');
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'Content-Length': body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
}

const DEV = process.argv.includes('--dev');

const server = createServer((req, res) => {
  // Dev-only: lets a local browser hand a canvas capture back to disk so the
  // art can be reviewed without a screenshot pipeline. Off unless --dev.
  if (DEV && req.method === 'POST' && req.url === '/__shot') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
    req.on('end', async () => {
      try {
        const b64 = body.replace(/^data:image\/png;base64,/, '');
        await writeFile(join(ROOT, 'docs', 'shot.png'), Buffer.from(b64, 'base64'));
        res.writeHead(200).end('ok');
      } catch (e) { res.writeHead(500).end(String(e)); }
    });
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, games: games.size, players: totalPlayers() }));
    return;
  }
  serveStatic(req, res).catch(() => { try { res.writeHead(500).end(); } catch {} });
});

// ---------------------------------------------------------------------------
// Party rooms
// ---------------------------------------------------------------------------
const games = new Map();      // code -> Game
const clients = new Map();    // conn -> { id, code, name }
let idSeq = 1;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no lookalikes

function newCode() {
  for (let attempt = 0; attempt < 200; attempt++) {
    let c = '';
    for (let i = 0; i < 4; i++) c += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0];
    if (!games.has(c)) return c;
  }
  return 'AAAA' + games.size;
}

function totalPlayers() {
  let n = 0;
  for (const g of games.values()) n += g.players.size;
  return n;
}

function lobbyPayload(game) {
  return {
    t: 'lobby',
    code: game.code,
    state: game.state,
    players: [...game.players.values()].map(p => ({
      id: p.id, name: p.name, colour: p.colour, ready: p.ready,
    })),
  };
}

function broadcast(game, obj) {
  const str = JSON.stringify(obj);
  for (const [conn, c] of clients) {
    if (c.code === game.code) conn.send(str);
  }
}

function connFor(game, playerId) {
  for (const [conn, c] of clients) {
    if (c.code === game.code && c.id === playerId) return conn;
  }
  return null;
}

attachWebSocket(server, (conn) => {
  const client = { id: idSeq++, code: null, name: 'HERO', lastPing: Date.now() };
  clients.set(conn, client);

  conn.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    handle(conn, client, msg);
  });

  conn.on('close', () => {
    const game = client.code && games.get(client.code);
    clients.delete(conn);
    if (game) {
      game.removePlayer(client.id);
      if (game.players.size === 0) {
        games.delete(game.code);
      } else {
        broadcast(game, lobbyPayload(game));
        broadcast(game, { t: 'note', m: `${client.name} LEFT` });
      }
    }
  });
});

function handle(conn, client, msg) {
  switch (msg.t) {
    case 'create': {
      const code = newCode();
      const game = new Game(code);
      games.set(code, game);
      joinGame(conn, client, game, msg.name);
      break;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const game = games.get(code);
      if (!game) { conn.sendJson({ t: 'error', m: 'NO SUCH PARTY' }); return; }
      if (game.players.size >= MAX_PLAYERS) { conn.sendJson({ t: 'error', m: 'PARTY IS FULL' }); return; }
      joinGame(conn, client, game, msg.name);
      break;
    }
    case 'ready': {
      const game = games.get(client.code);
      if (!game) return;
      const p = game.players.get(client.id);
      if (!p) return;
      p.ready = !!msg.v;
      broadcast(game, lobbyPayload(game));
      const all = [...game.players.values()];
      if (game.state === 'lobby' && all.length > 0 && all.every(x => x.ready)) {
        game.begin();
        broadcast(game, { t: 'start' });
      }
      break;
    }
    case 'in': {
      const game = games.get(client.code);
      if (!game) return;
      const p = game.players.get(client.id);
      if (!p) return;
      // Queue every frame the client sends. Sampling only the newest would
      // drop a sword swing that was held for a single tick.
      const bits = (msg.b | 0) & (IN.UP | IN.RIGHT | IN.DOWN | IN.LEFT | IN.A | IN.B);
      p.queue.push({ seq: msg.s | 0, bits });
      if (p.queue.length > 12) p.queue.splice(0, p.queue.length - 12);
      game.lastActivity = Date.now();
      break;
    }
    case 'cycle': {
      const game = games.get(client.code);
      const p = game?.players.get(client.id);
      if (p) { game.cycleItem(p); game.metaDirty = true; }
      break;
    }
    case 'again': {
      const game = games.get(client.code);
      if (!game) return;
      if (game.state === 'win' || game.state === 'over') {
        game.restart();
        broadcast(game, { t: 'start' });
      }
      break;
    }
    case 'ping':
      conn.sendJson({ t: 'pong', c: msg.c });
      break;
  }
}

function joinGame(conn, client, game, name) {
  const clean = String(name || 'HERO').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 8) || 'HERO';
  const p = game.addPlayer(client.id, clean);
  if (!p) { conn.sendJson({ t: 'error', m: 'PARTY IS FULL' }); return; }
  client.code = game.code;
  client.name = p.name;
  conn.sendJson({ t: 'welcome', id: client.id, code: game.code, colour: p.colour });
  broadcast(game, lobbyPayload(game));
  if (game.state !== 'lobby') conn.sendJson({ t: 'start' });
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------
let last = Date.now();
let acc = 0;

setInterval(() => {
  const now = Date.now();
  acc += now - last;
  last = now;
  if (acc > 250) acc = 250;   // don't spiral after a stall

  let steps = 0;
  while (acc >= TICK_MS && steps < 5) {
    acc -= TICK_MS;
    steps++;
    for (const game of games.values()) {
      if (game.state === 'play' || game.state === 'over') game.step();
    }
  }
  if (!steps) return;

  for (const game of games.values()) {
    if (game.state === 'lobby') continue;

    for (const p of game.players.values()) {
      const conn = connFor(game, p.id);
      if (conn) conn.sendJson(game.snapshotFor(p));
    }
    if (game.metaDirty) {
      game.metaDirty = false;
      broadcast(game, game.metaFor());
    }
    for (const b of game.banners) broadcast(game, { t: 'b', ...b });
    game.banners.length = 0;
    game.clearFx();

    if (game.state === 'win' && !game.announcedWin) {
      game.announcedWin = true;
      broadcast(game, {
        t: 'win',
        stats: {
          time: Math.round((Date.now() - game.startedAt) / 1000),
          kills: game.kills,
          deaths: game.deaths,
          gems: game.party.gems,
          players: [...game.players.values()].map(p => ({ name: p.name, kills: p.kills, colour: p.colour })),
        },
      });
    }
    if (game.state !== 'win') game.announcedWin = false;
  }
}, TICK_MS);

// Reap parties nobody is in.
setInterval(() => {
  for (const [code, game] of games) {
    if (game.players.size === 0 && Date.now() - game.lastActivity > 60_000) games.delete(code);
  }
}, 30_000);

// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  const addrs = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
    }
  }
  console.log('');
  console.log('  THE SUNKEN CRYPT — dungeon server running');
  console.log('  ------------------------------------------');
  console.log(`  You:      http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  Friends:  http://${a}:${PORT}`);
  console.log('');
  console.log('  Host a party, share the 4-letter code, and they join from the same page.');
  console.log('  Ctrl+C to stop.');
  console.log('');
});
