// Pocket Pals v2 — admin dashboard.
// Settings pages and content tables are generated from PP.SCHEMA, so anything added to the
// schema shows up here automatically. Changes are written to the same storage the game reads,
// and an open game tab picks them up straight away.
PP.whenReady(function () {   // after sign-in when online (js/online/cloud.js), straight away offline
  'use strict';
  const S = PP.store, SC = PP.SCHEMA, I = PP.icon, esc = PP.esc;
  const main = document.getElementById('main');
  const fmt = n => Math.floor(Number(n) || 0).toLocaleString();

  let data = S.loadData();
  let view = '';
  let dirty = false;
  let touched = new Set();            // which sections of the current form were edited
  let draft = null, sel = 0;          // collection editing
  const fresh = new WeakSet();        // rows added in this draft (their ID is still editable)
  let logFilter = 'all';
  let cfilter = '';                   // search text in a content list

  document.getElementById('brandMark').innerHTML = I('grid');

  // ---------------- navigation ----------------
  function navHTML() {
    const link = (r, icon, label, count) =>
      `<a href="#${r}" class="nav-link${view === r ? ' on' : ''}">${I(icon)}<span>${esc(label)}</span>${count != null ? `<span class="count">${count}</span>` : ''}</a>`;
    return `
      <div class="nav-group"><div class="nav-title">Live</div>
        ${link('overview', 'grid', 'Overview')}${link('player', 'user', 'Player')}${link('activity', 'activity', 'Activity')}</div>
      <div class="nav-group"><div class="nav-title">Game settings</div>
        ${SC.settings.map(g => link('settings/' + g.id, g.icon, g.label)).join('')}</div>
      <div class="nav-group"><div class="nav-title">Content</div>
        ${Object.entries(SC.collections).map(([k, c]) => link('content/' + k, c.icon, c.label, data[k].length)).join('')}</div>
      <div class="nav-group"><div class="nav-title">System</div>${link('check', 'check', 'Content check', (() => { const n = PP.validate(data).filter(x => x.level === 'error').length; return n ? n + ' ✕' : null; })())}${link('data', 'database', 'Data & backup')}${link('online', 'user', 'Online')}</div>`;
  }
  function route() { return decodeURIComponent(location.hash.slice(1)) || 'overview'; }
  function go() {
    const r = route();
    if (r === view) return;
    if (dirty && !confirm('You have unsaved changes. Discard them?')) { history.replaceState(null, '', '#' + view); return; }
    view = r; draft = null; sel = 0; cfilter = ''; render();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', go);
  window.addEventListener('beforeunload', e => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function setDirty(v) {
    dirty = v;
    if (!v) touched = new Set();
    const bar = document.getElementById('savebar');
    if (bar) bar.classList.toggle('show', v);
  }

  // ---------------- page chrome ----------------
  const page = (title, desc, actions, body, savable) => `
    <header class="page-head"><div><h1>${esc(title)}</h1>${desc ? `<p>${esc(desc)}</p>` : ''}</div>
      <div class="page-actions">${actions || ''}</div></header>
    ${body}
    ${savable ? `<div class="savebar" id="savebar"><span>Unsaved changes</span>
      <button class="btn" data-do="discard">Discard</button><button class="btn btn-primary" data-do="save">Save changes</button></div>` : ''}`;
  const panel = (title, body, opts = {}) => `
    <section class="panel${opts.cls ? ' ' + opts.cls : ''}"${opts.sec ? ` data-sec="${opts.sec}"` : ''}>
      ${title ? `<div class="panel-head"><h2>${esc(title)}</h2>${opts.right || ''}</div>` : ''}
      <div class="panel-body${opts.flush ? ' flush' : ''}">${body}</div></section>`;
  const btn = (label, doing, opts = {}) =>
    `<button class="btn${opts.cls ? ' ' + opts.cls : ''}" data-do="${doing}"${opts.attrs ? ' ' + opts.attrs : ''}${opts.title ? ` title="${esc(opts.title)}"` : ''}>${opts.icon ? I(opts.icon) : ''}${label ? esc(label) : ''}</button>`;

  // ---------------- schema-driven fields ----------------
  function fieldHTML(f, v, opts = {}) {
    const id = 'f_' + (opts.prefix || '') + f.key;
    const help = f.help ? `<p class="fh">${esc(f.help)}</p>` : '';
    const attr = `id="${id}" data-key="${f.key}"`;
    if (f.type === 'bool') {
      return `<div class="f"><div class="f-row"><label class="fl" for="${id}">${esc(f.label)}</label>
        <label class="switch"><input type="checkbox" ${attr} ${v ? 'checked' : ''}><span></span></label></div>${help}</div>`;
    }
    let input;
    switch (f.type) {
      case 'int': case 'number':
        input = `<div class="inp-wrap"><input class="inp tnum" type="number" ${attr} value="${esc(v)}"
          ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} step="${f.step || (f.type === 'int' ? 1 : 'any')}">
          ${f.suffix ? `<span class="sfx">${esc(f.suffix)}</span>` : ''}</div>`;
        break;
      case 'select':
        input = `<select ${attr}>${S.options(f.optionsFrom || f.options, data).map(([val, label]) =>
          `<option value="${esc(val)}"${val === v ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>`;
        break;
      case 'textarea':
        input = `<textarea ${attr} maxlength="${f.max || 300}" rows="3">${esc(v)}</textarea>`;
        break;
      case 'color':
        input = `<div class="color-inp"><input type="color" ${attr} value="${esc(v)}"><code>${esc(v)}</code></div>`;
        break;
      case 'multi': {
        const opts = S.options(f.optionsFrom || f.options, data), set = new Set(v || []);
        return `<div class="f wide"><span class="fl">${esc(f.label)}</span>
          <div class="multi" data-key="${f.key}" data-multi>${opts.length ? opts.map(([val, label]) =>
            `<label class="multi-opt${set.has(val) ? ' on' : ''}"><input type="checkbox" value="${esc(val)}" ${set.has(val) ? 'checked' : ''}><span>${esc(label)}</span></label>`).join('') : '<span class="fh">Nothing to choose yet.</span>'}</div>${help}</div>`;
      }
      case 'image':
        return `<div class="f wide"><label class="fl" for="${id}">${esc(f.label)}</label>
          <input class="inp" type="text" ${attr} value="${esc(v)}" maxlength="${f.max || 300}" spellcheck="false">${help}
          <div class="img-prev${f.preview === 'square' ? ' square' : ''}">${v ? `<img src="${esc(v)}" alt="" onerror="this.parentNode.classList.add('bad')">` : ''}<span>Image not found</span></div></div>`;
      case 'id':
        input = `<input class="inp" ${attr} value="${esc(v)}" ${opts.idEditable ? '' : 'readonly'} spellcheck="false">`;
        return `<div class="f"><label class="fl" for="${id}">${esc(f.label || 'ID')}</label>${input}
          <p class="fh">${opts.idEditable ? 'Lowercase letters, numbers and dashes. Can’t be changed after saving.' : 'Used to link things together, so it can’t be changed.'}</p></div>`;
      default:
        input = `<input class="inp" type="text" ${attr} value="${esc(v)}" maxlength="${f.max || 300}">`;
    }
    return `<div class="f${f.type === 'textarea' ? ' wide' : ''}"><label class="fl" for="${id}">${esc(f.label)}</label>${input}${help}</div>`;
  }
  function readFields(root, fields) {
    const out = {};
    fields.forEach(f => {
      const el = root.querySelector(`[data-key="${f.key}"]`);
      if (!el) return;
      if (f.type === 'multi') { out[f.key] = [...el.querySelectorAll('input:checked')].map(i => i.value); return; }
      out[f.key] = f.type === 'bool' ? el.checked : (f.type === 'int' || f.type === 'number') ? (el.value === '' ? null : Number(el.value)) : el.value;
    });
    return out;
  }

  // ---------------- views ----------------
  const VIEWS = {
    // Online: who may sign in, and who is playing (needs js/online/firebase-config.js)
    online() {
      const C = PP.Cloud;
      if (!C.on) return page('Online', 'Google sign-in, saves in the cloud, and playing with friends.', '', panel('Online mode is off', `
        <ol class="steps-list">
          <li>Create a project at <b>console.firebase.google.com</b> (the free Spark plan is enough).</li>
          <li><b>Build → Authentication → Get started → Google</b>: turn it on.</li>
          <li><b>Build → Firestore Database → Create database</b>, then paste <code>firestore.rules</code> into its <b>Rules</b> tab (put your own email where it says OWNER_EMAIL) and publish.</li>
          <li><b>Project settings → Your apps → Web app</b>: copy the config into <code>js/online/firebase-config.js</code>.</li>
          <li>Reload. The game and the admin will ask you to sign in with Google.</li>
        </ol>`));
      setTimeout(loadOnline, 0);
      return page('Online', `Signed in as ${C.user.email}. Anyone with a Google account can play.`, '', `
        <div id="onlineBody"><div class="empty-note">Loading…</div></div>`);
    },
    overview() {
      const sv = S.loadSave(data), s = data.settings;
      const need = S.expNeed(sv.level, data);
      const quests = data.quests.filter(q => q.active);
      const claimed = quests.filter(q => (sv.quests[q.id] || {}).claimed).length;
      const bag = Object.values(sv.inventory).reduce((a, b) => a + b, 0);
      const tile = (icon, c, label, value, sub) => `<div class="tile" style="--c:${c}"><div class="tile-label">${I(icon)}${esc(label)}</div>
        <div class="tile-value">${value}</div>${sub ? `<div class="tile-sub">${sub}</div>` : ''}</div>`;
      const log = S.getLog().slice(0, 8);
      return page('Overview', `Live view of ${sv.name}'s game. Changes made here reach an open game tab straight away.`, btn('Open game', 'open-game', { icon: 'external' }), `
        <div class="tiles">
          ${(() => { const e = sv.box.find(b => b.uid === sv.partner), p = e && data.pokemon.find(x => x.id === e.species);
            return tile('pokeball', 'var(--bad)', 'Partner', p ? esc(e.nickname || p.name) : '—', p ? `${sv.box.length} in PC box` : 'Not chosen yet'); })()}
          ${tile('user', 'var(--accent)', 'Trainer level', `Lv ${sv.level}`, `${fmt(sv.exp)} / ${fmt(need)} EXP`)}
          ${tile('list', 'var(--good)', 'Pokédex', `${Object.keys(sv.dex.caught).length} / ${Object.keys(sv.dex.seen).length}`, `caught / seen of ${data.pokemon.length}`)}
          ${tile('coin', 'var(--gold)', s.coinName, fmt(sv.coins), `${fmt(sv.stats.coinsEarned)} earned in total`)}
          ${tile('gem', 'var(--gem)', s.gemName, fmt(sv.gems), '')}
          ${tile('bag', 'var(--text-2)', 'In bag', fmt(bag), `${Object.keys(sv.inventory).length} kinds of item`)}
          ${tile('flag', 'var(--gold)', 'Quests claimed', `${claimed}/${quests.length}`, '')}
          ${tile('compass', 'var(--good)', 'Explores', fmt(sv.stats.explores), esc((data.locations.find(l => l.id === sv.location) || {}).name || ''))}
        </div>
        <div class="two">
          ${panel('Needs', data.needs.map(n => `<div class="meter" style="--c:${n.color}"><span class="meter-label">${I(n.icon)}${esc(n.label)}</span>
            <div class="bar"><i style="width:${sv.needs[n.id]}%"></i></div><span class="meter-val">${Math.round(sv.needs[n.id])}</span></div>`).join(''),
            { right: `<small>warning below ${s.lowNeed}</small>` })}
          ${panel('Quick adjustments', `<div class="quick">
            ${btn(`+100 ${s.coinName}`, 'quick', { attrs: 'data-q="coins"', icon: 'coin' })}
            ${btn(`+10 ${s.gemName}`, 'quick', { attrs: 'data-q="gems"', icon: 'gem' })}
            ${btn('Fill all needs', 'quick', { attrs: 'data-q="fill"', icon: 'heart' })}
            ${btn('Level up', 'quick', { attrs: 'data-q="level"', icon: 'up' })}
            ${btn('Clear cooldowns', 'quick', { attrs: 'data-q="cool"', icon: 'clock' })}
            ${btn(s.fastTime ? 'Turn fast time off' : 'Turn fast time on', 'quick', { attrs: 'data-q="fast"', icon: 'bolt' })}
          </div>`)}
        </div>
        <div style="height:18px"></div>
        ${panel('Recent activity', log.length ? logTable(log) : '<div class="empty-note">Nothing yet. Play the game and everything it does shows up here.</div>',
          { flush: true, right: '<a class="btn btn-sm" href="#activity">See all</a>' })}`);
    },

    player() {
      const sv = S.loadSave(data);
      const profile = `<div class="form-grid">${SC.save.map(f => fieldHTML(f, sv[f.key])).join('')}</div>
        <p class="fh" style="margin-top:12px">Level ${sv.level} needs ${fmt(S.expNeed(sv.level, data))} EXP to go up.</p>`;
      const needs = data.needs.map(n => `<div class="meter" style="--c:${n.color}"><span class="meter-label">${I(n.icon)}${esc(n.label)}</span>
        <input type="range" min="0" max="100" step="1" data-need="${esc(n.id)}" value="${Math.round(sv.needs[n.id])}">
        <span class="meter-val" data-out="${esc(n.id)}">${Math.round(sv.needs[n.id])}</span></div>`).join('');
      const owned = data.items.filter(it => sv.inventory[it.id] > 0);
      const inv = data.items.length ? `<table class="tbl"><thead><tr><th>Item</th><th>Effect</th><th class="r">Quantity</th></tr></thead><tbody>
        ${owned.map(it => `<tr><td><b>${esc(it.name)}</b></td><td>${it.effectNeed === 'none' ? '<span class="fh">—</span>' : `${it.effectAmount >= 0 ? '+' : ''}${it.effectAmount} ${esc(it.effectNeed)}`}</td>
          <td class="r"><input class="inp tnum" type="number" min="0" data-inv="${esc(it.id)}" value="${sv.inventory[it.id]}"></td></tr>`).join('')}
        ${owned.length ? '' : '<tr><td colspan="3" class="fh">The bag is empty.</td></tr>'}
        <tr><td colspan="2"><select class="inp" data-addinv style="max-width:320px"><option value="">Add an item…</option>
          ${data.items.filter(it => !(sv.inventory[it.id] > 0)).map(it => `<option value="${esc(it.id)}">${esc(it.name)}</option>`).join('')}</select></td>
          <td class="r"><input class="inp tnum" type="number" min="1" value="1" data-addqty></td></tr>
        </tbody></table>`
        : '<div class="empty-note">No items exist yet.</div>';
      const quests = data.quests.length ? `<table class="tbl"><thead><tr><th>Quest</th><th>Goal</th><th class="r">Progress</th><th class="r">Claimed</th></tr></thead><tbody>
        ${data.quests.map(q => { const st = sv.quests[q.id] || { progress: 0, claimed: false }; const total = stateValue(sv, q.goal);
          const today = q.kind !== 'daily' || data.settings.dailyPick === 0 || sv.daily.ids.includes(q.id);
          return `<tr><td><b>${esc(q.title)}</b> <span class="tag">${esc(({ story: 'Story', daily: 'Daily', explore: 'Exploration', achievement: 'Achievement' })[q.kind] || q.kind)}</span>${q.active ? '' : ' <span class="tag">Off</span>'}${q.active && !today ? ' <span class="tag">Not today</span>' : ''}</td><td>${esc(goalLabel(q.goal))}</td>
          <td class="r">${total != null ? `<span class="fh">${Math.min(total, q.target)}/${q.target} (total)</span>` : `<input class="inp tnum" type="number" min="0" max="${q.target}" data-qp="${esc(q.id)}" value="${st.progress}"> <span class="fh">/ ${q.target}</span>`}</td>
          <td class="r"><label class="switch" style="display:inline-block"><input type="checkbox" data-qc="${esc(q.id)}" ${st.claimed ? 'checked' : ''}><span></span></label></td></tr>`; }).join('')}</tbody></table>`
        : '<div class="empty-note">No quests exist yet.</div>';
      return page('Player', 'Edit the save directly. Only the sections you change are written.', '', `
        <form data-form="player" onsubmit="return false">
          ${panel('Profile', profile, { sec: 'profile' })}
          ${panel('Needs', needs, { sec: 'needs' })}
          ${panel('Bag', inv, { sec: 'inventory', flush: true })}
          ${panel('Story', storyEditHTML(sv), { sec: 'story' })}
          ${panel('Pokémon (PC box)', boxHTML(sv), { sec: 'box', flush: true, right: '<small>Partner = on the home screen</small>' })}
          ${panel('Quest progress', quests, { sec: 'quests', flush: true })}
        </form>
        ${panel('', `<div class="action-list">
          <div class="act-row"><div><b>Clear cooldowns</b><small>Every care button and exploring can be used straight away.</small></div>${btn('Clear', 'quick', { attrs: 'data-q="cool"' })}</div>
          <div class="act-row"><div><b>Start a new day of daily quests</b><small>Daily quest progress starts over and a new set is picked (as at the daily reset).</small></div>${btn('New day', 'quick', { attrs: 'data-q="daily"' })}</div>
          <div class="act-row"><div><b>Start a new player</b><small>Replaces this save with a fresh one, using the current starting values.</small></div>${btn('Reset player', 'reset-player', { cls: 'btn-danger' })}</div>
        </div>`, { cls: 'danger', flush: true })}`, true);
    },

    activity() {
      const all = S.getLog();
      const list = logFilter === 'all' ? all : all.filter(e => e.kind === logFilter);
      const kinds = Object.entries(SC.logKinds).filter(([k]) => all.some(e => e.kind === k));
      return page('Activity', `Everything the game generated or changed, newest first (keeps up to ${data.settings.logLimit}).`,
        btn('Export', 'export-log', { icon: 'download' }) + btn('Clear', 'clear-log', { icon: 'trash', cls: 'btn-danger' }), `
        <div class="chips" style="margin-bottom:14px">
          <button class="chip${logFilter === 'all' ? ' on' : ''}" data-do="filter" data-k="all">All · ${all.length}</button>
          ${kinds.map(([k, v]) => `<button class="chip${logFilter === k ? ' on' : ''}" data-do="filter" data-k="${k}">${esc(v.label)} · ${all.filter(e => e.kind === k).length}</button>`).join('')}
        </div>
        ${panel('', list.length ? logTable(list.slice(0, 500)) : '<div class="empty-note">No activity yet.</div>', { flush: true })}`);
    },

    check() {
      const issues = PP.validate(data), errs = issues.filter(x => x.level === 'error'), warns = issues.filter(x => x.level === 'warning');
      const totals = data.encounterTables.map(t => {
        const es = data.encounters.filter(e => e.table === t.id), sum = Math.round(es.reduce((a, e) => a + e.weight, 0) * 100) / 100;
        return `<tr><td><b>${esc(t.name)}</b>${t.enabled ? '' : ' <span class="tag">Off</span>'}<br><small class="fh">${esc(t.note)}</small></td><td>${esc(t.method)}</td><td class="r tnum">${es.length}</td>
          <td class="r"><span class="tag" style="--c:${Math.abs(sum - 100) < 0.001 ? 'var(--good)' : 'var(--bad)'}">${sum}%</span></td></tr>`;
      }).join('');
      const group = (list, c) => list.map(x => `<tr><td style="width:1%"><span class="tag" style="--c:${c}">${esc(x.area)}</span></td><td>${esc(x.text)}</td></tr>`).join('');
      return page('Content check', 'Checks the game data for mistakes: encounter tables that don’t add up to 100%, missing Pokémon or areas, and areas that can never be unlocked.', btn('Check again', 'recheck', { icon: 'reset' }), `
        <div class="tiles">
          <div class="tile" style="--c:var(--bad)"><div class="tile-label">${I('close')}Errors</div><div class="tile-value">${errs.length}</div><div class="tile-sub">must be fixed</div></div>
          <div class="tile" style="--c:var(--warn)"><div class="tile-label">${I('flag')}Warnings</div><div class="tile-value">${warns.length}</div><div class="tile-sub">worth a look</div></div>
          <div class="tile" style="--c:var(--good)"><div class="tile-label">${I('list')}Encounter tables</div><div class="tile-value">${data.encounterTables.length}</div><div class="tile-sub">${data.encounters.length} entries</div></div>
        </div>
        ${panel('Problems', issues.length ? `<table class="tbl"><tbody>${group(errs, 'var(--bad)')}${group(warns, 'var(--warn)')}</tbody></table>` : `<div class="empty-note">${I('check')} Everything checks out.</div>`, { flush: true })}
        ${panel('Encounter table totals', totals ? `<table class="tbl"><thead><tr><th>Table</th><th>Method</th><th class="r">Pokémon</th><th class="r">Total</th></tr></thead><tbody>${totals}</tbody></table>` : '<div class="empty-note">No encounter tables yet.</div>', { flush: true })}`);
    },

    data() {
      const size = k => { try { return ((localStorage.getItem(S.KEYS[k]) || '').length / 1024).toFixed(1) + ' KB'; } catch (e) { return '—'; } };
      return page('Data & backup', 'Everything lives in this browser’s local storage. Export a backup before big changes.', '', `
        ${panel('Backup', `<div class="action-list">
          <div class="act-row"><div><b>Export everything</b><small>Game data (${size('data')}), player save (${size('save')}) and activity (${size('log')}) as one JSON file.</small></div>${btn('Export', 'export-all', { icon: 'download' })}</div>
          <div class="act-row"><div><b>Import a backup</b><small>Replaces whatever the file contains: game data, save and/or activity.</small></div>
            <label class="btn">${I('upload')}Import<input type="file" accept="application/json,.json" id="importFile" hidden></label></div>
        </div>`, { flush: true })}
        ${panel('Taken names', (() => { const l = S.takenNames(); return l.length ? `<table class="tbl"><tbody>${l.map(x => `<tr><td><b>${esc(x.name)}</b></td>
            <td class="time">${esc(new Date(x.at).toLocaleDateString())}</td>
            <td class="r"><button class="btn btn-sm" data-do="release-name" data-name="${esc(x.name)}">Release</button></td></tr>`).join('')}</tbody></table>`
          : '<div class="empty-note">No names taken yet.</div>'; })(), { flush: true, right: '<small>In-game names are unique on this device</small>' })}
        ${panel('Reset', `<div class="action-list">
          <div class="act-row"><div><b>Reset game content and settings</b><small>Puts every setting and content list back to the built-in defaults. The player save stays.</small></div>${btn('Reset content', 'reset-data', { cls: 'btn-danger' })}</div>
          <div class="act-row"><div><b>Reset player</b><small>Starts a fresh save.</small></div>${btn('Reset player', 'reset-player', { cls: 'btn-danger' })}</div>
          <div class="act-row"><div><b>Reset everything</b><small>Content, save and activity log.</small></div>${btn('Reset all', 'reset-all', { cls: 'btn-danger' })}</div>
        </div>`, { cls: 'danger', flush: true })}`);
    },
  };

  function settingsView(id) {
    const g = SC.settings.find(x => x.id === id);
    if (!g) return notFound();
    return page(g.label, g.desc, btn('Reset to defaults', 'defaults', { icon: 'reset' }), `
      <form data-form="settings" onsubmit="return false">${panel('', `<div class="form-grid">${g.fields.map(f => fieldHTML(f, data.settings[f.key])).join('')}</div>`)}</form>`, true);
  }

  function collectionView(key) {
    const c = SC.collections[key];
    if (!c) return notFound();
    if (!draft) draft = S.clone(data[key]);
    sel = Math.max(0, Math.min(sel, draft.length - 1));
    return page(c.label, c.desc, btn('Reset list to defaults', 'coll-defaults', { icon: 'reset' }) + btn(`Add ${c.single.toLowerCase()}`, 'add', { icon: 'plus', cls: 'btn-primary' }), `
      <div class="split">
        ${panel(`${draft.length} ${draft.length === 1 ? c.single.toLowerCase() : c.label.toLowerCase()}`,
          (draft.length > 12 ? `<div class="clist-search"><input class="inp" type="search" id="cfilter" placeholder="Search ${esc(c.label.toLowerCase())}" value="${esc(cfilter)}" autocomplete="off"></div>` : '') +
          `<div class="clist" id="clist">${listHTML(key)}</div>`, { flush: true })}
        <section class="panel" id="ceditor">${editorHTML(key)}</section>
      </div>`, true);
  }
  function listHTML(key) {
    const c = SC.collections[key];
    if (!draft.length) return `<div class="empty-note">Nothing here yet.</div>`;
    const q = cfilter.trim().toLowerCase();
    const rows = draft.map((r, i) => {
      if (q && !`${c.title(r)} ${c.sub(r, data)} ${r.id}`.toLowerCase().includes(q)) return '';
      const color = (c.color && c.color(r, data)) || 'var(--text-3)';
      const src = c.pic ? c.pic(r) : r.image;
      const pic = src ? `<img src="${esc(encodeURI(src))}" alt="" loading="lazy">` : I(r.icon || c.icon);
      const tag = c.tag ? c.tag(r) : '';
      return `<button class="crow${i === sel ? ' on' : ''}" data-do="pick" data-i="${i}">
        <span class="crow-ic${src ? ' pic' : ''}" style="--c:${color}">${pic}</span>
        <span class="crow-main"><b>${esc(c.title(r) || r.id || 'Untitled')}</b><small>${esc(c.sub(r, data))}</small></span>
        ${tag ? `<span class="tag" style="--c:var(--accent)">${esc(tag)}</span>` : ''}
        ${c.off && c.off(r) ? '<span class="tag">Off</span>' : ''}</button>`;
    }).join('');
    return rows || `<div class="empty-note">Nothing matches “${esc(cfilter)}”.</div>`;
  }
  function editorHTML(key) {
    const c = SC.collections[key], r = draft[sel];
    if (!r) return `<div class="panel-body"><div class="empty-note">Add a ${c.single.toLowerCase()} to get started.</div></div>`;
    return `<div class="panel-head"><h2>${esc(c.title(r) || 'Untitled')}</h2><div class="editor-tools">
        ${btn('', 'move', { cls: 'btn-sm icon-only', icon: 'up', attrs: 'data-dir="-1"', title: 'Move up' })}
        ${btn('', 'move', { cls: 'btn-sm icon-only', icon: 'down', attrs: 'data-dir="1"', title: 'Move down' })}
        ${btn('', 'dup', { cls: 'btn-sm icon-only', icon: 'copy', title: 'Duplicate' })}
        ${btn('', 'del', { cls: 'btn-sm icon-only btn-danger', icon: 'trash', title: 'Delete' })}
      </div></div>
      <div class="panel-body" data-form="row" data-sec="row"><div class="form-grid">
        ${c.fields.map(f => fieldHTML(f, r[f.key], { prefix: 'r_', idEditable: fresh.has(r) })).join('')}
      </div></div>`;
  }
  const notFound = () => page('Not found', 'That page doesn’t exist.', '', '<a class="btn" href="#overview">Go to overview</a>');

  // story progress on Admin → Player: "done up to" a step, and badges
  function storyEditHTML(sv) {
    const steps = PP.Story.steps(data), cur = PP.Story.current(data, sv);
    const curIdx = cur ? steps.indexOf(cur) : steps.length;
    return `<div class="form-grid">
      <div class="f wide"><label class="fl" for="storyPos">Next story step</label>
        <select class="inp" id="storyPos" data-storypos>${steps.map((st, i) => `<option value="${i}"${i === curIdx ? ' selected' : ''}>${PP.esc(st.chapter)} · ${PP.esc(st.title)}</option>`).join('')}
          <option value="${steps.length}"${curIdx === steps.length ? ' selected' : ''}>Story finished</option></select>
        <p class="fh">Every step before the one picked counts as done. Areas that open at those steps open too.</p></div>
      <div class="f wide"><span class="fl">Badges</span><div class="multi">${data.badges.map(b => `<label class="multi-opt${sv.badges[b.id] ? ' on' : ''}"><input type="checkbox" data-badge="${PP.esc(b.id)}" ${sv.badges[b.id] ? 'checked' : ''}><span>${PP.esc(b.name)}</span></label>`).join('')}</div></div>
    </div>`;
  }
  // PC box editor on Admin → Player: species, nickname, partner, remove; plus "add" and the profile icon
  function boxHTML(sv) {
    const opts = sel => data.pokemon.map(p => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>#${String(p.dex).padStart(3, '0')} ${esc(p.name)}</option>`).join('');
    const owned = [...new Set(sv.box.map(b => b.species))];
    return `<table class="tbl"><thead><tr><th>Pokémon</th><th>Nickname</th><th class="r">Level</th><th class="r">Team</th><th class="r">Partner</th><th class="r">Remove</th></tr></thead><tbody>
      ${sv.box.map(b => `<tr data-box="${esc(b.uid)}">
        <td><select class="inp" data-bspecies style="max-width:220px">${opts(b.species)}</select></td>
        <td><input class="inp" data-bnick maxlength="16" value="${esc(b.nickname)}" placeholder="—"></td>
        <td class="r"><input class="inp tnum" type="number" min="1" max="100" data-blevel value="${b.level}" style="max-width:70px"></td>
        <td class="r"><input type="checkbox" data-bteam ${sv.team.includes(b.uid) ? 'checked' : ''}></td>
        <td class="r"><input type="radio" name="bpartner" value="${esc(b.uid)}" ${b.uid === sv.partner ? 'checked' : ''}></td>
        <td class="r"><input type="checkbox" data-bremove></td></tr>`).join('')}
      ${sv.box.length ? '' : '<tr><td colspan="6" class="fh">Empty: the player will be asked to choose a starter.</td></tr>'}
      <tr><td colspan="6"><select class="inp" data-badd style="max-width:320px"><option value="">Add a Pokémon to the box…</option>${opts('')}</select></td></tr>
      <tr><td colspan="4"><b>Profile icon</b></td><td colspan="2" class="r"><select class="inp" data-bavatar style="max-width:220px">
        <option value="">Same as the partner</option>
        ${owned.map(id => { const p = data.pokemon.find(x => x.id === id); return p ? `<option value="${esc(id)}"${id === sv.avatar ? ' selected' : ''}>${esc(p.name)}</option>` : ''; }).join('')}
      </select></td></tr></tbody></table>`;
  }
  // same as the game's "total" quest goals (js/game.js STATE_GOALS)
  function stateValue(sv, g) {
    const n = o => Object.keys(o || {}).length;
    const T = { level: sv.level, 'dex:caught': n(sv.dex.caught), 'dex:seen': n(sv.dex.seen), badges: n(sv.badges), trainers: n(sv.beaten), chapters: n(sv.story.chapters), owned: sv.box.length };
    if (g in T) return T[g];
    let m = /^chapter:(.+)$/.exec(g); if (m) return sv.story.chapters[m[1]] ? 1 : 0;
    m = /^badge:(.+)$/.exec(g); if (m) return sv.badges[m[1]] ? 1 : 0;
    return null;
  }
  function goalLabel(g) { const o = S.options('goals', data).find(x => x[0] === g); return o ? o[1] : g; }
  function logTable(list) {
    return `<table class="tbl"><tbody>${list.map(e => {
      const k = SC.logKinds[e.kind] || SC.logKinds.system;
      return `<tr><td class="time" title="${esc(new Date(e.t).toLocaleString())}">${esc(ago(e.t))}</td>
        <td style="width:1%"><span class="tag" style="--c:${k.color}">${esc(k.label)}</span></td><td>${esc(e.text)}</td></tr>`;
    }).join('')}</tbody></table>`;
  }
  function ago(t) {
    const s = Math.round((Date.now() - t) / 1000);
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  // ---------------- render ----------------
  async function loadOnline() {
    const el = document.getElementById('onlineBody'); if (!el) return;
    try {
      const [acc, players] = await Promise.all([PP.Cloud.getAccess(), PP.Cloud.listPlayers()]);
      const t = v => v && typeof v.toMillis === 'function' ? v.toMillis() : v && v.seconds ? v.seconds * 1000 : 0;
      const online = p => p.online && Date.now() - t(p.lastActive) < 3 * 60 * 1000;
      const when = v => t(v) ? esc(ago(t(v))) : '—';
      const dot = p => `<span class="odot${online(p) ? ' on' : ''}" title="${online(p) ? 'Online' : 'Offline'}"></span>`;
      const joined = players.slice().sort((a, b) => t(b.joined) - t(a.joined)).slice(0, 10);
      const played = players.slice().sort((a, b) => (online(b) - online(a)) || t(b.lastActive) - t(a.lastActive));
      const name = p => `<b>${esc(p.name || '(choosing a name)')}</b>`;
      el.innerHTML = `<div class="tiles" style="margin-bottom:18px">
          <div class="tile"><small>Players</small><b>${players.length}</b></div>
          <div class="tile"><small>Online now</small><b>${players.filter(online).length}</b></div>
          <div class="tile"><small>Joined this week</small><b>${players.filter(p => Date.now() - t(p.joined) < 7 * 864e5).length}</b></div>
        </div>`
        + panel('Recently joined', joined.length ? `<table class="tbl"><thead><tr><th>Player</th><th>Google account</th><th class="r">Joined</th></tr></thead><tbody>
          ${joined.map(p => `<tr><td>${dot(p)} ${name(p)}</td><td>${esc(p.email || '—')}</td><td class="r">${when(p.joined)}</td></tr>`).join('')}</tbody></table>`
          : '<div class="empty-note">Nobody has joined yet.</div>', { flush: true })
        + panel(`Players (${players.length})`, players.length ? `<table class="tbl"><thead><tr><th>Player</th><th class="r">Trainer Lv</th><th class="r">Badges</th><th class="r">Caught</th><th class="r">Last played</th></tr></thead><tbody>
          ${played.map(p => `<tr><td>${dot(p)} ${name(p)}</td><td class="r tnum">${p.level || 1}</td><td class="r tnum">${p.badges || 0}</td><td class="r tnum">${p.caught || 0}</td>
            <td class="r">${online(p) ? '<b style="color:#16a34a">Online now</b>' : when(p.lastActive || p.at)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty-note">Nobody has played online yet.</div>', { flush: true })
        + panel('Admins', `<div class="form-grid">
          <div class="f"><label class="fl" for="accAdmins">Admins (one email per line)</label>
            <textarea class="inp" id="accAdmins" rows="4" style="height:auto;padding:8px 11px" spellcheck="false">${esc(acc.admins.join('\n'))}</textarea>
            <p class="fh">Can open this admin and change the game for everyone. The owner email in firestore.rules always can.</p></div>
        </div><div style="margin-top:12px">${btn('Save admins', 'access-save', { cls: 'btn-primary', icon: 'check' })}</div>`);
    } catch (e) { el.innerHTML = `<div class="empty-note">Couldn’t load the online data (${esc(e.code || e.message)}).</div>`; }
  }
  async function saveAccess() {
    const list = id => [...new Set(document.getElementById(id).value.split(/[\s,;]+/).map(x => x.trim().toLowerCase()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)))];
    const acc = { players: [], admins: list('accAdmins') };            // anyone with a Google account can play
    try { await PP.Cloud.setAccess(acc); S.log('admin', `Admin list saved: ${acc.admins.length} admins`); toast('Admins saved'); loadOnline(); }
    catch (e) { toast('Couldn’t save: ' + (e.code || e.message)); }
  }
  function render() {
    document.getElementById('sideNav').innerHTML = navHTML();
    const [kind, arg] = view.split('/');
    main.innerHTML = kind === 'settings' ? settingsView(arg) : kind === 'content' ? collectionView(arg) : (VIEWS[kind] || notFound)();
    setDirty(false);
    document.title = (main.querySelector('h1') || {}).textContent + ' · Pocket Pals Admin';
    updateStatus();
  }
  function rerenderCollectionParts(key) {
    document.getElementById('clist').innerHTML = listHTML(key);
    document.getElementById('ceditor').innerHTML = editorHTML(key);
  }

  // ---------------- saving ----------------
  function saveCurrent() {
    const [kind, arg] = view.split('/');
    if (kind === 'settings') return saveSettings(arg);
    if (kind === 'content') return saveCollection(arg);
    if (kind === 'player') return savePlayer();
  }
  function saveSettings(id) {
    const g = SC.settings.find(x => x.id === id);
    const vals = readFields(main.querySelector('[data-form="settings"]'), g.fields);
    const before = data.settings;
    data = S.writeData(Object.assign({}, data, { settings: Object.assign({}, data.settings, vals) }));
    const changed = g.fields.filter(f => before[f.key] !== data.settings[f.key]);
    if (changed.length) S.log('admin', `${g.label}: ` + changed.map(f => `${f.label} ${short(before[f.key])} → ${short(data.settings[f.key])}`).join('; '));
    toast(changed.length ? 'Settings saved' : 'Nothing changed');
    render();
  }
  function short(v) { const s = typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v); return s.length > 40 ? s.slice(0, 37) + '…' : (s || '(empty)'); }

  function saveCollection(key) {
    const c = SC.collections[key];
    const ids = draft.map(r => PP.slug(r.id));
    const bad = ids.findIndex(id => !id);
    if (bad >= 0) { sel = bad; rerenderCollectionParts(key); return alert('Every row needs an ID.'); }
    const dupe = ids.findIndex((id, i) => ids.indexOf(id) !== i);
    if (dupe >= 0) { sel = dupe; rerenderCollectionParts(key); return alert(`The ID “${ids[dupe]}” is used twice. IDs must be unique.`); }
    const before = data[key];
    data = S.writeData(Object.assign({}, data, { [key]: draft }));
    const bIds = before.map(r => r.id), aIds = data[key].map(r => r.id);
    const added = aIds.filter(id => !bIds.includes(id)), removed = bIds.filter(id => !aIds.includes(id));
    const edited = data[key].filter(r => { const b = before.find(x => x.id === r.id); return b && JSON.stringify(b) !== JSON.stringify(r); }).map(r => r.id);
    const moved = !added.length && !removed.length && bIds.join() !== aIds.join();
    const parts = [];
    if (added.length) parts.push('added ' + added.join(', '));
    if (removed.length) parts.push('removed ' + removed.join(', '));
    if (edited.length) parts.push('edited ' + edited.join(', '));
    if (moved) parts.push('reordered');
    if (parts.length) S.log('admin', `${c.label}: ${parts.join('; ')}`);
    toast(parts.length ? `${c.label} saved` : 'Nothing changed');
    draft = null; render();
  }

  function savePlayer() {
    const form = main.querySelector('[data-form="player"]');
    const sv = S.loadSave(data), before = S.clone(sv), notes = [];
    if (touched.has('profile')) {
      Object.assign(sv, readFields(form, SC.save));
      SC.save.forEach(f => { if (String(before[f.key]) !== String(sv[f.key])) notes.push(`${f.label} ${short(before[f.key])} → ${short(sv[f.key])}`); });
      sv.name = String(sv.name || '').trim();
      if (sv.name && sv.name !== before.name) S.claimName(sv.name, before.name);
    }
    if (touched.has('needs')) {
      form.querySelectorAll('[data-need]').forEach(el => { sv.needs[el.dataset.need] = Number(el.value); });
      notes.push('needs set to ' + data.needs.map(n => `${n.label} ${Math.round(sv.needs[n.id])}`).join(', '));
    }
    if (touched.has('inventory')) {
      form.querySelectorAll('[data-inv]').forEach(el => { sv.inventory[el.dataset.inv] = Math.max(0, Math.round(Number(el.value) || 0)); });
      const add = form.querySelector('[data-addinv]'), addQty = form.querySelector('[data-addqty]');
      if (add && add.value) sv.inventory[add.value] = Math.max(1, Math.round(Number(addQty.value) || 1));
      const ch = data.items.filter(it => (before.inventory[it.id] || 0) !== (sv.inventory[it.id] || 0)).map(it => `${it.name} ${before.inventory[it.id] || 0} → ${sv.inventory[it.id] || 0}`);
      if (ch.length) notes.push('bag: ' + ch.join(', '));
    }
    if (touched.has('quests')) {
      data.quests.forEach(q => {
        const p = form.querySelector(`[data-qp="${CSS.escape(q.id)}"]`), cl = form.querySelector(`[data-qc="${CSS.escape(q.id)}"]`);
        const st = sv.quests[q.id] || { progress: 0, claimed: false };
        sv.quests[q.id] = { progress: p ? Math.max(0, Math.min(q.target, Math.round(Number(p.value) || 0))) : st.progress, claimed: cl ? cl.checked : st.claimed };
      });
      notes.push('quest progress updated');
    }
    if (touched.has('story')) {
      const steps = PP.Story.steps(data), idx = Number(form.querySelector('[data-storypos]').value), now = Date.now();
      sv.story.done = {};
      steps.slice(0, idx).forEach(st => { sv.story.done[st.id] = (before.story.done || {})[st.id] || now; });
      sv.story.chapters = Object.fromEntries(data.chapters.filter(c => PP.Story.chapterDone(data, sv, c.id)).map(c => [c.id, (before.story.chapters || {})[c.id] || now]));
      sv.badges = {};
      form.querySelectorAll('[data-badge]').forEach(el => { if (el.checked) sv.badges[el.dataset.badge] = (before.badges || {})[el.dataset.badge] || now; });
      notes.push(`story set to “${idx < steps.length ? steps[idx].title : 'finished'}”, ${Object.keys(sv.badges).length} badge(s)`);
    }
    if (touched.has('box')) {
      const rows = [...form.querySelectorAll('[data-box]')];
      const kept = rows.filter(r => !r.querySelector('[data-bremove]').checked);
      sv.box = kept.map(r => {
        const old = before.box.find(b => b.uid === r.dataset.box) || {};
        const species = r.querySelector('[data-bspecies]').value, sp = data.pokemon.find(p => p.id === species) || {};
        const level = Math.max(1, Math.min(100, Math.round(Number(r.querySelector('[data-blevel]').value) || 1)));
        const exp = old.species === species && old.level === level ? old.exp : S.expForLevel(sp.growth, level);
        return { uid: r.dataset.box, species, nickname: r.querySelector('[data-bnick]').value.trim(), since: old.since || Date.now(), level, exp, caughtAt: old.caughtAt || 'Admin' };
      });
      const add = form.querySelector('[data-badd]');
      if (add && add.value) sv.box.push({ uid: 'p' + Date.now().toString(36), species: add.value, nickname: '', since: Date.now(), level: 5, exp: S.expForLevel((data.pokemon.find(p => p.id === add.value) || {}).growth, 5), caughtAt: 'Admin' });
      sv.team = kept.filter(r => r.querySelector('[data-bteam]').checked).map(r => r.dataset.box).slice(0, data.settings.teamMax);
      if (add && add.value && sv.team.length < data.settings.teamMax) sv.team.push(sv.box[sv.box.length - 1].uid);
      const pr = form.querySelector('input[name="bpartner"]:checked');
      sv.partner = pr && sv.box.some(b => b.uid === pr.value) ? pr.value : (sv.box[0] || {}).uid || '';
      sv.avatar = (form.querySelector('[data-bavatar]') || {}).value || '';
      const nm = b => (data.pokemon.find(p => p.id === b.species) || {}).name || b.species;
      notes.push('PC box: ' + (sv.box.map(nm).join(', ') || 'empty'));
    }
    S.writeSave(S.normalizeSave(sv, data));
    if (notes.length) S.log('admin', 'Player edited: ' + notes.join('; '));
    toast('Player saved');
    render();
  }

  function quick(q) {
    const sv = S.loadSave(data), s = data.settings;
    let note = '';
    switch (q) {
      case 'coins': sv.coins += 100; note = `+100 ${s.coinName}`; break;
      case 'gems': sv.gems += 10; note = `+10 ${s.gemName}`; break;
      case 'fill': data.needs.forEach(n => { sv.needs[n.id] = 100; }); note = 'all needs filled'; break;
      case 'level': if (sv.level >= s.maxLevel) return toast('Already at the level cap'); sv.level++; sv.exp = 0; note = `level → ${sv.level}`; break;
      case 'cool': sv.cooldowns = {}; note = 'cooldowns cleared'; break;
      case 'daily': sv.daily = { day: '', ids: [] }; note = 'new day of daily quests'; break;
      case 'fast':
        data = S.writeData(Object.assign({}, data, { settings: Object.assign({}, s, { fastTime: !s.fastTime }) }));
        S.log('admin', `Fast time ${data.settings.fastTime ? 'on' : 'off'}`);
        toast(`Fast time ${data.settings.fastTime ? 'on' : 'off'}`); render(); return;
    }
    S.writeSave(sv);
    S.log('admin', 'Quick adjustment: ' + note);
    toast(note.charAt(0).toUpperCase() + note.slice(1));
    if (!dirty) render();
  }

  // ---------------- file helpers ----------------
  function download(name, obj) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  function importFile(file) {
    const rd = new FileReader();
    rd.onload = () => {
      let j;
      try { j = JSON.parse(rd.result); } catch (e) { return alert('That file isn’t valid JSON.'); }
      const has = ['data', 'save', 'log'].filter(k => j && j[k] != null);
      if (!has.length) return alert('No Pocket Pals data found in that file (expected "data", "save" and/or "log").');
      if (!confirm(`Replace ${has.join(', ')} with the contents of “${file.name}”?`)) return;
      if (j.data) data = S.writeData(j.data);
      if (j.save) S.writeSave(S.normalizeSave(j.save, data));
      if (j.log) S.writeLog(j.log);
      S.log('admin', `Imported ${has.join(', ')} from ${file.name}`);
      toast('Imported'); render();
    };
    rd.readAsText(file);
  }

  // ---------------- events ----------------
  main.addEventListener('input', e => {
    if (e.target.id === 'cfilter') { cfilter = e.target.value; document.getElementById('clist').innerHTML = listHTML(view.split('/')[1]); return; }
    onEdit(e);
  });
  main.addEventListener('change', e => {
    if (e.target.id === 'cfilter') return;
    if (e.target.id === 'importFile' && e.target.files[0]) { importFile(e.target.files[0]); e.target.value = ''; return; }
    if (e.target.matches('[data-key="id"]') && view.startsWith('content/')) e.target.value = PP.slug(e.target.value);
    onEdit(e);
  });
  function onEdit(e) {
    const t = e.target;
    if (t.id === 'importFile') return;
    const sec = t.closest('[data-sec]');
    if (!sec && !t.closest('[data-form="settings"]')) return;
    if (sec) touched.add(sec.dataset.sec);
    if (t.type === 'color') t.nextElementSibling.textContent = t.value;
    if (t.closest('.multi-opt')) t.closest('.multi-opt').classList.toggle('on', t.checked);
    const prev = t.parentNode.querySelector('.img-prev');
    if (prev && e.type === 'change') {
      prev.classList.remove('bad');
      prev.innerHTML = (t.value ? `<img src="${esc(t.value)}" alt="">` : '') + '<span>Image not found</span>';
      const img = prev.querySelector('img'); if (img) img.onerror = () => prev.classList.add('bad');
    }
    if (t.dataset.need) { const o = main.querySelector(`[data-out="${CSS.escape(t.dataset.need)}"]`); if (o) o.textContent = t.value; }
    if (view.startsWith('content/') && draft && draft[sel]) {
      const key = view.split('/')[1], c = SC.collections[key];
      Object.assign(draft[sel], readFields(document.getElementById('ceditor'), c.fields));
      document.getElementById('clist').innerHTML = listHTML(key);
      const h = document.querySelector('#ceditor .panel-head h2'); if (h) h.textContent = c.title(draft[sel]) || 'Untitled';
    }
    setDirty(true);
  }

  main.addEventListener('click', e => {
    const b = e.target.closest('[data-do]'); if (!b) return;
    const key = view.split('/')[1], c = SC.collections[key];
    switch (b.dataset.do) {
      case 'save': saveCurrent(); break;
      case 'discard': draft = null; render(); break;
      case 'open-game': window.open('index.html', '_blank'); break;
      case 'recheck': render(); toast('Checked'); break;
      case 'quick': quick(b.dataset.q); break;
      case 'access-save': saveAccess(); break;
      case 'filter': logFilter = b.dataset.k; render(); break;
      case 'defaults': {
        const g = SC.settings.find(x => x.id === key);
        g.fields.forEach(f => {
          const el = main.querySelector(`[data-key="${f.key}"]`); if (!el) return;
          if (f.type === 'bool') el.checked = !!f.def; else el.value = f.def;
          if (f.type === 'color') el.nextElementSibling.textContent = f.def;
        });
        setDirty(true); toast('Defaults filled in. Save to apply.'); break;
      }
      // collections
      case 'pick': sel = Number(b.dataset.i); rerenderCollectionParts(key); break;
      case 'add': case 'dup': {
        const src = b.dataset.do === 'dup' ? draft[sel] : null;
        if (b.dataset.do === 'dup' && !src) break;
        const row = src ? S.clone(src) : S.defaultRow(c);
        const base = PP.slug(src ? src.id : c.single) || 'row';
        let n = 2, id = src ? `${base}-copy` : `${base}-${draft.length + 1}`;
        while (draft.some(r => r.id === id)) id = `${base}-${n++}`;
        row.id = id;
        if (src) { const tf = c.fields.find(f => f.type === 'text'); if (tf) row[tf.key] = String(row[tf.key] || '') + ' copy'; }
        draft.push(row); fresh.add(row); sel = draft.length - 1;
        rerenderCollectionParts(key); setDirty(true);
        const first = document.querySelector('#ceditor input:not([readonly])'); if (first) first.focus();
        break;
      }
      case 'del':
        if (!draft[sel] || !confirm(`Delete “${c.title(draft[sel]) || draft[sel].id}”? Anything that used it falls back to a default when you save.`)) break;
        draft.splice(sel, 1); sel = Math.max(0, sel - 1); rerenderCollectionParts(key); setDirty(true); break;
      case 'move': {
        const j = sel + Number(b.dataset.dir);
        if (j < 0 || j >= draft.length) break;
        [draft[sel], draft[j]] = [draft[j], draft[sel]]; sel = j; rerenderCollectionParts(key); setDirty(true); break;
      }
      case 'coll-defaults':
        if (!confirm(`Replace the ${c.label.toLowerCase()} list with the built-in defaults? (Nothing is saved until you press Save.)`)) break;
        draft = S.clone(c.rows); sel = 0; rerenderCollectionParts(key); setDirty(true); break;
      // data
      case 'export-all': download(`pocket-pals-backup-${stamp()}.json`, { app: 'pocket-pals', version: SC.version, exportedAt: new Date().toISOString(), data, save: S.loadSave(data), log: S.getLog() }); break;
      case 'release-name': if (confirm(`Release the name “${b.dataset.name}” so someone else can use it?`)) { S.releaseName(b.dataset.name); S.log('admin', `Released the name ${b.dataset.name}`); render(); } break;
      case 'export-log': download(`pocket-pals-activity-${stamp()}.json`, { log: S.getLog() }); break;
      case 'clear-log': if (confirm('Clear the whole activity log?')) { S.clearLog(); S.log('admin', 'Activity log cleared'); render(); } break;
      case 'reset-data': if (confirm('Reset all settings and content to the defaults?')) { S.reset('data'); data = S.loadData(); S.log('admin', 'Content and settings reset to defaults'); toast('Content reset'); render(); } break;
      case 'reset-player': if (confirm('Replace the player save with a brand-new one?')) { S.writeSave(S.newSave(data)); S.log('admin', 'Player reset to a new save'); toast('Player reset'); render(); } break;
      case 'reset-all': if (confirm('Reset content, the player save and the activity log? This can’t be undone.')) { S.reset('all'); data = S.loadData(); S.writeSave(S.newSave(data)); S.log('admin', 'Everything reset'); toast('Everything reset'); render(); } break;
    }
  });

  // ---------------- live updates from the game ----------------
  S.onExternal(k => {
    if (k === 'data' || k === 'all') data = S.loadData();
    updateStatus();
    if (dirty) return;                                                // never throw away edits
    const a = document.activeElement;
    if (a && main.contains(a) && a.matches('input, select, textarea')) return;   // don't steal focus
    if (view === 'overview' || view === 'activity' || view === 'player' || k === 'data' || k === 'all') { draft = null; render(); }
  });
  function updateStatus() {
    const raw = S.rawSave(), live = raw && Date.now() - Number(raw.lastTick) < 12000;
    document.getElementById('status').innerHTML = `<span class="dot${live ? ' on' : ''}"></span><span>${live ? 'Game is open' : 'Game not running'}</span>`;
  }
  setInterval(updateStatus, 3000);

  function toast(text) {
    const box = document.getElementById('toasts'), el = document.createElement('div');
    el.className = 'toast'; el.textContent = text; box.appendChild(el);
    setTimeout(() => el.remove(), 2400);
  }

  go();
});
