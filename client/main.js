// Boot, screen flow, and the fixed-step loop.

import { Renderer } from './render.js';
import { Input } from './input.js';
import { Net } from './net.js';
import * as audio from './audio.js';
import { TICK_MS, CLASS_ORDER, isBoss } from '../shared/constants.js';
import { TT, regionOf } from '../shared/terrain.js';

const canvas = document.getElementById('screen');
const renderer = new Renderer(canvas);
const input = new Input();

let mode = 'connecting';   // connecting | title | lobby | play | end | lost
let banner = null, bannerUntil = 0;
let endStats = null, endWon = false;
let autoReady = false;
let myReady = false;
const particles = [];

const preset = new URLSearchParams(location.search).get('code');

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
  onOpen() {
    if (mode === 'connecting' || mode === 'lost') {
      mode = 'title';
      ui.screen = 'name';
      input.textMode = true;
    }
  },
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

net.connect();

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
      if (ui.code.length === 4) { net.join(ui.code, ui.name, CLASS_ORDER[ui.cls]); return; }
      ui.screen = 'menu';
    }
    return;
  }
  if (ui.screen === 'menu') {
    if (ev.type === 'up') { ui.sel = (ui.sel + 2) % 3; audio.sfx('menu'); }
    else if (ev.type === 'down') { ui.sel = (ui.sel + 1) % 3; audio.sfx('menu'); }
    else if (ev.type === 'start') {
      audio.sfx('select');
      const cls = CLASS_ORDER[ui.cls];
      if (ui.sel === 0) net.create(ui.name, cls);
      else if (ui.sel === 1) { ui.screen = 'code'; ui.code = ''; input.textMode = true; }
      else { autoReady = true; net.create(ui.name, cls); }
    }
    return;
  }
  if (ui.screen === 'code') {
    if (ev.type === 'char' && ui.code.length < 4) { ui.code += ev.ch; audio.sfx('menu'); }
    else if (ev.type === 'back') ui.code = ui.code.slice(0, -1);
    else if (ev.type === 'cancel') { ui.screen = 'menu'; input.textMode = false; }
    else if (ev.type === 'start' && ui.code.length === 4) {
      audio.sfx('select');
      net.join(ui.code, ui.name, CLASS_ORDER[ui.cls]);
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
  if (ev.type === 'act') { net.act(); audio.sfx('menu'); }
  if (ev.type === 'slot') net.useSlot(ev.n);
  if (ev.type === 'start') net.act();
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
    if (mode === 'play') net.tick(input.bits());
  }
  draw(now);
}

function draw(now) {
  if (banner && now > bannerUntil) banner = null;
  for (let i = particles.length - 1; i >= 0; i--) {
    if (++particles[i].age > 14) particles.splice(i, 1);
  }

  switch (mode) {
    case 'connecting': renderer.drawConnecting('OPENING THE DUNGEON...'); break;
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
      if (banner) renderer.banner(banner);
      else promptForTile();
      updateMusic(st);
      break;
    }
  }
  renderer.present();
}

function promptForTile() {
  const t = net.tileHere();
  if (t === TT.EXIT) renderer.prompt('E - DESCEND');
  else if (t === TT.ENTRANCE && net.depth > 1) renderer.prompt('E - CLIMB BACK UP');
  else if (t === TT.LOCKED_EXIT) renderer.prompt('SEALED UNTIL THE BOSS FALLS');
  else if (t === TT.WELL) renderer.prompt('E - DRINK');
  else if (t === TT.PEDESTAL) renderer.prompt('E - TAKE IT');
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
};
