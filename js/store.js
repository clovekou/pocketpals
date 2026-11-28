// Shared storage for the game (index.html) and the admin (admin.html).
// Three localStorage keys: game data (settings + content), the player's save, the activity log.
// Everything read back is validated against PP.SCHEMA, so bad or old values can't break the game.
// When one tab writes, the other gets a 'storage' event and refreshes (see onExternal).
(function () {
  'use strict';
  const SC = PP.SCHEMA;
  const KEYS = { data: 'pp2.data', save: 'pp2.save', log: 'pp2.log', names: 'pp2.names' };
  const clone = o => JSON.parse(JSON.stringify(o));
  let logLimit = 500;
  const externals = [];          // onExternal listeners, also called by emit()

  function read(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function write(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch (e) { console.warn('Could not save', k, e); return false; }
  }
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const slug = s => String(s == null ? '' : s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

  // ---------- select options ----------
  function options(src, d) {
    if (Array.isArray(src)) return src.map(o => Array.isArray(o) ? o : [o, String(o)]);
    d = d || {};
    const needs = d.needs || [], items = d.items || [], actions = d.actions || [], locs = d.locations || [];
    switch (src) {
      case 'icons': return PP.ICON_CHOICES.map(i => [i, i]);
      case 'needs': return needs.map(n => [n.id, n.label]);
      case 'needsOrNone': return [['none', 'Nothing']].concat(needs.map(n => [n.id, n.label]));
      case 'items': return items.map(i => [i.id, i.name]);
      case 'itemsOrRandom': return [['random', 'Random (by drop weight)']].concat(items.map(i => [i.id, i.name]));
      case 'locations': return locs.map(l => [l.id, l.name]);
      case 'emotions': return (PP.EMOTIONS || ['Normal']).map(e => [e, e]);
      case 'emotionsOrNone': return [['none', 'No reaction']].concat((PP.EMOTIONS || ['Normal']).map(e => [e, e]));
      case 'pokemon': return (d.pokemon || []).map(p => [p.id, `#${String(p.dex).padStart(3, '0')} ${p.name}`]);
      case 'regions': return (d.regions || []).map(r => [r.id, r.name]);
      case 'encounterTables': return (d.encounterTables || []).map(t => [t.id, t.name]);
      case 'types': return Object.keys(PP.TYPES || {}).map(t => [t, t[0].toUpperCase() + t.slice(1)]);
      case 'typesOrNone': return [['none', '—']].concat(Object.keys(PP.TYPES || {}).map(t => [t, t[0].toUpperCase() + t.slice(1)]));
      case 'spriteFolders': return Object.keys(PP.SPRITES || {}).map(f => [f, f]);
      case 'pokemonOrNone': return [['', 'None (shows the starter screen)']].concat((d.pokemon || []).map(p => [p.id, p.name]));
      case 'chapters': return (d.chapters || []).map(c => [c.id, `Chapter ${c.number}: ${c.title}`]);
      case 'badgesOrNone': return [['none', 'None']].concat((d.badges || []).map(b => [b.id, b.name]));
      case 'trainersOrNone': return [['none', 'None']].concat((d.trainers || []).map(t => [t.id, `${t.trainerClass} ${t.name}`]));
      case 'locationsOrNone': return [['none', 'None']].concat(locs.map(l => [l.id, l.name]));
      case 'itemsOrNone': return [['none', 'None']].concat(items.map(i => [i.id, i.name]));
      case 'storyStepsOrNone': return [['none', 'None (no story step needed)']].concat((d.storySteps || []).map(st => [st.id, `${st.chapter}: ${st.title}`]));
      case 'musicOrNone': return [['none', 'No music']].concat((d.music || []).map(t => [t.id, t.name]));
      case 'categoriesOrNone': return [['none', 'None (not in a shop tab)']].concat((d.categories || []).map(c => [c.id, c.name]));
      case 'backgroundsOrNone': return [['none', 'None (plain)']].concat((d.backgrounds || []).map(b => [b.id, b.name]));
      case 'backgrounds': return (d.backgrounds || []).map(b => [b.id, b.name]);
      case 'backgroundsOrAuto': return [['auto', 'Auto (by environment)']].concat((d.backgrounds || []).map(b => [b.id, b.name]));
      case 'backgroundsOrHome': return [['home', 'Same as home']].concat((d.backgrounds || []).map(b => [b.id, b.name]));
      case 'goals': return []
        .concat(actions.map(a => ['action:' + a.id, `Use “${a.label}”`]))
        .concat([['explore:any', 'Explore any area']])
        .concat(locs.map(l => ['explore:' + l.id, `Explore ${l.name}`]))
        .concat([['see:any', 'Meet a wild Pokémon'], ['catch:any', 'Catch a Pokémon'], ['evolve', 'Evolve a Pokémon'], ['battle:win', 'Win a battle (any)'], ['battle:wild', 'Beat a wild Pokémon'], ['battle:trainer', 'Beat a trainer'],
          ['heal', 'Heal the team in a town'], ['buy:any', 'Buy from the shop'], ['use:any', 'Use an item']])
        .concat((d.chapters || []).map(c => ['chapter:' + c.id, `Finish Chapter ${c.number}: ${c.title}`]))
        .concat((d.badges || []).map(b => ['badge:' + b.id, `Earn the ${b.name}`]))
        .concat([['level', 'Reach a trainer level (total)'], ['dex:caught', 'Different Pokémon caught (total)'], ['dex:seen', 'Different Pokémon seen (total)'],
          ['badges', 'Badges earned (total)'], ['trainers', 'Trainers beaten (total)'], ['chapters', 'Chapters finished (total)'], ['owned', 'Pokémon owned (total)']]);
      default: return [];
    }
  }

  // ---------- validation ----------
  function coerce(f, v, d) {
    const def = f.def;
    switch (f.type) {
      case 'int': case 'number': {
        let n = Number(v);
        if (v === '' || v == null || !Number.isFinite(n)) n = def != null ? def : (f.min != null ? f.min : 0);
        if (f.type === 'int') n = Math.round(n);
        if (f.min != null) n = Math.max(f.min, n);
        if (f.max != null) n = Math.min(f.max, n);
        return n;
      }
      case 'bool': return v == null ? !!def : !!v;
      case 'color': return /^#[0-9a-f]{6}$/i.test(v) ? String(v).toLowerCase() : (def || '#888888');
      case 'select': {
        const vals = options(f.optionsFrom || f.options, d).map(o => o[0]);
        if (vals.includes(v)) return v;
        if (vals.includes(def)) return def;
        return vals.length ? vals[0] : '';
      }
      case 'id': return slug(v);
      case 'multi': {
        const vals = new Set(options(f.optionsFrom || f.options, d).map(o => o[0]));
        const arr = Array.isArray(v) ? v : typeof v === 'string' && v ? v.split(',') : (def || []);
        return [...new Set(arr.map(x => String(x).trim()))].filter(x => vals.has(x));
      }
      default: return String(v == null ? (def != null ? def : '') : v).slice(0, f.max || 300);
    }
  }
  const normalizeRow = (c, row, d) => Object.fromEntries(c.fields.map(f => [f.key, coerce(f, (row || {})[f.key], d)]));

  function defaults() {
    const d = { settings: {} };
    SC.settings.forEach(g => g.fields.forEach(f => { d.settings[f.key] = f.def; }));
    Object.entries(SC.collections).forEach(([k, c]) => { d[k] = clone(c.rows); });
    return d;
  }
  function defaultRow(c) { return Object.fromEntries(c.fields.filter(f => f.type !== 'id').map(f => [f.key, f.def])); }

  function normalizeData(raw) {
    const def = defaults();
    raw = raw && typeof raw === 'object' ? raw : {};
    const d = { settings: {}, contentVersion: SC.contentVersion };
    const migrate = (Number(raw.contentVersion) || 1) < SC.contentVersion;
    const pairs = {};
    Object.entries(SC.collections).forEach(([k, c]) => {
      let rows = Array.isArray(raw[k]) ? raw[k] : def[k];
      if (migrate && Array.isArray(raw[k])) {
        // older saved data: fill in fields that didn't exist yet, and append new default rows
        const defById = Object.fromEntries(def[k].map(r => [r.id, r]));
        rows = rows.map(r => r && defById[r.id] ? Object.assign({}, defById[r.id], r) : r);
        const have = new Set(rows.map(r => r && r.id));
        rows = rows.concat(def[k].filter(r => !have.has(r.id)));
      }
      // one-time removals of retired rows from older saved data
      if (Array.isArray(raw[k])) (SC.rowRemovals || []).forEach(u => {
        if (u.collection === k && (Number(raw.contentVersion) || 1) < u.v) rows = rows.filter(r => !(r && u.ids.includes(r.id)));
      });
      if (Array.isArray(raw[k])) (SC.rowUpdates || []).forEach(u => {
        if (u.collection === k && (Number(raw.contentVersion) || 1) < u.v) rows = rows.map(r => r && u.ids.includes(r.id) ? Object.assign({}, r, u.set) : r);
      });
      const seen = new Set();
      pairs[k] = rows.map(r => [normalizeRow(c, r, d), r || {}]).filter(([r]) => r.id && !seen.has(r.id) && seen.add(r.id));
      d[k] = pairs[k].map(([r]) => r);
    });
    // second pass: re-check references now that every collection exists
    Object.entries(SC.collections).forEach(([k, c]) => {
      const refs = c.fields.filter(f => (f.type === 'select' || f.type === 'multi') && f.optionsFrom);
      if (refs.length) pairs[k].forEach(([r, rawRow]) => refs.forEach(f => { r[f.key] = coerce(f, rawRow[f.key], d); }));
    });
    const rs = Object.assign({}, raw.settings || {});
    const fromV = Number(raw.contentVersion) || 1;
    if (raw.settings) (SC.settingsUpdates || []).forEach(u => { if (fromV < u.v) Object.assign(rs, u.set); });
    SC.settings.forEach(g => g.fields.forEach(f => { d.settings[f.key] = coerce(f, rs[f.key], d); }));
    return d;
  }

  // ---------- player save ----------
  function newSave(d) {
    const s = d.settings, t = Date.now();
    return {
      v: 1, name: s.defaultName, level: s.startLevel, exp: 0, coins: s.startCoins, gems: s.startGems,
      needs: Object.fromEntries(d.needs.map(n => [n.id, n.start])),
      inventory: {}, quests: {}, counters: {}, cooldowns: {},
      location: (d.locations[0] || {}).id || '',
      box: [],          // PC box: every Pokémon the player owns [{ uid, species, nickname, since }]
      partner: '',      // uid of the box Pokémon on the home screen ('' = no starter yet)
      avatar: '',       // species shown as the profile icon ('' = the partner's)
      named: false,     // has picked their in-game name in the welcome
      tutorialDone: false,
      team: [],         // uids of the Pokémon that battle with you (first = lead)
      pendingBattle: null, // a battle in progress, so a refresh resumes it instead of re-rolling
      kitGiven: false,  // starter Poké Balls and Potions handed out
      stats: { explores: 0, coinsEarned: 0, encounters: 0 },
      story: { done: {}, chapters: {} }, badges: {}, beaten: {},
      daily: { day: '', ids: [] },     // today's daily quests (day key, picked quest ids)
      tradesDone: {},                  // trade id → what this player already did with it (online trades)
      rivalName: s.rivalDefault || 'Kai', rivalNamed: false,   // the rival's name, chosen in the welcome
      dex: { seen: {}, caught: {} },   // species id → time first seen / caught
      areas: {},                       // area id → { explores, seen: { species: count } }
      createdAt: t, lastTick: t,
    };
  }
  function num(v, lo, hi, def, round) {
    let n = Number(v);
    if (v === '' || v == null || !Number.isFinite(n)) n = def;
    if (round) n = Math.round(n);
    return Math.max(lo, Math.min(hi, n));
  }
  function normalizeSave(raw, d) {
    const base = newSave(d);
    if (!raw || typeof raw !== 'object') return base;
    const s = d.settings, out = {};
    out.v = 1;
    out.name = String(raw.name == null ? base.name : raw.name).slice(0, 20).trim() || base.name;
    out.level = num(raw.level, 1, s.maxLevel, base.level, true);
    out.exp = num(raw.exp, 0, 1e12, 0, true);
    out.coins = num(raw.coins, 0, 1e12, base.coins, true);
    out.gems = num(raw.gems, 0, 1e12, base.gems, true);
    out.needs = {};
    d.needs.forEach(n => { out.needs[n.id] = num((raw.needs || {})[n.id], 0, 100, n.start); });
    out.inventory = {};
    d.items.forEach(i => { const q = num((raw.inventory || {})[i.id], 0, 1e9, 0, true); if (q > 0) out.inventory[i.id] = q; });
    out.quests = {};
    d.quests.forEach(q => {
      const st = (raw.quests || {})[q.id];
      if (st) out.quests[q.id] = { progress: num(st.progress, 0, 1e9, 0, true), claimed: !!st.claimed };
    });
    const numMap = m => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([, v]) => Number.isFinite(Number(v))).map(([k, v]) => [k, Number(v)]));
    out.counters = numMap(raw.counters);
    out.cooldowns = numMap(raw.cooldowns);
    out.location = d.locations.some(l => l.id === raw.location) ? raw.location : base.location;
    // PC box (older saves had a single `pet`: it becomes the first box Pokémon and the partner)
    const known = id => (d.pokemon || []).some(p => p.id === id);
    const rawBox = Array.isArray(raw.box) ? raw.box : (raw.pet ? [{ uid: 'p1', species: raw.pet, nickname: raw.petName, since: raw.petSince }] : []);
    const uids = new Set();
    out.box = rawBox.filter(e => e && known(e.species)).map((e, i) => {
      let uid = String(e.uid || 'p' + (i + 1)).replace(/[^\w-]/g, '').slice(0, 24) || 'p' + (i + 1);
      while (uids.has(uid)) uid += 'x';
      uids.add(uid);
      const sp = d.pokemon.find(p => p.id === e.species);
      const level = num(e.level != null ? e.level : raw.level, 1, 100, 5, true);      // older saves shared one level
      const exp = Math.max(num(e.exp, 0, 1e9, 0, true), expForLevel(sp && sp.growth, level));
      return { uid, species: e.species, nickname: String(e.nickname || '').slice(0, 16).trim(), since: Number(e.since) || Date.now(),
        level: levelForExp(sp && sp.growth, exp), exp, caughtAt: String(e.caughtAt || '').slice(0, 40),
        friendship: num(e.friendship, 0, 255, 70, true), held: d.items.some(it => it.id === e.held) ? e.held : '',
        hp: e.hp == null || e.hp === '' ? null : num(e.hp, 0, 9999, 0, true) };     // null = full HP
    });
    out.partner = out.box.some(e => e.uid === raw.partner) ? raw.partner : (out.box[0] ? out.box[0].uid : '');
    out.avatar = out.box.some(e => e.species === raw.avatar) ? raw.avatar : '';
    const teamMax = s.teamMax || 6, inBox = new Set(out.box.map(e => e.uid));
    out.team = [...new Set(Array.isArray(raw.team) ? raw.team : [])].filter(u => inBox.has(u)).slice(0, teamMax);
    if (!out.team.length && out.partner) out.team = [out.partner];
    const pb = raw.pendingBattle;
    out.pendingBattle = pb && typeof pb === 'object' && Array.isArray(pb.foes) && pb.foes.length && pb.foes.every(f => f && known(f.species))
      ? { kind: pb.kind === 'trainer' ? 'trainer' : 'wild', area: String(pb.area || ''), foes: pb.foes.map(f => ({ species: f.species, level: num(f.level, 1, 100, 5, true) })), at: Number(pb.at) || Date.now(),
          step: String(pb.step || ''), trainer: String(pb.trainer || '') }
      : null;
    out.kitGiven = !!raw.kitGiven;
    const ids = (list, m) => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([id]) => (list || []).some(x => x.id === id)).map(([id, t]) => [id, Number(t) || Date.now()]));
    const rs = raw.story || {};
    out.story = { done: ids(d.storySteps, rs.done), chapters: ids(d.chapters, rs.chapters) };   // step/chapter id → when finished
    // story steps added later in front of where the player already is count as done (nobody is sent back)
    const order = (d.storySteps || []).filter(st => st.enabled).map(st => st.id);
    let far = -1; order.forEach((id, i) => { if (out.story.done[id]) far = i; });
    for (let i = 0; i < far; i++) if (!out.story.done[order[i]]) out.story.done[order[i]] = 1;
    out.badges = ids(d.badges, raw.badges);
    out.beaten = ids(d.trainers, raw.beaten);
    const rdy = raw.daily && typeof raw.daily === 'object' ? raw.daily : {};
    out.rivalName = String(raw.rivalName || '').trim().slice(0, 20) || s.rivalDefault || 'Kai';
    out.rivalNamed = raw.rivalNamed != null ? !!raw.rivalNamed : !!(raw.named && Array.isArray(raw.box) && raw.box.length);   // players from before this keep “Kai”
    out.tradesDone = Object.fromEntries(Object.entries(raw.tradesDone && typeof raw.tradesDone === 'object' ? raw.tradesDone : {}).filter(([k, v]) => typeof v === 'string').slice(-300).map(([k, v]) => [String(k).slice(0, 40), v.slice(0, 12)]));
    out.daily = { day: String(rdy.day || '').slice(0, 10), ids: (Array.isArray(rdy.ids) ? rdy.ids : []).filter(id => d.quests.some(q => q.id === id)) };
    out.lastTown = d.locations.some(l => l.id === raw.lastTown) ? raw.lastTown : '';
    out.named = !!raw.named;
    out.tutorialDone = !!raw.tutorialDone;
    const st = raw.stats || {};
    out.stats = { explores: num(st.explores, 0, 1e12, 0, true), coinsEarned: num(st.coinsEarned, 0, 1e15, 0, true), encounters: num(st.encounters, 0, 1e12, 0, true) };
    const rd = raw.dex || {}, stamp = m => Object.fromEntries(Object.entries(m && typeof m === 'object' ? m : {}).filter(([id]) => known(id)).map(([id, t]) => [id, Number(t) || Date.now()]));
    out.dex = { seen: stamp(rd.seen), caught: stamp(rd.caught) };
    out.box.forEach(e => { out.dex.caught[e.species] = out.dex.caught[e.species] || e.since; });     // everything you own is caught…
    Object.keys(out.dex.caught).forEach(id => { out.dex.seen[id] = out.dex.seen[id] || out.dex.caught[id]; });   // …and seen
    out.areas = {};
    Object.entries(raw.areas && typeof raw.areas === 'object' ? raw.areas : {}).forEach(([id, a]) => {
      if (!d.locations.some(l => l.id === id) || !a) return;
      out.areas[id] = { explores: num(a.explores, 0, 1e9, 0, true), seen: Object.fromEntries(Object.entries(a.seen || {}).filter(([sid]) => known(sid)).map(([sid, n]) => [sid, num(n, 1, 1e9, 1, true)])) };
    });
    out.createdAt = Number(raw.createdAt) || base.createdAt;
    out.lastTick = Number(raw.lastTick) || base.lastTick;
    return out;
  }

  // ---------- levels ----------
  // Pokémon EXP curves by growth speed: total EXP needed to *reach* level n
  const CURVES = {
    fast: n => Math.floor(4 * n ** 3 / 5),
    medium: n => n ** 3,
    'medium-slow': n => Math.max(0, Math.floor(6 / 5 * n ** 3 - 15 * n ** 2 + 100 * n - 140)),
    slow: n => Math.floor(5 * n ** 3 / 4),
    erratic: n => n <= 50 ? Math.floor(n ** 3 * (100 - n) / 50) : n <= 68 ? Math.floor(n ** 3 * (150 - n) / 100) : n <= 98 ? Math.floor(n ** 3 * Math.floor((1911 - 10 * n) / 3) / 500) : Math.floor(n ** 3 * (160 - n) / 100),
    fluctuating: n => n <= 15 ? Math.floor(n ** 3 * (Math.floor((n + 1) / 3) + 24) / 50) : n <= 36 ? Math.floor(n ** 3 * (n + 14) / 50) : Math.floor(n ** 3 * (Math.floor(n / 2) + 32) / 50),
  };
  const expForLevel = (growth, n) => (n <= 1 ? 0 : (CURVES[growth] || CURVES.medium)(n));
  function levelForExp(growth, exp) { let n = 1; while (n < 100 && expForLevel(growth, n + 1) <= exp) n++; return n; }
  const expNeed = (level, d) => Math.max(1, Math.round(d.settings.expBase * Math.pow(d.settings.expGrowth, level - 1)));

  // ---------- public API ----------
  PP.esc = esc;
  PP.slug = slug;
  PP.store = {
    KEYS, clone, options, expForLevel, levelForExp, coerce, defaults, defaultRow, normalizeData, normalizeSave, newSave, expNeed,
    loadData() { const d = normalizeData(read(KEYS.data)); logLimit = d.settings.logLimit; return d; },
    writeData(d) { const n = normalizeData(d); logLimit = n.settings.logLimit; write(KEYS.data, n); return n; },
    loadSave(d) { return normalizeSave(read(KEYS.save), d); },
    rawSave() { return read(KEYS.save); },
    writeSave(s) { return write(KEYS.save, s); },
    getLog() { const l = read(KEYS.log); return Array.isArray(l) ? l : []; },
    clearLog() { write(KEYS.log, []); },
    writeLog(l) { write(KEYS.log, Array.isArray(l) ? l.slice(0, logLimit) : []); },
    /** record something that happened (shown in Admin → Activity) */
    log(kind, text) {
      const l = this.getLog();
      l.unshift({ t: Date.now(), kind, text: String(text).slice(0, 300) });
      write(KEYS.log, l.slice(0, logLimit));
    },
    /** fn('data' | 'save' | 'log' | 'all') when another tab changes storage */
    onExternal(fn) {
      externals.push(fn);
      window.addEventListener('storage', e => {
        if (e.key === null) return fn('all');
        const name = Object.keys(KEYS).find(k => KEYS[k] === e.key);
        if (name) fn(name);
      });
    },
    /** tell this tab's listeners that something changed elsewhere (used by online sync) */
    emit(kind) { externals.forEach(fn => fn(kind)); },
    // ---------- in-game names ----------
    // Names are unique on this device: once a player takes a name it stays taken (even after a reset)
    // until the admin releases it. Truly unique names across players need online accounts.
    takenNames() { const l = read(KEYS.names); return Array.isArray(l) ? l.filter(x => x && x.name) : []; },
    /** null if `name` is allowed, otherwise the reason it isn't. `current` = the player's own name. */
    checkName(name, d, current) {
      const s = d.settings, n = String(name || '').trim(), key = n.toLowerCase();
      if (n.length < s.nameMin) return `Use at least ${s.nameMin} letters.`;
      if (n.length > s.nameMax) return `Use at most ${s.nameMax} letters.`;
      if (!/^[\p{L}\p{N}][\p{L}\p{N} _.\-]*$/u.test(n)) return 'Use letters, numbers, spaces, dots, dashes or underscores.';
      const reserved = s.reservedNames.split(/[,\n]/).map(x => x.trim().toLowerCase()).filter(Boolean);
      if (reserved.includes(key)) return 'That name is reserved. Try another one.';
      if (key !== String(current || '').toLowerCase() && this.takenNames().some(x => x.name.toLowerCase() === key)) return 'That name is already taken. Try another one.';
      return null;
    },
    /** take `name` (and give back `old`, the player's previous name) */
    claimName(name, old) {
      const l = this.takenNames().filter(x => !old || x.name.toLowerCase() !== String(old).toLowerCase());
      if (!l.some(x => x.name.toLowerCase() === name.toLowerCase())) l.push({ name, at: Date.now() });
      write(KEYS.names, l);
    },
    releaseName(name) { write(KEYS.names, this.takenNames().filter(x => x.name.toLowerCase() !== String(name).toLowerCase())); },
    reset(what) { (what === 'all' ? Object.values(KEYS) : [KEYS[what]]).forEach(k => { try { localStorage.removeItem(k); } catch (e) {} }); },
  };
})();
