// Pocket Pals v2 — game screen.
// Every number comes from `data` (admin-editable, see schema.js); every reward or change the
// game makes is written to the activity log so it shows up in Admin → Activity.
PP.whenReady(function () {   // after sign-in when online (js/online/cloud.js), straight away offline
  'use strict';
  const S = PP.store, I = PP.icon, esc = PP.esc;
  const $ = id => document.getElementById(id);
  const fmt = n => Math.floor(n).toLocaleString();
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  let data = S.loadData();
  let save = S.loadSave(data);
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
      toast(`Trainer level up! Lv ${save.level}`);
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
    playAnim(a.anim);
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
    if (exploring) return;                                           // one trip at a time
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
      const enc = PP.Encounters.roll(data, force ? Object.assign({}, l, { encounterChance: 100 }) : l);
      const sp = enc && data.pokemon.find(p => p.id === enc.species);
      if (sp) {
        // a wild Pokémon instead of items. (Battling and catching it come in the next phase.)
        const newDex = !save.dex.seen[sp.id];
        save.dex.seen[sp.id] = save.dex.seen[sp.id] || t;
        st.seen[sp.id] = (st.seen[sp.id] || 0) + 1;
        save.stats.encounters++;
        S.log('explore', `Explored ${l.name}: a wild ${sp.name} (Lv ${enc.level}) appeared` + (newDex ? ' (new Pokédex entry)' : ''));
        bump('see:any');
        bump('explore:any'); bump('explore:' + l.id);
        gainExp(l.exp);
        commit();
        startBattle(l, [{ species: sp.id, level: enc.level }]);
        return;
      } else {
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
        lastExplore = { kind: 'loot', area: l.name, parts };
      }
      bump('explore:any'); bump('explore:' + l.id);
      gainExp(l.exp);
      commit();
      react(s.emoExplore);
    } finally { exploring = false; }
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
    commit(); toast(`Bought ${it.name}`);
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
    commit(); toast(`Reward claimed: ${q.title}`);
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
    save.partner = uid; P.x = P.tx = 0.5; P.act = null;
    PP.Sprite.preload(speciesOf(e.species).folder);
    S.log('pokemon', `${labelOf(e)} is now the partner on the home screen`);
    commit(); toast(`${labelOf(e)} is your partner now`);
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
    if (Math.abs(px - x) < box.w * sc * 0.6 && py < y + 10 && py > y - box.h * sc - 10) { playAnim('Hop'); react(data.settings.emoTap); }
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
    battleCtx = { area, step: ctx.step || null, trainer };
    const layer = $('battleLayer');
    layer.hidden = false;
    const protect = !!(trainer && trainer.mustWin);
    if (protect) teamEntries().forEach(e => { e.hp = null; });                       // a battle the player can't lose starts fully healed
    teamEntries().forEach(e => { if (e.hp != null) e.hp = Math.floor(e.hp); });    // HP is whole numbers in battle
    const bgs = trainer ? trainerBgs(trainer, area) : battleBgs(area);
    PP.Battle.start({
      root: layer, data, kind: trainer ? 'trainer' : 'wild', foes, team: teamEntries(), bag: save.inventory, protect, noSuperEffective: !!(trainer && trainer.noSuperEffective),
      trainer: trainer ? { name: PP.Story.trainerName(trainer), prize: trainer.prize } : null,
      backgrounds: bgs, loseText: `You hurry back to ${(locOf(save.lastTown) || { name: 'town' }).name}. Your Pokémon are healed.`,
      onEnd: endBattle,
    });
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
    const finish = () => { if (stepDone) completeStep(step); else { exploreTab = step ? 'story' : exploreTab; openSheet('explore'); } };
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
      const t = data.trainers.find(x => x.id === st.trainer); if (!t) return toast('This trainer is missing (check the admin).');
      if (!t.mustWin && !canBattle()) { openSheet('explore'); return toast('Your team can’t battle. Heal them at a town first.'); }
      const foes = PP.Story.team(data, save, t);
      if (!foes.length) return toast('This trainer has no Pokémon (check the admin).');
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
      n += 2; el.textContent = text.slice(0, n);
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
  async function submitName(v) {
    const name = String(v || '').trim().replace(/\s+/g, ' ');
    const why = S.checkName(name, data, null) || await PP.Cloud.claimName(name, null);
    if (why) { $('pnameErr').textContent = why; return; }
    S.claimName(name, null);
    S.log('system', `New player chose the name ${name}`);
    save.name = name; save.named = true;
    commit(); hideStory(); onboard();
  }
  /** start or resume the welcome for players who haven't finished it */
  function onboard() {
    if (storyOn() || sheetKind === 'starter') return;
    if (!save.named) {
      const intro = linesOf('introLines');
      return say(intro.slice(0, -1), () => askName(intro[intro.length - 1]));
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
        : `<div class="loc-head">${I('pin')}<span>No areas</span></div><div class="loc-sub">Add one in the admin</div>`;
    }

    // quest card
    const q = s.showQuest ? currentQuest() : null;
    const st = q && questState(q);
    const qSig = q ? [q.id, q.kind, q.title, q.description, st.progress, q.target, st.done].join('|') : 'none';
    if (sig.quest !== qSig) {
      sig.quest = qSig;
      const card = $('questCard');
      card.hidden = !q;
      card.classList.toggle('done', !!(st && st.done));
      if (q) card.innerHTML = `
        <div class="q-head"><span class="q-ic">${I('flag')}</span>${esc(kindLabel(q.kind))} quest</div>
        <div class="q-title">${esc(q.title)}</div>
        ${q.description ? `<div class="q-desc">${esc(q.description)}</div>` : ''}
        <div class="q-foot">
          ${st.done ? `<button class="btn btn-primary btn-sm" data-do="claim" data-id="${esc(q.id)}">${I('check')}Claim reward</button><span style="flex:1"></span>`
                    : `<div class="bar" style="--c:var(--gold)"><i style="width:${st.progress / q.target * 100}%"></i></div><span class="q-count tnum">${fmt(st.progress)}/${fmt(q.target)}</span>`}
          ${I('chevron')}
        </div>`;
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
  let exploreRegion = null, palsView = 'box', exploreTab = 'story', questTab = null;
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
        + (cards || empty('compass', 'No areas yet', 'Areas added in the admin show up here.')) };
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
      const none = { story: ['flag', 'No story quests', 'Story quests added in the admin show up here.'], daily: ['clock', 'No daily quests today', 'Check back after the reset.'],
        explore: ['compass', 'No exploration quests', 'Exploration quests added in the admin show up here.'], achievement: ['star', 'No achievements yet', 'Achievements added in the admin show up here.'] }[questTab];
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
      const pic = PP.Sprite.portrait(sp.folder);
      const days = Math.max(1, Math.ceil((Date.now() - e.since) / 86400000));
      const icon = (avatarSpecies() || {}).id;
      const boxRows = save.box.map(b => {
        const bs = speciesOf(b.species); if (!bs) return '';
        const bp = PP.Sprite.portrait(bs.folder), isPartner = b.uid === save.partner;
        return `<div class="row">
          <span class="row-ic has-pic">${bp ? `<img class="pix" src="${bp}" alt="">` : I('pokeball')}</span>
          <div class="row-main"><div class="row-title">${esc(labelOf(b))}${isPartner ? ' <span class="qty">Partner</span>' : ''}${icon === bs.id ? ' <span class="qty">Icon</span>' : ''}</div>
            <div class="row-sub">Lv ${b.level} · ${b.nickname ? esc(bs.name) + ' · ' : ''}#${String(bs.dex).padStart(3, '0')} · HP ${Math.floor(hpOf(b))}/${maxHp(b)}</div>
            <div class="bar" style="--c:${hpOf(b) / maxHp(b) > .5 ? 'var(--good)' : hpOf(b) / maxHp(b) > .2 ? 'var(--gold)' : 'var(--bad)'}"><i style="width:${hpOf(b) / maxHp(b) * 100}%"></i></div></div>
          <div class="row-side">
            ${save.team.includes(b.uid) ? `<button class="btn btn-sm btn-primary" data-do="team" data-id="${esc(b.uid)}" title="In your battle team. Tap to take it out.">Team ${save.team.indexOf(b.uid) + 1}</button>`
              : `<button class="btn btn-sm" data-do="team" data-id="${esc(b.uid)}" ${save.team.length >= data.settings.teamMax ? 'disabled title="Team is full"' : ''}>+ Team</button>`}
            ${isPartner ? '' : `<button class="btn btn-sm" data-do="partner" data-id="${esc(b.uid)}">Partner</button>`}
            ${icon === bs.id ? '' : `<button class="btn btn-sm" data-do="avatar" data-id="${esc(bs.id)}">Use as icon</button>`}
          </div></div>`;
      }).join('');
      return { title: data.settings.tabPals, body: `
        <div class="pet-card">
          <div class="pet-portrait">${pic ? `<img src="${pic}" alt="">` : I('pokeball')}</div>
          <div><div class="pet-name">${esc(petLabel())}</div>
            <div class="row-sub">Partner · Lv ${e.level} · ${e.nickname ? esc(sp.name) + ' · ' : ''}#${String(sp.dex).padStart(3, '0')} · together ${days} day${days === 1 ? '' : 's'}</div>
            <div class="bar pet-exp" title="EXP to the next level"><i style="width:${e.level >= 100 ? 100 : Math.round((e.exp - S.expForLevel(sp.growth, e.level)) / Math.max(1, S.expForLevel(sp.growth, e.level + 1) - S.expForLevel(sp.growth, e.level)) * 100)}%"></i></div></div>
        </div>
        <div class="sec-label">Partner’s nickname</div>
        <form class="field" data-form="petname"><input id="petNameInput" maxlength="16" placeholder="${esc(sp.name)}" value="${esc(e.nickname)}" autocomplete="off"><button class="btn btn-primary" type="submit">Save</button></form>
        <div class="sec-label">PC box · ${save.box.length} · team ${save.team.length}/${data.settings.teamMax}</div>
        ${boxRows}` };
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
    party() { return { title: data.settings.tabParty, body: empty('users', 'No friends yet', 'Friends you add will be listed here.') }; },
    settings() {
      const icon = (avatarSpecies() || {}).id, owned = [...new Set(save.box.map(b => b.species))].map(speciesOf).filter(Boolean);
      return { title: 'Profile & settings', body: `
        <div class="sec-label">In-game name</div>
        <form class="field" data-form="name"><input id="nameInput" maxlength="${data.settings.nameMax}" value="${esc(save.name)}" autocomplete="off" spellcheck="false"><button class="btn btn-primary" type="submit">Save</button></form>
        <p class="field-err" id="nameErr"></p>
        <div class="sec-label">Profile icon</div>
        ${owned.length ? `<div class="icon-grid">${owned.map(p => { const pic = PP.Sprite.portrait(p.folder);
          return `<button class="icon-pick${p.id === icon ? ' on' : ''}" data-do="avatar" data-id="${esc(p.id)}" title="${esc(p.name)}" aria-pressed="${p.id === icon}">${pic ? `<img src="${pic}" alt="">` : I('pokeball')}<span>${esc(p.name)}</span></button>`; }).join('')}</div>
          <p class="muted" style="margin-top:8px;text-align:left">Pick from the Pokémon in your PC box.</p>` : '<p class="muted" style="text-align:left">Choose a starter first.</p>'}
        ${PP.Cloud.on ? `<div class="sec-label">Account</div>
        <div class="row"><span class="row-ic" style="--c:var(--accent)">${I('user')}</span>
          <div class="row-main"><div class="row-title">${esc(PP.Cloud.user.name || 'Google account')}</div><div class="row-sub">${esc(PP.Cloud.user.email)} · progress saved online</div></div>
          <div class="row-side"><button class="btn btn-sm" data-do="sign-out">Sign out</button></div></div>` : ''}
        ${!PP.Cloud.on || PP.Cloud.admin ? `<div class="sec-label">Tools</div>
        <a class="row link-row" href="admin.html" target="_blank" rel="noopener"><span class="row-ic" style="--c:var(--accent)">${I('grid')}</span>
          <div class="row-main"><div class="row-title">Admin dashboard</div><div class="row-sub">Adjust everything in the game</div></div>${I('external')}</a>` : ''}
        <p class="muted">Pocket Pals v2 · ${PP.Cloud.on ? 'online' : 'local preview'}${data.settings.fastTime ? ' · fast time on' : ''}</p>` };
    },
  };
  /** Explore → Story: the current chapter's checklist, what's next, and the badge case */
  function storyHTML() {
    const ch = PP.Story.currentChapter(data, save), cur = PP.Story.current(data, save);
    if (!ch) return empty('flag', 'No story yet', 'Chapters and story steps are added in the admin.');
    const steps = PP.Story.chapterSteps(data, ch.id), done = steps.filter(x => save.story.done[x.id]).length;
    const ICON = { scene: 'megaphone', arrive: 'pin', heal: 'heart', trainer: 'swords', wild: 'paw' };
    const detail = st => {
      if (st.type === 'trainer') { const t = data.trainers.find(x => x.id === st.trainer); return t ? PP.Story.team(data, save, t).map(f => `${(speciesOf(f.species) || {}).name} Lv ${f.level}`).join(' · ') : ''; }
      if (st.type === 'wild') { const sp = speciesOf(st.species); return sp ? `${sp.name} Lv ${st.level}${st.mustCatch ? ' · catch it' : ''}` : ''; }
      return (locOf(st.area) || {}).name || '';
    };
    const rows = steps.map(st => {
      const isDone = !!save.story.done[st.id], isCur = cur && cur.id === st.id;
      return `<li class="step${isDone ? ' done' : isCur ? ' cur' : ' later'}">
        <span class="step-ic">${I(isDone ? 'check' : isCur ? ICON[st.type] || 'flag' : 'lock')}</span>
        <span class="step-main"><b>${esc(st.title)}</b><small>${esc(detail(st))}</small></span></li>`;
    }).join('');
    const label = !cur ? '' : cur.type === 'trainer' ? `Battle ${esc(PP.Story.trainerName(data.trainers.find(x => x.id === cur.trainer) || { trainerClass: '', name: 'trainer' }))}`
      : cur.type === 'wild' ? 'Continue: wild Pokémon ahead' : cur.type === 'arrive' ? `Travel to ${esc((locOf(cur.area) || {}).name || 'the next area')}` : 'Continue the journey';
    const gymInChapter = steps.map(st => data.trainers.find(x => x.id === st.trainer)).find(t => t && t.badge !== 'none');
    const badge = gymInChapter && data.badges.find(b => b.id === gymInChapter.badge);
    return `<div class="chapter">
        <div class="chapter-top"><span class="chapter-no">Chapter ${ch.number}</span><span class="tnum">${done}/${steps.length}</span></div>
        <h3>${esc(ch.title)}</h3><p>${esc(ch.description)}</p>
        <div class="bar" style="--c:var(--gold)"><i style="width:${steps.length ? done / steps.length * 100 : 0}%"></i></div>
        <ol class="steps">${rows}</ol>
        <div class="chapter-reward">${I('star')}<span>Chapter reward: ${fmt(ch.rewardCoins)} ${esc(coinName())} · ${fmt(ch.rewardGems)} ${esc(gemName())} · ${fmt(ch.rewardExp)} EXP${badge ? ` · ${esc(badge.name)}` : ''}</span></div>
        ${cur ? `<button class="btn btn-primary story-go" data-do="story-go">${I(ICON[cur.type] || 'flag')}${label}</button>`
              : '<p class="muted" style="margin:12px 0 0">You’ve reached the end of the story so far. More chapters are coming in a later update.</p>'}
      </div>
      <div class="sec-label">Badges · ${Object.keys(save.badges).length}/${data.badges.length}</div>
      <div class="badges">${data.badges.map(b => `<div class="badge${save.badges[b.id] ? ' got' : ''}" style="--c:${b.color}" title="${esc(b.name)}${save.badges[b.id] ? '' : ' (not earned yet)'}">${I('star')}<span>${esc(b.name.replace(/ Badge$/, ''))}</span></div>`).join('')}</div>`;
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
    sheetKind = null; $('sheet').hidden = true; $('sheet').classList.remove('locked');
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
  }
  function renderSheet() {
    if (!sheetKind || !SHEETS[sheetKind]) return;
    const body = $('sheetBody'), scroll = body.scrollTop;
    const a = document.activeElement;
    if (a && (a.id === 'nameInput' || a.id === 'petNameInput')) return;   // don't wipe what's being typed
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
      case 'pick-starter': starterPick = id; renderSheet(); break;
      case 'partner': setPartner(id); break;
      case 'team': toggleTeam(id); break;
      case 'heal': { const l = locOf(id); healTeam(l ? `at ${l.name}` : ''); bump('heal'); commit(); toast('Your team is fully healed!'); break; }
      case 'region': exploreRegion = id; renderSheet(); break;
      case 'explore-tab': exploreTab = id; renderSheet(); break;
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
      case 'close': closeSheet(); break;
      case 'sign-out': persist(); PP.Cloud.signOut(); break;
      case 'claim': { e.stopPropagation(); const q = data.quests.find(x => x.id === id); if (q) claim(q); break; }
      case 'explore': { const l = locOf(id); if (l) explore(l); break; }
      case 'buy': { const it = itemOf(id); if (it) buy(it); break; }
      case 'sell': { const it = itemOf(id); if (it) sell(it); break; }
      case 'use': { const it = itemOf(id); if (it) useItem(it); break; }
    }
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

  // ---------------- live sync with the admin ----------------
  S.onExternal(k => {
    if (k === 'data' || k === 'all') {
      data = S.loadData();
      save = S.normalizeSave(save, data);
      renderShell();
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
