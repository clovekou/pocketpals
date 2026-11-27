#!/usr/bin/env python3
"""Builds js/catalog-items.js from the icon folders in assets/Pokemon Items/.

Run from the project folder:  python3 tools/build_item_catalog.py

Each PNG in the shop-category folders becomes an item row (id, name, category, image, price).
Names come from, in order: the folder's item_names.csv, NAME_FIXES below, v1's items.js, or the
file name split into words. Everything can be edited afterwards in Admin → Content → Items;
the admin's edits are stored separately and are not overwritten by re-running this.
"""
import csv, json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ITEMS_DIR = ROOT / 'assets' / 'Pokemon Items'
V1_ITEMS = ROOT.parent / 'PocketPal' / 'items.js'
OUT = ROOT / 'js' / 'catalog-items.js'

# folder → (category id, default price, default sell price)
CATEGORIES = {
    'Evolutionary': ('evolutionary', 2500, 600),
    'Hold Item': ('hold', 1500, 400),
    'Recovery': ('recovery', 300, 75),
    'Vitamins': ('vitamins', 1000, 250),
}
# words the dictionary doesn't know, so the splitter keeps them whole
EXTRA_WORDS = '''exp share pp hp roto malasada galarica castelia jubilife lumiose pewter shalour moomoo
electirizer magmarizer eviolite augurite gateau galette teacup upgrade sachet z memory drive plate gem
seed orb scarf specs band vest policy booster cloak mask knot sludge balloon bulb amulet herb ash
crunchies remedy revive elixir ether potion heal awakening antidote lemonade soda pop berry sweet
candy mint capsule patch carbos calcium iron zinc protein hp up max honey apple syrupy tart dubious
disc protector reaper cloth razor claw fang scale tooth dragon deep sea dusk dawn shiny thunder
leaf moon sun ice fire water oval peat prism metal alloy coat linking cord malicious auspicious
armor masterpiece unremarkable chipped cracked pot whipped dream scroll darkness waters wreath cuff
strawberry clover flower ribbon star love leader crest king rock'''.split()
# names the splitter can't get right
NAME_FIXES = {
    "king'srock": "King's Rock", "leader'screst": "Leader's Crest", 'exp.share': 'Exp. Share',
    'upgrade': 'Up-Grade', 'rotohprestore': 'Roto HP Restore', 'rotopprestore': 'Roto PP Restore',
    'ragecandybar': 'Rage Candy Bar', 'moomoomilk': 'Moomoo Milk', 'pewtercrunchies': 'Pewter Crunchies',
    'shaloursable': 'Shalour Sable', 'sacredash': 'Sacred Ash', 'sodapop': 'Soda Pop',
    'brightpowder': 'Bright Powder', 'blackglasses': 'Black Glasses', 'twistedspoon': 'Twisted Spoon',
    'silverpowder': 'Silver Powder', 'nevermeltice': 'Never-Melt Ice', 'deepseascale': 'Deep Sea Scale',
    'deepseatooth': 'Deep Sea Tooth', 'electirizer': 'Electirizer', 'magmarizer': 'Magmarizer',
    'dracoplate': 'Draco Plate', 'leftovers': 'Leftovers', 'luckyegg': 'Lucky Egg', 'machobrace': 'Macho Brace',
    'protectivepads': 'Protective Pads', 'rustedshield': 'Rusted Shield', 'rustedsword': 'Rusted Sword',
    'safetygoggles': 'Safety Goggles', 'lavacookie': 'Lava Cookie', 'everstone': 'Everstone',
    'floatstone': 'Float Stone', 'bigroot': 'Big Root', 'heavydutyboots': 'Heavy-Duty Boots',
    'hearthflamemask': 'Hearthflame Mask', 'expshare': 'Exp. Share', 'kingsrock': "King's Rock",
    'leaderscrest': "Leader's Crest",
}

# HP restored when used in battle (9999 = fully). Game-design values; editable in the admin.
HEAL = {'potion': 20, 'super-potion': 60, 'hyper-potion': 120, 'max-potion': 9999, 'full-restore': 9999,
        'fresh-water': 30, 'soda-pop': 50, 'lemonade': 70, 'moomoo-milk': 100, 'berry-juice': 20, 'energy-powder': 60,
        'energy-root': 120, 'sweet-heart': 20, 'big-malasada': 60, 'castelia-cone': 40, 'lava-cookie': 40,
        'jubilife-muffin': 40, 'old-gateau': 40, 'rage-candy-bar': 40, 'lumiose-galette': 40, 'shalour-sable': 40,
        'pewter-crunchies': 40, 'max-honey': 9999}


def squash(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())

def load_words():
    words = set(EXTRA_WORDS)
    try:
        for w in Path('/usr/share/dict/words').read_text().split():
            if w.islower() and len(w) >= 3:
                words.add(w)
    except OSError:
        pass
    return words

def split_words(s, words):
    """fewest-words split; unknown runs stay together"""
    n = len(s)
    best = [(0, [])] + [(10 ** 9, [])] * n
    for i in range(1, n + 1):
        for j in range(max(0, i - 20), i):
            w = s[j:i]
            cost = 1 if w in words else 4 + len(w)       # unknown chunks are expensive
            if best[j][0] + cost < best[i][0]:
                best[i] = (best[j][0] + cost, best[j][1] + [w])
    out, buf = [], ''
    for w in best[n][1]:                                  # glue unknown pieces back together
        if w in words:
            if buf: out.append(buf); buf = ''
            out.append(w)
        else:
            buf += w
    if buf: out.append(buf)
    return out

def v1_names():
    names = {}
    if V1_ITEMS.exists():
        for key, name in re.findall(r"^\s*(\w+):\s*\{\s*name:\s*'([^']+)'", V1_ITEMS.read_text(), re.M):
            names[squash(key)] = name
            names[squash(name)] = name
    return names

def nice(stem, words, v1):
    for key in (stem.lower(), squash(stem)):
        if key in NAME_FIXES: return NAME_FIXES[key]
    if squash(stem) in v1: return v1[squash(stem)]
    base = squash(stem)
    if base.endswith('iumz') or base.endswith('z') and base[:-1].endswith(('ium', 'iuz')):
        return base[:-1].capitalize() + ' Z'
    return ' '.join(w.capitalize() for w in split_words(base, words))

def main():
    words, v1 = load_words(), v1_names()
    rows, used = [], set()
    for folder, (cat, buy, sell) in CATEGORIES.items():
        d = ITEMS_DIR / folder
        if not d.is_dir():
            print('missing folder:', d, file=sys.stderr); continue
        csv_names = {}
        for f in d.glob('*.csv'):
            with f.open(encoding='utf-8-sig') as fh:
                for r in csv.DictReader(fh):
                    if r.get('Icon Filename') and r.get('Item Name'):
                        csv_names[r['Icon Filename'].strip().lower()] = r['Item Name'].strip()
        for png in sorted(d.glob('*.png'), key=lambda p: p.name.lower()):
            name = csv_names.get(png.name.lower()) or nice(png.stem, words, v1)
            iid = re.sub(r'[^a-z0-9]+', '-', name.lower().replace("'", '')).strip('-')
            if iid in used:          # same item in two folders (e.g. King's Rock): keep the first category
                continue
            used.add(iid)
            rows.append({
                'id': iid, 'name': name, 'icon': 'box', 'image': png.relative_to(ROOT).as_posix(),
                'category': cat, 'description': '', 'inShop': True, 'currency': 'coins', 'buy': buy, 'sell': sell,
                'effectNeed': 'none', 'effectAmount': 0, 'exp': 0, 'dropWeight': 0, 'ball': 0, 'heal': HEAL.get(iid, 0),
            })
    js = ('// GENERATED by tools/build_item_catalog.py from assets/Pokemon Items/. Do not edit by hand:\n'
          '// change items in Admin → Content → Items, or edit the script and run it again.\n'
          'window.PP = window.PP || {};\n'
          'PP.ITEM_CATALOG = ' + json.dumps(rows, ensure_ascii=False, separators=(',', ':')).replace('},{', '},\n{') + ';\n')
    OUT.write_text(js, encoding='utf-8')
    by = {}
    for r in rows: by[r['category']] = by.get(r['category'], 0) + 1
    print(f'wrote {len(rows)} items to {OUT.relative_to(ROOT)}:', by)

if __name__ == '__main__':
    main()
