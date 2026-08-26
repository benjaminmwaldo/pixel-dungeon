// Boot, screen flow, and the fixed-step loop.

import { Renderer } from './render.js';
import { Input } from './input.js';
import { Net } from './net.js';
import * as audio from './audio.js';
import { TICK_MS, KIND } from '../shared/constants.js';

const canvas = document.getElementById('screen');
const renderer = new Renderer(canvas);
const input = new Input();

let mode = 'connecting';      // connecting | title | lobby | play | win | lost
let banner = null, bannerUntil = 0;
let winStats = null;
let autoReady = false;
let myReady = false;
const particles = [];

const preset = new URLSearchParams(location.search).get('code');

const ui = {
  screen: 'name',
  name: localStorage.getItem('pd.name') || '',
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
    audio.resume();
    audio.playMusic('dungeon');
  },
  onBanner(msg, ms) { banner = msg; bannerUntil = performance.now() + (ms || 1600); },
  onWin(stats) {
    winStats = stats;
    mode = 'win';
    audio.stopMusic();
    audio.sfx('win');
  },
  onError(msg) { ui.error = msg; audio.sfx('hurt'); },
  onFx(kind, x, y) {
    audio.sfx(kind);
    if (kind === 'die' || kind === 'bossdie') particles.push({ kind: 'poof', x, y, age: 0 });
    if (kind === 'secret' || kind === 'revive') particles.push({ kind: 'spark', x, y, age: 0 });
  },
});

net.connect();

// ---------------------------------------------------------------------------
// Screen input
// ---------------------------------------------------------------------------
input.on((ev) => {
  audio.resume();
  if (ev.type === 'mute') {
    const m = audio.toggleMute();
    banner = m ? 'SOUND OFF' : 'SOUND ON';
    bannerUntil = performance.now() + 900;
    return;
  }
  if (mode === 'title') return titleKeys(ev);
  if (mode === 'lobby') return lobbyKeys(ev);
  if (mode === 'play') return playKeys(ev);
  if (mode === 'win' && ev.type === 'start') { net.again(); winStats = null; mode = 'play'; audio.playMusic('dungeon'); }
});

function titleKeys(ev) {
  if (ui.screen === 'name') {
    if (ev.type === 'char' && ui.name.length < 8) { ui.name += ev.ch; audio.sfx('menu'); }
    else if (ev.type === 'back') ui.name = ui.name.slice(0, -1);
    else if (ev.type === 'start' && ui.name.length) {
      localStorage.setItem('pd.name', ui.name);
      input.textMode = false;
      audio.sfx('select');
      if (ui.code.length === 4) { net.join(ui.code, ui.name); return; }
      ui.screen = 'menu';
    }
    return;
  }
  if (ui.screen === 'menu') {
    if (ev.type === 'up') { ui.sel = (ui.sel + 2) % 3; audio.sfx('menu'); }
    else if (ev.type === 'down') { ui.sel = (ui.sel + 1) % 3; audio.sfx('menu'); }
    else if (ev.type === 'start') {
      audio.sfx('select');
      if (ui.sel === 0) net.create(ui.name);
      else if (ui.sel === 1) { ui.screen = 'code'; ui.code = ''; input.textMode = true; }
      else { autoReady = true; net.create(ui.name); }
    }
    return;
  }
  if (ui.screen === 'code') {
    if (ev.type === 'char' && ui.code.length < 4) { ui.code += ev.ch; audio.sfx('menu'); }
    else if (ev.type === 'back') ui.code = ui.code.slice(0, -1);
    else if (ev.type === 'cancel') { ui.screen = 'menu'; input.textMode = false; }
    else if (ev.type === 'start' && ui.code.length === 4) { audio.sfx('select'); net.join(ui.code, ui.name); }
  }
}

function lobbyKeys(ev) {
  if (ev.type === 'start') {
    myReady = !myReady;
    net.ready(myReady);
    audio.sfx('select');
  }
}

function playKeys(ev) {
  if (ev.type === 'cycle') { net.cycle(); audio.sfx('menu'); }
  if (ev.type === 'start' && net.serverState === 'win') net.again();
}

// ---------------------------------------------------------------------------
// Loop
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
    case 'connecting': renderer.drawConnecting('OPENING THE CRYPT...'); break;
    case 'lost': renderer.drawConnecting('CONNECTION LOST - RELOAD'); break;
    case 'title': renderer.drawTitle(ui); break;
    case 'lobby': renderer.drawLobby(ui); break;
    case 'win': if (winStats) renderer.drawWin(winStats); break;
    case 'play': {
      if (!net.room) { renderer.drawConnecting('ENTERING...'); break; }
      const state = net.state(now);
      state.particles = particles;
      renderer.clear();
      renderer.drawWorld(state);
      renderer.drawHUD(state);
      if (banner) renderer.banner(banner);
      if (net.serverState === 'over') renderer.drawGameOver();
      updateMusic(state);
      break;
    }
  }
  renderer.present();
}

function updateMusic(state) {
  const boss = state.room?.id === '3,1' && state.ents.some(e => e.kind === KIND.WYRM);
  audio.playMusic(boss ? 'boss' : 'dungeon');
}

window.addEventListener('resize', () => renderer.resize());
renderer.resize();
requestAnimationFrame(frame);

// Exposed for debugging from the console — and so an automated harness can
// drive the game when the tab is backgrounded and rAF is throttled.
window.PD = {
  net, renderer, input, audio,
  get mode() { return mode; },
  set mode(v) { mode = v; },
  frame: () => draw(performance.now()),
  hold: (bits, n = 1) => { for (let i = 0; i < n; i++) if (mode === 'play') net.tick(bits); },
  key: (code) => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true })),
};
