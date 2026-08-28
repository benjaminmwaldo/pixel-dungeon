import io

def edit(path, *pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n%s' % (path, old[:220]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched', path)

# ---------------------------------------------------------------------------
# Four worn slots now, not two
# ---------------------------------------------------------------------------
edit('shared/game.js',
  ("""      case 'unequip': {
        const which = a === 0 ? 'weapon' : 'armor';
        const worn = p.equip[which];
        if (!worn || worn.tier <= 1) return;      // your last shirt stays on
        if (!this.addToBag(p, worn)) return;
        p.equip[which] = { type: worn.type, tier: 1, upgrade: 0 };
        this.recalc(p);
        break;
      }""",
   """      case 'unequip': {
        const which = ['weapon', 'armor', 'ring1', 'ring2'][a] || 'weapon';
        if (which === 'ring1' || which === 'ring2') { this.removeRing(p, which); break; }
        const worn = p.equip[which];
        if (!worn || worn.tier <= 1) return;      // your last shirt stays on
        if (worn.cursed) {
          this.learnGear(p, worn, which);
          this.banner(`THE ${which === 'weapon' ? 'WEAPON' : 'ARMOUR'} WILL NOT COME OFF`, 1600);
          return;
        }
        if (!this.addToBag(p, worn)) return;
        p.equip[which] = { type: worn.type, tier: 1, upgrade: 0 };
        this.recalc(p);
        break;
      }"""),
)

# ---------------------------------------------------------------------------
# The panel shows them, and the cursor reaches them
# ---------------------------------------------------------------------------
edit('client/screens.js',
  ("""    case ITEM.POTION:
      return potionImg(POTION_TINT[st.app?.potionLook?.[item.kind]] || '#FCFCFC');
    default: return null;""",
   """    case ITEM.POTION:
      return potionImg(POTION_TINT[st.app?.potionLook?.[item.kind]] || '#FCFCFC');
    case ITEM.RING:
      return ringImg(RING_TINT[st.app?.ringLook?.[item.kind]] || '#FCFCFC');
    default: return null;"""),

  ("""    case ITEM.SCROLL:
      return st.known?.scrolls?.includes(item.kind)
        ? scrollText(item.kind) : 'THE RUNE MEANS NOTHING TO YOU YET';
    default: return '';""",
   """    case ITEM.SCROLL:
      return st.known?.scrolls?.includes(item.kind)
        ? scrollText(item.kind) : 'THE RUNE MEANS NOTHING TO YOU YET';
    case ITEM.RING: {
      const shown = item.known || st.known?.rings?.includes(item.kind);
      if (!shown) return 'YOU HAVE NOT WORN IT LONG ENOUGH';
      const word = RINGS[item.kind]?.blurb || '';
      return item.cursed ? `${word}  -  BACKWARDS, AND STUCK` : word;
    }
    default: return '';"""),

  ("""  const worn = [
    ['weapon', st.equip?.weapon, WEAPONS, IMG.SWORD_ICON],
    ['armor', st.equip?.armor, ARMORS, IMG.ARMOR_ICON],
  ];
  worn.forEach(([which, item, table, icon], i) => {
    const y = ey + i * 22;""",
   """  const worn = [
    ['weapon', st.equip?.weapon, ITEM.WEAPON, IMG.SWORD_ICON],
    ['armor', st.equip?.armor, ITEM.ARMOR, IMG.ARMOR_ICON],
    ['ring1', st.equip?.ring1, ITEM.RING, null],
    ['ring2', st.equip?.ring2, ITEM.RING, null],
  ];
  worn.forEach(([which, item, kind, icon], i) => {
    const y = ey + i * 22;"""),

  ("""    box(g, ex, y, 136, 20, sel ? '#243055' : C.dim, sel ? C.gold : C.frame);
    blit(g, icon, ex + 2, y + 2);
    if (item) {
      const full = { ...item, type: which === 'weapon' ? ITEM.WEAPON : ITEM.ARMOR };""",
   """    box(g, ex, y, 136, 20, sel ? '#243055' : C.dim, sel ? C.gold : C.frame);
    const slotIcon = icon || (item
      ? ringImg(RING_TINT[st.app?.ringLook?.[item.kind]] || '#FCFCFC')
      : null);
    if (slotIcon) blit(g, slotIcon, ex + 2, y + 2);
    if (!item) {
      text(g, kind === ITEM.RING ? 'NO RING' : '', ex + 20, y + 6, 'dark', 6);
      return;
    }
    {
      const full = { ...item, type: kind };"""),
)

print('done')
