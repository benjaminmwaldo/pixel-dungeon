// Boot, screen flow, and the fixed-step loop.

import { Renderer } from './render.js';
import { Input } from './input.js';
import { Net } from './net.js';
import * as audio from './audio.js';
import { TICK_MS, CLASS_ORDER, isBoss } from '../shared/constants.js';
import { itemLabel } from '../shared/items.js';
import { TT, regionOf, LEVEL_W, LEVEL_H } from '../shared/terrain.js';
import { drawInventory, drawPerks, moveNode, firstNode } from './screens.js';
import { treesFor } from '../shared/perks.js';
import { Host, joinAsGuest, socketTransport, makeCode, friendlyError } from './peer.js';

const canvas = document.getElementById('screen');
const renderer = new Renderer(canvas);
const input = new Input();

let mode = 'connecting';   // connecting | title | lobby | play | end | lost
let banner = null, bannerUntil = 0;
let endStats = null, endWon = false;
let panel = null;                       // null | 'inv' | 'perks'
const invUi = { cursor: 0, held: null };
const perkUi = { tree: 0, node: null };
let autoReady = false;
let myReady = false;
const particles = [];

const params = new URLSearchParams(location.search);
const preset = params.get('code');
const LAN = params.get('lan') === '1';    // talk to a Node server instead of a peer
let host = null;                          // set when this browser is the one hosting

const ui = {
  screen: 'name',
  name: localStorage.getItem('pd.name') || '',
  cls: Math.max(0, CLASS_ORDER.indexOf(localStorage.getItem('pd.cls') || 'warrior')),
  code: (preset || '').toUpperCase().slice(0, 4),
  sel: 0,
  error: '',
  players: [],
};

const net = new Net({
  onOpen() {},
  onClose() { mode = 'lost'; audio.stopMusic(); },
  onWelcome(m) { ui.code = m.code; ui.error = ''; },
  onLobby(m) {
    ui.players = m.players;
    ui.code = m.code;
    const me = m.players.find(p => p.id === net.id);
    myReady = !!me?.ready;
    if (mode !== 'play') mode = 'lobby';
    input.textMode = false;
    if (autoReady && !myReady) { autoReady = false; net.ready(true); }
  },
  onStart() {
    mode = 'play';
    myReady = false;
    endStats = null;
    audio.resume();
    audio.playMusic('sewers');
  },
  onBanner(msg, ms) { banner = msg; bannerUntil = performance.now() + (ms || 1600); },
  onEnd(stats, won) {
    endStats = stats; endWon = won;
    mode = 'end';
    audio.stopMusic();
    audio.sfx(won ? 'win' : 'lose');
  },
  onError(msg) { ui.error = msg; audio.sfx('hurt'); },
  onFx(kind, x, y) {
    audio.sfx(kind);
    if (kind === 'die' || kind === 'bossdie') particles.push({ kind: 'poof', x, y, age: 0 });
    if (kind === 'blast') particles.push({ kind: 'blast', x, y, age: 0 });
  },
});

mode = 'title';
ui.screen = 'name';
input.textMode = true;

// ---------------------------------------------------------------------------
// Three ways in: host it here, join a friend, or play alone with no network.
// ---------------------------------------------------------------------------
async function startHosting({ publish }) {
  ui.error = '';
  mode = 'connecting';
  try {
    if (LAN) {
      const t = socketTransport();
      await t.ready;
      net.attach(t);
      net.create(ui.name, CLASS_ORDER[ui.cls]);
      return;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const code = makeCode();
      const h = new Host(code);
      try {
        if (publish) await h.publish();
      } catch (e) {
        h.close();
        if (e?.type === 'unavailable-id') continue;   // someone else has that code
        throw e;
      }
      host = h;
      h.onError = (m) => { ui.error = m; };
      net.attach(h.localTransport());
      h.session.addPlayer(h.localId, ui.name, CLASS_ORDER[ui.cls]);
      return;
    }
    throw new Error('COULD NOT CLAIM A CODE');
  } catch (e) {
    ui.error = friendlyError(e);
    mode = 'title';
    ui.screen = 'menu';
  }
}

async function startJoining(code) {
  ui.error = '';
  mode = 'connecting';
  try {
    if (LAN) {
      const t = socketTransport();
      await t.ready;
      net.attach(t);
      net.join(code, ui.name, CLASS_ORDER[ui.cls]);
      return;
    }
    const t = await joinAsGuest(code, ui.name, CLASS_ORDER[ui.cls]);
    net.attach(t);
  } catch (e) {
    ui.error = friendlyError(e);
    mode = 'title';
    ui.screen = 'code';
    input.textMode = true;
  }
}

// ---------------------------------------------------------------------------
input.on((ev) => {
  audio.resume();
  if (ev.type === 'mute') {
    banner = audio.toggleMute() ? 'SOUND OFF' : 'SOUND ON';
    bannerUntil = performance.now() + 900;
    return;
  }
  if (mode === 'title') return titleKeys(ev);
  if (mode === 'lobby') return lobbyKeys(ev);
  if (mode === 'play') return playKeys(ev);
  if (mode === 'end' && ev.type === 'start') { net.again(); endStats = null; }
});

function titleKeys(ev) {
  if (ui.screen === 'name') {
    if (ev.type === 'char' && ui.name.length < 8) { ui.name += ev.ch; audio.sfx('menu'); }
    else if (ev.type === 'back') ui.name = ui.name.slice(0, -1);
    else if (ev.type === 'start' && ui.name.length) {
      localStorage.setItem('pd.name', ui.name);
      input.textMode = false;
      audio.sfx('select');
      ui.screen = 'class';
    }
    return;
  }
  if (ui.screen === 'class') {
    if (ev.type === 'up') { ui.cls = (ui.cls + 3) % 4; audio.sfx('menu'); }
    else if (ev.type === 'down') { ui.cls = (ui.cls + 1) % 4; audio.sfx('menu'); }
    else if (ev.type === 'start') {
      localStorage.setItem('pd.cls', CLASS_ORDER[ui.cls]);
      audio.sfx('select');
      if (ui.code.length === 4) { startJoining(ui.code); return; }
      ui.screen = 'menu';
    }
    return;
  }
  if (ui.screen === 'menu') {
    if (ev.type === 'up') { ui.sel = (ui.sel + 2) % 3; audio.sfx('menu'); }
    else if (ev.type === 'down') { ui.sel = (ui.sel + 1) % 3; audio.sfx('menu'); }
    else if (ev.type === 'start') {
      audio.sfx('select');
      if (ui.sel === 0) startHosting({ publish: true });
      else if (ui.sel === 1) { ui.screen = 'code'; ui.code = ''; input.textMode = true; }
      else { autoReady = true; startHosting({ publish: false }); }
    }
    return;
  }
  if (ui.screen === 'code') {
    if (ev.type === 'char' && ui.code.length < 4) { ui.code += ev.ch; audio.sfx('menu'); }
    else if (ev.type === 'back') ui.code = ui.code.slice(0, -1);
    else if (ev.type === 'cancel') { ui.screen = 'menu'; input.textMode = false; }
    else if (ev.type === 'start' && ui.code.length === 4) {
      audio.sfx('select');
      input.textMode = false;
      startJoining(ui.code);
    }
  }
}

function lobbyKeys(ev) {
  if (ev.type === 'start') {
    myReady = !myReady;
    net.ready(myReady);
    audio.sfx('select');
  } else if (ev.type === 'cycle') {
    ui.cls = (ui.cls + 1) % 4;
    net.chooseClass(CLASS_ORDER[ui.cls]);
    audio.sfx('menu');
  }
}

function playKeys(ev) {
  if (panel) return panelKeys(ev);
  switch (ev.type) {
    case 'act': net.act(); audio.sfx('menu'); break;
    case 'slot': net.useSlot(ev.n); break;
    case 'start': net.act(); break;
    case 'pack': openPanel('inv'); break;
    case 'skills': openPanel('perks'); break;
    default: break;
  }
}

function openPanel(which) {
  panel = which;
  audio.sfx('select');
  if (which === 'inv') { invUi.cursor = 0; invUi.held = null; }
  else if (!perkUi.node) firstNode(net.state(performance.now()), perkUi);
}

function panelKeys(ev) {
  if (ev.type === 'cancel'
      || (ev.type === 'pack' && panel === 'inv')
      || (ev.type === 'skills' && panel === 'perks')) {
    panel = null; invUi.held = null; audio.sfx('menu');
    return;
  }
  if (ev.type === 'pack') { openPanel('inv'); return; }
  if (ev.type === 'skills') { openPanel('perks'); return; }
  if (panel === 'inv') return invKeys(ev);
  return perkKeys(ev);
}

function invKeys(ev) {
  const bag = net.bag || [];
  const rows = Math.max(1, Math.ceil(bag.length / 8));
  const move = (dx, dy) => {
    if (invUi.cursor < 0) {
      if (dy > 0) invUi.cursor = invUi.cursor === -1 ? -2 : 0;
      else if (dy < 0) invUi.cursor = invUi.cursor === -2 ? -1 : (rows - 1) * 8;
      else if (dx < 0) invUi.cursor = 7;
      return;
    }
    let c = invUi.cursor % 8, r = (invUi.cursor / 8) | 0;
    c += dx; r += dy;
    if (c > 7) { invUi.cursor = -1; return; }
    if (r < 0) { invUi.cursor = -1; return; }
    if (c < 0) c = 0;
    if (r >= rows) r = rows - 1;
    invUi.cursor = Math.min(bag.length - 1, r * 8 + c);
  };

  switch (ev.type) {
    case 'left': move(-1, 0); audio.sfx('menu'); break;
    case 'right': move(1, 0); audio.sfx('menu'); break;
    case 'up': move(0, -1); audio.sfx('menu'); break;
    case 'down': move(0, 1); audio.sfx('menu'); break;
    case 'start': case 'a':
      if (invUi.cursor < 0) net.invOp('unequip', invUi.cursor === -1 ? 0 : 1);
      else net.invOp('use', invUi.cursor);
      audio.sfx('select');
      break;
    case 'b':
      if (invUi.cursor >= 0) { net.invOp('drop', invUi.cursor); audio.sfx('pickup'); }
      break;
    case 'cycle':
      if (invUi.cursor < 0) break;
      if (invUi.held === null) { invUi.held = invUi.cursor; audio.sfx('menu'); }
      else { net.invOp('swap', invUi.held, invUi.cursor); invUi.held = null; audio.sfx('select'); }
      break;
    case 'slot':
      if (invUi.held !== null) { net.invOp('swap', invUi.held, ev.n); invUi.held = null; }
      else net.useSlot(ev.n);
      audio.sfx('select');
      break;
    default: break;
  }
}

function perkKeys(ev) {
  const st = net.state(performance.now());
  const trees = treesFor(st.me.cls);
  switch (ev.type) {
    case 'left': moveNode(st, perkUi, -1, 0); audio.sfx('menu'); break;
    case 'right': moveNode(st, perkUi, 1, 0); audio.sfx('menu'); break;
    case 'up': moveNode(st, perkUi, 0, -1); audio.sfx('menu'); break;
    case 'down': moveNode(st, perkUi, 0, 1); audio.sfx('menu'); break;
    case 'tab': case 'cycle':
      perkUi.tree = (perkUi.tree + 1) % trees.length;
      firstNode(st, perkUi);
      audio.sfx('menu');
      break;
    case 'start': case 'a':
      if (perkUi.node) { net.takePerk(perkUi.node); audio.sfx('select'); }
      break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
let acc = 0;
let last = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min(250, now - last);
  last = now;
  while (acc >= TICK_MS) {
    acc -= TICK_MS;
    if (mode === 'play') net.tick(panel ? 0 : input.bits());
  }
  draw(now);
}

function draw(now) {
  if (banner && now > bannerUntil) banner = null;
  for (let i = particles.length - 1; i >= 0; i--) {
    if (++particles[i].age > 14) particles.splice(i, 1);
  }

  switch (mode) {
    case 'connecting': renderer.drawConnecting(LAN ? 'REACHING THE SERVER...' : 'OPENING A DOOR...'); break;
    case 'lost': renderer.drawConnecting('CONNECTION LOST - RELOAD'); break;
    case 'title': renderer.drawTitle(ui); break;
    case 'lobby': renderer.drawLobby(ui); break;
    case 'end': if (endStats) renderer.drawEnd(endStats, endWon); break;
    case 'play': {
      if (!net.haveFloor) { renderer.drawConnecting('DESCENDING...'); break; }
      const st = net.state(now);
      st.particles = particles;
      renderer.clear();
      renderer.drawWorld(st);
      renderer.drawHUD(st);
      renderer.bossBanner();
      if (panel === 'inv') drawInventory(renderer, st, invUi);
      else if (panel === 'perks') drawPerks(renderer, st, perkUi);
      else if (banner) renderer.banner(banner);
      else promptForTile(st);
      updateMusic(st);
      break;
    }
  }
  renderer.present();
}

function promptForTile(st) {
  // standing on something with a price tag
  const good = st.items?.find(e => e.price &&
    Math.abs(e.x - st.me.x) < 10 && Math.abs(e.y - st.me.y) < 10);
  if (good) {
    const name = itemLabel(good, st.app, st.known || { potions: [], scrolls: [] });
    renderer.prompt(st.me.gold >= good.price
      ? `E - BUY ${name} (${good.price})`
      : `${name} - ${good.price} GOLD`);
    return;
  }
  const t = net.tileHere();
  if (t === TT.EXIT) renderer.prompt('E - DESCEND');
  else if (t === TT.ENTRANCE && net.depth > 1) renderer.prompt('E - CLIMB BACK UP');
  else if (t === TT.LOCKED_EXIT) renderer.prompt('SEALED UNTIL THE BOSS FALLS');
  else if (t === TT.WELL) renderer.prompt('E - DRINK');
  else if (t === TT.PEDESTAL) renderer.prompt('E - TAKE IT');
  else if (chasmBeside()) renderer.prompt('E - LEAP DOWN');
}

/** Is one of the four tiles around the hero open air? */
function chasmBeside() {
  const i = net.tileIndex?.();
  if (i === null || i === undefined) return false;
  const x = i % LEVEL_W, y = (i / LEVEL_W) | 0;
  for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= LEVEL_W || ny >= LEVEL_H) continue;
    if (net.tiles?.[ny * LEVEL_W + nx] === TT.CHASM) return true;
  }
  return false;
}

function updateMusic(st) {
  const boss = st.ents.some(e => isBoss(e.kind));
  audio.playMusic(boss ? 'boss' : regionOf(st.depth).key);
}

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
requestAnimationFrame(frame);

// Exposed so an automated harness can drive the game when rAF is throttled.
window.PD = {
  net, renderer, input, audio,
  get mode() { return mode; },
  set mode(v) { mode = v; },
  frame: () => draw(performance.now()),
  hold: (bits, n = 1) => { for (let i = 0; i < n; i++) if (mode === 'play') net.tick(bits); },
  key: (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })),
  get host() { return host; },
  get panel() { return panel; },
  set panel(v) { panel = v; },
  invUi, perkUi,
};
