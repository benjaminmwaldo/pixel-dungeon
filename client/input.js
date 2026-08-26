// Keyboard, gamepad and touch, folded into one six-button controller.

import { IN } from '../shared/constants.js';

const KEY_BITS = {
  ArrowUp: IN.UP, KeyW: IN.UP,
  ArrowDown: IN.DOWN, KeyS: IN.DOWN,
  ArrowLeft: IN.LEFT, KeyA: IN.LEFT,
  ArrowRight: IN.RIGHT, KeyD: IN.RIGHT,
  KeyZ: IN.A, KeyJ: IN.A,
  KeyX: IN.B, KeyK: IN.B,
};

export class Input {
  constructor() {
    this.down = new Set();
    this.touch = 0;
    this.textMode = false;
    this.handlers = [];
    this.padWas = 0;

    window.addEventListener('keydown', (e) => this.onKeyDown(e));
    window.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
    });
    window.addEventListener('blur', () => this.down.clear());
    this.bindTouch();
  }

  on(fn) { this.handlers.push(fn); }
  emit(ev) { for (const h of this.handlers) h(ev); }

  onKeyDown(e) {
    // Don't let the page scroll out from under the game.
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    if (e.repeat) {
      if (this.textMode) return;
      return;
    }
    this.down.add(e.code);

    if (this.textMode) {
      if (/^Key[A-Z]$/.test(e.code)) { this.emit({ type: 'char', ch: e.code[3] }); return; }
      if (/^Digit[0-9]$/.test(e.code)) { this.emit({ type: 'char', ch: e.code[5] }); return; }
      if (e.code === 'Backspace') { this.emit({ type: 'back' }); return; }
    }

    if (/^Digit[1-8]$/.test(e.code)) { this.emit({ type: 'slot', n: Number(e.code[5]) - 1 }); return; }

    if (e.code === 'Tab') e.preventDefault();

    switch (e.code) {
      case 'KeyE': case 'Space': this.emit({ type: 'act' }); break;
      case 'KeyI': this.emit({ type: 'pack' }); break;
      case 'KeyK': this.emit({ type: 'skills' }); break;
      case 'Tab': this.emit({ type: 'tab' }); break;
      case 'Enter': case 'NumpadEnter': this.emit({ type: 'start' }); break;
      case 'Escape': this.emit({ type: 'cancel' }); break;
      case 'KeyC': case 'ShiftLeft': case 'ShiftRight': this.emit({ type: 'cycle' }); break;
      case 'KeyM': this.emit({ type: 'mute' }); break;
      case 'ArrowUp': case 'KeyW': this.emit({ type: 'up' }); break;
      case 'ArrowDown': case 'KeyS': this.emit({ type: 'down' }); break;
      case 'ArrowLeft': case 'KeyA': this.emit({ type: 'left' }); break;
      case 'ArrowRight': case 'KeyD': this.emit({ type: 'right' }); break;
      case 'KeyZ': case 'KeyJ': this.emit({ type: 'a' }); break;
      case 'KeyX': case 'KeyK': this.emit({ type: 'b' }); break;
    }
  }

  bindTouch() {
    const map = {
      'pad-up': IN.UP, 'pad-down': IN.DOWN, 'pad-left': IN.LEFT, 'pad-right': IN.RIGHT,
      'btn-a': IN.A, 'btn-b': IN.B,
    };
    for (const [id, bit] of Object.entries(map)) {
      const el = document.getElementById(id);
      if (!el) continue;
      const on = (e) => { e.preventDefault(); this.touch |= bit; el.classList.add('held'); };
      const off = (e) => { e.preventDefault(); this.touch &= ~bit; el.classList.remove('held'); };
      el.addEventListener('pointerdown', on);
      el.addEventListener('pointerup', off);
      el.addEventListener('pointercancel', off);
      el.addEventListener('pointerleave', off);
    }
    const extra = { 'btn-start': 'start', 'btn-cycle': 'cycle' };
    for (const [id, ev] of Object.entries(extra)) {
      const el = document.getElementById(id);
      if (el) el.addEventListener('pointerdown', (e) => { e.preventDefault(); this.emit({ type: ev }); });
    }
  }

  padBits() {
    if (!navigator.getGamepads) return 0;
    const pads = navigator.getGamepads();
    let bits = 0;
    for (const pad of pads) {
      if (!pad) continue;
      const [ax = 0, ay = 0] = pad.axes;
      if (ax < -0.4) bits |= IN.LEFT;
      if (ax > 0.4) bits |= IN.RIGHT;
      if (ay < -0.4) bits |= IN.UP;
      if (ay > 0.4) bits |= IN.DOWN;
      const b = pad.buttons;
      if (b[12]?.pressed) bits |= IN.UP;
      if (b[13]?.pressed) bits |= IN.DOWN;
      if (b[14]?.pressed) bits |= IN.LEFT;
      if (b[15]?.pressed) bits |= IN.RIGHT;
      if (b[0]?.pressed || b[2]?.pressed) bits |= IN.A;
      if (b[1]?.pressed || b[3]?.pressed) bits |= IN.B;
      if (b[9]?.pressed && !(this.padWas & 256)) this.emit({ type: 'start' });
      if (b[4]?.pressed && !(this.padWas & 512)) this.emit({ type: 'cycle' });
      this.padWas = (b[9]?.pressed ? 256 : 0) | (b[4]?.pressed ? 512 : 0);
    }
    return bits;
  }

  bits() {
    let b = this.touch | this.padBits();
    if (!this.textMode) {
      for (const code of this.down) b |= KEY_BITS[code] || 0;
    } else {
      for (const code of this.down) {
        if (code.startsWith('Arrow')) b |= KEY_BITS[code] || 0;
      }
    }
    return b;
  }
}
