// Everything you see. Draws into a 320x240 buffer at 1:1 pixels, then blits it
// to the visible canvas at an integer scale with smoothing off.
//
// The floor is bigger than the screen, so the camera follows you; anything you
// have never seen stays black, anything you have seen but cannot see now is
// drawn dim, and only what is in sight right now is lit.

import {
  TILE, VIEW_W, VIEW_H, HUD_H, SCREEN_W, SCREEN_H, KIND, CLASSES, CLASS_ORDER,
  N, E, W, ATTACK_TICKS, HUNGER_MAX, isBoss, clamp,
} from '../shared/constants.js';
import { LEVEL_W, LEVEL_H, TT, idx, tx, ty, regionOf } from '../shared/terrain.js';
import { ITEM, POTION_TINT } from '../shared/items.js';
import { RING_TINT } from '../shared/rings.js';
import { WAND_TINT } from '../shared/wands.js';
import { MOBS } from '../shared/mobs.js';
import { BUFFS } from '../shared/buffs.js';
import { TRAPS, trapById } from '../shared/traps.js';
import {
  IMG, TILE_IMG, TILE_DIM, WATER_IMG, WATER_DIM, HERO_IMG, bakeAll,
  blit, text, textCentered, textWidth, silhouette, potionImg, ringImg, wandImg,
} from './art/bake.js';

const C = {
  black: '#000000', ink: '#05070E', mid: '#808098',
  dark: '#2A2E3E', gold: '#F8B800', white: '#FCFCFC',
  red: '#F83800', green: '#40C040', blue: '#3CA0FC', panel: '#12141F',
};

const CLASS_DOT = { warrior: '#F83800', mage: '#0078F8', rogue: '#9840F8', ranger: '#00A800' };

const MOB_SPRITE = {
  [KIND.RAT]: ['RAT1', 'RAT2'],
  [KIND.SNAKE]: ['SNAKE1', 'SNAKE2'],
  [KIND.CRAB]: ['CRAB1', 'CRAB2'],
  [KIND.SLIME]: ['SLIME1', 'SLIME2'],
  [KIND.FLY]: ['FLY1', 'FLY2'],
  [KIND.SKELETON]: ['BONE1', 'BONE2'],
  [KIND.THIEF]: ['THIEF1', 'THIEF2'],
  [KIND.GUARD]: ['IRON_S1', 'IRON_S2'],
  [KIND.SHAMAN]: ['WISP1', 'WISP2'],
  [KIND.WRAITH]: ['WRAITH1', 'WRAITH2'],
  [KIND.BAT]: ['BAT1', 'BAT2'],
  [KIND.BRUTE]: ['BRUTE1', 'BRUTE2'],
  [KIND.SPIDER]: ['SPIDER1', 'SPIDER2'],
  [KIND.GOLEM]: ['GOLEM1', 'GOLEM2'],
  [KIND.MONK]: ['MONK1', 'MONK2'],
  [KIND.WARLOCK]: ['WARLOCK1', 'WARLOCK2'],
  [KIND.ELEMENTAL]: ['ELEMENTAL1', 'ELEMENTAL2'],
  [KIND.DEMON]: ['DEMON1', 'DEMON2'],
  [KIND.EYE]: ['EYE1', 'EYE2'],
  [KIND.SCORPIO]: ['SCORPIO1', 'SCORPIO2'],
  [KIND.SHEEP]: ['SHEEP1', 'SHEEP2'],
  [KIND.BOSS_GLUT]: ['BOSS_GLUT1', 'BOSS_GLUT2'],
  [KIND.BOSS_WARDEN]: ['BOSS_WARDEN1', 'BOSS_WARDEN2'],
  [KIND.BOSS_TYRANT]: ['BOSS_TYRANT1', 'BOSS_TYRANT2'],
  [KIND.BOSS_KING]: ['BOSS_KING1', 'BOSS_KING2'],
  [KIND.BOSS_UNSLEEPING]: ['BOSS_UNSLEEPING1', 'BOSS_UNSLEEPING2'],
};

const SHOT_SPRITE = {
  [KIND.ARROW]: 'BLADE', [KIND.BOLT]: 'MAGIC', [KIND.FIREBALL]: 'FIREBALL',
  [KIND.DART]: 'BLADE', [KIND.WEB]: 'MAGIC', [KIND.ACID]: 'FIREBALL',
  [KIND.BEAM]: 'MAGIC',
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
    this.frame = 0;
    this.cam = { x: 0, y: 0 };
    this.boss = null;
    bakeAll();
  }

  resize() {
    const sx = Math.floor((window.innerWidth - 8) / SCREEN_W);
    const sy = Math.floor((window.innerHeight - 8) / SCREEN_H);
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

  clear(colour = C.ink) {
    this.ctx.fillStyle = colour;
    this.ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  // =========================================================================
  // The floor
  // =========================================================================
  drawWorld(st) {
    this.frame++;
    this.boss = null;
    const g = this.ctx;
    const region = st.region || 'sewers';
    const tiles = st.tiles, fov = st.fov, seen = st.explored;

    const camX = clamp(Math.round(st.me.x + 8 - VIEW_W / 2), 0, LEVEL_W * TILE - VIEW_W);
    const camY = clamp(Math.round(st.me.y + 8 - VIEW_H / 2), 0, LEVEL_H * TILE - VIEW_H);
    this.cam.x = camX; this.cam.y = camY;

    g.save();
    g.beginPath();
    g.rect(0, HUD_H, VIEW_W, VIEW_H);
    g.clip();
    g.translate(-camX, HUD_H - camY);

    g.fillStyle = C.black;
    g.fillRect(camX, camY, VIEW_W, VIEW_H);

    const lit = TILE_IMG[region] || TILE_IMG.sewers;
    const remembered = TILE_DIM[region] || TILE_DIM.sewers;
    const wf = (this.frame >> 5) & 1;
    const water = (WATER_IMG[region] || WATER_IMG.sewers)[wf];
    const waterDim = (WATER_DIM[region] || WATER_DIM.sewers)[wf];

    const x0 = Math.max(0, (camX / TILE) | 0);
    const y0 = Math.max(0, (camY / TILE) | 0);
    const x1 = Math.min(LEVEL_W - 1, ((camX + VIEW_W) / TILE) | 0);
    const y1 = Math.min(LEVEL_H - 1, ((camY + VIEW_H) / TILE) | 0);

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = idx(x, y);
        const visible = fov[i];
        if (!visible && !seen[i]) continue;
        let t = tiles[i];
        if (t === TT.TRAP_HIDDEN) t = TT.FLOOR;
        if (t === TT.SECRET_DOOR) t = TT.WALL;   // it is a wall until it isn't
        const img = t === TT.WATER ? (visible ? water : waterDim)
                                   : (visible ? lit[t] : remembered[t]);
        if (img) g.drawImage(img, x * TILE, y * TILE);
        // a revealed trap wears the colour of what it will do to you
        if (t === TT.TRAP && st.traps) {
          const def = TRAPS[trapById(st.traps[i])];
          if (def) {
            g.fillStyle = def.colour;
            g.globalAlpha = visible ? 1 : 0.4;
            g.fillRect(x * TILE + 6, y * TILE + 6, 4, 4);
            g.globalAlpha = 1;
          }
        }
      }
    }

    for (const e of st.items) this.drawItem(e, st);
    for (const e of st.ents) this.drawEntity(e);
    for (const o of st.others) {
      this.drawHero(o.x, o.y, o.dir, CLASS_ORDER[o.clsIdx] || 'warrior',
        o.atk, o.walk, o.ghost, 0, o.name, o.invis);
    }
    this.drawHero(st.me.x, st.me.y, st.me.dir, st.me.cls, st.me.atk, st.me.walk,
      st.me.ghost, st.me.invuln, null, st.me.invis);

    for (const p of st.particles) {
      const spr = p.kind === 'poof'
        ? [IMG.POOF1, IMG.POOF2, IMG.POOF3][Math.min(2, (p.age / 5) | 0)]
        : [IMG.BLAST1, IMG.BLAST2, IMG.BLAST3][Math.min(2, (p.age / 4) | 0)];
      blit(g, spr, p.x - 8, p.y - 8);
    }

    g.restore();
  }

  drawHero(x, y, dir, cls, atk, walk, ghost, invuln, name, invis) {
    const g = this.ctx;
    if (invuln > 0 && (this.frame >> 1) % 2 === 0 && !ghost) return;
    const set = HERO_IMG[cls] || HERO_IMG.warrior;
    const side = dir === E || dir === W;
    const step = walk >= 8 ? 2 : 1;
    const flip = dir === W;
    let img;

    if (atk > 0) img = side ? set.HERO_ATK_E : (dir === N ? set.HERO_ATK_N : set.HERO_ATK_S);
    else if (side) img = step === 1 ? set.HERO_E1 : set.HERO_E2;
    else if (dir === N) img = step === 1 ? set.HERO_N1 : set.HERO_N2;
    else img = step === 1 ? set.HERO_S1 : set.HERO_S2;

    if (ghost) {
      g.save();
      g.globalAlpha = 0.4 + 0.15 * Math.sin(this.frame / 8);
      blit(g, silhouette(img, '#9CE0FC'), x, y, flip);
      g.restore();
    } else {
      if (invis > 0) { g.save(); g.globalAlpha = 0.35; }
      blit(g, img, x, y, flip);
      if (invis > 0) g.restore();
      if (atk > 0) this.drawSword(x, y, dir, atk);
    }
    if (name) text(g, name, Math.round(x + 8 - textWidth(name, 7) / 2), y - 9, 'white', 7);
  }

  drawSword(x, y, dir, atk) {
    const g = this.ctx;
    const reach = atk > ATTACK_TICKS - 3 ? 5 : atk > 3 ? 11 : 5;
    switch (dir) {
      case N: blit(g, IMG.SWORD_UP, x, y - reach - 4); break;
      case E: blit(g, IMG.SWORD_RIGHT, x + reach, y); break;
      case W: blit(g, IMG.SWORD_RIGHT, x - reach, y, true); break;
      default: blit(g, IMG.SWORD_UP, x, y + reach + 4, false, true); break;
    }
  }

  drawEntity(e) {
    const g = this.ctx;
    const f = this.frame;
    const flash = (e.flags & 1) && ((f >> 1) & 1);
    const frozen = e.flags & 2;
    const hidden = e.flags & 4;
    const mouth = e.flags & 8;

    const pair = MOB_SPRITE[e.kind];
    if (pair) {
      if (hidden) return;
      const big = isBoss(e.kind);
      let img = IMG[big ? (mouth ? pair[1] : pair[0]) : (((f >> 3) & 1) ? pair[1] : pair[0])];
      if (!img) return;
      const burning = e.flags & (1 << 5);
      const poisoned = e.flags & (2 << 5);
      const held = e.flags & (4 << 5);
      const maddened = e.flags & (8 << 5);
      const warded = e.flags & (16 << 5);
      const asleep = e.flags & (32 << 5);
      if (flash) img = silhouette(img, '#FCFCFC');
      else if (burning && ((f >> 1) & 1)) img = silhouette(img, '#F86018');
      else if ((frozen || held) && ((f >> 2) & 1)) img = silhouette(img, '#9CE0FC');
      else if (poisoned && ((f >> 3) & 3) === 0) img = silhouette(img, '#58C038');
      else if (maddened && ((f >> 2) & 1)) img = silhouette(img, '#B048C8');
      else if (warded && ((f >> 2) & 1)) img = silhouette(img, '#68C8F8');
      else if (e.flags & 16) img = silhouette(img, '#F87038');
      blit(g, img, e.x, e.y);
      if (asleep && ((f >> 4) & 1)) text(g, 'Z', e.x + 12, e.y - 6, 'blue', 6);
      if (big) this.boss = e;
      else if (e.hp < e.maxHp) this.mobBar(e);
      return;
    }

    const shot = SHOT_SPRITE[e.kind];
    if (shot) { blit(g, IMG[shot], e.x, e.y); return; }

    if (e.kind === KIND.THROWN) {
      blit(g, IMG.THROWN, e.x, e.y);
      return;
    }
    if (e.kind === KIND.WARD) {
      blit(g, ((f >> 3) & 1) ? IMG.WARD2 : IMG.WARD1, e.x - 4, e.y - 4);
      return;
    }
    if (e.kind === KIND.BOMB) {
      blit(g, ((f >> 1) & 1) ? silhouette(IMG.ITEM_BOMB, '#FCFCFC') : IMG.ITEM_BOMB, e.x, e.y);
      return;
    }
    if (e.kind === KIND.BLAST) {
      const spr = [IMG.BLAST1, IMG.BLAST2, IMG.BLAST3][Math.min(2, ((f >> 2) % 3))];
      for (const [qx, qy] of [[0, 0], [16, 0], [0, 16], [16, 16]]) {
        blit(g, spr, e.x + qx, e.y + qy, qx > 0, qy > 0);
      }
    }
  }

  mobBar(e) {
    const g = this.ctx;
    const w = 14;
    const frac = Math.max(0, e.hp / Math.max(1, e.maxHp));
    g.fillStyle = '#000000';
    g.fillRect(e.x + 1, e.y - 4, w, 3);
    g.fillStyle = frac > 0.5 ? C.green : frac > 0.25 ? C.gold : C.red;
    g.fillRect(e.x + 1, e.y - 4, Math.max(1, Math.round(w * frac)), 3);
  }

  drawItem(e, st) {
    const img = this.itemImage(e, st);
    if (!img) return;
    blit(this.ctx, img, e.x, e.y);
    if ((this.frame & 31) < 3) blit(this.ctx, IMG.ITEM_SPARKLE, e.x, e.y);
    if (e.price) {
      // adjacent shelves would overlap, so lift every other column a little
      const tag = `${e.price}`;
      const w = textWidth(tag, 7);
      const tagX = Math.round(e.x + 8 - w / 2);
      const tagY = e.y - ((Math.round(e.x / 16) & 1) ? 13 : 7);
      this.ctx.fillStyle = 'rgba(0,0,0,0.75)';
      this.ctx.fillRect(tagX - 1, tagY - 1, w + 2, 9);
      text(this.ctx, tag, tagX, tagY, '#F8B800', 7);
    }
  }

  itemImage(e, st) {
    switch (e.type) {
      case ITEM.GOLD: return IMG.GOLD_PILE;
      case ITEM.FOOD: return IMG.RATION;
      case ITEM.BOMB: return IMG.ITEM_BOMB;
      case ITEM.KEY: return IMG.ITEM_KEY;
      case ITEM.GOLDKEY: return IMG.GOLD_KEY;
      case ITEM.RELIC: return IMG.AMULET;
      case ITEM.WEAPON: return IMG.SWORD_ICON;
      case ITEM.ARMOR: return IMG.ARMOR_ICON;
      case ITEM.SCROLL: return IMG.SCROLL;
      case ITEM.POTION: {
        const look = st.app?.potionLook?.[e.kind];
        return potionImg(POTION_TINT[look] || '#FCFCFC');
      }
      case ITEM.RING: {
        const look = st.app?.ringLook?.[e.kind];
        return ringImg(RING_TINT[look] || '#FCFCFC');
      }
      case ITEM.WAND: {
        const look = st.app?.wandLook?.[e.kind];
        return wandImg(WAND_TINT[look] || '#FCFCFC');
      }
      case ITEM.MISSILE: return IMG.MISSILE;
      default: return null;
    }
  }

  // =========================================================================
  // Status bar
  // =========================================================================
  drawHUD(st) {
    const g = this.ctx;
    g.fillStyle = C.panel;
    g.fillRect(0, 0, SCREEN_W, HUD_H);
    g.fillStyle = C.dark;
    g.fillRect(0, HUD_H - 1, SCREEN_W, 1);

    this.drawMinimap(st, 3, 8);

    const region = regionOf(st.depth);
    const me = st.me;
    text(g, `FLOOR ${String(st.depth).padStart(2, '0')}`, 42, 3, 'gold', 7);
    text(g, region.name, 42, 12, 'grey', 6);

    const hpFrac = Math.max(0, me.hp / Math.max(1, me.maxHp));
    this.bar(42, 21, 92, 6, hpFrac, hpFrac > 0.5 ? C.green : hpFrac > 0.25 ? C.gold : C.red);
    text(g, `${me.hp}/${me.maxHp}`, 138, 21, 'white', 6);

    this.bar(42, 29, 92, 4, Math.min(1, me.xp / Math.max(1, me.xpNext)), C.blue);
    text(g, `LV${me.level}`, 138, 29, 'blue', 6);
    if (st.perkPoints > 0 && (this.frame >> 4) % 2 === 0) {
      text(g, `+${st.perkPoints} K`, 160, 29, 'gold', 6);
    }

    const hunger = Math.max(0, Math.min(1, me.hunger / HUNGER_MAX));
    this.bar(42, 36, 92, 3, hunger, hunger > 0.25 ? '#B07030' : C.red);
    text(g, hunger > 0 ? 'FED' : 'STARVED', 138, 36, hunger > 0 ? 'grey' : 'red', 6);

    blit(g, IMG.GOLD_PILE, 170, -2);
    text(g, String(me.gold), 186, 3, 'gold', 6);
    text(g, CLASSES[me.cls]?.name || '', 236, 3, 'grey', 6);

    for (let i = 0; i < 8; i++) {
      const x = 180 + i * 17;
      const slot = (st.bag || [])[i];
      g.fillStyle = slot ? C.dark : '#0A0C14';
      g.fillRect(x, 13, 16, 16);
      g.fillStyle = '#000000';
      g.fillRect(x + 1, 14, 14, 14);
      if (slot) {
        const img = this.itemImage({ type: slot.item.type, kind: slot.item.kind }, st);
        if (img) blit(g, img, x, 13);
        if (slot.item.type === ITEM.WAND) {
          // a wand shows what it has left, not how many you carry
          const n = slot.item.charges ?? 0;
          text(g, String(n), x + 9, 23, n > 0 ? 'blue' : 'red', 6);
        } else if (slot.count > 1) {
          text(g, String(slot.count), x + 9, 23, 'white', 6);
        }
      }
      text(g, String(i + 1), x + 5, 31, slot ? 'grey' : 'dark', 6);
    }

    this.drawBuffs(st, 176, 33);

    let px = 42;
    for (const m of st.party) {
      g.fillStyle = CLASS_DOT[m.cls] || C.white;
      g.fillRect(px, 42, 3, 3);
      const label = m.ghost ? 'DOWN' : String(m.hp);
      text(g, `${m.name.slice(0, 4)} ${label} F${m.depth}`, px + 5, 41,
        m.ghost ? 'red' : (m.id === st.myId ? 'white' : 'grey'), 6);
      px += 68;
    }
  }

  /** Little coloured chips for whatever is currently happening to you. */
  drawBuffs(st, x, y) {
    const g = this.ctx;
    const list = (st.buffs || []).slice(0, 10);
    list.forEach((b, i) => {
      const def = BUFFS[b.id];
      if (!def) return;
      const cx = x + i * 14;
      const expiring = b.t < 60 && (this.frame >> 2) % 2 === 0;
      g.fillStyle = expiring ? '#000000' : (def.colour || '#FCFCFC');
      g.fillRect(cx, y, 12, 9);
      g.fillStyle = '#000000';
      g.fillRect(cx, y, 12, 1);
      g.fillRect(cx, y + 8, 12, 1);
      text(g, def.short, cx + 1, y + 1, 'black', 4);
    });
    if (st.shield > 0) {
      const cx = x + list.length * 14;
      g.fillStyle = '#68C8F8';
      g.fillRect(cx, y, 12, 9);
      text(g, String(Math.min(99, st.shield)), cx + 2, y + 1, 'black', 5);
    }
  }

  bar(x, y, w, h, frac, colour) {
    const g = this.ctx;
    g.fillStyle = '#000000';
    g.fillRect(x, y, w, h);
    g.fillStyle = colour;
    g.fillRect(x + 1, y + 1, Math.max(0, Math.round((w - 2) * frac)), h - 2);
  }

  /** One pixel per tile — the whole floor fits in the corner of the bar. */
  drawMinimap(st, mx, my) {
    const g = this.ctx;
    g.fillStyle = '#000000';
    g.fillRect(mx - 1, my - 1, LEVEL_W + 2, LEVEL_H + 2);

    const tiles = st.tiles, seen = st.explored, fov = st.fov;
    for (let y = 0; y < LEVEL_H; y++) {
      for (let x = 0; x < LEVEL_W; x++) {
        const i = idx(x, y);
        if (!seen[i]) continue;
        const t = tiles[i];
        let col;
        if (t === TT.WALL || t === TT.WALL_DECO) col = '#22283A';
        else if (t === TT.EXIT || t === TT.LOCKED_EXIT) col = C.gold;
        else if (t === TT.ENTRANCE) col = '#C0C0D8';
        else if (t === TT.LOCKED_DOOR) col = '#F8B800';
        else if (t === TT.DOOR || t === TT.OPEN_DOOR) col = '#8C6A28';
        else if (t === TT.WATER) col = '#25507A';
        else if (t === TT.CHASM) col = '#000000';
        else col = fov[i] ? '#5A6480' : '#3A4058';
        g.fillStyle = col;
        g.fillRect(mx + x, my + y, 1, 1);
      }
    }
    for (const m of st.party) {
      if (m.depth !== st.depth || m.tile == null || m.id === st.myId) continue;
      g.fillStyle = CLASS_DOT[m.cls] || C.white;
      g.fillRect(mx + tx(m.tile), my + ty(m.tile), 1, 1);
    }
    if ((this.frame >> 3) % 2 === 0) {
      g.fillStyle = C.white;
      g.fillRect(mx + ((st.me.x + 8) >> 4), my + ((st.me.y + 8) >> 4), 1, 1);
    }
  }

  // =========================================================================
  // Overlays
  // =========================================================================
  banner(msg) {
    if (!msg) return;
    const g = this.ctx;
    const w = textWidth(msg, 7) + 12;
    const x = Math.round(SCREEN_W / 2 - w / 2);
    const y = HUD_H + 8;
    g.fillStyle = 'rgba(0,0,0,0.85)';
    g.fillRect(x, y, w, 16);
    g.fillStyle = C.gold;
    g.fillRect(x, y, w, 1);
    g.fillRect(x, y + 15, w, 1);
    textCentered(g, msg, SCREEN_W / 2, y + 4, 'white', 7);
  }

  bossBanner() {
    const e = this.boss;
    if (!e) return;
    const g = this.ctx;
    const st = MOBS[e.kind];
    const frac = Math.max(0, e.hp / Math.max(1, e.maxHp));
    g.fillStyle = 'rgba(0,0,0,0.8)';
    g.fillRect(40, SCREEN_H - 20, SCREEN_W - 80, 16);
    textCentered(g, st?.name || 'BOSS', SCREEN_W / 2, SCREEN_H - 19, 'red', 6);
    this.bar(44, SCREEN_H - 11, SCREEN_W - 88, 5, frac, C.red);
  }

  prompt(msg) {
    textCentered(this.ctx, msg, SCREEN_W / 2, SCREEN_H - 12, 'gold', 7);
  }

  // =========================================================================
  // Screens
  // =========================================================================
  frameBox() {
    const g = this.ctx;
    const wall = TILE_IMG.prison?.[TT.WALL];
    if (!wall) return;
    for (let x = 0; x < SCREEN_W; x += TILE) {
      g.drawImage(wall, x, 0);
      g.drawImage(wall, x, SCREEN_H - TILE);
    }
    for (let y = TILE; y < SCREEN_H - TILE; y += TILE) {
      g.drawImage(wall, 0, y);
      g.drawImage(wall, SCREEN_W - TILE, y);
    }
  }

  drawTitle(ui) {
    const g = this.ctx;
    this.clear('#05070E');
    this.frameBox();
    textCentered(g, 'PIXEL DUNGEON', SCREEN_W / 2, 26, 'gold');
    textCentered(g, 'TWENTY-FIVE FLOORS DOWN', SCREEN_W / 2, 40, 'grey', 7);

    CLASS_ORDER.forEach((cls, i) => {
      blit(g, HERO_IMG[cls]?.HERO_S1, 108 + i * 28, 54);
    });

    if (ui.screen === 'name') {
      textCentered(g, 'WHO GOES DOWN?', SCREEN_W / 2, 88, 'white', 7);
      this.field(ui.name, SCREEN_W / 2, 104, 8);
      textCentered(g, 'TYPE A NAME, THEN ENTER', SCREEN_W / 2, 128, 'grey', 7);
    } else if (ui.screen === 'class') {
      textCentered(g, 'CHOOSE YOUR HERO', SCREEN_W / 2, 82, 'white', 7);
      CLASS_ORDER.forEach((cls, i) => {
        const sel = ui.cls === i;
        const y = 96 + i * 18;
        const def = CLASSES[cls];
        if (sel) { g.fillStyle = '#1A2036'; g.fillRect(44, y - 4, 232, 17); }
        blit(g, HERO_IMG[cls]?.HERO_S1, 48, y - 4);
        text(g, def.name, 68, y, sel ? 'gold' : 'white', 7);
        text(g, def.blurb, 128, y + 1, sel ? 'white' : 'dark', 5);
      });
      textCentered(g, 'ARROWS + ENTER', SCREEN_W / 2, 176, 'grey', 7);
    } else if (ui.screen === 'menu') {
      const opts = ['HOST A PARTY', 'JOIN WITH A CODE', 'DELVE ALONE'];
      opts.forEach((o, i) => {
        const sel = ui.sel === i;
        textCentered(g, `${sel ? '>' : ' '} ${o}`, SCREEN_W / 2, 96 + i * 16, sel ? 'gold' : 'white', 7);
      });
      textCentered(g, 'ARROWS + ENTER', SCREEN_W / 2, 156, 'grey', 7);
    } else if (ui.screen === 'code') {
      textCentered(g, 'PARTY CODE', SCREEN_W / 2, 92, 'white', 7);
      this.field(ui.code, SCREEN_W / 2, 108, 4);
      textCentered(g, 'ENTER TO JOIN, ESC TO GO BACK', SCREEN_W / 2, 132, 'grey', 7);
    }

    if (ui.error) textCentered(g, ui.error, SCREEN_W / 2, 190, 'red', 7);
    textCentered(g, 'ARROWS MOVE   Z ATTACK   X ABILITY', SCREEN_W / 2, 204, 'grey', 7);
    textCentered(g, 'E STAIRS   1-8 ITEMS   M MUTE', SCREEN_W / 2, 214, 'grey', 7);
  }

  field(value, cx, y, len) {
    const g = this.ctx;
    const w = len * 10 + 8;
    const x = Math.round(cx - w / 2);
    g.fillStyle = C.panel;
    g.fillRect(x, y - 4, w, 16);
    g.fillStyle = C.mid;
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

  drawLobby(ui) {
    const g = this.ctx;
    this.clear('#05070E');
    this.frameBox();
    textCentered(g, 'PARTY CODE', SCREEN_W / 2, 26, 'grey', 7);
    textCentered(g, ui.code, SCREEN_W / 2, 38, 'gold');
    textCentered(g, 'SHARE IT - UP TO 4 HEROES', SCREEN_W / 2, 56, 'grey', 7);

    ui.players.forEach((p, i) => {
      const y = 80 + i * 24;
      blit(g, HERO_IMG[p.cls]?.HERO_S1, 70, y - 4);
      text(g, p.name, 92, y, p.ready ? 'green' : 'white', 7);
      text(g, CLASSES[p.cls]?.name || '', 152, y, 'grey', 7);
      text(g, p.ready ? 'READY' : '...', 218, y, p.ready ? 'green' : 'grey', 7);
    });

    textCentered(g, 'C CHANGES CLASS   ENTER WHEN READY', SCREEN_W / 2, 192, 'white', 7);
    textCentered(g, 'THE DUNGEON OPENS WHEN ALL ARE READY', SCREEN_W / 2, 208, 'grey', 6);
  }

  drawEnd(stats, won) {
    const g = this.ctx;
    this.clear('#05070E');
    this.frameBox();
    if (won) {
      blit(g, IMG.AMULET, SCREEN_W / 2 - 8, 24);
      textCentered(g, 'THE AMULET IS YOURS', SCREEN_W / 2, 46, 'gold');
      textCentered(g, 'THE DUNGEON IS BEATEN', SCREEN_W / 2, 60, 'grey', 7);
    } else {
      textCentered(g, 'THE PARTY HAS FALLEN', SCREEN_W / 2, 40, 'red');
      textCentered(g, 'THE DUNGEON KEEPS WHAT IT TAKES', SCREEN_W / 2, 56, 'grey', 7);
    }

    const mm = String(Math.floor(stats.time / 60)).padStart(2, '0');
    const ss = String(stats.time % 60).padStart(2, '0');
    text(g, `DEEPEST FLOOR  ${String(stats.deepest).padStart(2, '0')}`, 80, 82, 'white', 7);
    text(g, `TIME           ${mm}:${ss}`, 80, 94, 'white', 7);
    text(g, `SLAIN          ${String(stats.kills).padStart(3, '0')}`, 80, 106, 'white', 7);
    text(g, `FALLEN         ${String(stats.deaths).padStart(3, '0')}`, 80, 118, 'white', 7);

    (stats.players || []).forEach((p, i) => {
      const y = 138 + i * 16;
      blit(g, HERO_IMG[p.cls]?.HERO_S1, 74, y - 4);
      text(g, `${p.name} LV${String(p.level).padStart(2, '0')} ${String(p.kills).padStart(3, '0')} SLAIN`,
        94, y, 'white', 6);
    });

    textCentered(g, 'PRESS ENTER TO DELVE AGAIN', SCREEN_W / 2, 212, 'gold', 7);
  }

  drawConnecting(msg) {
    this.clear('#05070E');
    textCentered(this.ctx, msg, SCREEN_W / 2, SCREEN_H / 2 - 4, 'white', 7);
  }
}
