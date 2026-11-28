// Pocket Pals v2 — game screen.
// Every number comes from `data` (admin-editable, see schema.js); every reward or change the
// game makes is written to the activity log so it shows up in Admin → Activity.
PP.whenReady(function () {   // after sign-in when online (js/online/cloud.js), straight away offline
  'use strict';
  const S = PP.store, I = PP.icon, esc = PP.esc;
  const $ = id => document.getElementById(id);
  const fmt = n => Math.floor(n).toLocaleString();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  /** the story is written with “Kai”: show the rival's chosen name instead (only on screen, never saved) */
  function personalize(d, rival) {
    const from = (d.settings.rivalDefault || 'Kai').trim(), to = String(rival || '').trim();
    if (!from || !to || to === from) return d;
    const re = new RegExp('\\b' + from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
    const swap = v => typeof v === 'string' ? v.replace(re, () => to) : v;
    const TEXT = ['name', 'title', 'text', 'intro', 'defeat', 'description'];          // shown words only, never ids
    ['trainers', 'storySteps', 'chapters', 'quests', 'locations'].forEach(k => (d[k] || []).forEach(r => TEXT.forEach(f => { if (f in r) r[f] = swap(r[f]); })));
    return d;
  }
  let questOpen = (() => { try { return localStorage.getItem('pp2.questOpen') === '1'; } catch (e) { return false; } })();   // the home quest card starts folded
  let data = S.loadData();
  let save = S.loadSave(data);
  data = personalize(data, save.rivalName);
  let sheetKind = null;
  let careOpen = data.settings.careStartOpen;   // is the care menu dropped down?
  function setCare(open) {
    careOpen = open;
    const wrap = $('actions'), menu = $('actMenu'), tg = wrap.querySelector('.act-toggle');
    wrap.classList.toggle('open', open);
    if (menu) menu.inert = !open;
    if (tg) { tg.setAttribute('aria-expanded', String(open)); tg.querySelector('.act-toggle-ic').innerHTML = I(open ? 'close' : 'heart'); }
  }
  let lastExplore = null;
  const sig = {};               // last-rendered signatures, so cards only re-render when they change

  const TABS = [
    { id: 'bag', icon: 'bag', label: 'tabBag' },
    { id: 'pals', icon: 'pokeball', label: 'tabPals' },
    { id: 'explore', icon: 'compass', label: 'tabExplore', center: true },
    { id: 'party', icon: 'users', label: 'tabParty' },
    { id: 'shop', icon: 'cart', label: 'tabShop' },
  ];
  const needOf = id => data.needs.find(n => n.id === id);
  const itemOf = id => data.items.find(i => i.id === id);
  const locOf = id => data.locations.find(l => l.id === id);
  const coinName = () => data.settings.coinName;
  const gemName = () => data.settings.gemName;

  // ---------------- time ----------------
  /** move game time forward to now; returns the game minutes that passed */
  function advance() {
    const t = Date.now();
    const speed = data.settings.fastTime ? 60 : 1;
    const mins = Math.min(Math.max(0, (t - save.lastTick) / 60000 * speed), data.settings.offlineCapHours * 60);
    save.lastTick = t;
    if (ensureDaily()) { questNotices(true); if (sheetKind === 'quests') renderSheet(); }
    if (!mins) return 0;
    regenHp(mins);
    const floor = data.settings.needMin;
    data.needs.forEach(n => {
      const v = save.needs[n.id];
      save.needs[n.id] = Math.max(Math.min(v, floor), v - n.decayPerHour / 60 * mins);
    });
    return mins;
  }
  const persist = () => S.writeSave(save);

  // ---------------- progress ----------------
  /** trainer EXP; the partner Pokémon gets its share (Game settings → Pokémon) as its own EXP */
  function gainExp(n) {
    if (!n) return;
    const s = data.settings;
    petExp(Math.round(n * s.partnerExpShare / 100));
    save.exp += n;
    while (save.level < s.maxLevel && save.exp >= S.expNeed(save.level, data)) {
      save.exp -= S.expNeed(save.level, data);
      save.level++;
      save.coins += s.levelUpCoins; save.gems += s.levelUpGems;
      S.log('level', `Trainer reached Lv ${save.level}` + rewardText(s.levelUpCoins, s.levelUpGems));
      toast(`Trainer level up! Lv ${save.level}`); PP.Audio.sfx('levelup');
      setTimeout(() => react(s.emoLevel), 0);
    }
    if (save.level >= s.maxLevel) save.exp = Math.min(save.exp, S.expNeed(save.level, data));
  }
  /** EXP for the partner Pokémon, levelling it by its species' growth speed */
  function petExp(n) {
    const e = partnerEntry(), sp = petSpecies();
    if (!e || !sp || n <= 0 || e.level >= 100) return;
    e.exp += n;
    const lv = Math.min(100, S.levelForExp(sp.growth, e.exp));
    if (lv > e.level) {
      e.level = lv;
      S.log('pokemon', `${labelOf(e)} grew to Lv ${e.level}`);
      toast(`${labelOf(e)} grew to Lv ${e.level}!`);
      setTimeout(() => { playAnim('Hop'); react(data.settings.emoLevel); }, 0);
    }
  }
  function rewardText(coins, gems) {
    const p = [];
    if (coins) p.push(`+${fmt(coins)} ${coinName()}`);
    if (gems) p.push(`+${fmt(gems)} ${gemName()}`);
    return p.length ? ' (' + p.join(', ') + ')' : '';
  }
  function addCoins(n) { save.coins += n; save.stats.coinsEarned += n; }
  function addItem(id, n) { save.inventory[id] = (save.inventory[id] || 0) + n; if (save.inventory[id] <= 0) delete save.inventory[id]; }

  // ---------------- quests ----------------
  // Goals that count what the player already has (badges owned, Pokédex size…) instead of new actions.
  const STATE_GOALS = {
    level: () => save.level,
    'dex:caught': () => Object.keys(save.dex.caught).length,
    'dex:seen': () => Object.keys(save.dex.seen).length,
    badges: () => Object.keys(save.badges).length,
    trainers: () => Object.keys(save.beaten).length,
    chapters: () => Object.keys(save.story.chapters).length,
    owned: () => save.box.length,
  };
  function stateValue(goal) {
    if (STATE_GOALS[goal]) return STATE_GOALS[goal]();
    let m = /^chapter:(.+)$/.exec(goal); if (m) return save.story.chapters[m[1]] ? 1 : 0;
    m = /^badge:(.+)$/.exec(goal); if (m) return save.badges[m[1]] ? 1 : 0;
    return null;
  }
  const QUEST_KINDS = [['story', 'Story', 'flag'], ['daily', 'Daily', 'clock'], ['explore', 'Exploration', 'compass'], ['achievement', 'Achievements', 'star']];
  /** the day key for daily quests (the day starts at the admin's reset hour) */
  function dayKey(t = Date.now()) {
    const d = new Date(t - data.settings.dailyResetHour * 3600e3);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function nextReset() {
    const h = data.settings.dailyResetHour, d = new Date();
    const r = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0);
    if (r <= d) r.setDate(r.getDate() + 1);
    return r.getTime();
  }
  /** a new day: daily quests start over, and today's set is picked */
  function ensureDaily() {
    const key = dayKey();
    if (save.daily.day === key) return false;
    const pool = data.quests.filter(q => q.active && q.kind === 'daily');
    pool.forEach(q => { delete save.quests[q.id]; });
    const n = data.settings.dailyPick;
    let ids = pool.map(q => q.id);
    if (n > 0 && ids.length > n) {
      const shuffled = ids.slice().sort(() => Math.random() - 0.5).slice(0, n);
      ids = ids.filter(id => shuffled.includes(id));       // keep the admin's order
    }
    const first = !save.daily.day;
    save.daily = { day: key, ids };
    if (!first) S.log('quest', `New day: ${ids.length} daily quest${ids.length === 1 ? '' : 's'}`);
    return true;
  }
  /** is the quest on offer right now (daily ones only on the days they were picked) */
  const questOn = q => q.active && (q.kind !== 'daily' || data.settings.dailyPick === 0 || save.daily.ids.includes(q.id));
  function questState(q) {
    const st = save.quests[q.id] || { progress: 0, claimed: false };
    const v = stateValue(q.goal);
    const progress = Math.min(v != null ? v : st.progress, q.target);
    return { progress, claimed: st.claimed, done: progress >= q.target };
  }
  /** count one step towards every active quest with this goal */
  function bump(goal, n = 1) {
    if (stateValue(goal) != null) return;
    data.quests.forEach(q => {
      if (!questOn(q) || q.goal !== goal) return;
      const st = save.quests[q.id] || (save.quests[q.id] = { progress: 0, claimed: false });
      if (st.claimed) return;
      st.progress = Math.min(q.target, st.progress + n);
    });
  }
  // toast once when a quest becomes ready to claim (covers both counted and "total" goals)
  const questKey = q => q.kind === 'daily' ? q.id + '@' + save.daily.day : q.id;
  const questToasted = new Set();
  function questNotices(silent) {
    data.quests.forEach(q => {
      if (!questOn(q)) return;
      const st = questState(q), k = questKey(q);
      if (st.done && !st.claimed && !questToasted.has(k)) { questToasted.add(k); if (!silent) toast(`Quest complete: ${q.title}`); }
    });
  }
  const readyQuests = () => data.quests.filter(q => questOn(q) && questState(q).done && !questState(q).claimed);
  /** the home card: a quest ready to claim first, then the first unfinished one */
  const currentQuest = () => readyQuests()[0] || data.quests.find(q => questOn(q) && !questState(q).claimed);
  const kindLabel = k => (QUEST_KINDS.find(x => x[0] === k) || [k, 'Quest'])[1];

  // ---------------- player actions ----------------
  function doAction(a) {
    const t = Date.now(), cd = save.cooldowns[a.id] || 0;
    if (cd > t) return toast(`${a.label} is ready in ${Math.ceil((cd - t) / 1000)}s`);
    if (save.coins < a.coinCost) return toast(`Not enough ${coinName()}`);
    const n = needOf(a.need), before = save.needs[a.need];
    save.needs[a.need] = clamp(before + a.amount, 0, 100);
    save.coins -= a.coinCost;
    if (a.cooldownSec) save.cooldowns[a.id] = t + a.cooldownSec * 1000;
    save.counters['action:' + a.id] = (save.counters['action:' + a.id] || 0) + 1;
    S.log('action', `${a.label}: ${n.label} ${Math.round(before)} → ${Math.round(save.needs[a.need])}` +
      (a.exp ? `, +${a.exp} EXP` : '') + (a.coinCost ? `, −${fmt(a.coinCost)} ${coinName()}` : ''));
    bump('action:' + a.id);
    gainExp(a.exp);
    commit();
    playAnim(a.anim); PP.Audio.sfx('pop');
    react(a.emotion);
  }

  function randomDrop() {
    const pool = data.items.filter(i => i.dropWeight > 0);
    let r = Math.random() * pool.reduce((s, i) => s + i.dropWeight, 0);
    for (const i of pool) { r -= i.dropWeight; if (r < 0) return i; }
    return pool[pool.length - 1] || null;
  }
  let exploring = false;
  function explore(l, force) {
    const s = data.settings, t = Date.now();
    if (exploring || walk) return;                                   // one trip at a time
    if (!s.exploreOpen) return toast('Exploring is closed right now');
    if (!PP.Progress.unlocked(data, save, l)) return toast(`Locked: ${PP.Progress.missingText(data, save, l) || 'closed'}`);
    const cd = save.cooldowns.__explore || 0;
    if (cd > t) return toast(`Wait ${Math.ceil((cd - t) / 1000)}s before exploring again`);
    const nd = needOf(s.exploreNeed);
    if (nd && save.needs[nd.id] < l.energyCost) return toast(`Not enough ${nd.label} (needs ${l.energyCost})`);
    if (force && !PP.Encounters.tableFor(data, l)) return toast('No wild Pokémon live here.');
    if ((force || (l.environment !== 'town' && l.encounterChance > 0)) && !canBattle()) return toast('Your team can’t battle. Heal them at a town first.');
    exploring = true;
    try {
      if (nd) save.needs[nd.id] = Math.max(0, save.needs[nd.id] - l.energyCost);      // charged once per trip
      const st = save.areas[l.id] || (save.areas[l.id] = { explores: 0, seen: {} });
      const first = !st.explores;
      st.explores++; save.stats.explores++; save.location = l.id;
      if (s.exploreCooldownSec) save.cooldowns.__explore = t + s.exploreCooldownSec * 1000;
      if (first) { S.log('explore', `Discovered ${l.name}`); toast(`Discovered ${l.name}!`); }
      if (l.environment === 'town') save.lastTown = l.id;
      // walk along the area's path: wild Pokémon jump out on the way, the end of the path finishes the trip
      if (s.walkOn && l.environment !== 'town' && petSpecies()) { commit(); startWalk(l, planWalk(l, force)); return; }
      const enc = PP.Encounters.roll(data, force ? Object.assign({}, l, { encounterChance: 100 }) : l);
      if (enc && meet(l, enc)) { commit(); startBattle(l, [{ species: enc.species, level: enc.level }]); return; }
      const parts = exploreLoot(l);
      lastExplore = { kind: 'loot', area: l.name, parts };
      bump('explore:any'); bump('explore:' + l.id);
      gainExp(l.exp);
      commit();
      react(s.emoExplore);
    } finally { exploring = false; }
  }
  /** a wild Pokémon appears: Pokédex, area records and quests */
  function meet(l, enc) {
    const sp = data.pokemon.find(p => p.id === enc.species); if (!sp) return false;
    const st = save.areas[l.id] || (save.areas[l.id] = { explores: 0, seen: {} }), newDex = !save.dex.seen[sp.id];
    save.dex.seen[sp.id] = save.dex.seen[sp.id] || Date.now();
    st.seen[sp.id] = (st.seen[sp.id] || 0) + 1;
    save.stats.encounters++;
    S.log('explore', `Exploring ${l.name}: a wild ${sp.name} (Lv ${enc.level}) appeared` + (newDex ? ' (new Pokédex entry)' : ''));
    bump('see:any');
    return true;
  }
  /** the area's rewards for finishing a trip → text parts for the log and screens */
  function exploreLoot(l) {
    const lo = Math.min(l.coinsMin, l.coinsMax), hi = Math.max(l.coinsMin, l.coinsMax);
    const coins = lo + Math.floor(Math.random() * (hi - lo + 1));
    const gems = Math.random() * 100 < l.gemChance ? l.gemAmount : 0;
    const drop = Math.random() * 100 < l.itemChance ? (l.dropItem === 'random' ? randomDrop() : itemOf(l.dropItem)) : null;
    addCoins(coins); save.gems += gems; if (drop) addItem(drop.id, 1);
    const parts = [`+${fmt(coins)} ${coinName()}`];
    if (gems) parts.push(`+${fmt(gems)} ${gemName()}`);
    if (drop) parts.push(drop.name);
    if (l.exp) parts.push(`+${l.exp} EXP`);
    S.log('explore', `Explored ${l.name}: ${parts.join(', ')}`);
    return parts;
  }

  // ---------------- walking explore ----------------
  let walk = null;
  /** the wide path picture for an area (its own, or the one for its environment) */
  function walkBg(l) {
    const s = data.settings, env = l.environment, img = id => (data.backgrounds.find(b => b.id === id) || {}).image;
    const id = l.walkBackground && l.walkBackground !== 'auto' ? l.walkBackground
      : env === 'hideout' || env === 'building' ? s.walkBgHideout : env === 'cave' ? s.walkBgCave : env === 'forest' ? s.walkBgForest
      : env === 'underwater' ? s.walkBgUnderwater : env === 'water' || env === 'island' ? s.walkBgWater : s.walkBgLand;
    return img(id) || img(s.walkBgLand) || img('path-forest');
  }
  /** where on the path wild Pokémon will jump out (each place rolls the area's chance) */
  function planWalk(l, force) {
    const s = data.settings, stops = [];
    if (!PP.Encounters.tableFor(data, l)) return stops;
    for (let k = 0; k < s.walkStops && stops.length < s.walkMaxBattles; k++) {
      const enc = PP.Encounters.roll(data, l);
      if (enc) stops.push({ at: (k + 1) / (s.walkStops + 1), enc });
    }
    if (force && !stops.length) {
      const enc = PP.Encounters.roll(data, Object.assign({}, l, { encounterChance: 100 }));
      if (enc) stops.push({ at: (1 + Math.floor(Math.random() * s.walkStops)) / (s.walkStops + 1), enc });
    }
    return stops;
  }
  function startWalk(l, stops) {
    const sp = petSpecies(), layer = $('walkLayer');
    closeSheet(true); setCare(false);
    layer.innerHTML = `<canvas class="walk-cv"></canvas>
      <div class="walk-top"><div class="walk-area">${I('pin')}<span>${esc(l.name)}</span></div>
        <div class="walk-prog"><i id="walkProg"></i></div><button class="walk-leave" data-do="walk-leave">Leave</button></div>
      <div class="walk-bang" id="walkBang" hidden>!</div><div class="walk-flash" id="walkFlash"></div><div class="walk-done" id="walkDone" hidden></div>`;
    layer.hidden = false;
    const im = new Image(); im.src = encodeURI(walkBg(l) || '');
    PP.Sprite.preload(sp.folder, ['Walk', 'Idle']);
    walk = { l, stops, next: 0, p: 0, paused: false, done: false, im, sp, last: performance.now(), battles: 0 };
    nextWalkFrame();
  }
  /** next frame of the walk (a timer backs up the frame loop, which some phones and browsers slow down) */
  function nextWalkFrame() {
    let fired = false;
    const go = () => { if (fired) return; fired = true; walkFrame(performance.now()); };
    requestAnimationFrame(go); setTimeout(go, 50);
  }
  function walkFrame(now) {
    const w = walk; if (!w) return;
    const cv = $('walkLayer').querySelector('.walk-cv'); if (!cv) return;
    const dt = Math.min(.05, (now - w.last) / 1000); w.last = now;
    if (!w.paused && !w.done && $('battleLayer').hidden) {
      w.p = Math.min(1, w.p + dt / data.settings.walkSeconds);
      const stop = w.stops[w.next];
      if (stop && w.p >= stop.at) { w.p = stop.at; w.next++; walkEncounter(stop); }
      else if (w.p >= 1) finishWalk();
    }
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = Math.round(r.width * dpr), ch = Math.round(r.height * dpr);
    if (cv.width !== cw || cv.height !== ch) { cv.width = cw; cv.height = ch; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.imageSmoothingEnabled = false;
    const H = r.height, im = w.im;
    if (im.complete && im.naturalWidth) {
      const sc = Math.max(H / im.naturalHeight, r.width * 1.6 / im.naturalWidth), W = im.naturalWidth * sc, IH = im.naturalHeight * sc;
      const x0 = r.width * .14, x1 = W - r.width * .14, wx = x0 + (x1 - x0) * w.p;
      const cam = Math.max(0, Math.min(W - r.width, wx - r.width * .42)), top = H - IH;
      g.fillStyle = '#0b0f1a'; g.fillRect(0, 0, r.width, H);
      g.drawImage(im, -cam, top, W, IH);
      const walking = !w.paused && !w.done && $('battleLayer').hidden;
      const size = (w.sp.size || 100) / 100, scale = Math.max(2, IH / 240) * size;
      const gy = top + IH * data.settings.walkGround / 100;          // feet on the grass strip (Game settings → Exploring)
      PP.Sprite.draw(g, w.sp.folder, { x: wx - cam, y: gy, scale, t: now / 1000, anim: walking ? 'Walk' : 'Idle', dir: 'right' });
      const b = $('walkBang'); if (b && !b.hidden) { b.style.left = (wx - cam) + 'px'; b.style.top = (gy - 30 * scale) + 'px'; }
    } else { g.fillStyle = '#0b0f1a'; g.fillRect(0, 0, r.width, H); }
    const pr = $('walkProg'); if (pr) pr.style.width = (w.p * 100) + '%';
    nextWalkFrame();
  }
  function walkEncounter(stop) {
    const w = walk; w.paused = true;
    if (!canBattle() || !meet(w.l, stop.enc)) { w.paused = false; return; }
    commit();
    const b = $('walkBang'); b.hidden = false; b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
    PP.Audio.sfx('alert');
    setTimeout(() => {
      const f = $('walkFlash'); f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
      setTimeout(() => { b.hidden = true; w.battles++; startBattle(w.l, [{ species: stop.enc.species, level: stop.enc.level }], { walk: true }); }, 650);
    }, 900);
  }
  /** after a battle on the path: keep walking from where it stopped */
  function resumeWalk() {
    if (!walk) return;
    $('walkLayer').hidden = false;
    const f = $('walkFlash'); if (f) f.classList.remove('go');        // the flash into the battle ends on white: clear it
    const b = $('walkBang'); if (b) b.hidden = true;
    walk.paused = false; walk.last = performance.now();
  }
  function finishWalk() {
    const w = walk; if (!w || w.done) return;
    w.done = true;
    const parts = exploreLoot(w.l);
    lastExplore = { kind: 'loot', area: w.l.name, parts };
    bump('explore:any'); bump('explore:' + w.l.id);
    gainExp(w.l.exp);
    commit();
    PP.Audio.sfx('coin');
    const d = $('walkDone');
    d.innerHTML = `<div class="walk-card"><div class="walk-card-ic">${I('flag')}</div><h3>Explore complete!</h3>
      <p>You reached the end of ${esc(w.l.name)}${w.battles ? ` after ${w.battles} wild battle${w.battles === 1 ? '' : 's'}` : ''}.</p>
      <div class="walk-loot">${parts.map(x => `<span>${esc(x)}</span>`).join('')}</div>
      <button class="btn btn-primary" data-do="walk-close">Continue</button></div>`;
    d.hidden = false;
  }
  function endWalk(open) {
    walk = null;
    const layer = $('walkLayer'); layer.hidden = true; layer.innerHTML = '';
    react(data.settings.emoExplore);
    if (open) { exploreTab = 'wild'; openSheet('explore'); }
  }
  const wallet = cur => (cur === 'gems' ? 'gems' : 'coins');
  const curName = cur => (cur === 'gems' ? gemName() : coinName());
  function buy(it) {
    if (!data.settings.shopOpen) return toast('The shop is closed right now');
    const w = wallet(it.currency);
    if (save[w] < it.buy) return toast(`Not enough ${curName(w)}`);
    save[w] -= it.buy; addItem(it.id, 1);
    S.log('shop', `Bought ${it.name} for ${fmt(it.buy)} ${curName(w)}`);
    bump('buy:any');
    commit(); toast(`Bought ${it.name}`); PP.Audio.sfx('coin');
  }
  function sell(it) {
    if (!(save.inventory[it.id] > 0)) return;
    addItem(it.id, -1); addCoins(it.sell);
    S.log('shop', `Sold ${it.name} for ${fmt(it.sell)} ${coinName()}`);
    commit(); toast(`Sold ${it.name} · +${fmt(it.sell)}`);
  }
  function useItem(it) {
    if (!(save.inventory[it.id] > 0) || it.effectNeed === 'none') return;
    const n = needOf(it.effectNeed), before = save.needs[it.effectNeed];
    save.needs[it.effectNeed] = clamp(before + it.effectAmount, 0, 100);
    addItem(it.id, -1);
    S.log('item', `Used ${it.name}: ${n.label} ${Math.round(before)} → ${Math.round(save.needs[it.effectNeed])}` + (it.exp ? `, +${it.exp} EXP` : ''));
    bump('use:any');
    gainExp(it.exp);
    commit(); toast(`Used ${it.name}`);
    playAnim(it.effectNeed === 'food' ? 'Eat' : 'Nod');
    react(data.settings.emoItem);
  }
  function claim(q) {
    const st = questState(q);
    if (!questOn(q) || !st.done || st.claimed) return;
    save.quests[q.id] = { progress: st.progress, claimed: true };
    addCoins(q.rewardCoins); save.gems += q.rewardGems;
    const it = q.rewardItem !== 'none' && q.rewardQty > 0 && itemOf(q.rewardItem);
    if (it) addItem(it.id, q.rewardQty);
    S.log('quest', `${kindLabel(q.kind)} quest “${q.title}” claimed` + rewardText(q.rewardCoins, q.rewardGems) + (q.rewardExp ? `, +${q.rewardExp} EXP` : '') + (it ? `, ${q.rewardQty}× ${it.name}` : ''));
    gainExp(q.rewardExp);
    commit(); toast(`Reward claimed: ${q.title}`); PP.Audio.sfx('coin');
  }
  /** change the in-game name; returns the reason it was refused, or null */
  async function rename(name) {
    name = String(name || '').trim().replace(/\s+/g, ' ');
    if (name === save.name) return null;
    const why = S.checkName(name, data, save.name) || await PP.Cloud.claimName(name, save.name);   // online: unique across all players
    if (why) return why;
    S.claimName(name, save.name);
    S.log('system', `Player renamed: ${save.name} → ${name}`);
    save.name = name; commit(); toast('Name saved');
    return null;
  }
  function commit() { questNotices(); persist(); update(); renderSheet(); }

  // ---------------- rendering: structure ----------------
  function renderShell() {
    const s = data.settings;
    $('settingsBtn').innerHTML = I('sliders');
    $('sheetClose').innerHTML = I('close');
    document.querySelector('#coinPill .pill-ic').innerHTML = I('coin');
    document.querySelector('#gemPill .pill-ic').innerHTML = I('gem');
    document.querySelectorAll('.pill-plus').forEach(p => { p.innerHTML = I('plus'); });
    $('palRing').innerHTML = I('paw');
    $('needs').innerHTML = data.needs.map(n => `
      <div class="need" data-need="${esc(n.id)}" style="--c:${n.color}" title="${esc(n.label)}">
        <div class="need-top"><span class="need-ic">${I(n.icon)}</span><span class="need-val tnum">0</span></div>
        <div class="bar"><i></i></div>
      </div>`).join('');
    const acts = data.actions.filter(a => a.enabled);
    $('actions').innerHTML = !acts.length ? '' : `
      <button class="act act-toggle" data-do="care" aria-expanded="false" aria-controls="actMenu" style="--c:var(--accent)">
        <span class="act-toggle-ic">${I('heart')}</span><span class="act-label">${esc(s.careLabel)}</span><span class="act-dot"></span>
      </button>
      <div class="act-menu" id="actMenu">${acts.map((a, i) => `
        <button class="act" data-do="act" data-id="${esc(a.id)}" style="--c:${(needOf(a.need) || {}).color || 'var(--accent)'};--i:${i}">
          ${I(a.icon)}<span class="act-label">${esc(a.label)}</span>
        </button>`).join('')}</div>`;
    setCare(careOpen);
    $('tabbar').innerHTML = TABS.map(t => {
      const closed = (t.id === 'explore' && !s.exploreOpen) || (t.id === 'shop' && !s.shopOpen);
      return `<button class="tab${t.center ? ' center' : ''}${closed ? ' closed' : ''}" data-do="sheet" data-kind="${t.id}">
        ${t.center ? `<span class="tab-fab">${I(t.icon)}</span>` : I(t.icon)}<span>${esc(s[t.label])}</span></button>`;
    }).join('');
    $('banner').hidden = !s.announcement.trim();
    $('banner').innerHTML = I('megaphone') + `<span>${esc(s.announcement)}</span>`;
    $('locCard').hidden = !s.showLocation;
    const app = $('app');
    app.style.setProperty('--glass', s.glassOpacity + '%');
    app.style.setProperty('--glass-strong', Math.min(100, s.glassOpacity + 18) + '%');
    app.style.setProperty('--glass-blur', s.glassBlur + 'px');
    Object.keys(sig).forEach(k => delete sig[k]);
  }

  // ---------------- background scene ----------------
  /** the current area's background if it has one, otherwise the home background */
  function currentScene() {
    const l = locOf(save.location);
    const id = l && l.background !== 'home' ? l.background : data.settings.homeBackground;
    const b = data.backgrounds.find(x => x.id === id);
    return b && b.image ? b : null;
  }
  function applyScene() {
    const b = currentScene();
    const key = b ? [b.image, b.position, b.dim].join('|') : 'none';
    if (sig.scene === key) return;
    sig.scene = key;
    const app = $('app'), el = $('scene');
    const clear = () => { app.classList.remove('has-bg'); el.style.backgroundImage = ''; };
    if (!b) return clear();
    // only switch once a picture has loaded; if its file is missing, try the other backgrounds in order
    const list = [b].concat(data.backgrounds.filter(x => x !== b && x.image));
    const tryAt = i => {
      const c = list[i];
      if (!c) return clear();
      const img = new Image();
      img.onload = () => {
        if (sig.scene !== key) return;
        el.style.backgroundImage = `url("${encodeURI(c.image).replace(/"/g, '%22')}")`;
        el.style.backgroundPosition = 'center ' + c.position;
        el.style.setProperty('--dim', c.dim / 100);
        app.classList.add('has-bg');
      };
      img.onerror = () => { if (sig.scene === key) tryAt(i + 1); };
      img.src = c.image;
    };
    tryAt(0);
  }

  // ---------------- your Pokémon ----------------
  const speciesOf = id => data.pokemon.find(p => p.id === id && PP.Sprite.has(p.folder)) || null;
  const partnerEntry = () => save.box.find(e => e.uid === save.partner) || null;
  const petSpecies = () => { const e = partnerEntry(); return e ? speciesOf(e.species) : null; };
  const labelOf = e => (e ? e.nickname || (speciesOf(e.species) || {}).name || '' : '');
  const petLabel = () => labelOf(partnerEntry());
  /** the Pokémon shown as the profile icon: the chosen one, or the partner */
  const avatarSpecies = () => speciesOf(save.avatar) || petSpecies();
  const newUid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // P: what the Pokémon on the home screen is doing (screen-only state, not saved)
  const P = { x: 0.5, tx: 0.5, dir: 'downright', walking: false, act: null, nextMove: 0, last: 0 };
  /** play an animation once ('Sleep' loops for a few seconds) */
  function playAnim(name) {
    const sp = petSpecies();
    if (!sp || !name || name === 'none') return;
    const loop = name === 'Sleep';
    P.act = { name, t0: performance.now() / 1000, loop, dur: loop ? 6 : PP.Sprite.length(sp.folder, name) };
    P.walking = false; P.tx = P.x;
  }
  function choose(sp) {
    const level = Math.min(100, data.settings.starterLevel), now = Date.now();
    const e = { uid: newUid(), species: sp.id, nickname: '', since: now, level, exp: S.expForLevel(sp.growth, level), caughtAt: 'Starter' };
    save.box.push(e); save.partner = e.uid;
    save.dex.seen[sp.id] = save.dex.seen[sp.id] || now; save.dex.caught[sp.id] = save.dex.caught[sp.id] || now;
    P.x = P.tx = 0.5; P.dir = 'downright'; P.nextMove = 0;
    S.log('pokemon', `${save.name} chose ${sp.name} as their first partner (Lv ${level})`);
    closeSheet(true); commit();
    setTimeout(() => playAnim('Hop'), 350);
    save.team = [e.uid];
    giveKit(); commit();
    setTimeout(onboard, 700);                        // the Professor carries on with the tutorial
  }
  function renamePet(name) {
    const e = partnerEntry(), sp = petSpecies(); if (!e || !sp) return;
    name = String(name || '').trim().slice(0, 16);
    if (name === e.nickname) return;
    S.log('pokemon', name ? `Nicknamed ${sp.name} “${name}”` : `Removed ${sp.name}'s nickname`);
    e.nickname = name; commit(); toast('Nickname saved');
  }
  function setPartner(uid) {
    const e = save.box.find(x => x.uid === uid); if (!e || uid === save.partner) return;
    save.partner = uid; save.team = [uid].concat(save.team.filter(u => u !== uid)).slice(0, data.settings.teamMax);   // the partner is the main Pokémon P.x = P.tx = 0.5; P.act = null;
    PP.Sprite.preload(speciesOf(e.species).folder);
    S.log('pokemon', `${labelOf(e)} is now the partner on the home screen`);
    commit(); toast(`${labelOf(e)} is your partner now`); { const ps = speciesOf(e.species); if (ps) PP.Audio.cry(ps.folder, false, ps.id); }
    setTimeout(() => playAnim('Hop'), 200);
  }
  /** add to / take out of the battle team (at least one Pokémon always stays in) */
  function toggleTeam(uid) {
    const e = save.box.find(x => x.uid === uid); if (!e) return;
    if (save.team.includes(uid)) {
      if (save.team.length === 1) return toast('Your team needs at least one Pokémon');
      save.team = save.team.filter(u => u !== uid);
      S.log('pokemon', `${labelOf(e)} left the team`);
    } else {
      if (save.team.length >= data.settings.teamMax) return toast('Your team is full');
      save.team.push(uid);
      S.log('pokemon', `${labelOf(e)} joined the team`);
    }
    commit();
  }
  function setAvatar(species) {
    const sp = speciesOf(species); if (!sp || !save.box.some(e => e.species === species)) return;
    save.avatar = species;
    S.log('system', `Profile icon changed to ${sp.name}`);
    commit(); toast('Profile icon updated');
  }

  const petCanvas = $('petCanvas'), petCtx = petCanvas.getContext('2d');
  let starterPick = null;
  // size a canvas's pixels to its box. The box must come from CSS/inline style, never from the
  // canvas's own pixel size, or the canvas would grow every frame.
  function fitCanvas(cv) {
    const dpr = window.devicePixelRatio || 1;
    if (!cv.style.width) { cv.style.width = '100%'; cv.style.height = cv.dataset.h || '100%'; }
    const r = (cv.dataset.h ? cv : cv.parentElement).getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { dpr, W: r.width, H: r.height };
  }
  function petPos() {
    const { W, H } = petCanvas.getBoundingClientRect();
    return { x: P.x * W, y: data.settings.petGround / 100 * H };
  }
  function petFrame(ms) {
    requestAnimationFrame(petFrame);              // schedule first, so one bad frame never stops it
    if (document.hidden) return;
    const t = ms / 1000, dt = Math.min(0.05, t - (P.last || t)); P.last = t;
    if (sheetKind === 'starter') drawStarters(t);
    const sp = petSpecies();
    $('palSlot').hidden = !!sp;
    const { dpr, W, H } = fitCanvas(petCanvas);
    petCtx.setTransform(1, 0, 0, 1, 0, 0);
    petCtx.clearRect(0, 0, petCanvas.width, petCanvas.height);
    if (!sp || !W) return;
    const s = data.settings;
    // wander: pick a new spot every few seconds and walk there
    const talking = storyOn();
    if (talking && story.target === 'pet') placeSpot();
    // walk to a spot, then stand still for a while (longer near the sides), sometimes just stay put
    if (!P.act && s.petWander && !talking) {
      const d = P.tx - P.x, step = s.petWalkSpeed / 300 * dt;
      if (Math.abs(d) > 0.004) { P.x += Math.sign(d) * Math.min(Math.abs(d), step); P.dir = d < 0 ? 'left' : 'right'; P.walking = true; }
      else {
        if (P.walking) {                                // just arrived: rest here
          P.walking = false; P.dir = P.dir === 'left' ? 'downleft' : 'downright';
          const lo = s.petRestMin, hi = Math.max(lo, s.petRestMax), edge = P.x < 0.32 || P.x > 0.68;
          P.nextMove = t + (lo + Math.random() * (hi - lo)) * (edge ? 1.5 : 1);
        } else if (t > P.nextMove) {
          if (Math.random() < 0.3) P.nextMove = t + s.petRestMin;          // stays put a little longer
          else P.tx = 0.22 + Math.random() * 0.56;
        }
      }
    } else if (!P.walking && P.nextMove < t) P.nextMove = t + 2;
    petCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (s.buddiesOn) drawBuddies(t, dt, W, H, talking);
    const scale = s.petScale * sp.size / 100, x = P.x * W, y = s.petGround / 100 * H;
    const box = PP.Sprite.idleBox(sp.folder);
    // soft shadow under its feet
    petCtx.fillStyle = 'rgba(0,0,0,.18)';
    petCtx.beginPath(); petCtx.ellipse(x, y - 1, box.w * scale * 0.32, box.w * scale * 0.09, 0, 0, Math.PI * 2); petCtx.fill();
    const facing = P.dir === 'left' || P.dir === 'downleft' ? 'downleft' : 'downright';
    let name = P.walking ? 'Walk' : 'Idle', at = t, dir = P.walking ? P.dir : facing, once = false;
    if (P.act) { name = P.act.name; at = t - P.act.t0; dir = facing; once = !P.act.loop; }
    const done = PP.Sprite.draw(petCtx, sp.folder, { x, y, scale, t: at, anim: name, dir, once });
    if (P.act && (P.act.loop ? at > P.act.dur : done)) P.act = null;
    placeReact(t, x, y, box.h * scale, W);
  }
  // ---------------- the rest of the team, playing further back ----------------
  const BUD = {};                       // uid → { x, y, tx, ty, dir, mode: idle|walk|sleep|chat, until, with, bubble, hop }
  const BUBBLES = ['…', '♪', '♥', '!', '?', '☆'];
  const budList = () => teamEntries().slice(1, data.settings.teamMax).map(e => ({ e, sp: speciesOf(e.species) })).filter(b => b.sp && PP.Sprite.has(b.sp.folder));
  function budBox(b, W, H) {
    const s = data.settings, st = BUD[b.e.uid];
    const y = (s.buddyTop + (Math.max(s.buddyTop, s.buddyBottom) - s.buddyTop) * st.y) / 100 * H;
    return { x: st.x * W, y, scale: s.petScale * b.sp.size / 100 * s.buddyScale / 100 * (0.92 + st.y * 0.16) };
  }
  function drawBuddies(t, dt, W, H, still) {
    const s = data.settings, list = budList(), ids = new Set(list.map(b => b.e.uid));
    Object.keys(BUD).forEach(u => { if (!ids.has(u)) delete BUD[u]; });
    list.forEach((b, i) => {
      if (!BUD[b.e.uid]) { BUD[b.e.uid] = { x: 0.14 + (i / Math.max(1, list.length - 1 || 1)) * 0.72 + (Math.random() - .5) * .06, y: Math.random(), tx: 0, ty: 0, dir: Math.random() < .5 ? 'downleft' : 'downright', mode: 'idle', until: t + 1 + Math.random() * 4, with: null, bubble: '', hop: 0 };
        PP.Sprite.preload(b.sp.folder, ['Idle', 'Walk', 'Sleep', 'Hop']); }
    });
    const speed = s.petWalkSpeed / 300 * 0.7 * dt;
    list.forEach(b => {
      const st = BUD[b.e.uid];
      if (still) return;
      if (st.mode === 'walk' || (st.mode === 'chat' && !st.met)) {
        const dx = st.tx - st.x, dy = st.ty - st.y, d = Math.hypot(dx, dy * .5);
        if (d > 0.006) { const k = Math.min(1, speed / d); st.x += dx * k; st.y += dy * k; st.dir = dx < 0 ? 'left' : 'right'; st.walking = true; }
        else { st.walking = false; if (st.mode === 'chat') { st.met = true; st.until = t + 4 + Math.random() * 3; } else { st.mode = 'idle'; st.until = t + 2 + Math.random() * 5; } st.dir = st.dir === 'left' ? 'downleft' : 'downright'; }
      }
      if (st.mode === 'chat' && st.met) {                     // face the friend; little speech bubbles back and forth
        const o = BUD[st.with]; if (o) st.dir = o.x < st.x ? 'downleft' : 'downright';
        st.bubble = Math.floor(t * 0.8 + (st.side || 0)) % 2 === 0 ? (st.word || '…') : '';
      } else st.bubble = '';
      if (t > st.until && !st.walking) {
        if (st.mode === 'chat' && st.with && BUD[st.with]) { const o = BUD[st.with]; o.mode = 'idle'; o.with = null; o.until = t + 2 + Math.random() * 3; }
        st.with = null; st.met = false;
        const r = Math.random(), free = list.filter(o => o.e.uid !== b.e.uid && ['idle', 'walk'].includes(BUD[o.e.uid].mode) && !BUD[o.e.uid].walking);
        if (r < 0.18) { st.mode = 'sleep'; st.until = t + 8 + Math.random() * 10; }
        else if (r < 0.42 && free.length) {                   // walk over to a friend and chat
          const o = BUD[free[Math.floor(Math.random() * free.length)].e.uid];
          const sideOf = o.x > 0.5 ? -1 : 1;
          st.mode = 'chat'; st.with = free.find(f => BUD[f.e.uid] === o).e.uid; st.tx = Math.max(0.08, Math.min(0.92, o.x + sideOf * 0.12)); st.ty = o.y; st.met = false;
          st.word = BUBBLES[Math.floor(Math.random() * BUBBLES.length)]; st.side = 0;
          o.mode = 'chat'; o.with = b.e.uid; o.met = true; o.walking = false; o.tx = o.x; o.ty = o.y; o.until = t + 12; o.word = BUBBLES[Math.floor(Math.random() * BUBBLES.length)]; o.side = 1;
        } else if (r < 0.8) { st.mode = 'walk'; st.tx = 0.08 + Math.random() * 0.84; st.ty = Math.random(); }
        else { st.mode = 'idle'; st.until = t + 3 + Math.random() * 5; }
      }
    });
    // back to front, so nearer ones overlap further ones
    list.slice().sort((a, b) => BUD[a.e.uid].y - BUD[b.e.uid].y).forEach(b => {
      const st = BUD[b.e.uid], p = budBox(b, W, H), box = PP.Sprite.idleBox(b.sp.folder);
      petCtx.fillStyle = 'rgba(0,0,0,.14)';
      petCtx.beginPath(); petCtx.ellipse(p.x, p.y - 1, box.w * p.scale * 0.3, box.w * p.scale * 0.08, 0, 0, Math.PI * 2); petCtx.fill();
      const hopping = st.hop && t - st.hop < 1;
      const anim = hopping ? 'Hop' : st.walking ? 'Walk' : st.mode === 'sleep' ? 'Sleep' : 'Idle';
      PP.Sprite.draw(petCtx, b.sp.folder, { x: p.x, y: p.y, scale: p.scale, t: hopping ? t - st.hop : t + b.e.level, anim, dir: st.walking ? st.dir : (st.dir === 'left' || st.dir === 'downleft' ? 'downleft' : 'downright'), once: hopping });
      const head = p.y - box.h * p.scale - 4;
      if (st.mode === 'sleep') {                              // floating z's
        petCtx.fillStyle = 'rgba(255,255,255,.92)'; petCtx.strokeStyle = 'rgba(30,40,70,.55)'; petCtx.lineWidth = 3;
        [0, 1, 2].forEach(k => { const ph = (t * 0.6 + k / 3) % 1, fs = 10 + k * 3;
          petCtx.globalAlpha = Math.sin(ph * Math.PI); petCtx.font = `800 ${fs}px system-ui, sans-serif`;
          const zx = p.x + 8 + ph * 14, zy = head - ph * 22; petCtx.strokeText('z', zx, zy); petCtx.fillText('z', zx, zy); });
        petCtx.globalAlpha = 1;
      }
      if (st.bubble) {                                        // a little speech bubble
        const bx = p.x + (st.dir === 'downleft' ? -10 : 10), by = head - 6, w = 24, h = 20;
        petCtx.fillStyle = '#fff'; petCtx.strokeStyle = 'rgba(20,30,50,.25)'; petCtx.lineWidth = 1;
        petCtx.beginPath(); if (petCtx.roundRect) petCtx.roundRect(bx - w / 2, by - h, w, h, 8); else petCtx.rect(bx - w / 2, by - h, w, h); petCtx.fill(); petCtx.stroke();
        petCtx.beginPath(); petCtx.moveTo(bx - 3, by); petCtx.lineTo(bx + 3, by); petCtx.lineTo(bx, by + 5); petCtx.fill();
        petCtx.fillStyle = st.word === '♥' ? '#e5484d' : '#2b3550'; petCtx.font = '800 13px system-ui, sans-serif'; petCtx.textAlign = 'center';
        petCtx.fillText(st.bubble, bx, by - 5); petCtx.textAlign = 'start';
      }
    });
  }
  function drawStarters(t) {
    document.querySelectorAll('.starter-cv').forEach(cv => {
      const sp = data.pokemon.find(p => p.id === cv.dataset.id); if (!sp) return;
      const { dpr, W, H } = fitCanvas(cv), g = cv.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const picked = starterPick === sp.id;
      PP.Sprite.draw(g, sp.folder, { x: W / 2, y: H * 0.86, scale: 2.5 * sp.size / 100, t: t + sp.dex, anim: picked ? 'Hop' : 'Idle', dir: 'down' });
    });
  }
  // tap the Pokémon: it hops
  petCanvas.addEventListener('click', e => {
    const sp = petSpecies(); if (!sp || P.act) return;
    const r = petCanvas.getBoundingClientRect(), { x, y } = petPos();
    const box = PP.Sprite.idleBox(sp.folder), sc = data.settings.petScale * sp.size / 100;
    const px = e.clientX - r.left, py = e.clientY - r.top;
    if (Math.abs(px - x) < box.w * sc * 0.6 && py < y + 10 && py > y - box.h * sc - 10) { playAnim('Hop'); react(data.settings.emoTap); return; }
    if (!data.settings.buddiesOn) return;
    const W = r.width, H = r.height, t = performance.now() / 1000;
    for (const b of budList()) {
      const st = BUD[b.e.uid]; if (!st) continue;
      const p = budBox(b, W, H), bb = PP.Sprite.idleBox(b.sp.folder);
      if (Math.abs(px - p.x) < bb.w * p.scale * 0.6 && py < p.y + 8 && py > p.y - bb.h * p.scale - 8) {
        st.hop = t; if (st.mode === 'sleep') { st.mode = 'idle'; st.until = t + 3; }
        PP.Audio.cry(b.sp.folder, false, b.sp.id); return;
      }
    }
  });

  // ---------------- reaction bubbles ----------------
  // The Pokémon's emotion portrait pops up above it, at most once every `reactGapSec` seconds.
  const R = { last: -1e9, until: 0, lastIdle: performance.now() / 1000 };
  function react(emotion) {
    const s = data.settings, sp = petSpecies(), now = performance.now() / 1000;
    if (!s.reactOn || !sp || !emotion || emotion === 'none' || storyOn() || sheetKind === 'starter') return;
    if (now - R.last < s.reactGapSec) return;                    // not too often
    const src = PP.Sprite.portrait(sp.folder, emotion); if (!src) return;
    R.last = R.lastIdle = now; R.until = now + s.reactShowSec;
    const el = $('react');
    $('reactImg').src = src;
    el.hidden = false; el.classList.remove('out');
    void el.offsetWidth; el.classList.add('pop');                // restart the pop-in animation
  }
  /** now and then it shows how it feels by itself (sad when a need is low) */
  function idleReact() {
    const s = data.settings, now = performance.now() / 1000;
    if (!s.reactIdleSec || now - R.lastIdle < s.reactIdleSec) return;
    R.lastIdle = now;
    react(data.needs.some(n => save.needs[n.id] < s.lowNeed) ? s.emoLow : s.emoContent);
  }
  function placeReact(t, x, y, h, W) {
    const el = $('react'); if (el.hidden) return;
    if (t > R.until) { el.hidden = true; el.classList.remove('pop', 'out'); return; }
    if (t > R.until - 0.3) el.classList.add('out');
    el.style.left = Math.max(44, Math.min(W - 44, x)) + 'px';
    el.style.top = Math.max(4, y - h - 10) + 'px';
  }

  // ---------------- battles ----------------
  const maxHp = e => { const sp = speciesOf(e.species); return sp ? Math.floor(2 * sp.hp * e.level / 100) + e.level + 10 : 1; };
  const hpOf = e => (e.hp == null ? maxHp(e) : e.hp);
  const teamEntries = () => save.team.map(u => save.box.find(e => e.uid === u)).filter(e => e && speciesOf(e.species));
  const canBattle = () => teamEntries().some(e => hpOf(e) > 0);
  /** battle backgrounds for an area, best first (an area's own pick, then by environment, then fallbacks) */
  function battleBgs(area, gym) {
    const s = data.settings, env = area ? area.environment : 'grassland';
    const ids = [gym ? s.battleBgGym : null, area && area.battleBackground !== 'auto' ? area.battleBackground : null,
      env === 'hideout' ? s.battleBgHideout : env === 'cave' ? s.battleBgCave : env === 'forest' ? s.battleBgForest : env === 'water' || env === 'island' ? s.battleBgWater : s.battleBgLand,
      s.battleBgLand, s.homeBackground, 'sakura-meadow'];
    return ids.map(id => data.backgrounds.find(b => b.id === id)).filter(b => b && b.image).map(b => b.image);
  }
  function healTeam(why) {
    save.box.forEach(e => { e.hp = null; });
    S.log('battle', `Team healed${why ? ' ' + why : ''}`);
  }
  /** hand out the starter Poké Balls and Potions once */
  function giveKit() {
    if (save.kitGiven || !petSpecies()) return;
    const s = data.settings;
    if (s.startBalls && itemOf('poke-ball')) addItem('poke-ball', s.startBalls);
    if (s.startPotions && itemOf('potion')) addItem('potion', s.startPotions);
    save.kitGiven = true;
    S.log('system', `Got ${s.startBalls} Poké Balls and ${s.startPotions} Potions for the journey`);
  }
  /** slow HP recovery over time (Game settings → Battles) */
  function regenHp(mins) {
    const pct = data.settings.hpRegenPerHour; if (!pct || !mins) return;
    save.box.forEach(e => {
      if (e.hp == null) return;
      const m = maxHp(e); e.hp = Math.min(m, e.hp + m * pct / 100 * mins / 60);
      if (e.hp >= m) e.hp = null;
    });
  }
  // ctx: { area, step (story step or null), trainer (or null) }
  let battleCtx = null;
  /** start a battle. Wild: foes = [{species, level}]. Trainer: ctx.trainer is set. */
  function startBattle(area, foes, ctx = {}) {
    const trainer = ctx.trainer || null;
    save.pendingBattle = { kind: trainer ? 'trainer' : 'wild', area: area ? area.id : '', foes, at: Date.now(),
      step: ctx.step ? ctx.step.id : '', trainer: trainer ? trainer.id : '' };            // a refresh resumes this battle
    persist();
    closeSheet(true); setCare(false);
    battleCtx = { area, step: ctx.step || null, trainer, walk: !!ctx.walk };
    const layer = $('battleLayer');
    layer.hidden = false;
    const protect = !!(trainer && trainer.mustWin);
    if (protect) teamEntries().forEach(e => { e.hp = null; });                       // a battle the player can't lose starts fully healed
    teamEntries().forEach(e => { if (e.hp != null) e.hp = Math.floor(e.hp); });    // HP is whole numbers in battle
    const bgs = trainer ? trainerBgs(trainer, area) : battleBgs(area);
    PP.Audio.play(battleMusic(trainer));
    PP.Battle.start({
      root: layer, data, kind: trainer ? 'trainer' : 'wild', foes, team: teamEntries(), bag: save.inventory, protect, noSuperEffective: !!(trainer && trainer.noSuperEffective),
      trainer: trainer ? { name: PP.Story.trainerName(trainer), prize: trainer.prize } : null,
      backgrounds: bgs, loseText: `You hurry back to ${(locOf(save.lastTown) || { name: 'town' }).name}. Your Pokémon are healed.`,
      onEnd: endBattle,
    });
  }
  /** which music a battle uses (Game settings → Sound & music) */
  function battleMusic(t) {
    const s = data.settings;
    return !t ? s.musicWild : ['gym', 'elite', 'champion'].includes(t.kind) ? s.musicGym : s.musicTrainer;
  }
  function trainerBgs(t, area) {
    const s = data.settings, pick = id => (data.backgrounds.find(b => b.id === id) || {}).image;
    const first = t.background !== 'auto' ? pick(t.background) : t.kind === 'gym' || t.kind === 'elite' || t.kind === 'champion' ? pick(s.battleBgGym) : t.kind === 'villain' ? pick(s.battleBgHideout) : null;
    return [first].concat(battleBgs(area)).filter(Boolean);
  }
  function endBattle(r) {
    const ctx = battleCtx || {}, area = ctx.area || locOf(save.location) || {}, t = ctx.trainer, step = ctx.step;
    const foe = speciesOf(r.foe.species) || { name: r.foe.species };
    $('battleLayer').hidden = true; $('battleLayer').innerHTML = '';
    PP.Audio.play(data.settings.musicHome);
    save.pendingBattle = null; battleCtx = null;
    Object.entries(r.used).forEach(([id, n]) => S.log('item', `Used ${n}× ${(itemOf(id) || { name: id }).name} in battle`));
    r.log.forEach(x => S.log('pokemon', x));
    const who = t ? PP.Story.trainerName(t) : `a wild ${foe.name}`;
    let after = [];                                    // what the Professor / trainer says afterwards
    if (r.outcome === 'caught' && r.caught) {
      const sp = speciesOf(r.caught.species), now = Date.now();
      const e = { uid: newUid(), species: sp.id, nickname: '', since: now, level: r.caught.level, exp: r.caught.exp, hp: r.caught.hp, caughtAt: area.name || '' };
      save.box.push(e);
      const toTeam = save.team.length < data.settings.teamMax;
      if (toTeam) save.team.push(e.uid);
      save.dex.seen[sp.id] = save.dex.seen[sp.id] || now; save.dex.caught[sp.id] = save.dex.caught[sp.id] || now;
      S.log('battle', `Caught a wild ${sp.name} (Lv ${e.level}) at ${area.name}` + (toTeam ? ', added to the team' : ', sent to the PC box'));
      bump('catch:any');
      toast(`${sp.name} ${toTeam ? 'joined your team' : 'was sent to your PC box'}!`);
    } else if (r.outcome === 'won' && t) {
      addCoins(r.prize); save.beaten[t.id] = save.beaten[t.id] || Date.now();
      S.log('battle', `Beat ${who}` + (r.prize ? ` and got ${fmt(r.prize)} ${coinName()}` : ''));
      bump('battle:win'); bump('battle:trainer');
      after = linesOf2(t.defeat);
      if (t.badge && t.badge !== 'none' && !save.badges[t.badge]) {
        const b = data.badges.find(x => x.id === t.badge);
        save.badges[t.badge] = Date.now();
        S.log('story', `Received the ${b ? b.name : t.badge}`);
        after.push(`You received the ${b ? b.name : 'badge'}!`);
      }
    } else if (r.outcome === 'beat') {
      S.log('battle', `Beat a wild ${foe.name} (Lv ${r.foe.level}) at ${area.name}`); bump('battle:win'); bump('battle:wild');
    } else if (r.outcome === 'ran') {
      S.log('battle', `Ran from a wild ${foe.name} at ${area.name}`);
    } else if (r.outcome === 'lost') {
      const town = locOf(save.lastTown) || data.locations.find(l => l.enabled && l.environment === 'town');
      if (town) save.location = town.id;
      healTeam(`after losing to ${who}`);
      S.log('battle', `Lost to ${who} and went back to ${town ? town.name : 'town'}`);
    }
    // did this finish a story step?
    let stepDone = false;
    if (step) {
      if (step.type === 'trainer') stepDone = r.outcome === 'won';
      else if (step.type === 'wild') stepDone = step.mustCatch ? r.outcome === 'caught' : r.outcome === 'caught' || r.outcome === 'beat';
      if (!stepDone && step.type === 'wild' && step.mustCatch && r.outcome === 'beat') after.push('It fainted before you could catch it. Try again, and throw a Poké Ball when its HP is low!');
      if (!stepDone && r.outcome === 'ran') after.push('It got away. Continue the journey to find it again.');
    }
    lastExplore = t ? null : { kind: 'battle', area: area.name, outcome: r.outcome, name: foe.name, folder: foe.folder, level: r.foe.level };
    commit();
    if (r.outcome === 'caught') react(data.settings.emoLevel);
    const onPath = ctx.walk && walk;
    if (onPath && r.outcome === 'lost') endWalk(false);           // sent back to town: the trip ends
    const finish = () => { if (stepDone) completeStep(step); else if (onPath && r.outcome !== 'lost') resumeWalk(); else { exploreTab = step ? 'story' : exploreTab; openSheet('explore'); } };
    if (after.length) say(after, finish); else finish();
  }
  const linesOf2 = txt => String(txt || '').split('\n').map(x => x.trim()).filter(Boolean);

  // ---------------- story journey ----------------
  /** play the current story step */
  function runStep(st) {
    if (!st || storyOn() || save.pendingBattle) return;
    const area = locOf(st.area);
    const text = linesOf2(st.text);
    closeSheet(true);
    if (st.type === 'trainer') {
      const t = data.trainers.find(x => x.id === st.trainer); if (!t) return toast('This battle isn’t ready yet. Try again later.');
      if (!t.mustWin && !canBattle()) { openSheet('explore'); return toast('Your team can’t battle. Heal them at a town first.'); }
      const foes = PP.Story.team(data, save, t);
      if (!foes.length) return toast('This battle isn’t ready yet. Try again later.');
      return say(text.concat(linesOf2(t.intro)), () => startBattle(area, foes, { step: st, trainer: t }));
    }
    if (st.type === 'wild') {
      if (!canBattle()) { openSheet('explore'); return toast('Your team can’t battle. Heal them at a town first.'); }
      return say(text, () => startBattle(area, [{ species: st.species, level: st.level }], { step: st }));
    }
    if (st.type === 'arrive' && area) {
      save.location = area.id;
      const a = save.areas[area.id] || (save.areas[area.id] = { explores: 0, seen: {} });
      if (!a.explores) a.explores = 1;
      if (area.environment === 'town') save.lastTown = area.id;
      S.log('story', `Arrived at ${area.name}`);
      commit();
      return say(text.length ? text : [`You arrived at ${area.name}!`], () => completeStep(st));
    }
    if (st.type === 'heal') { healTeam(area ? `at ${area.name}` : ''); commit(); }
    return say(text.length ? text : ['…'], () => completeStep(st));
  }
  function completeStep(st) {
    if (save.story.done[st.id]) return;
    save.story.done[st.id] = Date.now();
    const got = [];
    if (st.rewardCoins) { addCoins(st.rewardCoins); got.push(`+${fmt(st.rewardCoins)} ${coinName()}`); }
    if (st.rewardGems) { save.gems += st.rewardGems; got.push(`+${fmt(st.rewardGems)} ${gemName()}`); }
    if (st.rewardItem !== 'none' && st.rewardQty > 0 && itemOf(st.rewardItem)) { addItem(st.rewardItem, st.rewardQty); got.push(`${st.rewardQty}× ${itemOf(st.rewardItem).name}`); }
    S.log('story', `Story: ${st.title}` + (got.length ? ` (${got.join(', ')})` : ''));
    bump('story:' + st.id);
    if (got.length) toast(got.join(' · '));
    const ch = PP.Story.chapterOf(data, st.chapter);
    if (ch && !save.story.chapters[ch.id] && PP.Story.chapterDone(data, save, ch.id)) {
      save.story.chapters[ch.id] = Date.now();
      addCoins(ch.rewardCoins); save.gems += ch.rewardGems;
      S.log('story', `Finished Chapter ${ch.number}: ${ch.title}` + rewardText(ch.rewardCoins, ch.rewardGems) + (ch.rewardExp ? `, +${ch.rewardExp} EXP` : ''));
      gainExp(ch.rewardExp);
      commit();
      const next = PP.Story.current(data, save), nch = next && PP.Story.chapterOf(data, next.chapter);
      return say([`Chapter ${ch.number} complete: ${ch.title}!`, `Rewards:${rewardText(ch.rewardCoins, ch.rewardGems)}${ch.rewardExp ? ` +${fmt(ch.rewardExp)} EXP` : ''}.`]
        .concat(nch ? [`Chapter ${nch.number} begins: ${nch.title}.`] : ['More of the journey is coming in a later update.']),
        () => { exploreTab = 'story'; openSheet('explore'); });
    }
    commit();
    exploreTab = 'story'; openSheet('explore');
  }

  // ---------------- welcome story & tutorial ----------------
  // New players: Professor's welcome → choose a name → choose a starter → guided tour.
  // Each step is saved (named / partner / tutorialDone), so closing the game resumes where they left off.
  const story = { lines: [], i: 0, done: null, target: 'none', mode: 'talk', typing: null, skip: false, gen: 0 };
  const fill = t => String(t).replace(/\{(\w+)\}/g, (m, k) => {
    const v = { name: save.name, pokemon: petLabel() || 'your Pokémon', professor: data.settings.professorName, coins: data.settings.coinName, gems: data.settings.gemName }[k];
    return v == null ? m : v;
  });
  const linesOf = key => String(data.settings[key] || '').split('\n').map(x => x.trim()).filter(Boolean);
  const storyOn = () => !$('story').hidden;

  /** the Professor says `lines` one box at a time, then calls done() */
  function say(lines, done, target, opts = {}) {
    story.gen++;
    story.lines = lines.map(fill).map(t => { const m = /^([^:]{1,28}):\s+(.+)$/.exec(t); return m ? { who: m[1], text: m[2] } : { who: '', text: t }; });
    story.i = 0; story.done = done || null;
    story.target = target || 'none'; story.mode = 'talk'; story.skip = !!opts.skip;
    if (!story.lines.length) { hideStory(); if (done) done(); return; }
    showStory(); typeLine();
  }
  /** name and face in the text box: the Professor unless the line names someone else */
  function setSpeaker(who) {
    const s = data.settings, prof = !who || /professor|hazel/i.test(who) || who === s.professorName;
    $('dlgWho').textContent = who || s.professorName;
    const trainer = !prof && data.trainers.find(t => t.name === who || PP.Story.trainerName(t) === who);
    $('dlgFace').innerHTML = prof && s.professorImage ? `<img src="${esc(encodeURI(s.professorImage))}" alt="">` : I(prof ? 'user' : trainer ? 'users' : 'user');
    $('dlgFace').classList.toggle('other', !prof);
    // the Professor stands above the text box while he talks (not during the guided tour, which points at things)
    const fig = $('storyFigure'), show = prof && !!s.professorFullImage && !story.skip && !$('story').classList.contains('dlg-top');
    if (show && fig.getAttribute('src') !== encodeURI(s.professorFullImage)) fig.src = encodeURI(s.professorFullImage);
    if (fig.hidden === show) { fig.hidden = !show; if (show) { fig.classList.remove('in'); void fig.offsetWidth; fig.classList.add('in'); } }
  }
  function showStory() {
    if ($('story').hidden) { $('story').hidden = false; }
    setSpeaker('');
    $('dlgSkip').hidden = !story.skip;
    placeSpot();
  }
  function hideStory() { $('story').hidden = true; clearInterval(story.typing); story.typing = null; }
  function typeLine() {
    const line = story.lines[story.i], text = line.text, el = $('dlgText');
    setSpeaker(line.who);
    clearInterval(story.typing);
    let n = 0; el.textContent = ''; $('dlgExtra').innerHTML = ''; $('dlgNext').hidden = true;
    placeSpot();
    story.typing = setInterval(() => {
      const shown = text.slice(n, n + 2);
      n += 2; el.textContent = text.slice(0, n);
      if (/[\p{L}\p{N}]/u.test(shown)) PP.Audio.blip(line.who || data.settings.professorName);
      if (n >= text.length) { clearInterval(story.typing); story.typing = null; $('dlgNext').hidden = false; }
    }, 20);
  }
  function advanceStory() {
    if (story.mode !== 'talk') return;
    if (story.typing) {                              // first tap shows the whole line
      clearInterval(story.typing); story.typing = null;
      $('dlgText').textContent = story.lines[story.i].text; $('dlgNext').hidden = false; return;
    }
    if (++story.i < story.lines.length) return typeLine();
    // run what comes next first: if it's more talking, the box stays open (no flicker between steps)
    const d = story.done, g = ++story.gen; story.done = null;
    if (d) d();
    if (story.gen === g) hideStory();
  }
  function askName(question) {
    story.gen++;
    story.mode = 'name'; story.target = 'none'; story.skip = false;
    showStory(); clearInterval(story.typing); story.typing = null;
    $('dlgText').textContent = fill(question || 'What is your name?');
    $('dlgNext').hidden = true;
    $('dlgExtra').innerHTML = `<form class="dlg-name" data-form="pname">
        <input id="pnameInput" maxlength="${data.settings.nameMax}" placeholder="Your name" autocomplete="off" autocapitalize="words" enterkeyhint="done" spellcheck="false">
        <button class="btn btn-primary" type="submit">Confirm</button></form>
      <p class="dlg-err" id="pnameErr"></p>`;
    setTimeout(() => { const i = $('pnameInput'); if (i) i.focus(); }, 60);
  }
  function askRival(question) {
    story.gen++;
    story.mode = 'name'; story.target = 'none'; story.skip = false;
    showStory(); clearInterval(story.typing); story.typing = null;
    $('dlgText').textContent = fill(question || 'What is your rival’s name?');
    $('dlgNext').hidden = true;
    const def = data.settings.rivalDefault || 'Kai';
    $('dlgExtra').innerHTML = `<form class="dlg-name" data-form="rname">
        <input id="rnameInput" maxlength="${data.settings.nameMax}" value="${esc(save.rivalName || def)}" placeholder="${esc(def)}" autocomplete="off" autocapitalize="words" enterkeyhint="done" spellcheck="false">
        <button class="btn btn-primary" type="submit">Confirm</button></form>
      <p class="dlg-err" id="rnameErr"></p>`;
    setTimeout(() => { const i = $('rnameInput'); if (i) { i.focus(); i.select(); } }, 60);
  }
  /** a rival name is allowed if it's the right length, made of letters/numbers, and not the player's own name */
  function rivalWhy(name) {
    const s = data.settings;
    if (name.length < 1) return 'Give your rival a name.';
    if (name.length > s.nameMax) return `Use at most ${s.nameMax} letters.`;
    if (!/^[\p{L}\p{N}][\p{L}\p{N} _.\-]*$/u.test(name)) return 'Use letters, numbers, spaces, dots, dashes or underscores.';
    if (name.toLowerCase() === String(save.name).toLowerCase()) return 'That’s your name! Choose a different one for your rival.';
    return null;
  }
  function setRival(name) {
    const old = save.rivalName;
    save.rivalName = name; save.rivalNamed = true;
    data = personalize(S.loadData(), name);
    S.log('system', old && old !== name && old !== data.settings.rivalDefault ? `Rival renamed: ${old} → ${name}` : `The rival is called ${name}`);
  }
  function submitRival(v) {
    const name = String(v || '').trim().replace(/\s+/g, ' '), why = rivalWhy(name);
    if (why) { $('rnameErr').textContent = why; return; }
    setRival(name);
    commit(); hideStory();
    // straight on to the starter (onboard() waits for the text box to close, which it doesn't between lines)
    say([`${name}! That’s right. I’m sure you two will push each other to grow stronger.`].concat(petSpecies() ? [] : linesOf('afterNameLines')),
      () => { if (!petSpecies()) openSheet('starter'); else { hideStory(); onboard(); } });
  }
  async function submitName(v) {
    const name = String(v || '').trim().replace(/\s+/g, ' ');
    const why = S.checkName(name, data, null) || await PP.Cloud.claimName(name, null);
    if (why) { $('pnameErr').textContent = why; return; }
    S.claimName(name, null);
    S.log('system', `New player chose the name ${name}`);
    save.name = name; save.named = true;
    if (SO.on) SO.setName(name);
    commit(); hideStory(); onboard();
  }
  /** start or resume the welcome for players who haven't finished it */
  function onboard() {
    if (storyOn() || sheetKind === 'starter') return;
    if (!save.named) {
      const intro = linesOf('introLines');
      return say(intro.slice(0, -1), () => askName(intro[intro.length - 1]));
    }
    if (!save.rivalNamed) {
      const r = linesOf('rivalLines');
      return say(r.slice(0, -1), () => askRival(r[r.length - 1]));
    }
    if (!petSpecies()) return say(linesOf('afterNameLines'), () => openSheet('starter'));
    if (!save.tutorialDone) return say(linesOf('afterStarterLines'), () => tour(0));
  }
  function tour(i) {
    const steps = data.tutorial.filter(t => t.enabled);
    if (i >= steps.length) return say(linesOf('outroLines'), finishTour);
    setCare(false);
    say([steps[i].text], () => tour(i + 1), steps[i].target, { skip: true });
  }
  function finishTour() {
    hideStory();
    if (save.tutorialDone) return;
    save.tutorialDone = true;
    S.log('system', `${save.name} finished the tutorial`);
    commit(); toast('Enjoy your adventure!');
  }
  // spotlight on the part of the screen being explained
  const TARGETS = { profile: '.profile', wallet: '.wallet', needs: '#needs', care: '.act-toggle', area: '#locCard', quest: '#questCard',
    'tab-bag': '.tab[data-kind="bag"]', 'tab-pals': '.tab[data-kind="pals"]', 'tab-explore': '.tab[data-kind="explore"]',
    'tab-party': '.tab[data-kind="party"]', 'tab-shop': '.tab[data-kind="shop"]' };
  function targetRect(t) {
    const app = $('app').getBoundingClientRect();
    if (t === 'pet') {
      const sp = petSpecies(); if (!sp) return null;
      const c = petCanvas.getBoundingClientRect(), { x, y } = petPos();
      const box = PP.Sprite.idleBox(sp.folder), sc = data.settings.petScale * sp.size / 100;
      const w = Math.max(70, box.w * sc), h = Math.max(70, box.h * sc + 14);
      return { x: c.left - app.left + x - w / 2, y: c.top - app.top + y - h + 10, w, h };
    }
    const el = TARGETS[t] && document.querySelector(TARGETS[t]);
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return r.width ? { x: r.left - app.left, y: r.top - app.top, w: r.width, h: r.height } : null;
  }
  function placeSpot() {
    const st = $('story'), spot = $('spot'), r = story.mode === 'talk' ? targetRect(story.target) : null;
    st.classList.toggle('has-spot', !!r);
    if (!r) { spot.hidden = true; st.classList.remove('dlg-top'); return; }
    const pad = 6;
    Object.assign(spot.style, { left: r.x - pad + 'px', top: r.y - pad + 'px', width: r.w + pad * 2 + 'px', height: r.h + pad * 2 + 'px' });
    spot.hidden = false;
    st.classList.toggle('dlg-top', r.y + r.h / 2 > $('app').clientHeight * 0.5);
  }

  // ---------------- rendering: values (every second) ----------------
  function update() {
    if (SO.on) updateFriendsBadge();
    const s = data.settings, t = Date.now();
    $('pName').textContent = save.name;
    $('pLevel').textContent = save.level;
    const need = S.expNeed(save.level, data), pct = save.level >= s.maxLevel ? 100 : Math.min(100, save.exp / need * 100);
    $('pExpText').textContent = save.level >= s.maxLevel ? 'MAX' : `EXP ${Math.floor(pct)}%`;
    $('pExpBar').style.width = pct + '%';
    $('coins').textContent = fmt(save.coins);
    $('gems').textContent = fmt(save.gems);

    document.querySelectorAll('.need').forEach(el => {
      const v = save.needs[el.dataset.need] || 0;
      el.querySelector('.need-val').textContent = Math.round(v);
      el.querySelector('.bar > i').style.width = v + '%';
      el.classList.toggle('low', v < s.lowNeed);
    });
    let anyReady = false;
    document.querySelectorAll('.act[data-id]').forEach(el => {
      const a = data.actions.find(x => x.id === el.dataset.id); if (!a) return;
      const left = (save.cooldowns[a.id] || 0) - t;
      const cooling = left > 0 && a.cooldownSec > 0;
      if (!cooling) anyReady = true;
      el.classList.toggle('cooling', cooling);
      el.style.setProperty('--p', cooling ? Math.min(100, left / (a.cooldownSec * 1000) * 100) + '%' : '0%');
      el.querySelector('.act-label').textContent = cooling ? Math.ceil(left / 1000) + 's' : a.label;
    });
    // little dot on the closed Care button when something in it can be used
    const dot = document.querySelector('.act-toggle .act-dot');
    if (dot) dot.hidden = careOpen || !anyReady;

    applyScene();

    // profile icon: the chosen Pokémon's portrait (the partner's by default)
    const sp = avatarSpecies(), pic = sp && PP.Sprite.portrait(sp.folder);
    const avSig = pic || 'none';
    if (sig.avatar !== avSig) {
      sig.avatar = avSig;
      document.querySelector('.avatar').innerHTML = pic ? `<img src="${pic}" alt="">` : '<span class="avatar-empty"></span>';
    }

    // area card
    const l = locOf(save.location) || data.locations.find(x => x.enabled);
    const open = data.locations.filter(x => PP.Progress.unlocked(data, save, x)).length;
    const total = data.locations.filter(x => x.enabled).length, locSig = [l && l.name, open, total].join('|');
    if (sig.loc !== locSig) {
      sig.loc = locSig;
      $('locCard').innerHTML = l ? `<div class="loc-head">${I('pin')}<span>${esc(l.name)}</span></div>
        <div class="loc-map"></div><div class="loc-sub">${open} of ${total} areas open</div>`
        : `<div class="loc-head">${I('pin')}<span>No areas</span></div><div class="loc-sub">Coming soon</div>`;
    }

    // quest card
    const q = s.showQuest ? currentQuest() : null;
    const st = q && questState(q);
    const qSig = q ? [q.id, q.kind, q.title, q.description, st.progress, q.target, st.done, questOpen].join('|') : 'none';
    if (sig.quest !== qSig) {
      sig.quest = qSig;
      const card = $('questCard');
      card.hidden = !q;
      card.classList.toggle('done', !!(st && st.done));
      card.classList.toggle('mini', !!q && !questOpen);
      if (q && !questOpen) card.innerHTML = `<button class="q-fab" data-do="quest-toggle" aria-label="Show your quest: ${esc(q.title)}">${I('flag')}
          <span class="q-fab-badge${st.done ? ' ready' : ''}">${st.done ? '!' : `${Math.round(st.progress / q.target * 100)}%`}</span></button>`;
      else if (q) card.innerHTML = `<button class="q-close" data-do="quest-toggle" aria-label="Fold the quest card">${I('close')}</button><div class="q-open" data-do="sheet" data-kind="quests">
        <div class="q-head"><span class="q-ic">${I('flag')}</span>${esc(kindLabel(q.kind))} quest</div>
        <div class="q-title">${esc(q.title)}</div>
        ${q.description ? `<div class="q-desc">${esc(q.description)}</div>` : ''}
        <div class="q-foot">
          ${st.done ? `<button class="btn btn-primary btn-sm" data-do="claim" data-id="${esc(q.id)}">${I('check')}Claim reward</button><span style="flex:1"></span>`
                    : `<div class="bar" style="--c:var(--gold)"><i style="width:${st.progress / q.target * 100}%"></i></div><span class="q-count tnum">${fmt(st.progress)}/${fmt(q.target)}</span>`}
          ${I('chevron')}
        </div></div>`;
    }
  }

  // ---------------- sheets ----------------
  const priceTag = (n, cur) => `<span class="price tnum${cur === 'gems' ? ' gem' : ''}">${I(cur === 'gems' ? 'gem' : 'coin')}${fmt(n)}</span>`;
  const empty = (icon, title, text) => `<div class="empty">${I(icon)}<b>${esc(title)}</b>${esc(text)}</div>`;
  const itemColor = it => (needOf(it.effectNeed) || {}).color || 'var(--text-3)';
  /** an item's picture if it has one, otherwise its line icon */
  const itemPic = it => it.image ? `<img class="pix" src="${esc(encodeURI(it.image))}" alt="" loading="lazy" decoding="async">` : I(it.icon);

  // ---- shop: category tabs + search + 3-column grid ----
  let shopCat = null, shopQuery = '';
  let exploreRegion = null, palsView = 'box', exploreTab = 'story', questTab = null, storyAll = false;
  const shopItems = () => data.items.filter(i => i.inShop && i.buy > 0);
  function shopTabs() {
    const list = shopItems();
    const tabs = data.categories.filter(c => list.some(i => i.category === c.id)).map(c => ({ id: c.id, name: c.name }));
    if (list.some(i => !data.categories.some(c => c.id === i.category))) tabs.push({ id: 'none', name: 'Other' });
    return tabs;
  }
  function shopGridHTML() {
    const q = shopQuery.trim().toLowerCase();
    const inCat = i => (shopCat === 'none' ? !data.categories.some(c => c.id === i.category) : i.category === shopCat);
    const list = shopItems().filter(i => (q ? i.name.toLowerCase().includes(q) : inCat(i)));
    if (!list.length) return `<div class="shop-empty">${q ? `Nothing matches “${esc(shopQuery)}”.` : 'Nothing in this category yet.'}</div>`;
    return list.map(it => {
      const afford = save[wallet(it.currency)] >= it.buy, owned = save.inventory[it.id] || 0;
      return `<div class="shop-card" title="${esc(it.description || it.name)}">
        ${owned ? `<span class="shop-owned tnum">×${fmt(owned)}</span>` : ''}
        <div class="shop-pic" style="--c:${itemColor(it)}">${itemPic(it)}</div>
        <div class="shop-name">${esc(it.name)}</div>
        <button class="btn btn-sm shop-buy${afford ? ' btn-primary' : ''}" data-do="buy" data-id="${esc(it.id)}" ${afford ? '' : 'disabled'} aria-label="Buy ${esc(it.name)}">${priceTag(it.buy, it.currency)}</button>
      </div>`;
    }).join('');
  }
  function shopTabsHTML() {
    return shopTabs().map(t => `<button class="cat-tab${t.id === shopCat && !shopQuery.trim() ? ' on' : ''}" data-do="cat" data-id="${esc(t.id)}">${esc(t.name)}</button>`).join('');
  }

  const SHEETS = {
    bag() {
      const owned = data.items.filter(i => save.inventory[i.id] > 0);
      return { title: data.settings.tabBag, body: owned.length ? owned.map(it => `
        <div class="row"><span class="row-ic${it.image ? ' has-pic' : ''}" style="--c:${itemColor(it)}">${itemPic(it)}</span>
          <div class="row-main"><div class="row-title">${esc(it.name)} <span class="qty tnum">×${fmt(save.inventory[it.id])}</span></div>
          <div class="row-sub">${esc(it.description || (it.effectNeed !== 'none' ? `${it.effectAmount >= 0 ? '+' : ''}${it.effectAmount} ${needOf(it.effectNeed).label}` : ''))}</div></div>
          <div class="row-side">
            ${it.effectNeed !== 'none' ? `<button class="btn btn-primary btn-sm" data-do="use" data-id="${esc(it.id)}">Use</button>` : ''}
            ${it.sell > 0 ? `<button class="btn btn-sm" data-do="sell" data-id="${esc(it.id)}">Sell ${fmt(it.sell)}</button>` : ''}
          </div></div>`).join('') : empty('bag', 'Your bag is empty', 'Buy things in the shop or find them while exploring.') };
    },
    shop() {
      if (!data.settings.shopOpen) return { title: data.settings.tabShop, body: empty('cart', 'The shop is closed', 'Check back later.') };
      const tabs = shopTabs();
      if (!tabs.length) return { title: data.settings.tabShop, body: empty('cart', 'Nothing for sale', 'Items appear here when they are put in the shop.') };
      if (!tabs.some(t => t.id === shopCat)) shopCat = tabs[0].id;
      return { title: data.settings.tabShop, body: `
        <div class="shop-head">
          <div class="cat-tabs" id="catTabs" role="tablist">${shopTabsHTML()}</div>
          <div class="shop-tools">
            <input type="search" id="shopSearch" placeholder="Search items" value="${esc(shopQuery)}" autocomplete="off">
            <span class="shop-wallet">${priceTag(save.coins, 'coins')}${priceTag(save.gems, 'gems')}</span>
          </div>
        </div>
        <div class="shop-grid" id="shopGrid">${shopGridHTML()}</div>` };
    },
    explore() {
      const s = data.settings, nd = needOf(s.exploreNeed);
      if (!s.exploreOpen) return { title: s.tabExplore, body: empty('compass', 'Exploring is closed', 'Check back later.') };
      const regions = data.regions.filter(r => r.enabled && data.locations.some(l => l.enabled && l.region === r.id));
      if (!regions.some(r => r.id === exploreRegion)) exploreRegion = (regions.find(r => data.locations.some(l => l.id === save.location && l.region === r.id)) || regions[0] || {}).id;
      const tabs = `<div class="seg"><button class="seg-btn${exploreTab === 'story' ? ' on' : ''}" data-do="explore-tab" data-id="story">${I('flag')}Story</button><button class="seg-btn${exploreTab === 'wild' ? ' on' : ''}" data-do="explore-tab" data-id="wild">${I('paw')}Wild battles</button></div>`;
      if (exploreTab === 'story') return { title: s.tabExplore, body: tabs + storyHTML() };
      const list = data.locations.filter(l => l.enabled && l.region === exploreRegion);
      const r = lastExplore;
      const OUT = { caught: 'Caught!', beat: 'You won the battle', ran: 'You got away', lost: 'You lost the battle' };
      const res = !r ? '' : r.kind === 'battle' ? `
        <div class="result encounter">
          <div class="enc-pic">${PP.Sprite.portrait(r.folder) ? `<img src="${PP.Sprite.portrait(r.folder)}" alt="">` : I('pokeball')}</div>
          <div><b>${OUT[r.outcome] || ''}</b>Wild ${esc(r.name)} · Lv ${r.level} · ${esc(r.area)}
            <div class="enc-note">${r.outcome === 'caught' ? 'It’s in your Pokédex now.' : r.outcome === 'lost' ? 'Your team was healed in town.' : 'Explore again to meet more Pokémon.'}</div></div>
        </div>` : r.kind === 'encounter' ? `
        <div class="result encounter">
          <div class="enc-pic">${(PP.Sprite.portrait(r.folder) ? `<img src="${PP.Sprite.portrait(r.folder)}" alt="">` : I('pokeball'))}</div>
          <div><b>A wild ${esc(r.name)} appeared!</b>Lv ${r.level} · ${esc(r.rarity)} · ${esc(r.area)}${r.exp ? ` · +${r.exp} EXP` : ''}
            <div class="enc-note">${r.newDex ? 'New! Added to your Pokédex as seen. ' : 'Seen before. '}It wandered off. Battling and catching are coming in the next update.</div></div>
        </div>` : `<div class="result"><b>${esc(r.area)}</b>${esc(r.parts.join(' · '))}</div>`;
      const ENV = { town: 'pin', grassland: 'leafy', forest: 'leafy', cave: 'gem', water: 'drop', mountain: 'compass', building: 'grid', island: 'drop' };
      const cards = list.map(l => {
        const open = PP.Progress.unlocked(data, save, l), c = PP.Progress.completion(data, save, l.id), visited = c.explores > 0;
        const tags = [nd && l.energyCost ? `${I('bolt')}${l.energyCost} ${esc(nd.label)}` : '', `${I('coin')}${fmt(l.coinsMin)}–${fmt(l.coinsMax)}`,
          l.gemChance ? `${I('gem')}${l.gemChance}%` : '', l.itemChance ? `${I('box')}${l.itemChance}% item` : '',
          l.environment !== 'town' && l.encounterChance ? `${I('paw')}${l.encounterChance}% wild` : ''].filter(Boolean).map(x => `<span>${x}</span>`).join('');
        return `<article class="area${open ? '' : ' locked'}">
          <div class="area-pic env-${esc(l.environment)}">${l.thumbnail ? `<img src="${esc(encodeURI(l.thumbnail))}" alt="">` : I(open ? ENV[l.environment] || 'pin' : 'lock')}</div>
          <div class="area-body">
            <div class="area-head"><b>${esc(l.name)}</b><span class="qty">Lv ${l.unlockLevel}+</span></div>
            ${l.description ? `<p class="area-desc">${esc(l.description)}</p>` : ''}
            <div class="area-tags">${tags}</div>
            ${visited || open ? `<div class="area-prog"><div class="bar" style="--c:var(--good)"><i style="width:${c.pct}%"></i></div>
              <span class="tnum">${c.total ? `${c.found}/${c.total} found` : `${c.explores} visit${c.explores === 1 ? '' : 's'}`} · ${c.pct}%</span></div>` : ''}
            ${open ? `<div class="area-actions">${l.environment !== 'town' && PP.Encounters.tableFor(data, l) ? `<button class="btn btn-primary btn-sm area-go" data-do="wild" data-id="${esc(l.id)}">${I('swords')}Wild battle</button>` : ''}
                <button class="btn btn-sm${l.environment === 'town' ? ' btn-primary' : ''} area-go" data-do="explore" data-id="${esc(l.id)}">${l.environment === 'town' ? 'Visit' : 'Search'}</button>
                ${l.environment === 'town' && visited && save.box.some(e => e.hp != null) ? `<button class="btn btn-sm" data-do="heal" data-id="${esc(l.id)}">${I('heart')}Heal team</button>` : ''}</div>`
                   : `<div class="area-lock">${I('lock')}<span>Needs: ${esc(PP.Progress.missingText(data, save, l))}</span></div>`}
          </div></article>`;
      }).join('');
      return { title: s.tabExplore, body: tabs + res
        + (regions.length > 1 ? `<div class="cat-tabs">${regions.map(g => `<button class="cat-tab${g.id === exploreRegion ? ' on' : ''}" data-do="region" data-id="${esc(g.id)}">${esc(g.name)}</button>`).join('')}</div>` : '')
        + `<div class="sec-label">${esc((regions.find(g => g.id === exploreRegion) || {}).name || '')}${nd ? ` · ${esc(nd.label)} ${Math.round(save.needs[nd.id])}/100` : ''}</div>`
        + (((regions.find(g => g.id === exploreRegion) || {}).map) ? `<a class="region-map" href="${esc(encodeURI(regions.find(g => g.id === exploreRegion).map))}" target="_blank" rel="noopener"><img src="${esc(encodeURI(regions.find(g => g.id === exploreRegion).map))}" alt="Map of ${esc(regions.find(g => g.id === exploreRegion).name)}" loading="lazy"><span>${I('compass')}Region map</span></a>` : '')
        + (cards || empty('compass', 'No areas yet', 'New areas are coming soon.')) };
    },
    quests() {
      const on = data.quests.filter(questOn);
      const count = k => on.filter(q => q.kind === k && questState(q).done && !questState(q).claimed).length;
      if (!questTab) questTab = (QUEST_KINDS.find(([k]) => count(k)) || ['daily'])[0];
      const tabs = `<div class="cat-tabs">${QUEST_KINDS.map(([k, label, ic]) => `<button class="cat-tab${k === questTab ? ' on' : ''}" data-do="quest-tab" data-id="${k}">${I(ic)}${label}${count(k) ? `<span class="tab-dot">${count(k)}</span>` : ''}</button>`).join('')}</div>`;
      const list = on.filter(q => q.kind === questTab);
      const rank = q => { const st = questState(q); return st.claimed ? 2 : st.done ? 0 : 1; };
      list.sort((a, b) => rank(a) - rank(b));            // ready to claim, then in progress, then done
      let top = '';
      if (questTab === 'story') {
        const cur = PP.Story.current(data, save), ch = PP.Story.currentChapter(data, save);
        top = `<div class="q-journey">${I('flag')}<div><small>${ch ? `Chapter ${ch.number} · ${esc(ch.title)}` : 'Your journey'}</small>
          <b>${cur ? esc(cur.title) : 'The story so far is complete'}</b></div>
          ${cur ? `<button class="btn btn-primary btn-sm" data-do="story-open">Go</button>` : ''}</div>`;
      }
      if (questTab === 'daily') {
        const ms = Math.max(0, nextReset() - Date.now()), h = Math.floor(ms / 3600e3), m = Math.floor(ms % 3600e3 / 60000);
        top = `<div class="sec-label">New daily quests in ${h ? h + 'h ' : ''}${m}m</div>`;
      }
      const reward = q => {
        const p = [];
        if (q.rewardCoins) p.push(priceTag(q.rewardCoins, 'coins'));
        if (q.rewardGems) p.push(priceTag(q.rewardGems, 'gems'));
        if (q.rewardExp) p.push(`<span class="price tnum">${fmt(q.rewardExp)} EXP</span>`);
        const it = q.rewardItem !== 'none' && q.rewardQty > 0 && itemOf(q.rewardItem);
        if (it) p.push(`<span class="price tnum">${it.image ? `<img src="${esc(it.image)}" alt="">` : ''}${q.rewardQty}× ${esc(it.name)}</span>`);
        return p.length ? `<div class="q-rewards">${p.join('')}</div>` : '';
      };
      const body = list.map(q => {
        const st = questState(q);
        return `<div class="row quest${st.claimed ? ' claimed' : st.done ? ' ready' : ''}"><span class="row-ic" style="--c:var(--gold)">${I(st.claimed ? 'check' : (QUEST_KINDS.find(x => x[0] === q.kind) || [, , 'flag'])[2])}</span>
          <div class="row-main"><div class="row-title">${esc(q.title)}</div><div class="row-sub">${esc(q.description)}</div>
          ${st.claimed ? '' : `<div class="bar" style="--c:var(--gold)"><i style="width:${st.progress / q.target * 100}%"></i></div>`}${st.claimed ? '' : reward(q)}</div>
          <div class="row-side">${st.claimed ? '<span class="qty">Done</span>' : st.done ? `<button class="btn btn-primary btn-sm" data-do="claim" data-id="${esc(q.id)}">Claim</button>` : `<span class="qty tnum">${fmt(st.progress)}/${fmt(q.target)}</span>`}</div></div>`;
      }).join('');
      const none = { story: ['flag', 'No story quests', 'New story quests are coming soon.'], daily: ['clock', 'No daily quests today', 'Check back after the reset.'],
        explore: ['compass', 'No exploration quests', 'New exploration quests are coming soon.'], achievement: ['star', 'No achievements yet', 'New achievements are coming soon.'] }[questTab];
      return { title: 'Quests', body: tabs + top + (body || empty(...none)) };
    },
    // the PC box: every Pokémon the player owns
    pals() {
      const view = `<div class="cat-tabs"><button class="cat-tab${palsView === 'box' ? ' on' : ''}" data-do="pals-view" data-id="box">PC box</button><button class="cat-tab${palsView === 'dex' ? ' on' : ''}" data-do="pals-view" data-id="dex">Pokédex</button></div>`;
      if (palsView === 'dex') return { title: data.settings.tabPals, body: view + dexHTML() };
      const r0 = SHEETS.palsBox(); r0.body = view + r0.body; return r0;
    },
    palsBox() {
      const e = partnerEntry(), sp = petSpecies();
      if (!e || !sp) return { title: data.settings.tabPals, body: empty('pokeball', `No ${data.settings.tabPals} yet`, 'Choose your first partner to get started.') };
      const max = data.settings.teamMax, team = teamEntries(), icon = (avatarSpecies() || {}).id;
      const pic = x => { const xs = speciesOf(x.species); const u = xs && PP.Sprite.portrait(xs.folder); return u ? `<img class="pix" src="${u}" alt="">` : I('pokeball'); };
      const hpBar = x => { const r = hpOf(x) / maxHp(x); return `<span class="mini-hp"><i style="width:${r * 100}%;background:${r > .5 ? 'var(--good)' : r > .2 ? 'var(--gold)' : 'var(--bad)'}"></i></span>`; };
      const cards = [];
      for (let k = 0; k < max; k++) {
        const x = team[k];
        cards.push(x ? `<button class="tm-card${k === 0 ? ' main' : ''}" data-do="cell" data-id="${esc(x.uid)}" aria-label="${esc(labelOf(x))}, ${k === 0 ? 'main' : 'team member ' + (k + 1)}">
            <span class="tm-tag">${k === 0 ? '★ Main' : 'Team ' + (k + 1)}</span><span class="tm-pic">${pic(x)}</span><b>${esc(labelOf(x))}</b><small>Lv ${x.level}</small>${hpBar(x)}</button>`
          : `<button class="tm-card empty" data-do="team-empty" aria-label="Empty team slot">${I('plus')}<small>Empty</small></button>`);
      }
      const sorted = save.box.slice().sort((a, b) => boxSort === 'level' ? b.level - a.level || a.since - b.since
        : boxSort === 'dex' ? (speciesOf(a.species) || {}).dex - (speciesOf(b.species) || {}).dex || b.level - a.level : b.since - a.since);
      const cells = sorted.map(x => {
        const xs = speciesOf(x.species); if (!xs) return '';
        const ti = save.team.indexOf(x.uid);
        return `<button class="box-cell${ti >= 0 ? ' in-team' : ''}" data-do="cell" data-id="${esc(x.uid)}" title="${esc(labelOf(x))} · Lv ${x.level}">
          <span class="box-pic">${pic(x)}<span class="box-lv">Lv ${x.level}</span>${ti >= 0 ? `<span class="box-team">${ti === 0 ? '★' : ti + 1}</span>` : ''}</span>
          <span class="box-name">${esc(labelOf(x))}</span>${hpBar(x)}</button>`;
      }).join('');
      const detail = boxDetail && save.box.find(x => x.uid === boxDetail);
      return { title: data.settings.tabPals, body: `
        <div class="sec-label">Your team · ${team.length}/${max}</div>
        <p class="team-help">${I('star')}<span>Your <b>Main</b> leads every battle and lives on your home screen. Tap any Pokémon to make it your Main, or add it to or remove it from your team.</span></p>
        <div class="tm-grid">${cards.join('')}</div>
        <div class="box-head"><div class="sec-label" style="margin:0">PC box · ${save.box.length} Pokémon</div>
          <div class="box-sort">${[['new', 'Newest'], ['level', 'Level'], ['dex', 'No.']].map(([k, l]) => `<button class="cat-tab${boxSort === k ? ' on' : ''}" data-do="box-sort" data-id="${k}">${l}</button>`).join('')}</div></div>
        <div class="box-grid">${cells}</div>
        <p class="muted" style="margin-top:10px">Tap a Pokémon to see its stats and moves, or to change your team.</p>
        ${detail ? boxDetailHTML(detail, icon) : ''}` };
    },
    starter() {
      const s = data.settings, list = data.pokemon.filter(p => p.starter && PP.Sprite.has(p.folder));
      if (!list.length) return { title: s.starterTitle, body: empty('pokeball', 'No starters yet', 'Mark some Pokémon as “Starter” in Admin → Content → Pokémon.') };
      if (!list.some(p => p.id === starterPick)) starterPick = null;
      const pick = list.find(p => p.id === starterPick);
      return { title: s.starterTitle, body: `
        <p class="starter-text">${esc(s.starterText)}</p>
        <div class="starters">${list.map(p => `
          <button class="starter${p.id === starterPick ? ' on' : ''}" data-do="pick-starter" data-id="${esc(p.id)}" aria-pressed="${p.id === starterPick}">
            <canvas class="starter-cv" data-id="${esc(p.id)}" data-h="104px" style="width:100%;height:104px"></canvas>
            <b>${esc(p.name)}</b><small class="starter-lv">Lv ${s.starterLevel}</small>
          </button>`).join('')}</div>
        <button class="btn btn-primary starter-go" data-do="choose-starter" ${pick ? '' : 'disabled'}>${pick ? `Choose ${esc(pick.name)}` : 'Pick a Pokémon'}</button>` };
    },
    party() {
      const title = data.settings.tabParty;
      if (!SO.on) return { title, body: empty('users', 'Friends need Google sign-in', 'When the game is online, sign in with Google to add friends, chat, trade and battle together.') };
      if (!save.named || !petSpecies()) return { title, body: empty('users', 'Finish the welcome first', 'Choose your name and your first Pokémon, then come back to add friends.') };
      if (friendView && SO.friend(friendView)) return { title, body: friendPageHTML(SO.friend(friendView)) };
      friendView = null;
      return { title, body: friendsListHTML() };
    },
    settings() {
      const icon = (avatarSpecies() || {}).id, owned = [...new Set(save.box.map(b => b.species))].map(speciesOf).filter(Boolean);
      return { title: 'Profile & settings', body: `
        <div class="sec-label">In-game name</div>
        ${SO.on ? `<div class="f-me"><b>${esc(save.name)}</b><span>Your unique player name. Friends find you by it, so it can’t be changed.</span></div>`
          : `<form class="field" data-form="name"><input id="nameInput" maxlength="${data.settings.nameMax}" value="${esc(save.name)}" autocomplete="off" spellcheck="false"><button class="btn btn-primary" type="submit">Save</button></form>
        <p class="field-err" id="nameErr"></p>`}
        <div class="sec-label">Your rival’s name</div>
        <form class="field" data-form="rival"><input id="rivalInput" maxlength="${data.settings.nameMax}" value="${esc(save.rivalName)}" autocomplete="off" spellcheck="false"><button class="btn btn-primary" type="submit">Save</button></form>
        <p class="field-err" id="rivalErr"></p>
        <div class="sec-label">Profile icon</div>
        ${owned.length ? `<div class="icon-grid">${owned.map(p => { const pic = PP.Sprite.portrait(p.folder);
          return `<button class="icon-pick${p.id === icon ? ' on' : ''}" data-do="avatar" data-id="${esc(p.id)}" title="${esc(p.name)}" aria-pressed="${p.id === icon}">${pic ? `<img src="${pic}" alt="">` : I('pokeball')}<span>${esc(p.name)}</span></button>`; }).join('')}</div>
          <p class="muted" style="margin-top:8px;text-align:left">Pick from the Pokémon in your PC box.</p>` : '<p class="muted" style="text-align:left">Choose a starter first.</p>'}
        <div class="sec-label">Sound</div>
        ${[['music', 'music', 'Music', data.settings.musicOn], ['sfx', 'bolt', 'Sound effects', data.settings.soundOn]].map(([k, ic, label, on]) => `
        <label class="row toggle-row"><span class="row-ic" style="--c:var(--accent)">${I(ic)}</span>
          <div class="row-main"><div class="row-title">${label}</div>${on ? '' : '<div class="row-sub">Turned off for now</div>'}</div>
          <span class="switch"><input type="checkbox" data-audio="${k}" ${PP.Audio.prefs()[k] && on ? 'checked' : ''} ${on ? '' : 'disabled'}><span></span></span></label>`).join('')}
        ${PP.Cloud.on ? `<div class="sec-label">Account</div>
        <div class="row"><span class="row-ic" style="--c:var(--accent)">${I('user')}</span>
          <div class="row-main"><div class="row-title">${esc(PP.Cloud.user.name || 'Google account')}</div><div class="row-sub">${esc(PP.Cloud.user.email)} · progress saved online</div></div>
          <div class="row-side"><button class="btn btn-sm" data-do="sign-out">Sign out</button></div></div>` : ''}
        <div class="sec-label">Start over</div>
        ${resetOpen ? `<form class="reset-box" data-form="reset">
            <p><b>Reset your game?</b> Your Pokémon, items, coins, badges and story progress will be deleted, and your name <b>${esc(save.name)}</b> becomes free for anyone to use. This can’t be undone.</p>
            <label for="resetName">Type your name to confirm</label>
            <input id="resetName" autocomplete="off" spellcheck="false" placeholder="${esc(save.name)}">
            <p class="field-err" id="resetErr"></p>
            <div class="reset-actions"><button type="button" class="btn" data-do="reset-cancel">Cancel</button><button type="submit" class="btn btn-danger">Reset my game</button></div>
          </form>`
          : `<button class="row link-row reset-row" data-do="reset-start"><span class="row-ic" style="--c:var(--bad, #e5484d)">${I('close')}</span>
            <div class="row-main"><div class="row-title">Reset my game</div><div class="row-sub">Delete your progress and start a new journey</div></div>${I('chevron')}</button>`}
        <p class="muted">Pocket Pals · ${PP.Cloud.on ? 'online' : 'saved on this device'}${data.settings.fastTime ? ' · fast time on' : ''}</p>` };
    },
  };
  // ---------------- friends (online only; data in js/online/social.js) ----------------
  const SO = PP.Social || { on: false };
  let friendView = null, friendQuery = '', friendResults = null, chatPair = null, chatUnsub = null, chatMsgs = [], tradePicking = false;
  const handled = new Set();              // trades and battles this tab already acted on
  let pvpOn = null;
  const portraitOf = sp => { const p = speciesOf(sp); return p ? PP.Sprite.portrait(p.folder) : null; };
  const avatarImg = sp => { const pic = sp && portraitOf(sp); return `<span class="f-ava">${pic ? `<img src="${pic}" alt="">` : I('user')}</span>`; };
  function agoText(t) {
    if (!t) return 'a while ago';
    const m = Math.round((Date.now() - t) / 60000);
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`;
  }
  const statusText = uid => SO.isOnline(uid) ? 'Online' : `Last seen ${agoText(SO.lastSeen(uid))}`;
  const dot = uid => `<span class="f-dot${SO.isOnline(uid) ? ' on' : ''}" title="${SO.isOnline(uid) ? 'Online' : 'Offline'}"></span>`;
  const fresh = (x, mins) => Date.now() - SO.ms(x.at) < mins * 60000 || !x.at;
  const invitesIn = () => SO.state.battlesIn.filter(b => b.status === 'invited' && fresh(b, 15));
  const invitesOut = () => SO.state.battlesOut.filter(b => b.status === 'invited' && fresh(b, 15));
  const offersIn = () => SO.state.tradesIn.filter(t => t.status === 'offered');
  const offersOut = () => SO.state.tradesOut.filter(t => t.status === 'offered');
  /** how many things wait for the player in Friends (shown on the tab) */
  const friendAlerts = () => !SO.on ? 0 : SO.state.reqIn.length + invitesIn().length + offersIn().length + SO.state.friends.filter(SO.unread).length;
  /** the Pokémon you can give away: not your partner, and never your last one */
  const tradeable = () => save.box.length > 1 ? save.box.filter(e => e.uid !== save.partner) : [];
  const entryCard = (e, extra) => { const sp = speciesOf(e.species) || { name: e.species };
    return `<div class="t-mon">${avatarImg(e.species)}<div><b>${esc(e.nickname || sp.name)}</b><small>Lv ${e.level}${extra ? ' · ' + extra : ''}</small></div></div>`; };

  function friendsListHTML() {
    const st = SO.state;
    const results = friendResults == null ? '' : friendResults.length ? friendResults.map(r => {
      const rel = SO.relation(r.uid);
      const btn = rel === 'friend' ? '<span class="qty">Friends</span>' : rel === 'sent' ? '<span class="qty">Requested</span>'
        : `<button class="btn btn-primary btn-sm" data-do="f-add" data-id="${esc(r.uid)}" data-name="${esc(r.name)}">${rel === 'received' ? 'Accept' : 'Add'}</button>`;
      return `<div class="row"><span class="row-ic" style="--c:var(--accent)">${I('user')}</span><div class="row-main"><div class="row-title">${esc(r.name)}</div></div><div class="row-side">${btn}</div></div>`;
    }).join('') : '<p class="muted" style="text-align:left">No player with that name.</p>';
    const inv = invitesIn().map(b => `<div class="row f-alert"><span class="row-ic" style="--c:#c2410c">${I('swords')}</span>
      <div class="row-main"><div class="row-title">${esc(b.names.a)} challenges you!</div><div class="row-sub">Live battle with your team</div></div>
      <div class="row-side"><button class="btn btn-sm" data-do="b-decline" data-id="${esc(b.id)}">No</button><button class="btn btn-primary btn-sm" data-do="b-accept" data-id="${esc(b.id)}">Battle</button></div></div>`).join('');
    const reqIn = st.reqIn.map(r => `<div class="row f-alert"><span class="row-ic" style="--c:var(--accent)">${I('user')}</span>
      <div class="row-main"><div class="row-title">${esc(r.fromName)}</div><div class="row-sub">Wants to be friends</div></div>
      <div class="row-side"><button class="btn btn-sm" data-do="r-decline" data-id="${esc(r.id)}">Decline</button><button class="btn btn-primary btn-sm" data-do="r-accept" data-id="${esc(r.id)}">Accept</button></div></div>`).join('');
    const reqOut = st.reqOut.map(r => `<div class="row"><span class="row-ic" style="--c:var(--text-3)">${I('clock')}</span>
      <div class="row-main"><div class="row-title">${esc(r.toName)}</div><div class="row-sub">Request sent</div></div>
      <div class="row-side"><button class="btn btn-sm" data-do="r-decline" data-id="${esc(r.id)}">Cancel</button></div></div>`).join('');
    const fr = st.friends.slice().sort((a, b) => (SO.isOnline(b.uid) - SO.isOnline(a.uid)) || a.name.localeCompare(b.name));
    const friends = fr.map(f => {
      const p = st.profiles[f.uid] || {}, n = offersIn().filter(t => t.from === f.uid).length + invitesIn().filter(b => b.a === f.uid).length;
      return `<button class="row f-row" data-do="friend" data-id="${esc(f.uid)}">${avatarImg(p.avatar)}${dot(f.uid)}
        <div class="row-main"><div class="row-title">${esc(f.name)}${SO.unread(f) ? ' <span class="f-new">new message</span>' : ''}</div>
        <div class="row-sub">${esc(statusText(f.uid))}${p.level ? ` · Lv ${p.level}` : ''}${p.badges ? ` · ${p.badges} badge${p.badges === 1 ? '' : 's'}` : ''}</div></div>
        <div class="row-side">${n ? `<span class="tab-dot">${n}</span>` : ''}${I('chevron')}</div></button>`;
    }).join('');
    return `<div class="f-me"><small>Your player name</small><b>${esc(save.name)}</b><span>Friends find you by this name.</span></div>
      <form class="field" data-form="fsearch"><input id="friendSearch" placeholder="Find a player by name" value="${esc(friendQuery)}" autocomplete="off" spellcheck="false" maxlength="${data.settings.nameMax}"><button class="btn btn-primary" type="submit">${I('search')}Search</button></form>
      <div id="fResults">${results}</div>
      ${inv || reqIn ? `<div class="sec-label">Waiting for you</div>${inv}${reqIn}` : ''}
      <div class="sec-label">Friends · ${fr.length} · ${fr.filter(f => SO.isOnline(f.uid)).length} online</div>
      ${friends || empty('users', 'No friends yet', 'Search for a player by name and send a friend request.')}
      ${reqOut ? `<div class="sec-label">Requests you sent</div>${reqOut}` : ''}`;
  }

  function friendPageHTML(f) {
    const p = SO.state.profiles[f.uid] || {}, online = SO.isOnline(f.uid);
    if (chatPair !== f.id) openChat(f.id);
    const myInvite = invitesOut().find(b => b.b === f.uid), theirInvite = invitesIn().find(b => b.a === f.uid);
    const battle = theirInvite ? `<div class="f-box"><p><b>${esc(f.name)}</b> challenges you to a live battle!</p>
        <div class="f-actions"><button class="btn" data-do="b-decline" data-id="${esc(theirInvite.id)}">Not now</button><button class="btn btn-primary" data-do="b-accept" data-id="${esc(theirInvite.id)}">${I('swords')}Battle</button></div></div>`
      : myInvite ? `<div class="f-box"><p>Waiting for <b>${esc(f.name)}</b> to accept your battle…</p><div class="f-actions"><button class="btn" data-do="b-cancel" data-id="${esc(myInvite.id)}">Cancel</button></div></div>`
      : `<button class="btn btn-primary f-big" data-do="b-invite" data-id="${esc(f.uid)}">${I('swords')}Challenge to a live battle</button>${online ? '' : `<p class="muted" style="margin:6px 0 0">${esc(f.name)} is offline, so they’ll see it next time they play.</p>`}`;
    const inOffer = offersIn().find(t => t.from === f.uid), outOffer = offersOut().find(t => t.to === f.uid);
    const mine = tradeable();
    const picker = (act, id) => mine.length ? `<div class="t-grid">${mine.map(e => { const sp = speciesOf(e.species) || { name: e.species };
        return `<button class="t-pick" data-do="${act}" data-id="${esc(id)}" data-uid="${esc(e.uid)}">${avatarImg(e.species)}<b>${esc(e.nickname || sp.name)}</b><small>Lv ${e.level}</small></button>`; }).join('')}</div>`
      : '<p class="muted" style="text-align:left">You need at least 2 Pokémon to trade (your partner on the home screen stays with you).</p>';
    const trade = inOffer ? `<div class="f-box"><p><b>${esc(f.name)}</b> offers:</p>${entryCard(inOffer.offer)}<p style="margin-top:10px">Pick one of yours to give back:</p>${picker('t-accept', inOffer.id)}
        <div class="f-actions"><button class="btn" data-do="t-decline" data-id="${esc(inOffer.id)}">Decline</button></div></div>`
      : outOffer ? `<div class="f-box"><p>You offered:</p>${entryCard(outOffer.offer)}<p class="muted" style="text-align:left">Waiting for ${esc(f.name)} to pick one of theirs…</p>
        <div class="f-actions"><button class="btn" data-do="t-cancel" data-id="${esc(outOffer.id)}">Take it back</button></div></div>`
      : tradePicking ? `<div class="f-box"><p>Which Pokémon do you want to offer?</p>${picker('t-offer', f.uid)}<div class="f-actions"><button class="btn" data-do="t-pick" data-id="0">Cancel</button></div></div>`
      : `<button class="btn f-big" data-do="t-pick" data-id="1">${I('box')}Offer a Pokémon to trade</button>`;
    return `<button class="f-back" data-do="friend" data-id="">${I('chevron')}Friends</button>
      <div class="f-head">${avatarImg(p.avatar)}<div><b>${esc(f.name)}</b><span>${dot(f.uid)}${esc(statusText(f.uid))}${p.level ? ` · Trainer Lv ${p.level}` : ''}</span>
        <small>${p.caught ? `${p.caught} Pokémon caught` : ''}${p.badges ? ` · ${p.badges} badge${p.badges === 1 ? '' : 's'}` : ''}</small></div></div>
      <div class="sec-label">Battle</div>${battle}
      <div class="sec-label">Trade</div>${trade}
      <div class="sec-label">Chat</div>
      <div class="chat-log" id="chatLog">${chatHTML()}</div>
      <form class="field" data-form="chat"><input id="chatInput" placeholder="Message ${esc(f.name)}" maxlength="300" autocomplete="off"><button class="btn btn-primary" type="submit">Send</button></form>
      <button class="f-remove" data-do="f-remove" data-id="${esc(f.uid)}">Remove friend</button>`;
  }
  function chatHTML() {
    if (!chatMsgs.length) return '<p class="muted">No messages yet. Say hi!</p>';
    const me = PP.Cloud.user.uid;
    return chatMsgs.map(m => `<div class="msg${m.from === me ? ' me' : ''}"><span>${esc(m.text)}</span><small>${esc(agoText(SO.ms(m.at) || Date.now()))}</small></div>`).join('');
  }
  function openChat(pair) {
    if (chatUnsub) chatUnsub();
    chatPair = pair; chatMsgs = [];
    chatUnsub = SO.openChat(pair, list => {
      chatMsgs = list; SO.markRead(pair);
      const log = $('chatLog');
      if (log) { log.innerHTML = chatHTML(); log.scrollTop = log.scrollHeight; }
    });
  }
  function closeChat() { if (chatUnsub) chatUnsub(); chatUnsub = null; chatPair = null; chatMsgs = []; }
  async function runFriendSearch(q) {
    friendQuery = q; friendResults = null;
    if (!q.trim()) { renderSheet(); return; }
    try { friendResults = await SO.search(q); } catch (e) { friendResults = []; toast('Search didn’t work. Try again.'); }
    const r = $('fResults'); if (r && sheetKind === 'party') renderSheet();
  }

  // ---- trades: the save only changes on this player's own device
  function takeOut(uid) {
    const e = save.box.find(x => x.uid === uid); if (!e) return null;
    save.box = save.box.filter(x => x.uid !== uid);
    save.team = save.team.filter(x => x !== uid);
    if (!save.team.length && save.partner) save.team = [save.partner];
    if (save.avatar === e.species && !save.box.some(x => x.species === e.species)) save.avatar = '';
    return e;
  }
  function putIn(entry, from) {
    const sp = speciesOf(entry.species); if (!sp) return null;
    const e = { uid: newUid(), species: sp.id, nickname: entry.nickname || '', since: Date.now(), level: entry.level, exp: entry.exp, hp: null, caughtAt: from };
    save.box.push(e);
    if (save.team.length < data.settings.teamMax) save.team.push(e.uid);
    save.dex.seen[sp.id] = save.dex.seen[sp.id] || Date.now(); save.dex.caught[sp.id] = save.dex.caught[sp.id] || Date.now();
    return e;
  }
  const plain = e => ({ species: e.species, level: e.level, exp: e.exp, nickname: e.nickname || '' });
  async function offerTrade(friendUid, entryUid) {
    const f = SO.friend(friendUid), e = save.box.find(x => x.uid === entryUid);
    if (!f || !e || !tradeable().includes(e)) return;
    try {
      const ref = await SO.offerTrade(f.uid, f.name, plain(e));
      handled.add(ref.id); takeOut(e.uid); save.tradesDone[ref.id] = 'offered';
      S.log('pokemon', `Offered ${labelOf(e)} to ${f.name} in a trade`);
      tradePicking = false; commit(); toast(`Offer sent to ${f.name}`);
    } catch (err) { toast('Couldn’t send the offer. Try again.'); }
  }
  async function acceptTrade(id, entryUid) {
    const t = SO.state.tradesIn.find(x => x.id === id), e = save.box.find(x => x.uid === entryUid);
    if (!t || !e || !tradeable().includes(e)) return;
    let ok = false;
    try { ok = await SO.acceptTrade(id, plain(e)); } catch (err) { return toast('Couldn’t trade. Try again.'); }
    if (!ok) return toast(`${t.fromName} took the offer back.`);
    takeOut(e.uid); const got = putIn(t.offer, `Traded from ${t.fromName}`);
    save.tradesDone[id] = 'received';
    S.log('pokemon', `Traded ${labelOf(e)} to ${t.fromName} for ${got ? labelOf(got) : t.offer.species}`);
    commit(); PP.Audio.sfx('catch'); if (got) setTimeout(() => { const gs = speciesOf(got.species); if (gs) PP.Audio.cry(gs.folder, false, gs.id); }, 700);
    toast(`Trade complete! ${got ? labelOf(got) : 'Your new Pokémon'} joined you.`);
  }
  async function cancelTrade(id) {
    const t = SO.state.tradesOut.find(x => x.id === id); if (!t) return;
    let ok = false;
    try { ok = await SO.cancelTrade(id); } catch (err) { return toast('Couldn’t take it back. Try again.'); }
    if (!ok) return;                       // they accepted first; the trade finishes below
    putIn(t.offer, 'Returned from a trade'); save.tradesDone[id] = 'cancelled';
    S.log('pokemon', `Took back a trade offer to ${t.toName}`); commit(); toast('Offer taken back');
  }
  /** finish your side of trades your friends answered (also catches up after being away) */
  function settleTrades() {
    let changed = false;
    SO.state.tradesOut.forEach(t => {
      const done = save.tradesDone[t.id];
      if (t.status === 'accepted' && done !== 'done' && t.give) {
        const got = putIn(t.give, `Traded from ${t.toName}`);
        save.tradesDone[t.id] = 'done'; changed = true;
        S.log('pokemon', `Trade with ${t.toName} complete: got ${got ? labelOf(got) : t.give.species}`);
        toast(`${t.toName} accepted your trade! ${got ? labelOf(got) : 'A new Pokémon'} joined you.`); PP.Audio.sfx('catch');
        SO.closeTrade(t.id, 'done').catch(() => {});
      } else if (t.status === 'declined' && done !== 'returned' && done !== 'cancelled') {
        putIn(t.offer, 'Returned from a trade'); save.tradesDone[t.id] = 'returned'; changed = true;
        toast(`${t.toName} declined your trade. Your Pokémon came back.`);
        SO.closeTrade(t.id, 'closed').catch(() => {});
      }
    });
    if (changed) commit();
  }

  // ---- live battles
  const myTeamSnapshot = () => teamEntries().slice(0, data.settings.teamMax).map(plain);
  function startPvp(b, side) {
    if (pvpOn || storyOn()) return;
    handled.add(b.id); pvpOn = b.id;
    const other = side === 'a' ? 'b' : 'a', name = b.names[other], otherUid = b[other];
    closeSheet(true); setCare(false); closeChat();
    const layer = $('battleLayer'); layer.hidden = false;
    PP.Audio.play(data.settings.musicTrainer);
    const pick = id => (data.backgrounds.find(x => x.id === id) || {}).image;
    PP.Battle.start({
      root: layer, data, kind: 'pvp', bag: {}, trainer: { name, prize: 0 },
      team: (b.teams[side] || []).map(e => Object.assign({}, e, { hp: null, uid: newUid() })),
      foes: (b.teams[other] || []).map(e => ({ species: e.species, level: e.level })),
      backgrounds: [pick(data.settings.battleBgGym), pick(data.settings.battleBgLand)].filter(Boolean),
      pvp: { side, seed: b.seed, exchange: (turn, choice) => SO.exchange(b.id, side, turn, choice) },
      onEnd: r => {
        layer.hidden = true; layer.innerHTML = ''; pvpOn = null;
        PP.Audio.play(data.settings.musicHome);
        const won = r.outcome === 'won', lost = r.outcome === 'lost';
        SO.endBattle(b.id, won ? PP.Cloud.user.uid : lost ? otherUid : 'draw');
        S.log('battle', `Live battle with ${name}: ${won ? 'won' : lost ? 'lost' : 'draw'}`);
        if (won) bump('battle:win');
        commit();
      },
    });
  }
  async function inviteBattle(uid) {
    const f = SO.friend(uid); if (!f) return;
    const team = myTeamSnapshot(); if (!team.length) return toast('You need a Pokémon in your team first.');
    try { await SO.challenge(f.uid, f.name, team); toast(`Challenge sent to ${f.name}`); } catch (e) { toast('Couldn’t send the challenge. Try again.'); }
  }
  async function acceptBattle(id) {
    const b = SO.state.battlesIn.find(x => x.id === id); if (!b) return;
    const team = myTeamSnapshot(); if (!team.length) return toast('You need a Pokémon in your team first.');
    try { await SO.acceptBattle(id, team); } catch (e) { return toast('Couldn’t join the battle. Try again.'); }
    startPvp(Object.assign({}, b, { teams: { a: b.teams.a, b: team } }), 'b');
  }
  /** react to friends' requests, trades and battles */
  const seenAlerts = new Set();
  function onSocial() {
    settleTrades();
    SO.state.battlesOut.forEach(b => {      // your challenge was accepted: start
      if (b.status === 'active' && !handled.has(b.id) && fresh(b, 2)) startPvp(b, 'a');
      if (b.status === 'declined' && !seenAlerts.has('d' + b.id) && fresh(b, 5)) { seenAlerts.add('d' + b.id); toast(`${b.names.b} can’t battle right now.`); }
    });
    const note = (key, text) => { if (!seenAlerts.has(key)) { seenAlerts.add(key); if (!firstSocial) { toast(text); PP.Audio.sfx('pop'); } } };
    SO.state.reqIn.forEach(r => note('r' + r.id, `${r.fromName} sent you a friend request`));
    invitesIn().forEach(b => note('b' + b.id, `${b.names.a} challenges you to a battle!`));
    offersIn().forEach(t => note('t' + t.id, `${t.fromName} offered you a trade`));
    SO.state.friends.forEach(f => { if (SO.unread(f) && f.id !== chatPair) note('m' + f.id + SO.ms(f.last.at), `${f.name}: ${f.last.text.slice(0, 60)}`); });
    firstSocial = false;
    updateFriendsBadge();
    if (sheetKind === 'party') renderSheet();
  }
  let firstSocial = true;
  function updateFriendsBadge() {
    const tab = document.querySelector('.tab[data-kind="party"]'); if (!tab) return;
    let b = tab.querySelector('.tab-badge'); const n = friendAlerts();
    if (!b) { b = document.createElement('span'); b.className = 'tab-badge'; tab.appendChild(b); }
    b.textContent = n > 9 ? '9+' : n; b.hidden = !n;
  }

  // ---------------- reset the whole game (Profile & settings) ----------------
  let resetOpen = false;
  async function resetGame(typed) {
    const name = save.name;
    if (String(typed || '').trim().toLowerCase() !== String(name).trim().toLowerCase()) { $('resetErr').textContent = 'That doesn’t match your name. Type it exactly to confirm.'; return; }
    const btn = document.querySelector('[data-form="reset"] .btn-danger'); if (btn) { btn.disabled = true; btn.textContent = 'Resetting…'; }
    S.log('system', `${name} reset their game; the name is free again`);
    S.releaseName(name);
    if (PP.Cloud.on) await PP.Cloud.releaseName(name);
    save = S.newSave(data);                    // also what gets written when the page closes
    persist();
    if (PP.Cloud.on && PP.Cloud.flush) await Promise.race([PP.Cloud.flush(), new Promise(r => setTimeout(r, 4000))]);
    location.reload();
  }

  // ---------------- PC box: team slots and Pokémon details ----------------
  let boxSlot = null, boxDetail = null, boxSort = 'new';
  /** put a box Pokémon into team slot k (0 = Main); swaps with whoever was there */
  function placeInSlot(uid, k) {
    const e = save.box.find(x => x.uid === uid); if (!e) return;
    const team = save.team.slice(), cur = team.indexOf(uid);
    if (k < team.length) {
      if (cur >= 0) { team[cur] = team[k]; team[k] = uid; }
      else { const out = team[k]; team[k] = uid; if (k === 0 && team.length < data.settings.teamMax) team.push(out); }   // the old main stays in the team if there's room
    } else if (cur < 0) { if (team.length >= data.settings.teamMax) return toast('Your team is full'); team.push(uid); }
    else return;                                                     // already in the team
    save.team = team.filter(Boolean);
    const wasMain = save.partner; save.partner = save.team[0];
    S.log('pokemon', k === 0 ? `${labelOf(e)} is now the main Pokémon` : `${labelOf(e)} is in backup slot ${Math.min(k, save.team.length - 1)}`);
    if (save.partner !== wasMain) { P.x = P.tx = 0.5; P.act = null; const ms = speciesOf(e.species); if (ms) { PP.Sprite.preload(ms.folder); PP.Audio.cry(ms.folder, false, ms.id); } }
    boxSlot = null; commit();
  }
  /** say goodbye to a Pokémon for good (not the main one, and never the last one) */
  function release(uid) {
    const e = save.box.find(x => x.uid === uid); if (!e) return;
    if (uid === save.team[0]) return toast('Your main Pokémon can’t be released. Choose another main first.');
    if (save.box.length <= 1) return toast('You can’t release your last Pokémon.');
    if (!confirm(`Release ${labelOf(e)} (Lv ${e.level})? It will return to the wild and can’t be brought back.`)) return;
    save.box = save.box.filter(x => x.uid !== uid);
    save.team = save.team.filter(x => x !== uid);
    if (save.avatar === e.species && !save.box.some(x => x.species === e.species)) save.avatar = '';
    S.log('pokemon', `Released ${labelOf(e)} (Lv ${e.level}) back into the wild`);
    boxDetail = null; commit(); toast(`${labelOf(e)} was released. Bye bye!`);
  }
  function teamOut(k) {
    if (k === 0) return toast('Your main Pokémon can’t be removed. Choose another main first.');
    const uid = save.team[k], e = save.box.find(x => x.uid === uid); if (!e) return;
    save.team = save.team.filter((_, i) => i !== k);
    S.log('pokemon', `${labelOf(e)} went back to the PC box`); commit();
  }
  function boxDetailHTML(e, icon) {
    const sp = speciesOf(e.species), m = PP.Battle.build(data, Object.assign({}, e)), ti = save.team.indexOf(e.uid);
    const lo = S.expForLevel(sp.growth, e.level), hi = S.expForLevel(sp.growth, e.level + 1), expPct = e.level >= 100 ? 100 : Math.round((e.exp - lo) / Math.max(1, hi - lo) * 100);
    const stat = (label, v, top) => `<div class="st-row"><span>${label}</span><b class="tnum">${v}</b><span class="st-bar"><i style="width:${Math.min(100, v / top * 100)}%"></i></span></div>`;
    const top = Math.max(60, m.atk, m.def, m.spa, m.spd, m.spe) * 1.1;
    const types = m.types.map(t => `<span class="type-chip" style="--c:${(PP.TYPES || {})[t] || '#888'}">${esc(t)}</span>`).join('');
    const days = Math.max(1, Math.ceil((Date.now() - e.since) / 86400000));
    return `<div class="box-detail" role="dialog" aria-label="${esc(labelOf(e))}">
      <div class="bd-scrim" data-do="cell-close"></div>
      <div class="bd-card">
        <button class="icon-btn sm bd-close" data-do="cell-close" aria-label="Close">${I('close')}</button>
        <div class="bd-head"><span class="bd-pic">${PP.Sprite.portrait(sp.folder) ? `<img class="pix" src="${PP.Sprite.portrait(sp.folder)}" alt="">` : I('pokeball')}</span>
          <div><b>${esc(labelOf(e))}</b><span>${e.nickname ? esc(sp.name) + ' · ' : ''}#${String(sp.dex).padStart(3, '0')} · Lv ${e.level}</span><div class="bd-types">${types}</div></div></div>
        <div class="bd-actions top">
          ${ti === 0 ? '<span class="qty main-tag">★ Your main Pokémon</span>' : `<button class="btn btn-primary" data-do="make-main" data-id="${esc(e.uid)}">${I('star')}Make main</button>`}
          ${ti > 0 ? `<button class="btn" data-do="team-out" data-id="${ti}">Remove from team</button>`
            : ti < 0 ? `<button class="btn btn-primary" data-do="team-add" data-id="${esc(e.uid)}" ${save.team.length >= data.settings.teamMax ? 'disabled' : ''}>Add to team</button>` : ''}
          ${icon === sp.id ? '<span class="qty">Profile icon</span>' : `<button class="btn btn-sm" data-do="avatar" data-id="${esc(sp.id)}">Use as icon</button>`}
        </div>
        <div class="bd-line"><span>EXP</span><span class="st-bar wide"><i style="width:${expPct}%;background:var(--accent)"></i></span><small>${expPct}%</small></div>
        <div class="bd-line"><span>HP</span><span class="st-bar wide"><i style="width:${hpOf(e) / maxHp(e) * 100}%;background:var(--good)"></i></span><small class="tnum">${Math.floor(hpOf(e))}/${maxHp(e)}</small></div>
        <div class="bd-stats">${stat('Attack', m.atk, top)}${stat('Defense', m.def, top)}${stat('Sp. Atk', m.spa, top)}${stat('Sp. Def', m.spd, top)}${stat('Speed', m.spe, top)}</div>
        <div class="bd-moves">${m.moves.map(mv => `<span class="bd-move" style="--c:${(PP.TYPES || {})[mv.type] || '#888'}"><b>${esc(mv.name)}</b><small>${esc(mv.type)} · ${mv.power || '—'} power</small></span>`).join('')}</div>
        <p class="muted" style="text-align:left;margin:8px 0 12px">${e.caughtAt ? `From ${esc(e.caughtAt)} · ` : ''}with you ${days} day${days === 1 ? '' : 's'}</p>
        <form class="field" data-form="nick" data-uid="${esc(e.uid)}"><input id="nickInput" maxlength="16" placeholder="Nickname (${esc(sp.name)})" value="${esc(e.nickname)}" autocomplete="off"><button class="btn" type="submit">Save</button></form>
        ${ti !== 0 && save.box.length > 1 ? `<button class="bd-release" data-do="release" data-id="${esc(e.uid)}">Release ${esc(labelOf(e))}</button>` : ''}
      </div></div>`;
  }

  /** the badges of a chapter's region (each region has its own badge case) */
  const regionBadges = ch => data.badges.filter(b => (b.region || 'lumera') === ((ch && ch.region) || 'lumera'));
  /** Explore → Story: the current chapter's checklist, what's next, and the badge case */
  function storyHTML() {
    const ch = PP.Story.currentChapter(data, save), cur = PP.Story.current(data, save);
    if (!ch) return empty('flag', 'No story yet', 'The story is coming soon.');
    const steps = PP.Story.chapterSteps(data, ch.id), done = steps.filter(x => save.story.done[x.id]).length;
    const ICON = { scene: 'megaphone', arrive: 'pin', heal: 'heart', trainer: 'swords', wild: 'paw' };
    const detail = st => {
      if (st.type === 'trainer') { const t = data.trainers.find(x => x.id === st.trainer); return t ? PP.Story.team(data, save, t).map(f => `${(speciesOf(f.species) || {}).name} Lv ${f.level}`).join(' · ') : ''; }
      if (st.type === 'wild') { const sp = speciesOf(st.species); return sp ? `${sp.name} Lv ${st.level}${st.mustCatch ? ' · catch it' : ''}` : ''; }
      return (locOf(st.area) || {}).name || '';
    };
    // a short list: the last finished step, the current one and a few ahead (all of them on request)
    const ci = cur ? steps.findIndex(x => x.id === cur.id) : steps.length;
    const shown = storyAll ? steps : steps.filter((x, i) => i >= ci - 1 && i <= ci + 3);
    const rows = shown.map(st => {
      const isDone = !!save.story.done[st.id], isCur = cur && cur.id === st.id;
      const inner = `<span class="step-ic">${I(isDone ? 'check' : isCur ? ICON[st.type] || 'flag' : 'lock')}</span>
        <span class="step-main"><b>${esc(st.title)}</b><small>${esc(detail(st))}</small></span>${isCur ? `<span class="step-play">${I('chevron')}</span>` : ''}`;
      return isCur ? `<li class="step cur"><button class="step-btn" data-do="story-go">${inner}</button></li>` : `<li class="step${isDone ? ' done' : ' later'}">${inner}</li>`;
    }).join('');
    const more = steps.length > shown.length || storyAll ? `<button class="steps-more" data-do="story-all">${storyAll ? 'Show fewer steps' : `Show all ${steps.length} steps`}</button>` : '';
    const label = !cur ? '' : cur.type === 'trainer' ? `Battle ${esc(PP.Story.trainerName(data.trainers.find(x => x.id === cur.trainer) || { trainerClass: '', name: 'trainer' }))}`
      : cur.type === 'wild' ? 'Continue: wild Pokémon ahead' : cur.type === 'arrive' ? `Travel to ${esc((locOf(cur.area) || {}).name || 'the next area')}` : 'Continue the journey';
    const gymInChapter = steps.map(st => data.trainers.find(x => x.id === st.trainer)).find(t => t && t.badge !== 'none');
    const badge = gymInChapter && data.badges.find(b => b.id === gymInChapter.badge);
    const next = cur ? `<button class="story-next" data-do="story-go">
        <span class="sn-ic">${I(ICON[cur.type] || 'flag')}</span>
        <span class="sn-main"><small>Next in the story</small><b>${esc(cur.title)}</b><span>${esc(detail(cur))}</span></span>
        <span class="sn-play">Play</span></button>` : '';
    return `${next}<div class="chapter">
        <div class="chapter-top"><span class="chapter-no">${data.regions.filter(r => r.enabled).length > 1 ? esc((data.regions.find(r => r.id === ch.region) || {}).name || '') + ' · ' : ''}Chapter ${ch.number}</span><span class="tnum">${done}/${steps.length}</span></div>
        <h3>${esc(ch.title)}</h3><p>${esc(ch.description)}</p>
        <div class="bar" style="--c:var(--gold)"><i style="width:${steps.length ? done / steps.length * 100 : 0}%"></i></div>
        <ol class="steps">${rows}</ol>${more}
        <div class="chapter-reward">${I('star')}<span>Chapter reward: ${fmt(ch.rewardCoins)} ${esc(coinName())} · ${fmt(ch.rewardGems)} ${esc(gemName())} · ${fmt(ch.rewardExp)} EXP${badge ? ` · ${esc(badge.name)}` : ''}</span></div>
        ${cur ? '' : '<p class="muted" style="margin:12px 0 0">You’ve reached the end of the story so far. More chapters are coming in a later update.</p>'}
      </div>
      <div class="sec-label">${regionBadges(ch).length && data.regions.filter(r => r.enabled).length > 1 ? esc((data.regions.find(r => r.id === ch.region) || {}).name || '') + ' badges' : 'Badges'} · ${regionBadges(ch).filter(b => save.badges[b.id]).length}/${regionBadges(ch).length}</div>
      <div class="badges">${regionBadges(ch).map(b => `<div class="badge${save.badges[b.id] ? ' got' : ''}" style="--c:${b.color}" title="${esc(b.name)}${save.badges[b.id] ? '' : ' (not earned yet)'}">${I('star')}<span>${esc(b.name.replace(/ Badge$/, ''))}</span></div>`).join('')}</div>`;
  }
  /** the Pokédex: every species, seen or caught */
  function dexHTML() {
    const list = data.pokemon.filter(p => PP.Sprite.has(p.folder)).sort((a, b) => a.dex - b.dex);
    const seen = list.filter(p => save.dex.seen[p.id]).length, caught = list.filter(p => save.dex.caught[p.id]).length;
    return `<div class="dex-head"><div><b class="tnum">${seen}</b><small>seen</small></div><div><b class="tnum">${caught}</b><small>caught</small></div><div><b class="tnum">${list.length}</b><small>in all</small></div></div>
      <div class="dex-grid">${list.map(p => {
        const sn = save.dex.seen[p.id], cg = save.dex.caught[p.id], pic = sn && PP.Sprite.portrait(p.folder);
        return `<div class="dex-cell${sn ? '' : ' unseen'}" title="${sn ? esc(p.name) : 'Not seen yet'}">
          <span class="dex-no tnum">${String(p.dex).padStart(3, '0')}</span>${cg ? `<span class="dex-caught">${I('pokeball')}</span>` : ''}
          ${pic ? `<img src="${pic}" alt="" loading="lazy">` : '<span class="dex-q">?</span>'}
          <span class="dex-name">${sn ? esc(p.name) : '???'}</span></div>`;
      }).join('')}</div>`;
  }
  function openSheet(kind) {
    if (sheetKind === 'starter' && kind !== 'starter') return;      // pick a starter first
    if (kind === 'explore' && !data.settings.exploreOpen) return toast('Exploring is closed right now');
    if (kind === 'shop' && !data.settings.shopOpen) return toast('The shop is closed right now');
    if (kind === 'starter') data.pokemon.filter(p => p.starter).forEach(p => PP.Sprite.preload(p.folder, ['Idle', 'Hop']));
    if (kind === 'quests' && sheetKind !== 'quests') questTab = null;    // open on the tab with something to claim
    sheetKind = kind; $('sheet').hidden = false;
    $('sheet').classList.toggle('locked', kind === 'starter');
    $('sheetClose').hidden = kind === 'starter';
    renderSheet();
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.kind === kind));
  }
  /** close the open sheet; the starter screen only closes once a Pokémon is chosen (force) */
  function closeSheet(force) {
    if (sheetKind === 'starter' && force !== true) return;
    if (sheetKind === 'party') closeChat();
    sheetKind = null; $('sheet').hidden = true; $('sheet').classList.remove('locked');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  }
  function renderSheet() {
    if (!sheetKind || !SHEETS[sheetKind]) return;
    const body = $('sheetBody'), scroll = body.scrollTop;
    const a = document.activeElement;
    if (a && (a.id === 'nameInput' || a.id === 'petNameInput' || a.id === 'nickInput' || a.id === 'resetName' || a.id === 'rivalInput')) return;   // don't wipe what's being typed
    if (sheetKind === 'party' && a && (a.id === 'chatInput' || a.id === 'friendSearch')) return;
    if (sheetKind === 'shop' && a && a.id === 'shopSearch' && $('shopGrid')) { refreshShop(); return; }
    const v = SHEETS[sheetKind]();
    $('sheetTitle').textContent = v.title;
    body.innerHTML = v.body;
    body.scrollTop = scroll;
  }

  /** update the shop's tabs and grid without rebuilding the search box */
  function refreshShop() {
    const g = $('shopGrid'), t = $('catTabs');
    if (g) g.innerHTML = shopGridHTML();
    if (t) t.innerHTML = shopTabsHTML();
    const w = document.querySelector('.shop-wallet');
    if (w) w.innerHTML = priceTag(save.coins, 'coins') + priceTag(save.gems, 'gems');
  }

  // ---------------- toasts ----------------
  function toast(text) {
    const box = $('toasts'), el = document.createElement('div');
    el.className = 'toast'; el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 260); }, 2200);
  }

  // ---------------- input ----------------
  document.addEventListener('click', e => {
    if (Date.now() < ignoreClicksUntil) return;          // the release after a press-and-hold isn't a tap
    // the Professor's text box sits over everything: a tap moves the story on
    if (e.target.closest('#story')) {
      if (e.target.closest('[data-do="skip-tour"]')) finishTour();
      else if (!e.target.closest('form, input, button')) advanceStory();
      return;
    }
    const b = e.target.closest('[data-do]'); if (!b) return;
    const id = b.dataset.id;
    switch (b.dataset.do) {
      case 'care': setCare(!careOpen); update(); break;
      case 'pick-starter': { starterPick = id; renderSheet(); const sp = speciesOf(id); if (sp) PP.Audio.cry(sp.folder, false, sp.id); break; }
      case 'partner': setPartner(id); break;
      case 'team': toggleTeam(id); break;
      case 'heal': { const l = locOf(id); healTeam(l ? `at ${l.name}` : ''); bump('heal'); commit(); toast('Your team is fully healed!'); PP.Audio.sfx('heal'); break; }
      case 'region': exploreRegion = id; renderSheet(); break;
      case 'explore-tab': exploreTab = id; renderSheet(); break;
      case 'story-all': storyAll = !storyAll; renderSheet(); break;
      case 'quest-toggle': e.stopPropagation(); questOpen = !questOpen; try { localStorage.setItem('pp2.questOpen', questOpen ? '1' : ''); } catch (err) {} sig.quest = null; update(); break;
      case 'team-empty': toast('Tap a Pokémon in your PC box below, then “Add to team”.'); break;
      case 'quest-tab': questTab = id; renderSheet(); $('sheetBody').scrollTop = 0; break;
      case 'story-open': exploreTab = 'story'; openSheet('explore'); break;
      case 'story-go': runStep(PP.Story.current(data, save)); break;
      case 'wild': { const l = locOf(id); if (l) explore(l, true); break; }
      case 'pals-view': palsView = id; renderSheet(); break;
      case 'avatar': setAvatar(id); break;
      case 'choose-starter': { const sp = data.pokemon.find(p => p.id === starterPick); if (sp) choose(sp); break; }
      case 'cat': {
        shopCat = id; shopQuery = '';
        const s = $('shopSearch'); if (s) s.value = '';
        refreshShop(); $('sheetBody').scrollTop = 0;
        break;
      }
      case 'act': { const a = data.actions.find(x => x.id === id); if (a) doAction(a); break; }
      case 'sheet': openSheet(b.dataset.kind); break;
      case 'close': closeSheet(); resetOpen = false; break;
      case 'reset-start': resetOpen = true; renderSheet(); setTimeout(() => { const i = $('resetName'); if (i) i.focus(); }, 50); break;
      case 'reset-cancel': resetOpen = false; renderSheet(); break;
      case 'slot': boxSlot = boxSlot === +id ? null : +id; boxDetail = null; renderSheet(); break;
      case 'slot-cancel': boxSlot = null; renderSheet(); break;
      case 'cell': if (longPressed) { longPressed = false; break; } if (boxSlot != null) placeInSlot(id, boxSlot); else { boxDetail = id; renderSheet(); } break;
      case 'cell-close': boxDetail = null; renderSheet(); break;
      case 'box-sort': boxSort = id; renderSheet(); break;
      case 'make-main': placeInSlot(id, 0); boxDetail = id; renderSheet(); break;
      case 'team-add': placeInSlot(id, save.team.length); boxDetail = id; renderSheet(); break;
      case 'team-out': teamOut(+id); renderSheet(); break;
      case 'release': release(id); break;
      case 'walk-leave': if (walk && !walk.done && confirm('Head back now? You won’t get this trip’s rewards.')) { S.log('explore', `Left ${walk.l.name} early`); endWalk(true); } break;
      case 'walk-close': endWalk(true); break;
      case 'friend': friendView = id || null; tradePicking = false; if (!friendView) closeChat(); renderSheet(); $('sheetBody').scrollTop = 0; break;
      case 'f-add': SO.sendRequest(id, b.dataset.name).then(() => toast('Friend request sent'), () => toast('Couldn’t send the request. Try again.')); break;
      case 'r-accept': { const r = SO.state.reqIn.find(x => x.id === id); if (r) SO.accept(r).then(() => toast(`You and ${r.fromName} are now friends!`), () => toast('Couldn’t accept. Try again.')); break; }
      case 'r-decline': { const r = SO.state.reqIn.concat(SO.state.reqOut).find(x => x.id === id); if (r) SO.decline(r).catch(() => {}); break; }
      case 'f-remove': { const f = SO.friend(id); if (f && confirm(`Remove ${f.name} from your friends?`)) { SO.unfriend(f).catch(() => {}); friendView = null; closeChat(); renderSheet(); } break; }
      case 'b-invite': inviteBattle(id); break;
      case 'b-accept': acceptBattle(id); break;
      case 'b-decline': SO.declineBattle(id).catch(() => {}); break;
      case 'b-cancel': SO.cancelBattle(id).catch(() => {}); break;
      case 't-pick': tradePicking = id === '1'; renderSheet(); break;
      case 't-offer': offerTrade(id, b.dataset.uid); break;
      case 't-accept': acceptTrade(id, b.dataset.uid); break;
      case 't-decline': SO.declineTrade(id).catch(() => {}); break;
      case 't-cancel': cancelTrade(id); break;
      case 'sign-out': persist(); PP.Cloud.signOut(); break;
      case 'claim': { e.stopPropagation(); const q = data.quests.find(x => x.id === id); if (q) claim(q); break; }
      case 'explore': { const l = locOf(id); if (l) explore(l); break; }
      case 'buy': { const it = itemOf(id); if (it) buy(it); break; }
      case 'sell': { const it = itemOf(id); if (it) sell(it); break; }
      case 'use': { const it = itemOf(id); if (it) useItem(it); break; }
    }
  });
  document.addEventListener('change', e => {
    const k = e.target.dataset && e.target.dataset.audio;
    if (k) { PP.Audio.setPrefs({ [k]: e.target.checked }); if (k === 'music' && e.target.checked) PP.Audio.play(battleCtx ? battleMusic(battleCtx.trainer) : data.settings.musicHome); }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'shopSearch') { shopQuery = e.target.value; refreshShop(); $('sheetBody').scrollTop = 0; }
  });
  document.addEventListener('submit', e => {
    if (e.target.dataset.form === 'name') {
      e.preventDefault();
      rename($('nameInput').value).then(why => {
        $('nameErr').textContent = why || '';
        if (!why) $('nameInput').blur();
      });
    }
    if (e.target.dataset.form === 'rname') { e.preventDefault(); submitRival($('rnameInput').value); }
    if (e.target.dataset.form === 'rival') {
      e.preventDefault();
      const name = String($('rivalInput').value || '').trim().replace(/\s+/g, ' '), why = rivalWhy(name);
      $('rivalErr').textContent = why || '';
      if (!why && name !== save.rivalName) { setRival(name); $('rivalInput').blur(); commit(); toast(`Your rival is now ${name}`); }
    }
    if (e.target.dataset.form === 'reset') { e.preventDefault(); resetGame($('resetName').value); }
    if (e.target.dataset.form === 'nick') {
      e.preventDefault();
      const x = save.box.find(b => b.uid === e.target.dataset.uid), v = String($('nickInput').value || '').trim().slice(0, 16);
      if (x && v !== x.nickname) { S.log('pokemon', v ? `Nicknamed ${(speciesOf(x.species) || {}).name} “${v}”` : 'Removed a nickname'); x.nickname = v; $('nickInput').blur(); commit(); toast('Nickname saved'); }
    }
    if (e.target.dataset.form === 'fsearch') { e.preventDefault(); runFriendSearch($('friendSearch').value); }
    if (e.target.dataset.form === 'chat') {
      e.preventDefault();
      const i = $('chatInput'), text = i.value.trim();
      if (text && chatPair) { i.value = ''; SO.sendMessage(chatPair, text).catch(() => { i.value = text; toast('Message not sent. Try again.'); }); }
    }
    if (e.target.dataset.form === 'pname') { e.preventDefault(); submitName($('pnameInput').value); }
    if (e.target.dataset.form === 'petname') { e.preventDefault(); const i = $('petNameInput'); i.blur(); renamePet(i.value); }
  });
  document.addEventListener('keydown', e => {
    if (storyOn() && story.mode === 'talk' && (e.key === 'Enter' || e.key === ' ') && !e.target.closest('input, textarea')) {
      e.preventDefault(); advanceStory(); return;
    }
    if (e.key === 'Escape' && sheetKind) closeSheet();
    if ((e.key === 'Enter' || e.key === ' ') && e.target.id === 'questCard') { e.preventDefault(); openSheet('quests'); }
  });

  // ---------------- PC box: press and hold a Pokémon for its details ----------------
  let pressTimer = null, longPressed = false, ignoreClicksUntil = 0;
  document.addEventListener('pointerdown', e => {
    const c = e.target.closest('.box-cell'); if (!c) return;
    clearTimeout(pressTimer); longPressed = false;
    pressTimer = setTimeout(() => { longPressed = false; ignoreClicksUntil = Date.now() + 450; boxDetail = c.dataset.id; if (navigator.vibrate) navigator.vibrate(15); renderSheet(); }, 420);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(ev => document.addEventListener(ev, () => clearTimeout(pressTimer), true));
  document.addEventListener('contextmenu', e => { if (e.target.closest('.box-cell')) e.preventDefault(); });

  // ---------------- no zooming on phones ----------------
  // iOS Safari ignores the viewport's no-zoom setting, so double-taps and pinches are stopped here.
  let lastTouchEnd = 0;
  document.addEventListener('touchend', e => {
    const now = Date.now();
    if (now - lastTouchEnd < 320 && !e.target.closest('button, a, label, input, textarea, select, [data-do], [data-gate], [data-b]')) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  // the Home Screen app never scrolls as a whole page (pulling it down used to slide the game around)
  if (document.documentElement.classList.contains('ios-standalone')) document.addEventListener('touchmove', e => {
    if (!e.target.closest('.sheet-body, .chat-log, .cat-tabs, .menu, .list, textarea')) e.preventDefault();
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(ev => document.addEventListener(ev, e => e.preventDefault(), { passive: false }));
  document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

  // ---------------- live sync with the admin ----------------
  S.onExternal(k => {
    if (k === 'data' || k === 'all') {
      data = S.loadData();
      save = S.normalizeSave(save, data);
      data = personalize(data, save.rivalName);
      renderShell();
      PP.Audio.configure(data);
      PP.Audio.play(battleCtx ? battleMusic(battleCtx.trainer) : data.settings.musicHome);
    }
    if (k === 'save' || k === 'all') {
      const s = S.rawSave();
      save = s ? S.normalizeSave(s, data) : S.newSave(data);
    }
    if (k === 'data' || k === 'save' || k === 'all') { ensureDaily(); questNotices(true); }
    if (k !== 'log') {
      update(); renderSheet();
      if (sheetKind === 'starter' && petSpecies()) closeSheet(true);     // the admin gave them a Pokémon
      onboard();
    }
  });

  // ---------------- start ----------------
  const isNew = !S.rawSave();
  const away = advance();
  questNotices(true);                       // quests already done before this visit don't toast again
  if (isNew) S.log('system', `New player started: ${save.name}`);
  else if (away >= 30) S.log('system', `Back after ${away >= 120 ? Math.round(away / 60) + ' h' : Math.round(away) + ' min'} of game time; needs dropped while away`);
  persist();
  renderShell(); update();
  if (SO.on) { SO.start({ name: save.named ? save.name : '' }); SO.subscribe(onSocial); }
  PP.Audio.configure(data);
  if (!save.pendingBattle) PP.Audio.play(data.settings.musicHome);   // a battle being resumed picks its own music
  const sp0 = petSpecies(); if (sp0) PP.Sprite.preload(sp0.folder);
  giveKit(); persist();
  // a battle was in progress when the game closed: carry on with the same Pokémon
  if (save.pendingBattle && save.tutorialDone && canBattle()) {
    const pb = save.pendingBattle, area = locOf(pb.area) || locOf(save.location);
    const t = pb.trainer && data.trainers.find(x => x.id === pb.trainer), st = pb.step && data.storySteps.find(x => x.id === pb.step);
    if (area || t) setTimeout(() => startBattle(area, pb.foes, { trainer: t || null, step: st || null }), 500);
  } else save.pendingBattle = null;
  setTimeout(onboard, 400);
  requestAnimationFrame(petFrame);
  let ticks = 0;
  setInterval(() => { advance(); update(); idleReact(); if (++ticks % 5 === 0) persist(); }, 1000);
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });
});
