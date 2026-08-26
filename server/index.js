// One process: serves the client over HTTP and runs the authoritative game
// over WebSocket. No dependencies — `node server/index.js` and you're playing.

import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachWebSocket } from './ws.js';
import { Game } from './game.js';
import { TICK_MS, MAX_PLAYERS, IN, CLASSES } from '../shared/constants.js';
import { MAX_DEPTH } from '../shared/terrain.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT || argValue('--port') || 8080);
const DEV = process.argv.includes('--dev');

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
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const ALLOWED_DIRS = ['client', 'shared'];

async function serveStatic(req, res) {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/' || path === '/index.html') path = '/client/index.html';
  if (!path.startsWith('/client/') && !path.startsWith('/shared/')) path = '/client' + path;

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

const server = createServer((req, res) => {
  // Dev-only: lets a local browser hand a canvas capture back to disk so the
  // art can be reviewed without a screenshot pipeline. Off unless --dev.
  if (DEV && req.method === 'POST' && req.url === '/__shot') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 8e6) req.destroy(); });
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
// Parties
// ---------------------------------------------------------------------------
const games = new Map();
const clients = new Map();
let idSeq = 1;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function newCode() {
  for (let n = 0; n < 200; n++) {
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
      id: p.id, name: p.name, cls: p.cls, ready: p.ready,
    })),
  };
}

function broadcast(game, obj) {
  const str = JSON.stringify(obj);
  for (const [conn, c] of clients) if (c.code === game.code) conn.send(str);
}

function connFor(game, playerId) {
  for (const [conn, c] of clients) if (c.code === game.code && c.id === playerId) return conn;
  return null;
}

attachWebSocket(server, (conn) => {
  const client = { id: idSeq++, code: null, name: 'HERO' };
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
    if (!game) return;
    game.removePlayer(client.id);
    if (game.players.size === 0) games.delete(game.code);
    else {
      broadcast(game, lobbyPayload(game));
      broadcast(game, { t: 'note', m: `${client.name} LEFT THE PARTY` });
    }
  });
});

function handle(conn, client, msg) {
  const game = client.code ? games.get(client.code) : null;
  const p = game?.players.get(client.id);

  switch (msg.t) {
    case 'create': {
      const code = newCode();
      const g = new Game(code);
      games.set(code, g);
      joinGame(conn, client, g, msg.name, msg.cls);
      break;
    }
    case 'join': {
      const code = String(msg.code || '').toUpperCase().trim();
      const g = games.get(code);
      if (!g) { conn.sendJson({ t: 'error', m: 'NO SUCH PARTY' }); return; }
      if (g.players.size >= MAX_PLAYERS) { conn.sendJson({ t: 'error', m: 'PARTY IS FULL' }); return; }
      joinGame(conn, client, g, msg.name, msg.cls);
      break;
    }
    case 'class': {
      if (!game || !p || game.state !== 'lobby') return;
      const want = String(msg.cls || '');
      if (!CLASSES[want]) return;
      const taken = [...game.players.values()].some(o => o.id !== p.id && o.cls === want);
      if (taken) return;
      p.cls = want;
      p.colour = CLASSES[want].colour;
      p.hp = p.maxHp = CLASSES[want].hp;
      game.metaDirty = true;
      broadcast(game, lobbyPayload(game));
      break;
    }
    case 'ready': {
      if (!game || !p) return;
      p.ready = !!msg.v;
      broadcast(game, lobbyPayload(game));
      const all = [...game.players.values()];
      if (game.state === 'lobby' && all.length && all.every(x => x.ready)) {
        game.begin();
        broadcast(game, { t: 'start' });
      }
      break;
    }
    case 'in': {
      if (!game || !p) return;
      const bits = (msg.b | 0) & (IN.UP | IN.RIGHT | IN.DOWN | IN.LEFT | IN.A | IN.B);
      p.queue.push({ seq: msg.s | 0, bits });
      if (p.queue.length > 12) p.queue.splice(0, p.queue.length - 12);
      game.lastActivity = Date.now();
      break;
    }
    case 'act': if (game && p) game.interact(p); break;
    case 'use': if (game && p) game.useSlot(p, msg.n | 0); break;
    case 'inv':
      if (game && p) game.invOp(p, String(msg.op || ''), msg.a | 0, msg.b | 0);
      break;
    case 'perk':
      if (game && p) game.spendPerk(p, String(msg.id || ''));
      break;
    case 'again':
      if (game && (game.state === 'win' || game.state === 'over')) game.restart();
      break;
    case 'ping': conn.sendJson({ t: 'pong', c: msg.c }); break;
  }
}

function joinGame(conn, client, game, name, cls) {
  const clean = String(name || 'HERO').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 8) || 'HERO';
  const p = game.addPlayer(client.id, clean, cls);
  if (!p) { conn.sendJson({ t: 'error', m: 'PARTY IS FULL' }); return; }
  client.code = game.code;
  client.name = p.name;
  conn.sendJson({ t: 'welcome', id: client.id, code: game.code, cls: p.cls });
  broadcast(game, lobbyPayload(game));
  if (game.state !== 'lobby') conn.sendJson({ t: 'start' });
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------
let last = Date.now();
let acc = 0;
let exploredBeat = 0;

setInterval(() => {
  const now = Date.now();
  acc += now - last;
  last = now;
  if (acc > 250) acc = 250;

  let steps = 0;
  while (acc >= TICK_MS && steps < 5) {
    acc -= TICK_MS;
    steps++;
    for (const game of games.values()) {
      if (game.state === 'play' || game.state === 'over') game.step();
    }
  }
  if (!steps) return;
  exploredBeat++;

  for (const game of games.values()) {
    if (game.state === 'lobby') continue;

    if (game.announceStart) {
      game.announceStart = false;
      broadcast(game, { t: 'start' });
    }

    for (const p of game.players.values()) {
      const conn = connFor(game, p.id);
      if (!conn) continue;
      if (p.needFloor) {
        p.needFloor = false;
        conn.sendJson(game.floorPacket(p));
      }
      conn.sendJson(game.snapshotFor(p));
    }

    // teammates' exploration bleeds into everyone's map, a couple of times a second
    if (exploredBeat % 15 === 0) {
      const depths = new Set([...game.players.values()].map(x => x.depth));
      for (const d of depths) {
        const f = game.floors.get(d);
        if (!f?.mapDirty) continue;
        f.mapDirty = false;
        const packet = JSON.stringify(game.exploredPacket(d));
        for (const o of game.players.values()) {
          if (o.depth !== d) continue;
          connFor(game, o.id)?.send(packet);
        }
      }
    }

    if (game.metaDirty) {
      game.metaDirty = false;
      broadcast(game, game.metaFor());
    }
    for (const b of game.banners) broadcast(game, { t: 'b', ...b });
    game.banners.length = 0;
    game.clearTransient();

    if (game.state === 'win' && !game.announcedWin) {
      game.announcedWin = true;
      broadcast(game, {
        t: 'win',
        stats: {
          time: Math.round((Date.now() - game.startedAt) / 1000),
          kills: game.kills, deaths: game.deaths, deepest: MAX_DEPTH,
          players: [...game.players.values()].map(x => ({
            name: x.name, cls: x.cls, level: x.level, kills: x.kills, gold: x.gold,
          })),
        },
      });
    }
    if (game.state === 'over' && !game.announcedOver) {
      game.announcedOver = true;
      broadcast(game, {
        t: 'over',
        stats: {
          time: Math.round((Date.now() - game.startedAt) / 1000),
          kills: game.kills, deaths: game.deaths, deepest: game.deepest,
          players: [...game.players.values()].map(x => ({
            name: x.name, cls: x.cls, level: x.level, kills: x.kills, gold: x.gold,
          })),
        },
      });
    }
    if (game.state === 'play') { game.announcedWin = false; game.announcedOver = false; }
  }
}, TICK_MS);

setInterval(() => {
  for (const [code, game] of games) {
    if (game.players.size === 0 && Date.now() - game.lastActivity > 60_000) games.delete(code);
  }
}, 30_000);

// ---------------------------------------------------------------------------
server.listen(PORT, () => {
  const addrs = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const ni of list || []) if (ni.family === 'IPv4' && !ni.internal) addrs.push(ni.address);
  }
  console.log('');
  console.log('  PIXEL DUNGEON — 25 floors, up to 4 heroes');
  console.log('  -----------------------------------------');
  console.log(`  You:      http://localhost:${PORT}`);
  for (const a of addrs) console.log(`  Friends:  http://${a}:${PORT}`);
  console.log('');
  console.log('  Host a party, share the 4-letter code, and they join from the same page.');
  console.log('  Ctrl+C to stop.');
  console.log('');
});
