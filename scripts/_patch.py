import io

def edit(path, *pairs):
    s = io.open(path, encoding='utf-8').read()
    for old, new in pairs:
        if old not in s:
            raise SystemExit('NOT FOUND in %s:\n%s' % (path, old[:200]))
        s = s.replace(old, new, 1)
    io.open(path, 'w', encoding='utf-8', newline='\n').write(s)
    print('  patched', path)

# --- stagger the tags so neighbouring prices stop colliding ----------------
edit('client/render.js',
  ("""    if (e.price) {
      const tag = `${e.price}`;
      text(this.ctx, tag, Math.round(e.x + 8 - textWidth(tag, 7) / 2), e.y - 8, '#F8B800', 7);
    }""",
   """    if (e.price) {
      // adjacent shelves would overlap, so lift every other column a little
      const tag = `${e.price}`;
      const lift = (Math.round(e.x / 16) & 1) ? 13 : 7;
      text(this.ctx, tag, Math.round(e.x + 8 - textWidth(tag, 7) / 2), e.y - lift, '#F8B800', 7);
    }"""))

# --- and say what it is when you stand on it -------------------------------
edit('client/main.js',
  ("""function promptForTile() {
  const t = net.tileHere();""",
   """function promptForTile() {
  const st = net.state();
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
  const t = net.tileHere();"""))

s = io.open('client/main.js', encoding='utf-8').read()
if 'itemLabel' not in s.split('\n\n')[0] and 'itemLabel' not in s[:3000]:
    # add the import next to whatever items.js already brings in
    import re
    m = re.search(r"import \{([^}]*)\} from '\.\./shared/items\.js';", s)
    if m:
        s = s[:m.start(1)] + m.group(1).rstrip() + ', itemLabel ' + s[m.end(1):]
    else:
        s = s.replace("import { TT", "import { itemLabel } from '../shared/items.js';\nimport { TT", 1)
    io.open('client/main.js', 'w', encoding='utf-8', newline='\n').write(s)
    print('  imported itemLabel')

print('done')
