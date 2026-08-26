// Everything you see. Draws into a 256x240 buffer at 1:1 pixels, then blits it
// to the visible canvas at an integer scale with smoothing off.

import {
  TILE, ROOM_W, ROOM_H, PLAY_W, PLAY_H, HUD_H, SCREEN_W, SCREEN_H,
  T, KIND, PICKUP, DOOR, N, E, S, W, DOOR_TILES, PLAYER_COLORS,
  TRANSITION_TICKS, ATTACK_TICKS,
} from '../shared/constants.js';
import { DS } from '../shared/physics.js';
import { ROOM_BY_ID, GRID_W, GRID_H, DUNGEON_NAME } from '../shared/dungeon.js';
import { IMG, TILE_IMG, HERO_IMG, bakeAll, blit, text, textCentered, textWidth, silhouette } from './art/bake.js';

const C = {
  black: '#000000', stone: '#C0C0D8', stoneMid: '#808098', stoneDark: '#404058',
  gold: '#F8B800', white: '#FCFCFC', grey: '#7C7C7C', red: '#F83800',
  blue: '#0078F8', dark: '#0A0A12', hudBg: '#000000', panel: '#16162A',
};

export class Renderer {
  constructor(canvas) {
    this.view = canvas;
    this.vctx = canvas.getContext('2d');
    this.buf = document.createElement('canvas');
    this.buf.width = SCREEN_W;
    this.buf.height = SCREEN_H;
    this.ctx = this.buf.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
    this.vctx.imageSmoothingEnabled = false;
    this.roomCache = new Map();
    this.frame = 0;
    bakeAll();
  }

  resize() {
    const pad = 8;
    const sx = Math.floor((window.innerWidth - pad) / SCREEN_W);
    const sy = Math.floor((window.innerHeight - pad) / SCREEN_H);
    const scale = Math.max(1, Math.min(sx, sy));
    this.scale = scale;
    this.view.width = SCREEN_W * scale;
    this.view.height = SCREEN_H * scale;
    this.view.style.width = `${SCREEN_W * scale}px`;
    this.view.style.height = `${SCREEN_H * scale}px`;
    this.vctx.imageSmoothingEnabled = false;
  }

  present() {
    this.vctx.imageSmoothingEnabled = false;
    this.vctx.drawImage(this.buf, 0, 0, this.view.width, this.view.height);
  }

  clear(colour = C.black) {
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  // =========================================================================
  // Rooms
  // =========================================================================
  roomCanvas(roomId, doors, pushed) {
    const key = `${roomId}|${doors.join('')}|${pushed ? 1 : 0}`;
    let c = this.roomCache.get(key);
    if (c) return c;

    const def = ROOM_BY_ID.get(roomId);
    if (!def) return null;
    c = document.createElement('canvas');
    c.width = PLAY_W; c.height = PLAY_H;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;

    const tiles = Uint8Array.from(def.tiles);
    if (pushed && def.pushBlock) {
      // mirror the server's single legal push
      const tx = def.pushBlock.ix + 1, ty = def.pushBlock.iy + 1;
      tiles[ty * ROOM_W + tx] = T.FLOOR;
    }

    g.fillStyle = C.dark;
    g.fillRect(0, 0, PLAY_W, PLAY_H);
    for (let y = 0; y < ROOM_H; y++) {
      for (let x = 0; x < ROOM_W; x++) {
        const t = tiles[y * ROOM_W + x];
        if (t === T.WATER) continue;               // animated, drawn per frame
        const img = TILE_IMG[t === T.DOORWAY ? T.FLOOR : t];
        if (img) g.drawImage(img, x * TILE, y * TILE);
      }
    }
    for (let d = 0; d < 4; d++) this.drawDoor(g, d, def.doors[d], doors[d]);

    this.roomCache.set(key, c);
    if (this.roomCache.size > 60) {
      this.roomCache.delete(this.roomCache.keys().next().value);
    }
    return c;
  }

  /** Water animates, so it is painted over the cached room each frame. */
  drawWater(roomId, ox, oy, pushed) {
    const def = ROOM_BY_ID.get(roomId);
    if (!def) return;
    const img = ((this.frame >> 5) & 1) ? TILE_IMG.water2 : TILE_IMG[T.WATER];
    const g = this.ctx;
    for (let y = 0; y < ROOM_H; y++) {
      for (let x = 0; x < ROOM_W; x++) {
        if (def.tiles[y * ROOM_W + x] === T.WATER) {
          g.drawImage(img, ox + x * TILE, oy + y * TILE);
        }
      }
    }
  }

  drawDoor(g, dir, type, state) {
    if (type === DOOR.NONE) return;
    const vertical = (dir === N || dir === S);
    const [tx, ty] = DOOR_TILES[dir][0];
    const x = tx * TILE, y = ty * TILE;
    const w = vertical ? 32 : 16;
    const h = vertical ? 16 : 16;

    // A bombable wall reads as plain wall until it is blown open.
    if (type === DOOR.BOMB && state !== DS.OPEN) {
      for (const [dx, dy] of DOOR_TILES[dir]) {
        g.drawImage(TILE_IMG[T.WALL], dx * TILE, dy * TILE);
      }
      g.fillStyle = C.black;
      const cx = x + (vertical ? 16 : 8), cy = y + 8;
      g.fillRect(cx - 1, cy - 5, 2, 3);
      g.fillRect(cx, cy - 2, 2, 3);
      g.fillRect(cx - 2, cy + 1, 2, 4);
      return;
    }

    g.fillStyle = C.black;
    g.fillRect(x, y, w, h);

    const jamb = vertical ? 7 : 4;
    g.fillStyle = C.stoneMid;
    if (vertical) {
      g.fillRect(x, y, jamb, h);
      g.fillRect(x + w - jamb, y, jamb, h);
      g.fillStyle = C.stone;
      g.fillRect(x, y, 2, h);
      g.fillRect(x + w - 2, y, 2, h);
      g.fillStyle = C.stoneDark;
      g.fillRect(x + jamb - 2, y, 2, h);
      g.fillRect(x + w - jamb, y, 2, h);
      // lintel on the outer edge
      g.fillStyle = C.stoneMid;
      if (dir === N) g.fillRect(x, y, w, 3); else g.fillRect(x, y + h - 3, w, 3);
    } else {
      g.fillRect(x, y, w, jamb);
      g.fillRect(x, y + h - jamb, w, jamb);
      g.fillStyle = C.stone;
      g.fillRect(x, y, w, 2);
      g.fillRect(x, y + h - 2, w, 2);
      g.fillStyle = C.stoneMid;
      if (dir === W) g.fillRect(x, y, 3, h); else g.fillRect(x + w - 3, y, 3, h);
    }

    if (state === DS.OPEN) return;

    // Still shut — show why.
    const cx = x + w / 2, cy = y + h / 2;
    if (type === DOOR.SHUT) {
      g.fillStyle = C.gold;
      if (vertical) {
        for (const bx of [cx - 8, cx - 2, cx + 4]) g.fillRect(bx, y + 3, 3, h - 5);
      } else {
        for (const by of [cy - 6, cy - 1, cy + 4]) g.fillRect(x + 3, by, w - 6, 2);
      }
    } else if (type === DOOR.LOCK) {
      g.fillStyle = C.gold;
      g.fillRect(cx - 5, cy - 5, 10, 10);
      g.fillStyle = C.black;
      g.fillRect(cx - 1, cy - 3, 2, 3);
      g.fillRect(cx - 2, cy, 4, 3);
    } else if (type === DOOR.BOSS) {
      g.fillStyle = C.white;
      g.fillRect(cx - 5, cy - 6, 10, 8);
      g.fillRect(cx - 4, cy + 2, 8, 3);
      g.fillStyle = C.black;
      g.fillRect(cx - 3, cy - 4, 2, 3);
      g.fillRect(cx + 1, cy - 4, 2, 3);
      g.fillRect(cx - 1, cy + 2, 2, 3);
    }
  }

  // =========================================================================
  // World
  // =========================================================================
  drawWorld(S_, alpha) {
    const g = this.ctx;
    this.frame++;
    g.save();
    g.beginPath();
    g.rect(0, HUD_H, PLAY_W, PLAY_H);
    g.clip();
    g.translate(0, HUD_H);

    const me = S_.me;
    const scroll = this.scrollOffset(S_);

    if (scroll) {
      const from = this.roomCanvas(scroll.fromId, scroll.fromDoors, false);
      if (from) g.drawImage(from, scroll.ox0, scroll.oy0);
      this.drawWater(scroll.fromId, scroll.ox0, scroll.oy0, false);
    }

    const room = this.roomCanvas(S_.room.id, S_.room.doors, S_.room.pushed);
    const ox = scroll ? scroll.ox1 : 0;
    const oy = scroll ? scroll.oy1 : 0;
    if (room) g.drawImage(room, ox, oy);
    this.drawWater(S_.room.id, ox, oy, S_.room.pushed);

    if (!scroll) {
      for (const e of S_.ents) this.drawEntity(e, 0, 0);
      for (const o of S_.others) this.drawPlayer(o.x, o.y, o.dir, o.colour, o.atk, o.walk, o.ghost, 0, o.name, 0, 0);
    }
    this.drawPlayer(me.x, me.y, me.dir, S_.colour, me.atk, me.walk, me.ghost, me.invuln, null, ox, oy);

    g.restore();
    this.drawParticles(S_);
  }

  scrollOffset(S_) {
    const me = S_.me;
    if (!me.trans || me.trans <= 0 || !me.transFrom) return null;
    const p = 1 - (me.trans / TRANSITION_TICKS);
    const dir = me.transDir;
    const dx = dir === E ? -1 : dir === W ? 1 : 0;
    const dy = dir === S ? -1 : dir === N ? 1 : 0;
    const fromDef = ROOM_BY_ID.get(me.transFrom);
    return {
      fromId: me.transFrom,
      fromDoors: fromDef ? fromDef.doors.map(t => (t === DOOR.NONE ? DS.SOLID : DS.OPEN)) : [0, 0, 0, 0],
      ox0: Math.round(dx * p * PLAY_W),
      oy0: Math.round(dy * p * PLAY_H),
      ox1: Math.round(dx * p * PLAY_W - dx * PLAY_W),
      oy1: Math.round(dy * p * PLAY_H - dy * PLAY_H),
    };
  }

  drawPlayer(x, y, dir, colour, atk, walk, ghost, invuln, name, ox = 0, oy = 0) {
    const g = this.ctx;
    if (invuln > 0 && (this.frame >> 1) % 2 === 0 && !ghost) return;
    const set = HERO_IMG[colour] || HERO_IMG.green;
    const side = dir === E || dir === W;
    const step = walk >= 8 ? 2 : 1;
    let img, flip = dir === W;

    if (atk > 0) {
      img = side ? set.HERO_ATK_E : (dir === N ? set.HERO_ATK_N : set.HERO_ATK_S);
    } else if (side) {
      img = step === 1 ? set.HERO_E1 : set.HERO_E2;
    } else if (dir === N) {
      img = step === 1 ? set.HERO_N1 : set.HERO_N2;
    } else {
      img = step === 1 ? set.HERO_S1 : set.HERO_S2;
    }

    const px = x + ox, py = y + oy;
    if (ghost) {
      g.save();
      g.globalAlpha = 0.45 + 0.15 * Math.sin(this.frame / 8);
      blit(g, silhouette(img, '#9CE0FC'), px, py, flip);
      g.restore();
    } else {
      blit(g, img, px, py, flip);
      if (atk > 0) this.drawSword(px, py, dir, atk);
    }

    if (name) {
      // 7px spacing: every glyph fits in 7 columns, so nothing overlaps.
      text(g, name, Math.round(px + 8 - textWidth(name, 7) / 2), py - 9, 'white', 7);
    }
  }

  drawSword(x, y, dir, atk) {
    const g = this.ctx;
    // The blade extends fully at the start of the swing and pulls back in.
    const reach = atk > ATTACK_TICKS - 3 ? 5 : atk > 3 ? 11 : 5;
    switch (dir) {
      case N: blit(g, IMG.SWORD_UP, x, y - reach - 4); break;
      case S: blit(g, IMG.SWORD_UP, x, y + reach + 4, false, true); break;
      case E: blit(g, IMG.SWORD_RIGHT, x + reach, y); break;
      default: blit(g, IMG.SWORD_RIGHT, x - reach, y, true); break;
    }
  }

  drawEntity(e, ox, oy) {
    const g = this.ctx;
    const f = this.frame;
    const x = e.x + ox, y = e.y + oy;
    const flash = (e.flags & 1) && ((f >> 1) & 1);
    const stunned = e.flags & 2;
    const hidden = e.flags & 4;
    let img = null, flip = false;

    switch (e.kind) {
      case KIND.BAT: img = ((f >> 2) & 1) ? IMG.BAT2 : IMG.BAT1; break;
      case KIND.SLIME:
      case KIND.SLIMELET: img = ((f >> 3) & 1) ? IMG.SLIME2 : IMG.SLIME1; break;
      case KIND.BONEWALKER: img = ((f >> 3) & 1) ? IMG.BONE2 : IMG.BONE1; break;
      case KIND.HURLER:
      case KIND.IRONCLAD: {
        const pre = e.kind === KIND.HURLER ? 'HURLER' : 'IRON';
        const alt = ((f >> 3) & 1) ? 2 : 1;
        if (e.dir === E || e.dir === W) { img = IMG[`${pre}_E${alt}`]; flip = e.dir === W; }
        else if (e.dir === N) img = IMG[`${pre}_N1`];
        else img = IMG[`${pre}_S${alt}`];
        break;
      }
      case KIND.WISP: {
        if (hidden) return;
        img = ((f >> 3) & 1) ? IMG.WISP2 : IMG.WISP1;
        break;
      }
      case KIND.GRABHAND: img = ((f >> 3) & 1) ? IMG.HAND2 : IMG.HAND1; break;
      case KIND.WYRM: img = (e.flags & 8) ? IMG.WYRM2 : IMG.WYRM1; break;

      case KIND.FIREBALL: img = IMG.FIREBALL; break;
      case KIND.MAGIC: img = IMG.MAGIC; break;
      case KIND.BLADE: img = IMG.BLADE; break;
      case KIND.BOOMERANG: img = IMG.BOOMERANG; break;
      case KIND.BEAM: {
        const vertical = e.dir === N || e.dir === S;
        img = vertical ? IMG.BEAM_V : IMG.BEAM_H;
        flip = e.dir === W;
        blit(g, img, x, y, flip, e.dir === N);
        return;
      }
      case KIND.BOMB: {
        if ((f >> 1) & 1) { blit(g, silhouette(IMG.ITEM_BOMB, '#FCFCFC'), x, y); }
        else blit(g, IMG.ITEM_BOMB, x, y);
        return;
      }
      case KIND.BLAST: {
        const stage = e.t !== undefined ? e.t : 0;
        const spr = [IMG.BLAST1, IMG.BLAST2, IMG.BLAST3][Math.min(2, ((f >> 2) % 3))];
        for (const [qx, qy] of [[0, 0], [16, 0], [0, 16], [16, 16]]) {
          blit(g, spr, x + qx, y + qy, qx > 0, qy > 0);
        }
        return;
      }
      case KIND.DROP: {
        const spr = DROP_SPRITE[e.item];
        if (!spr) return;
        let s = IMG[spr];
        if (e.item === PICKUP.FAIRY) s = ((f >> 3) & 1) ? IMG.ITEM_FAIRY2 : IMG.ITEM_FAIRY;
        // a brief twinkle so items read as pickups without losing their shape
        if ((f & 31) < 2) s = silhouette(s, '#FCFCFC');
        blit(g, s, x, y);
        return;
      }
      default: return;
    }

    if (!img) return;
    if (flash) img = silhouette(img, '#FCFCFC');
    else if (stunned && ((f >> 2) & 1)) img = silhouette(img, '#9CE0FC');
    blit(g, img, x, y, flip);
  }

  // Local one-shot puffs, spawned from server fx events.
  drawParticles(S_) {
    const g = this.ctx;
    g.save();
    g.beginPath();
    g.rect(0, HUD_H, PLAY_W, PLAY_H);
    g.clip();
    g.translate(0, HUD_H);
    for (const p of S_.particles) {
      const spr = p.kind === 'poof'
        ? [IMG.POOF1, IMG.POOF2, IMG.POOF3][Math.min(2, (p.age / 5) | 0)]
        : [IMG.BLAST1, IMG.BLAST2, IMG.BLAST3][Math.min(2, (p.age / 4) | 0)];
      blit(g, spr, p.x - 8, p.y - 8);
    }
    g.restore();
  }

  // =========================================================================
  // Status bar
  // =========================================================================
  drawHUD(S_) {
    const g = this.ctx;
    g.fillStyle = C.hudBg;
    g.fillRect(0, 0, SCREEN_W, HUD_H);
    g.fillStyle = C.stoneDark;
    g.fillRect(0, HUD_H - 2, SCREEN_W, 2);

    textCentered(g, DUNGEON_NAME, 128, 3, 'gold');

    this.drawMinimap(S_, 6, 15);

    // counters
    const P = S_.party;
    blit(g, IMG.ITEM_KEY, 66, 14);
    text(g, `x${String(P.keys).padStart(2, '0')}`, 82, 18, 'white');
    blit(g, IMG.ITEM_BOMB, 66, 28);
    text(g, `x${String(P.bombs).padStart(2, '0')}`, 82, 32, 'white');
    blit(g, IMG.ITEM_GEM, 66, 42);
    text(g, `x${String(Math.min(999, P.gems)).padStart(3, '0')}`, 82, 46, 'white');

    // item slots
    this.slot(112, 14, 'B', S_.bItem === 'boomerang' ? IMG.ITEM_BOOMERANG
      : S_.bItem === 'potion' ? IMG.ITEM_POTION
        : (P.bombs > 0 ? IMG.ITEM_BOMB : null));
    this.slot(136, 14, 'A', IMG.SWORD_UP);

    // treasures found
    let tx = 112;
    if (P.map) { blit(g, IMG.ITEM_MAP, tx, 42); tx += 14; }
    if (P.compass) { blit(g, IMG.ITEM_COMPASS, tx, 42); tx += 14; }
    if (P.skullKey) { blit(g, IMG.ITEM_SKULL_KEY, tx, 42); tx += 14; }

    // hearts
    text(g, '-LIFE-', 176, 14, 'red');
    const hearts = Math.ceil(S_.me.maxHp / 2);
    for (let i = 0; i < hearts; i++) {
      const col = i % 8, row = (i / 8) | 0;
      const left = S_.me.hp - i * 2;
      const img = left >= 2 ? IMG.HEART_FULL : left === 1 ? IMG.HEART_HALF : IMG.HEART_EMPTY;
      blit(g, img, 168 + col * 9, 24 + row * 9);
    }

    // party roster
    let px = 6;
    for (const m of S_.partyList) {
      g.fillStyle = TUNIC_DOT[m.colourIdx] || C.white;
      g.fillRect(px, 57, 4, 4);
      const n = Math.max(0, Math.ceil(m.hp / 2));
      text(g, m.ghost ? '--' : String(n).padStart(2, '0'), px + 6, 56,
        m.ghost ? 'grey' : (m.hp <= 2 ? 'red' : 'white'), 6);
      px += 26;
    }
  }

  slot(x, y, label, img) {
    const g = this.ctx;
    g.fillStyle = C.stoneDark;
    g.fillRect(x, y, 20, 22);
    g.fillStyle = C.black;
    g.fillRect(x + 1, y + 5, 18, 16);
    text(g, label, x + 7, y - 3, 'white', 6);
    if (img) blit(g, img, x + 2, y + 5);
  }

  drawMinimap(S_, mx, my) {
    const g = this.ctx;
    const cw = 7, ch = 5;
    g.fillStyle = C.panel;
    g.fillRect(mx - 1, my - 1, GRID_W * cw + 2, GRID_H * ch + 2);

    for (const [id, info] of S_.map) {
      const def = ROOM_BY_ID.get(id);
      if (!def) continue;
      const x = mx + def.gx * cw, y = my + def.gy * ch;
      if (info.visited) {
        g.fillStyle = '#3858A8';
        g.fillRect(x, y, cw - 1, ch - 1);
      } else {
        g.fillStyle = '#202038';
        g.fillRect(x, y, cw - 1, ch - 1);
      }
      if (S_.party.compass) {
        if (info.boss) { g.fillStyle = C.red; g.fillRect(x + 2, y + 1, 2, 2); }
        else if (info.item) { g.fillStyle = C.gold; g.fillRect(x + 2, y + 1, 2, 2); }
      }
    }
    // teammates, then you on top
    for (const m of S_.partyList) {
      const def = ROOM_BY_ID.get(m.room);
      if (!def || m.id === S_.myId) continue;
      g.fillStyle = TUNIC_DOT[m.colourIdx] || C.white;
      g.fillRect(mx + def.gx * cw + 1, my + def.gy * ch + 1, 3, 3);
    }
    const here = ROOM_BY_ID.get(S_.room.id);
    if (here && (this.frame >> 3) % 2 === 0) {
      g.fillStyle = C.white;
      g.fillRect(mx + here.gx * cw + 1, my + here.gy * ch + 1, 3, 3);
    }
  }

  // =========================================================================
  // Overlays and full screens
  // =========================================================================
  banner(msg) {
    if (!msg) return;
    const g = this.ctx;
    const w = textWidth(msg) + 12;
    const x = Math.round(128 - w / 2);
    const y = HUD_H + 12;
    g.fillStyle = C.black;
    g.fillRect(x, y, w, 18);
    g.fillStyle = C.gold;
    g.fillRect(x, y, w, 1);
    g.fillRect(x, y + 17, w, 1);
    g.fillRect(x, y, 1, 18);
    g.fillRect(x + w - 1, y, 1, 18);
    textCentered(g, msg, 128, y + 5, 'white');
  }

  drawTitle(ui) {
    const g = this.ctx;
    this.clear('#05050C');
    // a torchlit stone frame
    for (let x = 0; x < SCREEN_W; x += TILE) {
      g.drawImage(TILE_IMG[T.WALL], x, 0);
      g.drawImage(TILE_IMG[T.WALL], x, SCREEN_H - TILE);
    }
    for (let y = TILE; y < SCREEN_H - TILE; y += TILE) {
      g.drawImage(TILE_IMG[T.WALL], 0, y);
      g.drawImage(TILE_IMG[T.WALL], SCREEN_W - TILE, y);
    }

    textCentered(g, 'THE SUNKEN', 128, 34, 'gold');
    textCentered(g, 'CRYPT', 128, 46, 'gold');
    textCentered(g, 'A PIXEL DUNGEON FOR 1-4', 128, 64, 'grey');

    blit(g, IMG.HERO_S1 && HERO_IMG.green.HERO_S1, 96, 84);
    blit(g, IMG.BONE1, 116, 84);
    blit(g, IMG.SLIME1, 136, 84);

    if (ui.screen === 'name') {
      textCentered(g, 'WHO ENTERS?', 128, 116, 'white');
      this.field(ui.name, 128, 132, 8);
      textCentered(g, 'TYPE A NAME, THEN ENTER', 128, 154, 'grey');
    } else if (ui.screen === 'menu') {
      const opts = ['HOST A NEW PARTY', 'JOIN WITH A CODE', 'PLAY ALONE'];
      opts.forEach((o, i) => {
        const sel = ui.sel === i;
        textCentered(g, `${sel ? '>' : ' '} ${o}`, 128, 120 + i * 14, sel ? 'gold' : 'white');
      });
      textCentered(g, 'ARROWS + ENTER', 128, 170, 'grey');
    } else if (ui.screen === 'code') {
      textCentered(g, 'PARTY CODE', 128, 116, 'white');
      this.field(ui.code, 128, 132, 4);
      textCentered(g, 'ENTER TO JOIN, ESC TO GO BACK', 128, 154, 'grey');
    }

    if (ui.error) textCentered(g, ui.error, 128, 178, 'red');
    textCentered(g, 'ARROWS MOVE  Z SWORD  X ITEM', 128, 196, 'grey');
    textCentered(g, 'C SWAPS ITEM  M MUTES', 128, 208, 'grey');
  }

  field(value, cx, y, len) {
    const g = this.ctx;
    const w = len * 10 + 8;
    const x = Math.round(cx - w / 2);
    g.fillStyle = C.panel;
    g.fillRect(x, y - 4, w, 16);
    g.fillStyle = C.stoneMid;
    g.fillRect(x, y - 4, w, 1);
    g.fillRect(x, y + 11, w, 1);
    for (let i = 0; i < len; i++) {
      const ch = value[i] || '';
      const cxx = x + 4 + i * 10;
      g.fillStyle = '#000000';
      g.fillRect(cxx, y, 9, 9);
      if (ch) text(g, ch, cxx, y, 'white');
      else if (i === value.length && (this.frame >> 3) % 2 === 0) {
        g.fillStyle = C.gold;
        g.fillRect(cxx + 1, y + 7, 7, 2);
      }
    }
  }

  drawLobby(ui, S_) {
    const g = this.ctx;
    this.clear('#05050C');
    for (let x = 0; x < SCREEN_W; x += TILE) {
      g.drawImage(TILE_IMG[T.WALL], x, 0);
      g.drawImage(TILE_IMG[T.WALL], x, SCREEN_H - TILE);
    }
    textCentered(g, 'PARTY CODE', 128, 26, 'grey');
    textCentered(g, ui.code, 128, 40, 'gold');
    textCentered(g, 'SHARE IT - UP TO 4 HEROES', 128, 58, 'grey');

    ui.players.forEach((p, i) => {
      const y = 80 + i * 22;
      const set = HERO_IMG[p.colour] || HERO_IMG.green;
      blit(g, set.HERO_S1, 60, y - 4);
      text(g, p.name, 82, y, p.ready ? 'green' : 'white');
      text(g, p.ready ? 'READY' : '...', 160, y, p.ready ? 'green' : 'grey');
    });

    textCentered(g, 'PRESS ENTER WHEN READY', 128, 188, 'white');
    textCentered(g, 'THE CRYPT OPENS ONCE', 128, 204, 'grey');
    textCentered(g, 'EVERY HERO IS READY', 128, 214, 'grey');
  }

  drawGameOver(t) {
    const g = this.ctx;
    g.fillStyle = 'rgba(0,0,0,0.75)';
    g.fillRect(0, HUD_H, PLAY_W, PLAY_H);
    textCentered(g, 'THE PARTY HAS FALLEN', 128, HUD_H + 60, 'red');
    textCentered(g, 'THE CRYPT DRAWS YOU BACK...', 128, HUD_H + 80, 'grey');
  }

  drawWin(stats) {
    const g = this.ctx;
    this.clear('#05050C');
    for (let x = 0; x < SCREEN_W; x += TILE) {
      g.drawImage(TILE_IMG[T.WALL], x, 0);
      g.drawImage(TILE_IMG[T.WALL], x, SCREEN_H - TILE);
    }
    blit(g, IMG.ITEM_RELIC, 120, 30);
    textCentered(g, 'THE RELIC IS YOURS', 128, 56, 'gold');
    textCentered(g, 'THE SUNKEN CRYPT IS QUIET', 128, 70, 'grey');

    const mm = String(Math.floor(stats.time / 60)).padStart(2, '0');
    const ss = String(stats.time % 60).padStart(2, '0');
    text(g, `TIME    ${mm}:${ss}`, 60, 96, 'white');
    text(g, `SLAIN   ${String(stats.kills).padStart(3, '0')}`, 60, 108, 'white');
    text(g, `FALLEN  ${String(stats.deaths).padStart(3, '0')}`, 60, 120, 'white');
    text(g, `GEMS    ${String(stats.gems).padStart(3, '0')}`, 60, 132, 'white');

    stats.players.forEach((p, i) => {
      const set = HERO_IMG[p.colour] || HERO_IMG.green;
      blit(g, set.HERO_S1, 60, 150 + i * 16);
      text(g, `${p.name}  ${String(p.kills).padStart(3, '0')}`, 80, 154 + i * 16, 'white');
    });

    textCentered(g, 'PRESS ENTER TO DELVE AGAIN', 128, 210, 'gold');
  }

  drawConnecting(msg) {
    this.clear('#05050C');
    textCentered(this.ctx, msg, 128, 112, 'white');
  }
}

const TUNIC_DOT = ['#00A800', '#0078F8', '#F83800', '#9840F8'];

const DROP_SPRITE = {
  [PICKUP.HEART]: 'ITEM_HEART',
  [PICKUP.GEM]: 'ITEM_GEM',
  [PICKUP.GEM_BIG]: 'ITEM_GEM_BIG',
  [PICKUP.BOMB]: 'ITEM_BOMB',
  [PICKUP.KEY]: 'ITEM_KEY',
  [PICKUP.FAIRY]: 'ITEM_FAIRY',
  [PICKUP.CLOCK]: 'ITEM_CLOCK',
  [PICKUP.MAP]: 'ITEM_MAP',
  [PICKUP.COMPASS]: 'ITEM_COMPASS',
  [PICKUP.BOOMERANG]: 'ITEM_BOOMERANG',
  [PICKUP.BOMBBAG]: 'ITEM_BOMBBAG',
  [PICKUP.HEART_CONTAINER]: 'ITEM_HEART_CONTAINER',
  [PICKUP.SKULL_KEY]: 'ITEM_SKULL_KEY',
  [PICKUP.RELIC]: 'ITEM_RELIC',
  [PICKUP.POTION]: 'ITEM_POTION',
};
