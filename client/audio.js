// A tiny chip synth: two pulse voices, a triangle bass and a noise channel.
// The music is original — an ominous loop written for this dungeon.

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let noiseBuf = null;

let timer = null;
let step = 0;
let nextTime = 0;
let track = 'dungeon';
export let muted = false;

const A4 = 440;
const hz = (midi) => A4 * Math.pow(2, (midi - 69) / 12);

export function init() {
  if (ctx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.6;
  master.connect(ctx.destination);

  musicGain = ctx.createGain();
  musicGain.gain.value = 0.32;
  musicGain.connect(master);

  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.75;
  sfxGain.connect(master);

  const len = ctx.sampleRate * 0.5;
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}

export function resume() {
  init();
  if (ctx && ctx.state === 'suspended') ctx.resume();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.6;
  return muted;
}

// ---------------------------------------------------------------------------
// Voices
// ---------------------------------------------------------------------------
function tone(freq, dur, { type = 'square', vol = 0.2, to = null, at = 0, dest = null, attack = 0.005 } = {}) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(Math.max(20, to), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(dest || sfxGain);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, { vol = 0.2, at = 0, filter = 1200, sweep = null, dest = null } = {}) {
  if (!ctx || !noiseBuf) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(filter, t);
  if (sweep) bp.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp); bp.connect(g); g.connect(dest || sfxGain);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------
const FX = {
  sword:   () => { tone(760, 0.07, { type: 'square', vol: 0.16, to: 240 }); noise(0.05, { vol: 0.06, filter: 2600 }); },
  beam:    () => { tone(520, 0.22, { type: 'square', vol: 0.15, to: 1400 }); },
  hit:     () => { noise(0.07, { vol: 0.2, filter: 900, sweep: 200 }); tone(180, 0.07, { type: 'square', vol: 0.1, to: 90 }); },
  clang:   () => { tone(1400, 0.05, { type: 'square', vol: 0.12, to: 900 }); noise(0.06, { vol: 0.12, filter: 4000 }); },
  die:     () => { tone(420, 0.18, { type: 'square', vol: 0.16, to: 60 }); noise(0.18, { vol: 0.12, filter: 1400, sweep: 200 }); },
  bossdie: () => {
    for (let i = 0; i < 7; i++) {
      tone(300 - i * 22, 0.16, { type: 'square', vol: 0.16, to: 60, at: i * 0.12 });
      noise(0.2, { vol: 0.16, filter: 900, sweep: 120, at: i * 0.12 });
    }
  },
  hurt:    () => { tone(300, 0.16, { type: 'sawtooth', vol: 0.2, to: 90 }); },
  pickup:  () => { tone(880, 0.05, { vol: 0.14 }); tone(1320, 0.08, { vol: 0.14, at: 0.05 }); },
  heart:   () => { tone(1046, 0.06, { vol: 0.14 }); tone(1568, 0.1, { vol: 0.13, at: 0.06 }); },
  gem:     () => { tone(1318, 0.05, { vol: 0.12 }); tone(1760, 0.07, { vol: 0.11, at: 0.05 }); },
  key:     () => { tone(1046, 0.06, { vol: 0.14 }); tone(1244, 0.06, { vol: 0.14, at: 0.06 }); tone(1568, 0.14, { vol: 0.14, at: 0.12 }); },
  item:    () => { [659, 784, 988, 1319].forEach((f, i) => tone(f, 0.18, { vol: 0.16, at: i * 0.1 })); },
  door:    () => { noise(0.3, { vol: 0.16, filter: 400, sweep: 120 }); },
  shutter: () => { noise(0.25, { vol: 0.18, filter: 300, sweep: 900 }); tone(120, 0.25, { type: 'square', vol: 0.1, to: 300 }); },
  secret:  () => { [523, 659, 784, 1046, 1319].forEach((f, i) => tone(f, 0.2, { vol: 0.15, at: i * 0.09 })); },
  bomb:    () => { tone(220, 0.06, { type: 'square', vol: 0.1, to: 320 }); },
  blast:   () => { noise(0.45, { vol: 0.3, filter: 900, sweep: 60 }); tone(90, 0.4, { type: 'sawtooth', vol: 0.16, to: 30 }); },
  boom:    () => { tone(440, 0.09, { type: 'square', vol: 0.1, to: 900 }); },
  throw:   () => { tone(300, 0.08, { type: 'square', vol: 0.09, to: 700 }); },
  magic:   () => { tone(1200, 0.14, { type: 'sine', vol: 0.12, to: 300 }); },
  fire:    () => { noise(0.28, { vol: 0.16, filter: 700, sweep: 180 }); },
  fizzle:  () => { noise(0.06, { vol: 0.07, filter: 1800, sweep: 600 }); },
  grab:    () => { tone(160, 0.3, { type: 'sawtooth', vol: 0.2, to: 60 }); noise(0.3, { vol: 0.12, filter: 500 }); },
  clear:   () => { [784, 988, 1175].forEach((f, i) => tone(f, 0.16, { vol: 0.15, at: i * 0.08 })); },
  boss:    () => { [110, 116, 123].forEach((f, i) => tone(f, 0.5, { type: 'sawtooth', vol: 0.2, at: i * 0.18 })); },
  revive:  () => { [523, 784, 1046, 1319].forEach((f, i) => tone(f, 0.22, { vol: 0.15, at: i * 0.08 })); },
  menu:    () => { tone(880, 0.04, { vol: 0.1 }); },
  select:  () => { tone(660, 0.05, { vol: 0.12 }); tone(990, 0.08, { vol: 0.12, at: 0.05 }); },
  lose:    () => { [440, 415, 392, 330, 262].forEach((f, i) => tone(f, 0.34, { type: 'square', vol: 0.18, at: i * 0.22 })); },
  win:     () => { [523, 659, 784, 1046, 988, 1046, 1319].forEach((f, i) => tone(f, 0.3, { vol: 0.18, at: i * 0.16 })); },
};

export function sfx(name) {
  if (!ctx || muted) return;
  const f = FX[name];
  if (f) f();
}

// ---------------------------------------------------------------------------
// Music — original loops
// ---------------------------------------------------------------------------
const R = null;
const TRACKS = {
  // Slow, circling, a little unresolved. D minor with a flat second.
  dungeon: {
    stepMs: 165,
    bass: [38, R, 38, R, 39, R, 38, R, 36, R, 36, R, 33, R, 35, R,
           38, R, 38, R, 41, R, 40, R, 38, R, 36, R, 38, R, R, R],
    lead: [62, R, R, 65, R, R, 63, R, 62, R, R, 60, R, R, R, R,
           58, R, R, 60, R, R, 62, R, 65, R, 63, R, 62, R, R, R],
    drum: [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0,
           1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 2],
  },
  // Boss: same key, twice the pulse, no melody to hide behind.
  boss: {
    stepMs: 105,
    bass: [38, 38, R, 38, 39, R, 38, R, 36, 36, R, 36, 37, R, 36, R,
           38, 38, R, 38, 41, R, 40, R, 38, 38, R, 37, 36, R, 35, R],
    lead: [74, R, 73, R, 74, R, 77, R, 76, R, 74, R, 73, R, 74, R,
           70, R, 71, R, 73, R, 74, R, 77, R, 76, R, 74, R, R, R],
    drum: [1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 2, 2, 2,
           1, 0, 2, 0, 1, 0, 2, 0, 1, 0, 2, 0, 1, 2, 2, 2],
  },
};

export function playMusic(name) {
  init();
  if (!ctx) return;
  if (track === name && timer) return;
  track = name;
  step = 0;
  nextTime = ctx.currentTime + 0.06;
  if (!timer) timer = setInterval(pump, 40);
}

export function stopMusic() {
  if (timer) { clearInterval(timer); timer = null; }
}

function pump() {
  if (!ctx || muted) return;
  const t = TRACKS[track];
  if (!t) return;
  const dur = t.stepMs / 1000;
  while (nextTime < ctx.currentTime + 0.25) {
    const at = nextTime - ctx.currentTime;
    if (at >= 0) {
      const b = t.bass[step % t.bass.length];
      if (b !== null) tone(hz(b), dur * 1.7, { type: 'triangle', vol: 0.34, at, dest: musicGain, attack: 0.01 });
      const l = t.lead[step % t.lead.length];
      if (l !== null) tone(hz(l), dur * 1.25, { type: 'square', vol: 0.13, at, dest: musicGain, attack: 0.01 });
      const d = t.drum[step % t.drum.length];
      if (d === 1) noise(0.06, { vol: 0.16, filter: 220, at, dest: musicGain });
      else if (d === 2) noise(0.04, { vol: 0.09, filter: 5000, at, dest: musicGain });
    }
    nextTime += dur;
    step++;
  }
}
