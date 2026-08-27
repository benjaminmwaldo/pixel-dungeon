// Timed effects on actors.
//
// Nearly everything Pixel Dungeon does to you is one of these: a trap applies
// one, a potion applies one, an enchantment applies one, a monster applies one.
// Building it once means the rest of the game is mostly a table.
//
// SPD counts durations in turns; a turn here is about a third of a second of
// walking, so a "20 turn" effect becomes ~200 ticks.

export const B = {
  // damage over time
  BURNING: 'burning', POISON: 'poison', BLEEDING: 'bleeding', CORROSION: 'corrosion',
  // movement
  FROZEN: 'frozen', ROOTS: 'roots', CRIPPLE: 'cripple', SLOW: 'slow',
  HASTE: 'haste', LEVITATION: 'levitation', OOZE: 'ooze',
  // control
  PARALYSIS: 'paralysis', SLEEP: 'sleep', TERROR: 'terror', AMOK: 'amok', CHARM: 'charm',
  // senses
  BLINDNESS: 'blindness', MIND_VISION: 'mindVision', MAGICAL_SIGHT: 'magicalSight',
  LIGHT: 'light', FORESIGHT: 'foresight',
  // combat maths
  WEAKNESS: 'weakness', HEX: 'hex', BLESS: 'bless', FURY: 'fury',
  BARKSKIN: 'barkskin', BARRIER: 'barrier', VULNERABLE: 'vulnerable',
  // upkeep
  HEALING: 'healing', REGEN: 'regen', RECHARGING: 'recharging',
  INVISIBLE: 'invisible', DOOM: 'doom', MIGHT: 'might',
};

// bad: shown in red and cleansed by cleansing effects
// dot:  damage per tick window; every: how many ticks between ticks of damage
// move: multiplier on movement speed
// dealt/taken: multipliers on damage given and received
// sight: tiles added to your view
// ai: what it does to a monster's decisions
export const BUFFS = {
  [B.BURNING]:   { name: 'BURNING', short: 'BRN', bad: true, dot: 2, every: 18, colour: '#F86018', spreads: true },
  [B.POISON]:    { name: 'POISONED', short: 'PSN', bad: true, dot: 1, every: 22, colour: '#58C038' },
  [B.BLEEDING]:  { name: 'BLEEDING', short: 'BLD', bad: true, dot: 2, every: 26, colour: '#C01818', decays: true },
  [B.CORROSION]: { name: 'CORRODED', short: 'COR', bad: true, dot: 3, every: 20, colour: '#A8D018' },

  [B.FROZEN]:    { name: 'FROZEN', short: 'FRZ', bad: true, move: 0, freeze: true, colour: '#9CE0FC' },
  [B.ROOTS]:     { name: 'ROOTED', short: 'ROO', bad: true, move: 0, colour: '#8C6A28' },
  [B.CRIPPLE]:   { name: 'CRIPPLED', short: 'CRP', bad: true, move: 0.5, colour: '#C07830' },
  [B.SLOW]:      { name: 'SLOWED', short: 'SLW', bad: true, move: 0.55, colour: '#7898C8' },
  [B.OOZE]:      { name: 'OOZED', short: 'OOZ', bad: true, move: 0.7, dot: 1, every: 30, colour: '#68A028' },
  [B.HASTE]:     { name: 'HASTENED', short: 'HST', move: 1.6, colour: '#F8E058' },
  [B.LEVITATION]:{ name: 'LEVITATING', short: 'LEV', fly: true, colour: '#C0C0FC' },

  [B.PARALYSIS]: { name: 'PARALYSED', short: 'PAR', bad: true, move: 0, freeze: true, colour: '#F8F858' },
  [B.SLEEP]:     { name: 'ASLEEP', short: 'SLP', bad: true, move: 0, freeze: true, wakes: true, colour: '#A0A0D8' },
  [B.TERROR]:    { name: 'TERRIFIED', short: 'TER', bad: true, ai: 'flee', colour: '#B048C8' },
  [B.AMOK]:      { name: 'AMOK', short: 'AMK', bad: true, ai: 'amok', colour: '#F87038' },
  [B.CHARM]:     { name: 'CHARMED', short: 'CHM', bad: true, ai: 'charm', move: 0.6, colour: '#F878C8' },

  [B.BLINDNESS]: { name: 'BLINDED', short: 'BLN', bad: true, sight: -6, colour: '#585858' },
  [B.MIND_VISION]:{ name: 'MIND VISION', short: 'MND', sense: 12, colour: '#B0F8F8' },
  [B.MAGICAL_SIGHT]:{ name: 'FARSIGHT', short: 'FAR', sight: 6, colour: '#88D8F8' },
  [B.LIGHT]:     { name: 'LIT', short: 'LIT', sight: 3, colour: '#F8F0A0' },
  [B.FORESIGHT]: { name: 'FORESIGHT', short: 'FOR', search: 4, colour: '#D8B0F8' },

  [B.WEAKNESS]:  { name: 'WEAKENED', short: 'WEA', bad: true, dealt: 0.6, colour: '#987848' },
  [B.HEX]:       { name: 'HEXED', short: 'HEX', bad: true, dealt: 0.75, taken: 1.25, colour: '#8850A8' },
  [B.VULNERABLE]:{ name: 'VULNERABLE', short: 'VUL', bad: true, taken: 1.5, colour: '#D85838' },
  [B.BLESS]:     { name: 'BLESSED', short: 'BLS', dealt: 1.25, taken: 0.85, colour: '#F8F8C0' },
  [B.FURY]:      { name: 'FURIOUS', short: 'FUR', dealt: 1.5, colour: '#F83800' },
  [B.MIGHT]:     { name: 'MIGHTY', short: 'MGT', dealt: 1.5, colour: '#F8B800' },
  [B.BARKSKIN]:  { name: 'BARKSKIN', short: 'BRK', taken: 0.6, colour: '#68A038' },
  [B.BARRIER]:   { name: 'SHIELDED', short: 'SHD', shield: true, colour: '#68C8F8' },

  [B.HEALING]:   { name: 'MENDING', short: 'HEA', heal: 2, every: 14, colour: '#58E058' },
  [B.REGEN]:     { name: 'REGENERATING', short: 'REG', heal: 1, every: 26, colour: '#48C048' },
  [B.RECHARGING]:{ name: 'RECHARGING', short: 'RCH', recharge: 3, colour: '#88B8F8' },
  [B.INVISIBLE]: { name: 'INVISIBLE', short: 'INV', invisible: true, colour: '#C8C8E8' },
  [B.DOOM]:      { name: 'DOOMED', short: 'DOM', bad: true, taken: 2, colour: '#802020' },
};

export const BUFF_IDS = Object.keys(BUFFS);
const INDEX = new Map(BUFF_IDS.map((id, i) => [id, i]));
export const buffIndex = (id) => INDEX.get(id) ?? -1;
export const buffById = (i) => BUFF_IDS[i];

/** Put a timed effect on an actor. Re-applying takes the longer of the two. */
export function apply(actor, id, ticks, magnitude = 1) {
  if (!BUFFS[id] || ticks <= 0) return;
  actor.buffs ??= {};
  const have = actor.buffs[id];
  if (have) {
    have.t = Math.max(have.t, ticks);
    have.m = Math.max(have.m, magnitude);
  } else {
    actor.buffs[id] = { t: ticks, m: magnitude, c: 0 };
  }
}

export function has(actor, id) { return !!actor.buffs?.[id]; }
export function remaining(actor, id) { return actor.buffs?.[id]?.t || 0; }
export function magnitude(actor, id) { return actor.buffs?.[id]?.m || 0; }
export function clear(actor, id) { if (actor.buffs) delete actor.buffs[id]; }

/** Wipe every harmful effect — what cleansing does. */
export function cleanse(actor) {
  if (!actor.buffs) return 0;
  let n = 0;
  for (const id of Object.keys(actor.buffs)) {
    if (BUFFS[id]?.bad) { delete actor.buffs[id]; n++; }
  }
  return n;
}

/**
 * Age every effect by one tick and collect what the caller must act on.
 * Returns { damage, heal, recharge, expired[] }.
 */
export function tickBuffs(actor) {
  const out = { damage: 0, heal: 0, recharge: 0, expired: [] };
  const buffs = actor.buffs;
  if (!buffs) return out;

  for (const id of Object.keys(buffs)) {
    const b = buffs[id];
    const def = BUFFS[id];
    if (!def) { delete buffs[id]; continue; }

    if (def.dot || def.heal) {
      b.c = (b.c || 0) + 1;
      if (b.c >= def.every) {
        b.c = 0;
        if (def.dot) out.damage += def.dot * b.m;
        if (def.heal) out.heal += def.heal * b.m;
      }
    }
    if (def.recharge) out.recharge += def.recharge * b.m;
    // bleeding fades as it runs
    if (def.decays && b.m > 1 && b.t % 30 === 0) b.m = Math.max(1, b.m - 1);

    if (--b.t <= 0) {
      delete buffs[id];
      out.expired.push(id);
    }
  }
  return out;
}

/** Everything the simulation needs to know, folded into one object. */
export function summarise(actor) {
  const s = {
    move: 1, dealt: 1, taken: 1, sight: 0, sense: 0, search: 0,
    frozen: false, fly: false, invisible: false, ai: null, shield: 0,
  };
  const buffs = actor.buffs;
  if (!buffs) return s;
  for (const id of Object.keys(buffs)) {
    const def = BUFFS[id];
    if (!def) continue;
    const m = buffs[id].m || 1;
    if (def.move !== undefined) s.move *= def.move;
    if (def.dealt) s.dealt *= def.dealt;
    if (def.taken) s.taken *= def.taken;
    if (def.sight) s.sight += def.sight;
    if (def.sense) s.sense = Math.max(s.sense, def.sense);
    if (def.search) s.search = Math.max(s.search, def.search);
    if (def.freeze) s.frozen = true;
    if (def.fly) s.fly = true;
    if (def.invisible) s.invisible = true;
    if (def.shield) s.shield += m;
    if (def.ai) s.ai = def.ai;
  }
  return s;
}

/** The compact form that goes on the wire: [[index, ticks, magnitude], ...] */
export function packBuffs(actor) {
  const out = [];
  const buffs = actor.buffs;
  if (!buffs) return out;
  for (const id of Object.keys(buffs)) {
    const i = buffIndex(id);
    if (i >= 0) out.push([i, Math.min(9999, buffs[id].t | 0), buffs[id].m | 0]);
  }
  return out;
}

/** A small bitfield so other actors' effects can be drawn without a full list. */
export function buffFlags(actor) {
  const b = actor.buffs;
  if (!b) return 0;
  let f = 0;
  if (b[B.BURNING]) f |= 1;
  if (b[B.POISON]) f |= 2;
  if (b[B.FROZEN] || b[B.PARALYSIS]) f |= 4;
  if (b[B.TERROR] || b[B.AMOK] || b[B.CHARM]) f |= 8;
  if (b[B.BARRIER] || b[B.BARKSKIN]) f |= 16;
  if (b[B.SLEEP]) f |= 32;
  return f;
}
