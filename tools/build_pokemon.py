#!/usr/bin/env python3
"""Builds js/catalog-pokemon.js from assets/Pokemon Sprites/ (PMD SpriteCollab layout).

Run from the project folder:  python3 tools/build_pokemon.py

Only AnimData.xml and PNG headers are read, so it is fast.
  PP.SPRITES[folder] = { a: { Anim: [frameW, frameH, frames, rows, [durations], file?] }, p: hasPortrait }
  PP.POKEMON_CATALOG = [ { id, dex, name, folder, starter, size } ]   default rows for Admin → Content → Pokémon
"""
import json, re, struct, sys
import xml.etree.ElementTree as ET
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'assets' / 'Pokemon Sprites'
OUT = ROOT / 'js' / 'catalog-pokemon.js'
WANT = ['Idle', 'Walk', 'Sleep', 'Hop', 'Eat', 'Nod', 'Attack', 'Hurt', 'Pose']
STARTERS = {'bulbasaur', 'charmander', 'squirtle'}
# portrait emotions, in this order: PP.SPRITES[folder].p is a bitmask of the ones that exist
EMOTIONS = ['Normal', 'Happy', 'Pain', 'Angry', 'Worried', 'Sad', 'Crying', 'Shouting', 'Teary-Eyed',
            'Determined', 'Joyous', 'Inspired', 'Surprised', 'Dizzy', 'Special0', 'Special1', 'Sigh',
            'Stunned', 'Special2', 'Special3']
NAME_FIXES = {'Nidoran_F': 'Nidoran♀', 'Nidoran_M': 'Nidoran♂', 'Farfetch_d': "Farfetch'd", 'Mr_Mime': 'Mr. Mime'}


def png_size(path):
    with open(path, 'rb') as f:
        head = f.read(24)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    return struct.unpack('>II', head[16:24])


def parse_animdata(sprite_dir):
    root = ET.parse(sprite_dir / 'AnimData.xml').getroot()
    anims = {}
    for a in root.iter('Anim'):
        name, copy = a.findtext('Name'), a.findtext('CopyOf')
        if copy:
            anims[name] = {'copy': copy}
        else:
            anims[name] = {'fw': int(a.findtext('FrameWidth')), 'fh': int(a.findtext('FrameHeight')),
                           'dur': [int(d.text) for d in a.iter('Duration')]}
    for name, v in list(anims.items()):
        if 'copy' in v and v['copy'] in anims and 'copy' not in anims[v['copy']]:
            anims[name] = dict(anims[v['copy']], file=v['copy'])
    return anims


def build(sprite_dir):
    anims, out = parse_animdata(sprite_dir), {}
    for name in WANT:
        meta = anims.get(name)
        if not meta or 'copy' in meta:
            continue
        file = meta.get('file', name)
        path = sprite_dir / f'{file}-Anim.png'
        if not path.exists():
            continue
        w, h = png_size(path)
        fw, fh = meta['fw'], meta['fh']
        if fw <= 0 or fh <= 0 or w < fw or h < fh:
            continue
        cols = w // fw
        entry = [fw, fh, min(cols, len(meta['dur'])) or 1, h // fh, meta['dur'][:cols] or [10]]
        if file != name:
            entry.append(file)
        out[name] = entry
    return out


# ---- moves: [id, name, type, power, accuracy, pp, category (p = physical, s = special), priority, drain %]
MOVES = [
    ['tackle', 'Tackle', 'normal', 40, 100, 35, 'p', 0, 0], ['quick-attack', 'Quick Attack', 'normal', 40, 100, 30, 'p', 1, 0],
    ['swift', 'Swift', 'normal', 60, 100, 20, 's', 0, 0], ['headbutt', 'Headbutt', 'normal', 70, 100, 15, 'p', 0, 0],
    ['body-slam', 'Body Slam', 'normal', 85, 100, 15, 'p', 0, 0], ['hyper-voice', 'Hyper Voice', 'normal', 90, 100, 10, 's', 0, 0],
    ['ember', 'Ember', 'fire', 40, 100, 25, 's', 0, 0], ['flame-wheel', 'Flame Wheel', 'fire', 60, 100, 25, 'p', 0, 0],
    ['fire-punch', 'Fire Punch', 'fire', 75, 100, 15, 'p', 0, 0], ['flamethrower', 'Flamethrower', 'fire', 90, 100, 15, 's', 0, 0],
    ['flare-blitz', 'Flare Blitz', 'fire', 110, 90, 10, 'p', 0, 0], ['fire-blast', 'Fire Blast', 'fire', 110, 85, 5, 's', 0, 0],
    ['water-gun', 'Water Gun', 'water', 40, 100, 25, 's', 0, 0], ['aqua-jet', 'Aqua Jet', 'water', 40, 100, 20, 'p', 1, 0],
    ['bubble-beam', 'Bubble Beam', 'water', 65, 100, 20, 's', 0, 0], ['waterfall', 'Waterfall', 'water', 80, 100, 15, 'p', 0, 0],
    ['surf', 'Surf', 'water', 90, 100, 15, 's', 0, 0], ['aqua-tail', 'Aqua Tail', 'water', 90, 90, 10, 'p', 0, 0],
    ['vine-whip', 'Vine Whip', 'grass', 45, 100, 25, 'p', 0, 0], ['absorb', 'Absorb', 'grass', 20, 100, 25, 's', 0, 50],
    ['razor-leaf', 'Razor Leaf', 'grass', 55, 95, 25, 'p', 0, 0], ['mega-drain', 'Mega Drain', 'grass', 40, 100, 15, 's', 0, 50],
    ['seed-bomb', 'Seed Bomb', 'grass', 80, 100, 15, 'p', 0, 0], ['giga-drain', 'Giga Drain', 'grass', 75, 100, 10, 's', 0, 50],
    ['wood-hammer', 'Wood Hammer', 'grass', 110, 100, 10, 'p', 0, 0], ['energy-ball', 'Energy Ball', 'grass', 90, 100, 10, 's', 0, 0],
    ['thunder-shock', 'Thunder Shock', 'electric', 40, 100, 30, 's', 0, 0], ['spark', 'Spark', 'electric', 65, 100, 20, 'p', 0, 0],
    ['shock-wave', 'Shock Wave', 'electric', 60, 100, 20, 's', 0, 0], ['thunder-punch', 'Thunder Punch', 'electric', 75, 100, 15, 'p', 0, 0],
    ['thunderbolt', 'Thunderbolt', 'electric', 90, 100, 15, 's', 0, 0], ['wild-charge', 'Wild Charge', 'electric', 90, 100, 15, 'p', 0, 0],
    ['powder-snow', 'Powder Snow', 'ice', 40, 100, 25, 's', 0, 0], ['ice-shard', 'Ice Shard', 'ice', 40, 100, 30, 'p', 1, 0],
    ['aurora-beam', 'Aurora Beam', 'ice', 65, 100, 20, 's', 0, 0], ['ice-punch', 'Ice Punch', 'ice', 75, 100, 15, 'p', 0, 0],
    ['ice-beam', 'Ice Beam', 'ice', 90, 100, 10, 's', 0, 0], ['icicle-crash', 'Icicle Crash', 'ice', 85, 90, 10, 'p', 0, 0],
    ['rock-smash', 'Rock Smash', 'fighting', 40, 100, 15, 'p', 0, 0], ['vacuum-wave', 'Vacuum Wave', 'fighting', 40, 100, 30, 's', 1, 0],
    ['karate-chop', 'Karate Chop', 'fighting', 50, 100, 25, 'p', 0, 0], ['brick-break', 'Brick Break', 'fighting', 75, 100, 15, 'p', 0, 0],
    ['aura-sphere', 'Aura Sphere', 'fighting', 80, 100, 20, 's', 0, 0], ['cross-chop', 'Cross Chop', 'fighting', 100, 80, 5, 'p', 0, 0],
    ['poison-sting', 'Poison Sting', 'poison', 15, 100, 35, 'p', 0, 0], ['acid', 'Acid', 'poison', 40, 100, 30, 's', 0, 0],
    ['sludge', 'Sludge', 'poison', 65, 100, 20, 's', 0, 0], ['poison-fang', 'Poison Fang', 'poison', 50, 100, 15, 'p', 0, 0],
    ['poison-jab', 'Poison Jab', 'poison', 80, 100, 20, 'p', 0, 0], ['sludge-bomb', 'Sludge Bomb', 'poison', 90, 100, 10, 's', 0, 0],
    ['mud-slap', 'Mud-Slap', 'ground', 20, 100, 10, 's', 0, 0], ['mud-shot', 'Mud Shot', 'ground', 55, 95, 15, 's', 0, 0],
    ['bulldoze', 'Bulldoze', 'ground', 60, 100, 20, 'p', 0, 0], ['dig', 'Dig', 'ground', 80, 100, 10, 'p', 0, 0],
    ['earth-power', 'Earth Power', 'ground', 90, 100, 10, 's', 0, 0], ['earthquake', 'Earthquake', 'ground', 100, 100, 10, 'p', 0, 0],
    ['gust', 'Gust', 'flying', 40, 100, 35, 's', 0, 0], ['peck', 'Peck', 'flying', 35, 100, 35, 'p', 0, 0],
    ['wing-attack', 'Wing Attack', 'flying', 60, 100, 35, 'p', 0, 0], ['air-cutter', 'Air Cutter', 'flying', 60, 95, 25, 's', 0, 0],
    ['drill-peck', 'Drill Peck', 'flying', 80, 100, 20, 'p', 0, 0], ['air-slash', 'Air Slash', 'flying', 75, 95, 15, 's', 0, 0],
    ['confusion', 'Confusion', 'psychic', 50, 100, 25, 's', 0, 0], ['psybeam', 'Psybeam', 'psychic', 65, 100, 20, 's', 0, 0],
    ['psycho-cut', 'Psycho Cut', 'psychic', 70, 100, 20, 'p', 0, 0], ['zen-headbutt', 'Zen Headbutt', 'psychic', 80, 90, 15, 'p', 0, 0],
    ['psychic', 'Psychic', 'psychic', 90, 100, 10, 's', 0, 0],
    ['bug-bite', 'Bug Bite', 'bug', 60, 100, 20, 'p', 0, 0], ['struggle-bug', 'Struggle Bug', 'bug', 50, 100, 20, 's', 0, 0],
    ['signal-beam', 'Signal Beam', 'bug', 75, 100, 15, 's', 0, 0], ['leech-life', 'Leech Life', 'bug', 80, 100, 10, 'p', 0, 50],
    ['x-scissor', 'X-Scissor', 'bug', 80, 100, 15, 'p', 0, 0], ['bug-buzz', 'Bug Buzz', 'bug', 90, 100, 10, 's', 0, 0],
    ['rock-throw', 'Rock Throw', 'rock', 50, 90, 15, 'p', 0, 0], ['rock-tomb', 'Rock Tomb', 'rock', 60, 95, 15, 'p', 0, 0],
    ['ancient-power', 'Ancient Power', 'rock', 60, 100, 5, 's', 0, 0], ['rock-slide', 'Rock Slide', 'rock', 75, 90, 10, 'p', 0, 0],
    ['power-gem', 'Power Gem', 'rock', 80, 100, 20, 's', 0, 0], ['stone-edge', 'Stone Edge', 'rock', 100, 80, 5, 'p', 0, 0],
    ['lick', 'Lick', 'ghost', 30, 100, 30, 'p', 0, 0], ['astonish', 'Astonish', 'ghost', 30, 100, 15, 'p', 0, 0],
    ['shadow-sneak', 'Shadow Sneak', 'ghost', 40, 100, 30, 'p', 1, 0], ['hex', 'Hex', 'ghost', 65, 100, 10, 's', 0, 0],
    ['shadow-claw', 'Shadow Claw', 'ghost', 70, 100, 15, 'p', 0, 0], ['shadow-ball', 'Shadow Ball', 'ghost', 80, 100, 15, 's', 0, 0],
    ['twister', 'Twister', 'dragon', 40, 100, 20, 's', 0, 0], ['dragon-breath', 'Dragon Breath', 'dragon', 60, 100, 20, 's', 0, 0],
    ['dragon-tail', 'Dragon Tail', 'dragon', 60, 90, 10, 'p', 0, 0], ['dragon-claw', 'Dragon Claw', 'dragon', 80, 100, 15, 'p', 0, 0],
    ['dragon-pulse', 'Dragon Pulse', 'dragon', 85, 100, 10, 's', 0, 0], ['outrage', 'Outrage', 'dragon', 120, 100, 10, 'p', 0, 0],
    ['pursuit', 'Pursuit', 'dark', 40, 100, 20, 'p', 0, 0], ['snarl', 'Snarl', 'dark', 55, 95, 15, 's', 0, 0],
    ['bite', 'Bite', 'dark', 60, 100, 25, 'p', 0, 0], ['crunch', 'Crunch', 'dark', 80, 100, 15, 'p', 0, 0],
    ['dark-pulse', 'Dark Pulse', 'dark', 80, 100, 15, 's', 0, 0], ['night-slash', 'Night Slash', 'dark', 70, 100, 15, 'p', 0, 0],
    ['metal-claw', 'Metal Claw', 'steel', 50, 95, 35, 'p', 0, 0], ['mirror-shot', 'Mirror Shot', 'steel', 65, 85, 10, 's', 0, 0],
    ['iron-head', 'Iron Head', 'steel', 80, 100, 15, 'p', 0, 0], ['flash-cannon', 'Flash Cannon', 'steel', 80, 100, 10, 's', 0, 0],
    ['iron-tail', 'Iron Tail', 'steel', 100, 75, 15, 'p', 0, 0],
    ['fairy-wind', 'Fairy Wind', 'fairy', 40, 100, 30, 's', 0, 0], ['draining-kiss', 'Draining Kiss', 'fairy', 50, 100, 10, 's', 0, 75],
    ['dazzling-gleam', 'Dazzling Gleam', 'fairy', 80, 100, 10, 's', 0, 0], ['play-rough', 'Play Rough', 'fairy', 90, 90, 10, 'p', 0, 0],
    ['moonblast', 'Moonblast', 'fairy', 95, 100, 15, 's', 0, 0],
]
# per type, four tiers of moves: (physical, special) — the one matching the Pokémon's better attack stat is used
TIERS = {
    'normal': [('tackle', 'tackle'), ('quick-attack', 'quick-attack'), ('headbutt', 'swift'), ('body-slam', 'hyper-voice')],
    'fire': [('ember', 'ember'), ('flame-wheel', 'flame-wheel'), ('fire-punch', 'flamethrower'), ('flare-blitz', 'fire-blast')],
    'water': [('aqua-jet', 'water-gun'), ('bubble-beam', 'bubble-beam'), ('waterfall', 'surf'), ('aqua-tail', 'surf')],
    'grass': [('vine-whip', 'absorb'), ('razor-leaf', 'mega-drain'), ('seed-bomb', 'giga-drain'), ('wood-hammer', 'energy-ball')],
    'electric': [('spark', 'thunder-shock'), ('spark', 'shock-wave'), ('thunder-punch', 'thunderbolt'), ('wild-charge', 'thunderbolt')],
    'ice': [('ice-shard', 'powder-snow'), ('ice-punch', 'aurora-beam'), ('icicle-crash', 'ice-beam'), ('icicle-crash', 'ice-beam')],
    'fighting': [('rock-smash', 'vacuum-wave'), ('karate-chop', 'vacuum-wave'), ('brick-break', 'aura-sphere'), ('cross-chop', 'aura-sphere')],
    'poison': [('poison-sting', 'acid'), ('poison-fang', 'sludge'), ('poison-jab', 'sludge'), ('poison-jab', 'sludge-bomb')],
    'ground': [('mud-slap', 'mud-slap'), ('bulldoze', 'mud-shot'), ('dig', 'earth-power'), ('earthquake', 'earth-power')],
    'flying': [('peck', 'gust'), ('wing-attack', 'air-cutter'), ('drill-peck', 'air-slash'), ('drill-peck', 'air-slash')],
    'psychic': [('confusion', 'confusion'), ('psycho-cut', 'psybeam'), ('zen-headbutt', 'psychic'), ('zen-headbutt', 'psychic')],
    'bug': [('bug-bite', 'struggle-bug'), ('bug-bite', 'struggle-bug'), ('x-scissor', 'signal-beam'), ('leech-life', 'bug-buzz')],
    'rock': [('rock-throw', 'ancient-power'), ('rock-tomb', 'ancient-power'), ('rock-slide', 'power-gem'), ('stone-edge', 'power-gem')],
    'ghost': [('lick', 'astonish'), ('shadow-sneak', 'hex'), ('shadow-claw', 'shadow-ball'), ('shadow-claw', 'shadow-ball')],
    'dragon': [('twister', 'twister'), ('dragon-tail', 'dragon-breath'), ('dragon-claw', 'dragon-pulse'), ('outrage', 'dragon-pulse')],
    'dark': [('pursuit', 'snarl'), ('bite', 'snarl'), ('night-slash', 'dark-pulse'), ('crunch', 'dark-pulse')],
    'steel': [('metal-claw', 'metal-claw'), ('metal-claw', 'mirror-shot'), ('iron-head', 'flash-cannon'), ('iron-tail', 'flash-cannon')],
    'fairy': [('fairy-wind', 'fairy-wind'), ('draining-kiss', 'draining-kiss'), ('play-rough', 'dazzling-gleam'), ('play-rough', 'moonblast')],
}


def learnset(t1, t2, atk, spatk):
    """custom level-up moves from types and the better attack stat: "1:tackle,1:ember,8:...". Editable in the admin."""
    side = 0 if atk >= spatk else 1
    pick = lambda t, tier: TIERS[t][tier][side]
    other = t2 if t2 != 'none' else 'normal'
    plan = [(1, pick('normal', 0)), (1, pick(t1, 0)), (8, pick(other, 0) if other != t1 else pick('normal', 1)),
            (14, pick(t1, 1)), (20, pick('normal', 2)), (25, pick(other, 1)), (31, pick(t1, 2)),
            (38, pick(other, 2) if other != 'normal' else pick('normal', 3)), (46, pick(t1, 3))]
    seen, out = set(), []
    for lv, m in plan:
        if m in seen and lv == 8:                       # single-type Pokémon: a quick normal move at 8
            m = pick('normal', 1)
        if m not in seen:                               # other duplicates are simply skipped (keeps the power curve)
            seen.add(m); out.append(f'{lv}:{m}')
    return ','.join(out)


GROWTH = {1: 'slow', 2: 'medium', 3: 'fast', 4: 'medium-slow', 5: 'erratic', 6: 'fluctuating'}
STAT_KEYS = {1: 'hp', 2: 'atk', 3: 'def', 4: 'spatk', 5: 'spdef', 6: 'speed'}


def species_data():
    """species facts from the PokéAPI tables in tools/pokeapi/ (types, base stats, catch rate, growth...)"""
    import csv
    d = ROOT / 'tools' / 'pokeapi'
    if not d.exists():
        return {}
    rd = lambda f: list(csv.DictReader(open(d / f, encoding='utf-8')))
    types = {r['id']: r['identifier'] for r in rd('types.csv')}
    out = {}
    for r in rd('pokemon_species.csv'):
        out[int(r['id'])] = {
            'catchRate': int(r['capture_rate'] or 45), 'growth': GROWTH.get(int(r['growth_rate_id'] or 2), 'medium'),
            'legendary': r['is_legendary'] == '1' or r['is_mythical'] == '1',
            'evolvesFrom': int(r['evolves_from_species_id']) if r['evolves_from_species_id'] else 0,
            'types': [], 'base': {},
        }
    for r in rd('pokemon.csv'):
        if r['is_default'] == '1' and int(r['species_id']) in out:
            out[int(r['species_id'])]['baseExp'] = int(r['base_experience'] or 50)
    for r in rd('pokemon_types.csv'):
        pid = int(r['pokemon_id'])
        if pid in out:
            out[pid]['types'].append((int(r['slot']), types[r['type_id']]))
    for r in rd('pokemon_stats.csv'):
        pid = int(r['pokemon_id'])
        if pid in out and int(r['stat_id']) in STAT_KEYS:
            out[pid]['base'][STAT_KEYS[int(r['stat_id'])]] = int(r['base_stat'])
    return out


def main():
    sprites, rows = {}, []
    facts = species_data()
    for d in sorted(p for p in SRC.iterdir() if p.is_dir()):
        m = re.match(r'^(\d{4})_(.+)$', d.name)
        if not m or int(m.group(1)) == 0:
            continue
        sd = d / 'sprite'
        if not (sd / 'AnimData.xml').exists():
            print('skipped (no AnimData.xml):', d.name, file=sys.stderr); continue
        try:
            a = build(sd)
        except Exception as e:
            print('skipped', d.name, e, file=sys.stderr); continue
        if 'Idle' not in a:
            print('skipped (no Idle):', d.name, file=sys.stderr); continue
        mask = sum(1 << i for i, e in enumerate(EMOTIONS) if (d / 'portrait' / f'{e}.png').exists())
        sprites[d.name] = {'a': a, 'p': mask}
        raw = m.group(2).strip('_')
        name = NAME_FIXES.get(raw, raw.replace('_', ' '))
        pid = re.sub(r'[^a-z0-9]+', '-', name.lower().replace('♀', '-f').replace('♂', '-m').replace("'", '')).strip('-')
        dex = int(m.group(1))
        row = {'id': pid, 'dex': dex, 'name': name, 'folder': d.name, 'starter': pid in STARTERS, 'size': 100}
        f = facts.get(dex)
        if f:
            t = [x for _, x in sorted(f['types'])]
            b = f['base']
            row.update({'type1': t[0] if t else 'normal', 'type2': t[1] if len(t) > 1 else 'none',
                        'hp': b.get('hp', 50), 'atk': b.get('atk', 50), 'def': b.get('def', 50),
                        'spatk': b.get('spatk', 50), 'spdef': b.get('spdef', 50), 'speed': b.get('speed', 50),
                        'catchRate': f['catchRate'], 'baseExp': f.get('baseExp', 50), 'growth': f['growth'],
                        'legendary': f['legendary'], 'evolvesFrom': f['evolvesFrom'],
                        'learnset': learnset(row_t1 := (t[0] if t else 'normal'), t[1] if len(t) > 1 else 'none', b.get('atk', 50), b.get('spatk', 50))})
        rows.append(row)
    js = ('// GENERATED by tools/build_pokemon.py from assets/Pokemon Sprites/. Do not edit by hand:\n'
          '// change Pokémon in Admin → Content → Pokémon, or run the script again after adding sprites.\n'
          'window.PP = window.PP || {};\n'
          'PP.EMOTIONS = ' + json.dumps(EMOTIONS) + ';\n'
          'PP.MOVE_CATALOG = ' + json.dumps([dict(zip(['id', 'name', 'type', 'power', 'accuracy', 'pp', 'category', 'priority', 'drain'], m)) for m in MOVES],
                                            separators=(',', ':')).replace('},{', '},\n{').replace('"category":"p"', '"category":"physical"').replace('"category":"s"', '"category":"special"') + ';\n'
          'PP.SPRITES = ' + json.dumps(sprites, separators=(',', ':')) + ';\n'
          'PP.POKEMON_CATALOG = ' + json.dumps(rows, ensure_ascii=False, separators=(',', ':')).replace('},{', '},\n{') + ';\n')
    OUT.write_text(js, encoding='utf-8')
    print(f'wrote {len(rows)} Pokémon to {OUT.relative_to(ROOT)} (starters: {", ".join(r["name"] for r in rows if r["starter"])})')


if __name__ == '__main__':
    main()
