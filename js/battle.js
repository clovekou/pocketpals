// Battle screen + rules, shared by the game (wild battles from Explore) and battle-preview.html.
//
// PP.Battle.start({
//   root, data,                       // container element, game data (pokemon, moves, items, settings)
//   kind: 'wild' | 'trainer',
//   foes: [{ species, level }],       // trainer: in order
//   trainer: { name, prize },         // trainer battles only
//   team: [boxEntry, …],              // the player's Pokémon (mutated: hp, exp, level)
//   bag: { itemId: qty },             // the player's inventory (mutated when items are used)
//   background,                       // picture behind the arena
//   onEnd(result)                     // { outcome: 'won'|'beat'|'caught'|'ran'|'lost', caught, prize, used, log }
// })
// Every number comes from data (Admin → Battles, Moves, Pokémon, Items).
(function () {
  'use strict';
  const I = PP.icon;
  PP.ICONS.swords = PP.ICONS.swords || '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>';
  PP.ICONS.flee = PP.ICONS.flee || '<path d="M5 6l6 6-6 6M13 6l6 6-6 6"/>';

  // attacking type → defending type → multiplier (anything not listed is ×1)
  const CHART = {
    normal: { rock: .5, ghost: 0, steel: .5 },
    fire: { fire: .5, water: .5, grass: 2, ice: 2, bug: 2, rock: .5, dragon: .5, steel: 2 },
    water: { fire: 2, water: .5, grass: .5, ground: 2, rock: 2, dragon: .5 },
    electric: { water: 2, electric: .5, grass: .5, ground: 0, flying: 2, dragon: .5 },
    grass: { fire: .5, water: 2, grass: .5, poison: .5, ground: 2, flying: .5, bug: .5, rock: 2, dragon: .5, steel: .5 },
    ice: { fire: .5, water: .5, grass: 2, ice: .5, ground: 2, flying: 2, dragon: 2, steel: .5 },
    fighting: { normal: 2, ice: 2, poison: .5, flying: .5, psychic: .5, bug: .5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: .5 },
    poison: { grass: 2, poison: .5, ground: .5, rock: .5, ghost: .5, steel: 0, fairy: 2 },
    ground: { fire: 2, electric: 2, grass: .5, poison: 2, flying: 0, bug: .5, rock: 2, steel: 2 },
    flying: { electric: .5, grass: 2, fighting: 2, bug: 2, rock: .5, steel: .5 },
    psychic: { fighting: 2, poison: 2, psychic: .5, dark: 0, steel: .5 },
    bug: { fire: .5, grass: 2, fighting: .5, poison: .5, flying: .5, psychic: 2, ghost: .5, dark: 2, steel: .5, fairy: .5 },
    rock: { fire: 2, ice: 2, fighting: .5, ground: .5, flying: 2, bug: 2, steel: .5 },
    ghost: { normal: 0, psychic: 2, ghost: 2, dark: .5 },
    dragon: { dragon: 2, steel: .5, fairy: 0 },
    dark: { fighting: .5, psychic: 2, ghost: 2, dark: .5, fairy: .5 },
    steel: { fire: .5, water: .5, electric: .5, ice: 2, rock: 2, steel: .5, fairy: 2 },
    fairy: { fire: .5, fighting: 2, poison: .5, dragon: 2, dark: 2, steel: .5 },
  };
  const effect = (type, def) => def.types.reduce((x, t) => x * ((CHART[type] || {})[t] != null ? CHART[type][t] : 1), 1);
  // used when every move is out of PP, so a battle can always go on
  const STRUGGLE = { id: 'struggle', name: 'Struggle', type: 'normal', category: 'physical', power: 50, accuracy: 100, pp: 1, left: Infinity, priority: 0, drain: 0 };
  // sound must never be able to stop a battle: any sound error is ignored
  const sfx = n => { try { if (PP.Audio) PP.Audio.sfx(n); } catch (e) {} };
  const cry = (m, slow) => { try { return PP.Audio && m ? Promise.resolve(PP.Audio.cry(m.folder, slow, m.id)).catch(() => {}) : Promise.resolve(); } catch (e) { return Promise.resolve(); } };   // by sprite folder number
  const TACKLE = { id: 'tackle', name: 'Tackle', type: 'normal', category: 'physical', power: 40, accuracy: 100, pp: 35, priority: 0, drain: 0 };

  /** the moves a species knows at a level: the last 4 it has reached in its learnset */
  function movesAt(d, sp, lv) {
    const seen = new Map();
    String(sp.learnset || '').split(',').map(x => x.split(':')).filter(([l, id]) => id && +l <= lv)
      .forEach(([, id]) => { const m = d.moves.find(x => x.id === id.trim()); if (m) { seen.delete(m.id); seen.set(m.id, m); } });
    const list = [...seen.values()].slice(-4);
    return (list.length ? list : [d.moves.find(m => m.id === 'tackle') || TACKLE]).map(m => Object.assign({ left: m.pp }, m));
  }
  function stats(m) {
    const sp = m.sp, lv = m.lv, st = b => Math.floor(2 * b * lv / 100) + 5, old = m.maxhp || 0;
    m.maxhp = Math.floor(2 * sp.hp * lv / 100) + lv + 10;
    m.atk = st(sp.atk); m.def = st(sp.def); m.spa = st(sp.spatk); m.spd = st(sp.spdef); m.spe = st(sp.speed);
    if (old) m.hp = Math.max(m.hp > 0 ? 1 : 0, m.hp + m.maxhp - old);
  }
  /** a battling Pokémon from a box entry ({species, level, hp, exp, nickname}) or a foe ({species, level}) */
  function build(d, ref) {
    const sp = d.pokemon.find(p => p.id === ref.species);
    const m = { ref, sp, id: sp.id, name: ref.nickname || sp.name, folder: sp.folder, lv: ref.level,
      types: [sp.type1, sp.type2].filter(t => t && t !== 'none'), exp: ref.exp != null ? ref.exp : PP.store.expForLevel(sp.growth, ref.level) };
    stats(m);
    m.hp = ref.hp == null ? m.maxhp : Math.max(0, Math.min(m.maxhp, ref.hp));
    m.moves = movesAt(d, sp, m.lv);
    return m;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // animate fn(0→1); a timer backs up the frame loop so a background tab can't stall the battle
  const tween = (ms, fn) => new Promise(res => {
    const t0 = performance.now(); let done = false;
    const end = () => { if (done) return; done = true; fn(1); res(); };
    const step = () => { if (done) return; const k = Math.min(1, (performance.now() - t0) / ms); if (k >= 1) return end(); fn(k); requestAnimationFrame(step); };
    requestAnimationFrame(step); setTimeout(end, ms + 40);
  });
  const ease = k => 1 - Math.pow(1 - k, 3);
  const imgs = {};
  const img = src => imgs[src] || (imgs[src] = Object.assign(new Image(), { src: encodeURI(src) }));

  const MARKUP = `
    <div class="battle">
      <section class="arena">
        <div class="arena-bg"></div><canvas class="field" aria-label="Battle"></canvas>
        <div class="hud foe gone"><div class="hud-top"><b class="hud-name" data-b="foeName"></b><span class="hud-lv" data-b="foeLv"></span></div>
          <div class="hud-hp"><span class="hp-tag">HP</span><div class="hp"><i data-b="foeHp"></i></div></div><div class="hud-party" data-b="foeParty"></div></div>
        <div class="hud me gone"><div class="hud-top"><b class="hud-name" data-b="meName"></b><span class="hud-lv" data-b="meLv"></span></div>
          <div class="hud-hp"><span class="hp-tag">HP</span><div class="hp"><i data-b="meHp"></i></div></div>
          <div class="hud-num tnum" data-b="meHpNum"></div><div class="exp"><i data-b="meExp"></i></div></div>
        <div class="trainer-chip" data-b="trainerChip" hidden></div>
      </section>
      <section class="console" data-b="console">
        <div class="msg" data-b="msg"><p data-b="msgText"></p><span class="msg-next" data-b="msgNext">▼</span></div>
        <div class="menu" data-b="menu" hidden></div>
      </section>
      <div class="result" data-b="result" hidden><div class="result-card"><div class="result-icon" data-b="resultIcon"></div>
        <h2 data-b="resultTitle"></h2><p data-b="resultText"></p>
        <div class="result-actions"><button class="btn btn-primary" data-b="resultGo">Continue</button></div></div></div>
    </div>`;

  // Friend battles (kind 'pvp'): o.pvp = { side: 'a' | 'b', seed, exchange(turn, myChoice) → Promise<theirChoice> }.
  // Both players run every turn with the same seeded random numbers, so both screens show the same battle.
  // Choices: { type: 'move', i } (i = -1 for Struggle), { type: 'switch', i }, { type: 'forfeit' }, { type: 'none' }.
  function prng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  PP.Battle = {
    effect, movesAt, build,
    start(o) {
      const d = o.data, set = d.settings;
      o.root.innerHTML = MARKUP;
      const $ = k => o.root.querySelector(`[data-b="${k}"]`);
      const box = o.root.querySelector('.battle');
      const bg = o.root.querySelector('.arena-bg');
      // backgrounds: try each in order, keep the first picture that exists (the stylesheet has a default)
      const bgs = (o.backgrounds || (o.background ? [o.background] : [])).filter(Boolean);
      (function tryBg(i) {
        if (i >= bgs.length) return;
        const im = new Image();
        im.onload = () => { bg.style.backgroundImage = `url("${encodeURI(bgs[i])}")`; };
        im.onerror = () => tryBg(i + 1);
        im.src = encodeURI(bgs[i]);
      })(0);
      o.root.querySelectorAll('.hud.foe, .hud.me').forEach(h => { h.dataset.b = h.classList.contains('foe') ? 'foeHud' : 'meHud'; });

      const party = o.team.filter(e => d.pokemon.some(p => p.id === e.species)).map(e => build(d, e));
      const foes = o.foes.map(f => build(d, { species: f.species, level: f.level }));
      const B = { kind: o.kind, me: Math.max(0, party.findIndex(m => m.hp > 0)), fi: 0, runs: 0, over: false, used: {}, log: [], turn: 0 };
      const PVP = o.kind === 'pvp', vsTrainer = o.kind !== 'wild';    // a friend battle works like a trainer battle
      let rand = Math.random;
      const R = () => rand();
      const reseed = n => { if (PVP) rand = prng((o.pvp.seed + n * 7919) >>> 0); };
      const cur = () => party[B.me], foe = () => foes[B.fi];
      const V = { me: { m: null, alpha: 0, dx: 0, dy: 0, scale: 1, anim: null, flash: 0 }, foe: { m: null, alpha: 0, dx: 0, dy: 0, scale: 1, anim: null, flash: 0 }, ball: null };
      const tName = o.trainer ? o.trainer.name : '';
      const label = (side, cap) => {
        if (side === 'me') return cur().name;
        const t = (B.kind === 'wild' ? 'the wild ' : 'the foe’s ') + foe().name;
        return cap ? t[0].toUpperCase() + t.slice(1) : t;
      };
      let busy = true;

      // ---- messages
      let skip = null;
      async function say(text, hold = 850) {
        $('console').classList.add('full'); $('console').classList.remove('sub'); $('menu').hidden = true;
        const el = $('msgText'); $('msgNext').hidden = true;
        let n = 0;
        await new Promise(res => {
          const iv = setInterval(() => { const shown = text.slice(n, n + 2); n += 2; el.textContent = text.slice(0, n);
            try { if (PP.Audio && PP.Audio.blip && /[\p{L}\p{N}]/u.test(shown)) PP.Audio.blip('battle'); } catch (e) {}
            if (n >= text.length) { clearInterval(iv); res(); } }, 16);
          skip = () => { clearInterval(iv); el.textContent = text; res(); };
        });
        $('msgNext').hidden = false;
        await new Promise(res => { const to = setTimeout(res, hold); skip = () => { clearTimeout(to); res(); }; });
        skip = null;
      }
      $('msg').addEventListener('click', () => skip && skip());
      const onKey = e => { if ((e.key === 'Enter' || e.key === ' ') && skip && !e.target.closest('input, textarea')) { e.preventDefault(); skip(); } };
      document.addEventListener('keydown', onKey);

      // ---- HUDs
      const hpClass = (el, m) => { const r = m.hp / m.maxhp; el.classList.toggle('mid', r <= .5 && r > .2); el.classList.toggle('low', r <= .2); };
      const expPct = m => m.lv >= 100 ? 100 : Math.max(0, Math.min(100, (m.exp - PP.store.expForLevel(m.sp.growth, m.lv)) / Math.max(1, PP.store.expForLevel(m.sp.growth, m.lv + 1) - PP.store.expForLevel(m.sp.growth, m.lv)) * 100));
      function hud(side) {
        const m = side === 'me' ? cur() : foe();
        $(side + 'Name').textContent = m.name; $(side + 'Lv').textContent = 'Lv ' + m.lv;
        const bar = $(side + 'Hp'); bar.style.width = (m.hp / m.maxhp * 100) + '%'; hpClass(bar, m);
        if (side === 'me') { $('meHpNum').textContent = `${m.hp} / ${m.maxhp}`; $('meExp').style.width = expPct(m) + '%'; }
        else $('foeParty').innerHTML = vsTrainer ? foes.map(f => `<span class="${f.hp <= 0 ? 'out' : ''}"></span>`).join('') : '';
      }
      const showHud = (side, on) => $(side + 'Hud').classList.toggle('gone', !on);
      async function hpTo(side, from) {
        const m = side === 'me' ? cur() : foe(), bar = $(side + 'Hp');
        bar.style.width = (m.hp / m.maxhp * 100) + '%'; hpClass(bar, m);
        if (side === 'me') await tween(550, k => { $('meHpNum').textContent = `${Math.round(from + (m.hp - from) * k)} / ${m.maxhp}`; });
        else await sleep(550);
      }

      // ---- menus
      function menu(html, sub) {
        $('console').classList.remove('full'); $('console').classList.toggle('sub', !!sub);
        $('menu').hidden = false; $('menu').innerHTML = html; $('menu').dataset.forced = '';
      }
      function commands() {
        busy = false;
        $('msgText').textContent = `What will ${cur().name} do?`; $('msgNext').hidden = true;
        const trainer = vsTrainer;
        if (PVP) startClock(randomTurn);
        if (PVP) return menu(`<div class="cmds">
          <button class="cmd" data-c="fight" style="--c:#e03b3b"><span class="cmd-ic">${I('swords')}</span><span>Fight<small>${cur().moves.length} move${cur().moves.length === 1 ? '' : 's'}</small></span></button>
          <button class="cmd" data-c="bag" style="--c:#e9a100" disabled><span class="cmd-ic">${I('bag')}</span><span>Bag<small>Not in friend battles</small></span></button>
          <button class="cmd" data-c="party" style="--c:#2f9e6b"><span class="cmd-ic">${I('pokeball')}</span><span>Pokémon<small>Switch</small></span></button>
          <button class="cmd" data-c="forfeit" style="--c:#3b6ef5"><span class="cmd-ic">${I('flee')}</span><span>Forfeit<small>Give up</small></span></button>
        </div>`);
        menu(`<div class="cmds">
          <button class="cmd" data-c="fight" style="--c:#e03b3b"><span class="cmd-ic">${I('swords')}</span><span>Fight<small>${cur().moves.length} move${cur().moves.length === 1 ? '' : 's'}</small></span></button>
          <button class="cmd" data-c="bag" style="--c:#e9a100"><span class="cmd-ic">${I('bag')}</span><span>Bag<small>Balls &amp; medicine</small></span></button>
          <button class="cmd" data-c="party" style="--c:#2f9e6b"><span class="cmd-ic">${I('pokeball')}</span><span>Pokémon<small>Switch</small></span></button>
          <button class="cmd" data-c="run" style="--c:#3b6ef5" ${trainer ? 'disabled' : ''}><span class="cmd-ic">${I('flee')}</span><span>Run<small>${trainer ? 'Not from trainers' : 'Escape'}</small></span></button>
        </div>`);
      }
      function fightMenu() {
        const m = cur(), f = foe();
        const tag = mv => { const e = effect(mv.type, f); return e > 1 ? 'Super effective' : e === 0 ? 'No effect' : e < 1 ? 'Not very effective' : ''; };
        if (m.moves.every(mv => mv.left <= 0)) return menu(`<div class="moves"><button class="move" data-move="struggle" style="--c:#888"><b>Struggle</b><span class="move-meta"><span class="type">normal</span><span class="pp tnum">No PP left</span></span></button></div>
          <div class="menu-foot"><button class="back" data-c="back">Back</button><span class="hint">Every move is out of PP</span></div>`, true);
        menu(`<div class="moves">${m.moves.map((mv, i) => `
            <button class="move" data-move="${i}" style="--c:${(PP.TYPES || {})[mv.type] || '#888'}" ${mv.left > 0 ? '' : 'disabled'}>
              <b>${PP.esc(mv.name)}</b><span class="move-meta"><span class="type">${mv.type}</span><span class="pp tnum">PP ${mv.left}/${mv.pp}</span></span>
              ${tag(mv) ? `<span class="hint">${tag(mv)}</span>` : ''}</button>`).join('')}${'<span></span>'.repeat(Math.max(0, 4 - m.moves.length))}</div>
          <div class="menu-foot"><button class="back" data-c="back">Back</button><span class="hint">Power ${m.moves.map(x => x.power).join(' · ')}</span></div>`, true);
      }
      let bagTab = 'balls';
      const bagItems = kind => d.items.filter(it => (kind === 'balls' ? it.ball > 0 : it.heal > 0) && (o.bag[it.id] || 0) > 0);
      function bagMenu() {
        const f = foe(), m = cur(), trainer = vsTrainer, list = bagItems(bagTab);
        menu(`<div class="tabs"><button class="tab${bagTab === 'balls' ? ' on' : ''}" data-tab="balls">Poké Balls</button><button class="tab${bagTab === 'meds' ? ' on' : ''}" data-tab="meds">Medicine</button></div>
          <div class="list">${list.length ? list.map(it => {
            const n = o.bag[it.id], pic = it.image ? `<img src="${PP.esc(encodeURI(it.image))}" alt="">` : `<span class="li-ic">${I(it.icon)}</span>`;
            const off = (it.ball && trainer) || (it.heal && m.hp >= m.maxhp);
            const sub = it.ball ? (trainer ? 'You can’t catch a trainer’s Pokémon' : `Catch chance about ${Math.round(catchChance(it, f) * 100)}%`)
              : (m.hp >= m.maxhp ? `${m.name} is at full HP` : `Restores ${it.heal >= 9999 ? 'all' : it.heal} HP`);
            return `<button class="li" data-item="${PP.esc(it.id)}" ${off ? 'disabled' : ''}>${pic}<span class="li-main"><b>${PP.esc(it.name)}</b><small>${sub}</small></span><span class="qty tnum">×${n}</span></button>`;
          }).join('') : `<div class="hint" style="padding:16px 4px">No ${bagTab === 'balls' ? 'Poké Balls' : 'medicine'} in your bag. Buy some in the shop.</div>`}</div>
          <div class="menu-foot"><button class="back" data-c="back">Back</button><span class="hint">${bagTab === 'balls' && !trainer ? 'Lower its HP first for a better chance' : ''}</span></div>`, true);
      }
      function partyMenu(forced) {
        menu(`<div class="list">${party.map((m, i) => {
            const pic = PP.Sprite.portrait(m.folder), out = m.hp <= 0, now = i === B.me && !forced;
            return `<button class="li${i === B.me ? ' on' : ''}" data-switch="${i}" ${out || i === B.me ? 'disabled' : ''}>${pic ? `<img src="${pic}" alt="">` : ''}
              <span class="li-main"><b>${PP.esc(m.name)}</b> <small style="display:inline">Lv ${m.lv}${now ? ' · in battle' : out ? ' · fainted' : ''}</small>
                <div class="hp"><i class="${m.hp / m.maxhp <= .2 ? 'low' : m.hp / m.maxhp <= .5 ? 'mid' : ''}" style="width:${m.hp / m.maxhp * 100}%"></i></div></span>
              <span class="qty tnum">${m.hp}/${m.maxhp}</span></button>`;
          }).join('')}</div>
          <div class="menu-foot">${forced ? '<span class="hint">Choose who goes out next</span>' : '<button class="back" data-c="back">Back</button><span class="hint">Switching uses your turn</span>'}</div>`, true);
        $('menu').dataset.forced = forced ? '1' : '';
      }
      $('menu').addEventListener('click', e => {
        if (busy || B.over) return;
        const t = e.target.closest('button'); if (!t || t.disabled) return;
        if (t.dataset.c === 'fight') return fightMenu();
        if (t.dataset.c === 'bag') return bagMenu();
        if (t.dataset.c === 'party') return partyMenu(false);
        if (t.dataset.c === 'back') return commands();
        if (t.dataset.c === 'run') return turn({ type: 'run' });
        if (t.dataset.c === 'forfeit') { if (confirm('Give up this battle?')) return turn({ type: 'forfeit' }); return; }
        if (t.dataset.tab) { bagTab = t.dataset.tab; return bagMenu(); }
        if (t.dataset.move != null) return turn({ type: 'move', move: t.dataset.move === 'struggle' ? STRUGGLE : cur().moves[+t.dataset.move] });
        if (t.dataset.item) return turn({ type: 'item', item: d.items.find(x => x.id === t.dataset.item) });
        if (t.dataset.switch != null) {
          if ($('menu').dataset.forced) { busy = true; if (PVP && forcedPick) { const f = forcedPick; forcedPick = null; return f(+t.dataset.switch); } return switchIn(+t.dataset.switch, true).then(commands); }
          return turn({ type: 'switch', i: +t.dataset.switch });
        }
      });

      // ---- the field
      const cv = o.root.querySelector('.field'), g = cv.getContext('2d');
      const pos = side => {
        const r = cv.parentElement.getBoundingClientRect();
        return side === 'me' ? { x: r.width * .28, y: r.height * .86, scale: 3.4, dir: 'upright' } : { x: r.width * .70, y: r.height * .47, scale: 2.6, dir: 'downleft' };
      };
      function frame(ms) {
        if (!B.alive) return;
        requestAnimationFrame(frame);
        const t = ms / 1000, dpr = window.devicePixelRatio || 1, r = cv.parentElement.getBoundingClientRect();
        const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
        if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
        g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, w, h); g.setTransform(dpr, 0, 0, dpr, 0, 0);
        ['foe', 'me'].forEach(side => {
          const p = pos(side), s = V[side];
          g.save(); g.globalAlpha = .9; g.fillStyle = 'rgba(20,30,10,.22)';
          g.beginPath(); g.ellipse(p.x, p.y + 2, 30 * p.scale, 7 * p.scale, 0, 0, Math.PI * 2); g.fill();
          g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.5; g.stroke(); g.restore();
          if (!s.m || s.alpha <= 0) return;
          if (s.flash > t && Math.floor(t * 14) % 2) return;
          g.save(); g.globalAlpha = s.alpha;
          let name = 'Idle', at = t + (side === 'me' ? 0 : .7), once = false;
          if (s.anim) { name = s.anim.name; at = t - s.anim.t0; once = true; }
          const done = PP.Sprite.draw(g, s.m.folder, { x: p.x + s.dx, y: p.y + s.dy, scale: p.scale * s.scale * (s.m.sp.size || 100) / 100, t: at, anim: name, dir: p.dir, once });
          if (s.anim && done) s.anim = null;
          g.restore();
        });
        const b = V.ball;
        if (b) {
          const im = img(b.src);
          if (im.complete && im.naturalWidth) {
            g.save(); g.imageSmoothingEnabled = false; g.translate(b.x, b.y); g.rotate(b.rot || 0);
            if (b.dim) g.filter = 'brightness(.75)';
            g.drawImage(im, -16, -16, 32, 32); g.restore();
          }
          if (b.stars) { g.fillStyle = '#ffd43b'; b.stars.forEach(([dx, dy]) => { g.beginPath(); g.arc(b.x + dx, b.y + dy, 2.5, 0, Math.PI * 2); g.fill(); }); }
        }
      }
      B.alive = true; requestAnimationFrame(frame);
      const play = (side, name) => { V[side].anim = { name, t0: performance.now() / 1000 }; };

      // ---- rules
      function catchChance(it, f) {
        if (it.ball >= 255) return 1;
        const a = (3 * f.maxhp - 2 * f.hp) * f.sp.catchRate * it.ball / (3 * f.maxhp);
        return Math.max(0, Math.min(1, a / 255 * set.catchMult));
      }
      function foeMove(f, target) {
        // usually picks its strongest option against you, sometimes a random one
        // a gentle trainer never uses super-effective moves (falls back to Tackle if that leaves nothing)
        const list = o.noSuperEffective ? f.moves.filter(m => effect(m.type, target) <= 1) : f.moves;
        if (!list.length) return TACKLE;
        if (Math.random() < .35) return list[Math.floor(Math.random() * list.length)];
        return list.slice().sort((a, b) => b.power * effect(b.type, target) - a.power * effect(a.type, target))[0];
      }
      async function useMove(side, mv) {
        const att = side === 'me' ? cur() : foe(), def = side === 'me' ? foe() : cur(), other = side === 'me' ? 'foe' : 'me';
        if (side === 'me') mv.left--;
        await say(`${label(side, true)} used ${mv.name}!`, 200);
        play(side, 'Attack'); try { if (PP.Audio && PP.Audio.move) PP.Audio.move(mv.type); } catch (e) {}
        const lx = side === 'me' ? 22 : -22, ly = side === 'me' ? -10 : 8;
        await tween(150, k => { V[side].dx = lx * k; V[side].dy = ly * k; });
        await tween(150, k => { V[side].dx = lx * (1 - k); V[side].dy = ly * (1 - k); });
        if (R() * 100 >= mv.accuracy) { sfx('miss'); return say(`${label(side, true)}’s attack missed!`); }
        const eff = effect(mv.type, def);
        if (eff === 0) return say(`It doesn’t affect ${label(other)}…`);
        const crit = R() < 1 / 16, stab = att.types.includes(mv.type) ? 1.5 : 1;
        const A = mv.category === 'special' ? att.spa : att.atk, D = mv.category === 'special' ? def.spd : def.def;
        let dmg = Math.floor(Math.floor(Math.floor(2 * att.lv / 5 + 2) * mv.power * A / D) / 50) + 2;
        dmg = Math.min(def.hp, Math.max(1, Math.floor(dmg * stab * eff * (.85 + R() * .15) * (crit ? 1.5 : 1))));
        if (side === 'foe' && o.protect) dmg = Math.min(dmg, Math.max(0, def.hp - 1));   // a battle the player can't lose
        const before = def.hp; def.hp -= dmg;
        sfx(eff > 1 ? 'super' : eff < 1 ? 'weak' : crit ? 'crit' : 'hit');
        play(other, 'Hurt'); V[other].flash = performance.now() / 1000 + .5;
        await hpTo(other, before);
        if (mv.drain && att.hp < att.maxhp && att.hp > 0) {
          const b2 = att.hp; att.hp = Math.min(att.maxhp, att.hp + Math.max(1, Math.floor(dmg * mv.drain / 100)));
          await hpTo(side, b2); await say(`${label(other, true)} had its energy drained!`);
        }
        if (side === 'foe' && o.protect && def.hp === 1 && !def.hung) { def.hung = true; await say(`${label(other, true)} is hanging on!`); }
        if (crit) await say('A critical hit!');
        if (eff > 1) await say('It’s super effective!'); else if (eff < 1) await say('It’s not very effective…');
        if (def.hp <= 0) {
          await cry(def, true);                    // a slower cry, then it fades away
          await tween(420, k => { V[other].dy = 50 * k; V[other].alpha = 1 - k; });
          showHud(other, false); sfx('faint');
          await say(`${label(other, true)} fainted!`);
          if (other === 'foe') hud('foe');
        }
      }
      async function sendOut() {
        V.me.m = cur(); V.me.dx = V.me.dy = 0;
        await say(`Go, ${cur().name}!`, 300);
        await tween(320, k => { V.me.alpha = k; V.me.scale = .3 + .7 * ease(k); });
        hud('me'); showHud('me', true); await cry(cur());
      }
      async function switchIn(i, forced) {
        if (!forced) { await say(`Come back, ${cur().name}!`, 300); await tween(260, k => { V.me.alpha = 1 - k; V.me.scale = 1 - .7 * k; }); }
        showHud('me', false); B.me = i; await sendOut();
      }
      async function gainExp(m, n) {
        await say(`${m.name} gained ${n} EXP. Points!`, 400);
        m.exp += n;
        const lv = Math.min(100, PP.store.levelForExp(m.sp.growth, m.exp));
        while (m.lv < lv) {
          $('meExp').style.width = '100%'; await sleep(600);
          m.lv++; stats(m);
          $('meExp').style.transition = 'none'; $('meExp').style.width = '0%'; void $('meExp').offsetWidth; $('meExp').style.transition = '';
          hud('me'); play('me', 'Hop');
          sfx('levelup'); await say(`${m.name} grew to Lv ${m.lv}!`);
          B.log.push(`${m.name} grew to Lv ${m.lv}`);
          const now = movesAt(d, m.sp, m.lv), had = new Set(m.moves.map(x => x.id));
          const fresh = now.filter(x => !had.has(x.id));
          if (fresh.length) {
            m.moves = now.map(x => Object.assign(x, { left: (m.moves.find(y => y.id === x.id) || x).left }));
            for (const x of fresh) await say(`${m.name} learned ${x.name}!`);
          }
        }
        $('meExp').style.width = expPct(m) + '%'; await sleep(450);
      }
      async function throwBall(it) {
        const f = foe(), fp = pos('foe'), mp = pos('me');
        await say(`You threw a ${it.name}!`, 150); sfx('throw');
        const from = { x: mp.x + 30, y: mp.y - 90 }, to = { x: fp.x, y: fp.y - 46 };
        V.ball = { src: it.image || 'assets/Pokemon Items/Pokeball/Pokeball.png', x: from.x, y: from.y, rot: 0 };
        await tween(650, k => { V.ball.x = from.x + (to.x - from.x) * k; V.ball.y = from.y + (to.y - from.y) * k - Math.sin(k * Math.PI) * 110; V.ball.rot = k * 14; });
        V.ball.rot = 0;
        await tween(260, k => { V.foe.alpha = 1 - k; V.foe.scale = 1 - .8 * k; });
        const ground = fp.y - 14;
        await tween(260, k => { V.ball.y = to.y + (ground - to.y) * ease(k); });
        const chance = catchChance(it, f), caught = Math.random() < chance;
        const shakes = caught ? 3 : Math.random() < chance ? 2 : Math.random() < .5 ? 1 : 0;
        for (let s = 0; s < shakes; s++) { await sleep(320); sfx('shake'); await tween(400, k => { V.ball.rot = Math.sin(k * Math.PI * 2) * .5; }); }
        await sleep(350);
        if (caught) {
          sfx('catch'); V.ball.dim = true; V.ball.stars = [[-18, -14], [16, -18], [22, 4], [-22, 6]];
          await say(`Caught it! ${f.name} was caught!`);
          B.caught = { species: f.id, level: f.lv, hp: f.hp, exp: f.exp };
          return true;
        }
        V.ball = null; sfx('breakout');
        await tween(240, k => { V.foe.alpha = k; V.foe.scale = .2 + .8 * k; });
        cry(f);
        await say(['It broke free!', 'So close… it broke free!', 'Argh! It was almost caught!'][shakes]);
        return false;
      }

      async function turn(a) {
        if (PVP) return pvpTurn(a);
        busy = true;
        const me = cur(), f = foe();
        if (a.type === 'move') {
          const fm = foeMove(f, me), mp = a.move.priority || 0, fp = fm.priority || 0;
          const meFirst = mp !== fp ? mp > fp : me.spe !== f.spe ? me.spe > f.spe : Math.random() < .5;
          for (const [side, mv] of meFirst ? [['me', a.move], ['foe', fm]] : [['foe', fm], ['me', a.move]]) {
            if (cur().hp <= 0 || foe().hp <= 0) break;
            await useMove(side, mv);
          }
        } else if (a.type === 'run') {
          B.runs++;
          if (me.spe >= f.spe || Math.random() * 100 < set.runChance + (B.runs - 1) * 20) { sfx('run'); await say('Got away safely!'); return finish('ran'); }
          await say('Couldn’t get away!');
          await useMove('foe', foeMove(f, me));
        } else if (a.type === 'switch') {
          await switchIn(a.i, false);
          await useMove('foe', foeMove(foe(), cur()));
        } else if (a.type === 'item') {
          const it = a.item;
          o.bag[it.id] = Math.max(0, (o.bag[it.id] || 0) - 1); if (!o.bag[it.id]) delete o.bag[it.id];
          B.used[it.id] = (B.used[it.id] || 0) + 1;
          if (it.ball) { if (await throwBall(it)) return finish('caught'); }
          else {
            const before = me.hp; me.hp = Math.min(me.maxhp, me.hp + it.heal); sfx('heal');
            await say(`You used a ${it.name}.`, 300); await hpTo('me', before);
            await say(`${me.name} got back ${me.hp - before} HP.`);
          }
          await useMove('foe', foeMove(foe(), cur()));
        }
        await afterTurn();
      }
      // ---- friend battles
      // 30 seconds to choose each turn; when time runs out a random move (or Pokémon) is chosen
      const TURN_SECONDS = (set.pvpTurnSeconds || 30);
      let pvpClock = null;
      function stopClock() { clearInterval(pvpClock); pvpClock = null; const c = $('pvpClock'); if (c) c.remove(); }
      function startClock(onTimeout) {
        stopClock(); if (!PVP || B.over) return;
        const end = Date.now() + TURN_SECONDS * 1000;
        const chip = document.createElement('div'); chip.className = 'pvp-clock'; chip.dataset.b = 'pvpClock';
        $('console').appendChild(chip);
        const tick = () => {
          const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
          chip.textContent = left + 's'; chip.classList.toggle('low', left <= 10);
          if (left <= 0) { stopClock(); onTimeout(); }
        };
        tick(); pvpClock = setInterval(tick, 250);
      }
      function randomTurn() {                      // time's up: pick any move that still has PP
        if (busy || B.over) return;
        const ok = cur().moves.filter(m => m.left > 0);
        turn({ type: 'move', move: ok.length ? ok[Math.floor(Math.random() * ok.length)] : STRUGGLE });
      }
      let forcedPick = null;
      const encode = a => a.type === 'move' ? { type: 'move', i: a.move === STRUGGLE ? -1 : cur().moves.indexOf(a.move) } : a.type === 'switch' ? { type: 'switch', i: a.i } : { type: a.type };
      const waiting = () => { $('console').classList.add('full'); $('menu').hidden = true; $('msgNext').hidden = true; $('msgText').textContent = `Waiting for ${tName}…`; };
      async function trade(mine) {               // send my choice, get theirs, and line up the shared random numbers
        waiting();
        const theirs = await o.pvp.exchange(B.turn, mine);
        reseed(B.turn); B.turn++;
        return theirs || { type: 'timeout' };
      }
      async function foeSwitch(i, forced) {
        if (!forced) { await say(`${tName} withdrew ${foe().name}!`, 300); await tween(260, k => { V.foe.alpha = 1 - k; }); }
        showHud('foe', false); B.fi = Math.max(0, Math.min(foes.length - 1, i));
        await say(`${tName} sent out ${foe().name}!`, 300);
        Object.assign(V.foe, { m: foe(), alpha: 0, dx: 0, dy: 0, scale: .3 });
        await tween(320, k => { V.foe.alpha = k; V.foe.scale = .3 + .7 * ease(k); });
        hud('foe'); showHud('foe', true); await cry(foe());
      }
      async function pvpTurn(a) {
        busy = true; stopClock();
        const mine = encode(a), theirs = await trade(mine);
        if (mine.type === 'forfeit') { await say('You gave up the battle.'); return finish('lost'); }
        if (theirs.type === 'forfeit' || theirs.type === 'timeout') { await say(theirs.type === 'timeout' ? `${tName} stopped responding.` : `${tName} gave up!`); return finish('won'); }
        // switches happen first (player a's before player b's), then moves by priority, speed, then a coin flip
        const meA = o.pvp.side === 'a';
        const switches = [['me', mine], ['foe', theirs]].filter(([, c]) => c.type === 'switch');
        if (!meA) switches.reverse();
        for (const [side, c] of switches) { if (side === 'me') await switchIn(c.i, false); else await foeSwitch(c.i, false); }
        const moveOf = (side, c) => c.i < 0 ? STRUGGLE : (side === 'me' ? cur() : foe()).moves[c.i] || STRUGGLE;
        const acts = [['me', mine], ['foe', theirs]].filter(([, c]) => c.type === 'move').map(([side, c]) => [side, moveOf(side, c)]);
        if (acts.length === 2) {
          const [m1, m2] = [acts[0][1], acts[1][1]], p1 = m1.priority || 0, p2 = m2.priority || 0;
          let meFirst;
          if (p1 !== p2) meFirst = p1 > p2;
          else if (cur().spe !== foe().spe) meFirst = cur().spe > foe().spe;
          else { const aFirst = R() < .5; meFirst = meA ? aFirst : !aFirst; }
          if (!meFirst) acts.reverse();
        }
        for (const [side, mv] of acts) {
          if (cur().hp <= 0 || foe().hp <= 0) break;
          await useMove(side, mv);
        }
        return pvpAfter();
      }
      async function pvpAfter() {
        const meLeft = party.some(m => m.hp > 0), foeLeft = foes.some(m => m.hp > 0);
        if (!meLeft && !foeLeft) { await say('Both sides are out of Pokémon!'); return finish('draw'); }
        if (!foeLeft) return finish('won');
        if (!meLeft) { await say('You have no Pokémon left that can fight!'); return finish('lost'); }
        const meOut = cur().hp <= 0, foeOut = foe().hp <= 0;
        if (meOut || foeOut) {                   // fainted Pokémon are replaced together
          let mine = { type: 'none' };
          if (meOut) {
            await say('Who will you send out next?', 300);
            const i = await new Promise(res => {
              forcedPick = v => { stopClock(); res(v); }; busy = false; partyMenu(true);
              startClock(() => { const ok = party.map((m, k) => m.hp > 0 ? k : -1).filter(k => k >= 0); if (forcedPick) { const f = forcedPick; forcedPick = null; f(ok[Math.floor(Math.random() * ok.length)]); } });
            });
            mine = { type: 'switch', i };
          }
          busy = true;
          const theirs = await trade(mine);
          if (theirs.type === 'forfeit' || theirs.type === 'timeout') { await say(theirs.type === 'timeout' ? `${tName} stopped responding.` : `${tName} gave up!`); return finish('won'); }
          if (meOut) await switchIn(mine.i, true);
          if (foeOut) await foeSwitch(theirs.type === 'switch' ? theirs.i : foes.findIndex(m => m.hp > 0), true);
        }
        commands();
      }

      async function afterTurn() {
        const me = cur(), f = foe();
        if (f.hp <= 0) {
          if (me.hp > 0) {
            const n = Math.max(1, Math.floor(f.sp.baseExp * f.lv / 7 * set.battleExpMult * (B.kind === 'trainer' ? set.trainerExpMult : 1)));
            await gainExp(me, n);
            // EXP Share: the rest of the team (not fainted) gets a part of it, quietly
            const share = Math.floor(n * (o.expShare || 0));
            const others = share > 0 ? party.filter(m => m !== me && m.hp > 0 && m.lv < 100) : [];
            if (others.length) {
              others.forEach(m => {
                m.exp += share;
                const lv = Math.min(100, PP.store.levelForExp(m.sp.growth, m.exp));
                if (lv > m.lv) { m.lv = lv; stats(m); B.log.push(`${m.name} grew to Lv ${m.lv} (EXP Share)`); m.moves = movesAt(d, m.sp, m.lv).map(x => Object.assign(x, { left: (m.moves.find(y => y.id === x.id) || x).left })); }
              });
              await say(`The rest of your team gained ${share} EXP thanks to the EXP Share!`, 400);
              const grew = others.filter(m => B.log.some(l => l === `${m.name} grew to Lv ${m.lv} (EXP Share)`));
              if (grew.length) { sfx('levelup'); await say(grew.map(m => `${m.name} grew to Lv ${m.lv}!`).join(' ')); }
            }
          }
          if (B.kind === 'trainer' && B.fi < foes.length - 1) {
            B.fi++;
            await say(`${tName} sent out ${foe().name}!`);
            Object.assign(V.foe, { m: foe(), alpha: 0, dx: 0, dy: 0, scale: .3 });
            await tween(320, k => { V.foe.alpha = k; V.foe.scale = .3 + .7 * ease(k); });
            hud('foe'); showHud('foe', true); await cry(foe());
          } else return finish(B.kind === 'trainer' ? 'won' : 'beat');
        }
        if (me.hp <= 0) {
          if (party.some(m => m.hp > 0)) { await say('Who will you send out next?', 300); busy = false; return partyMenu(true); }
          await say('You have no Pokémon left that can fight!');
          return finish('lost');
        }
        commands();
      }

      function finish(outcome) {
        if (B.over) return; B.over = true; busy = true; if (typeof stopClock === 'function') stopClock();
        if (PP.Audio) { if (outcome === 'won' || outcome === 'beat' || outcome === 'caught') { PP.Audio.stop(); sfx('victory'); } else if (outcome === 'lost' || outcome === 'draw') { PP.Audio.stop(); sfx('lose'); } }
        // write the battle back onto the player's Pokémon (friend battles never change your Pokémon)
        if (!PVP) party.forEach(m => { m.ref.hp = m.hp >= m.maxhp ? null : Math.max(0, m.hp); m.ref.exp = m.exp; m.ref.level = m.lv; });
        const f = foe();
        const prize = outcome === 'won' && o.trainer ? o.trainer.prize || 0 : 0;
        const R = {
          won: [I('star'), 'You won!', `You beat ${tName}${prize ? ` and got ${prize.toLocaleString()} ${set.coinName}` : ''}.`],
          beat: [I('swords'), 'Victory', `The wild ${f.name} fainted.`],
          caught: [`<img src="${PP.Sprite.portrait(f.folder) || ''}" alt="">`, `${f.name} caught!`, 'It’s been added to your Pokédex.'],
          ran: [I('flee'), 'Got away', 'You escaped safely.'],
          lost: [I('heart'), 'Out of usable Pokémon', o.loseText || 'You hurry back to safety. Your Pokémon will be healed.'],
          draw: [I('swords'), 'It’s a draw!', `You and ${tName} were evenly matched.`],
        }[outcome];
        if (PVP && outcome === 'won') R[2] = `You beat ${tName}!`;
        if (PVP && outcome === 'lost') { R[1] = 'You lost'; R[2] = `${tName} won this time. Train up and try again!`; }
        $('resultIcon').innerHTML = R[0]; $('resultTitle').textContent = R[1]; $('resultText').textContent = R[2];
        setTimeout(() => { $('result').hidden = false; }, 250);
        $('resultGo').onclick = () => {
          B.alive = false; document.removeEventListener('keydown', onKey);
          if (o.onEnd) o.onEnd({ outcome, caught: B.caught || null, prize, used: B.used, log: B.log, foe: { species: f.id, level: f.lv } });
        };
      }

      // ---- opening
      (async () => {
        foes.concat(party).forEach(m => PP.Sprite.preload(m.folder, ['Idle', 'Attack', 'Hurt', 'Hop']));
        Object.assign(V.foe, { m: foe(), alpha: 1, dx: 260 });
        $('trainerChip').hidden = !vsTrainer;
        $('trainerChip').innerHTML = I('user') + PP.esc(tName);
        await tween(600, k => { V.foe.dx = 260 * (1 - ease(k)); });
        if (B.kind === 'wild') { cry(foe()); await say(`A wild ${foe().name} appeared!`); }
        else { await say(PVP ? `Friend battle with ${tName}!` : `${tName} wants to battle!`); cry(foe()); await say(`${tName} sent out ${foe().name}!`); }
        hud('foe'); showHud('foe', true);
        await sendOut();
        commands();
      })();
      return { box };
    },
  };
})();
