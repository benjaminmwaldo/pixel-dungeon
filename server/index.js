// One process: serves the client over HTTP and runs the authoritative game
// over WebSocket. No dependencies — `node server/index.js` and you're playing.

import { createServer } from 'node:http';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { attachWebSocket } from './ws.js';
import { Session } from '../shared/session.js';
import { TICK_MS } from '../shared/constants.js';

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
//
// This process is only one of two ways to host. The browser can run the very
// same Session over WebRTC, which is how the public build works; this path
// exists for playing on one network with no broker in the middle.
// ---------------------------------------------------------------------------
const games = new Map();      // code -> Session
const clients = new Map();    // conn -> { id, code, name }
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
  for (const s of games.values()) n += s.players.size;
  return n;
}

function connFor(code, playerId) {
  for (const [conn, c] of clients) if (c.code === code && c.id === playerId) return conn;
  return null;
}

function makeSession(code) {
  const session = new Session(code, {
    send: (playerId, obj) => connFor(code, playerId)?.sendJson(obj),
    broadcast: (obj) => {
      const str = JSON.stringify(obj);
      for (const [conn, c] of clients) if (c.code === code) conn.send(str);
    },
  });
  games.set(code, session);
  return session;
}

attachWebSocket(server, (conn) => {
  const client = { id: idSeq++, code: null, name: 'HERO' };
  clients.set(conn, client);

  conn.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'create' || msg.t === 'join') {
      const session = msg.t === 'create'
        ? makeSession(newCode())
        : games.get(String(msg.code || '').toUpperCase().trim());
      if (!session) { conn.sendJson({ t: 'error', m: 'NO SUCH PARTY' }); return; }
      if (session.full()) { conn.sendJson({ t: 'error', m: 'PARTY IS FULL' }); return; }
      client.code = session.code;
      const clean = String(msg.name || 'HERO').replace(/[^A-Za-z0-9 ]/g, '').trim().slice(0, 8) || 'HERO';
      client.name = clean;
      session.addPlayer(client.id, clean, msg.cls);
      return;
    }

    const session = client.code && games.get(client.code);
    if (session) session.handle(client.id, msg);
  });

  conn.on('close', () => {
    const session = client.code && games.get(client.code);
    clients.delete(conn);
    if (!session) return;
    session.removePlayer(client.id);
    if (session.players.size === 0) games.delete(session.code);
  });
});

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------
let last = Date.now();

setInterval(() => {
  const now = Date.now();
  const dt = now - last;
  last = now;
  for (const session of games.values()) session.advance(dt);
}, TICK_MS);

setInterval(() => {
  for (const [code, session] of games) {
    if (session.players.size === 0 && Date.now() - session.game.lastActivity > 60_000) {
      games.delete(code);
    }
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
