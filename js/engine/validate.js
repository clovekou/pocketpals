// Content check: finds mistakes in the game data before players do.
// PP.validate(data) → [{ level: 'error' | 'warning', area: 'Encounters' | 'Areas' | …, text }]
window.PP = window.PP || {};
(function () {
  'use strict';
  PP.validate = function (d) {
    const out = [], err = (area, text) => out.push({ level: 'error', area, text }), warn = (area, text) => out.push({ level: 'warning', area, text });
    const byId = (list, id) => list.find(x => x.id === id);
    const locName = id => (byId(d.locations, id) || {}).name || id;

    // ---- encounter tables: totals, references, legendaries in ordinary tables
    d.encounterTables.forEach(t => {
      if (!byId(d.locations, t.location)) err('Encounters', `“${t.name}” belongs to an area that doesn’t exist (${t.location || 'none'}).`);
      const entries = d.encounters.filter(e => e.table === t.id);
      if (!t.enabled) return;
      if (!entries.length) { warn('Encounters', `“${t.name}” has no Pokémon in it.`); return; }
      const total = Math.round(entries.reduce((s, e) => s + e.weight, 0) * 100) / 100;
      if (Math.abs(total - 100) > 0.001) err('Encounters', `“${t.name}” adds up to ${total}%, not 100%.`);
      if (!['legendary', 'static', 'special'].includes(t.method)) entries.forEach(e => {
        const p = byId(d.pokemon, e.species);
        if (p && p.legendary) warn('Encounters', `${p.name} is legendary but is in the ordinary table “${t.name}”.`);
      });
    });
    d.encounters.forEach(e => {
      if (!byId(d.encounterTables, e.table)) err('Encounters', `Entry ${e.id} points to a table that doesn’t exist.`);
      const p = byId(d.pokemon, e.species);
      if (!p) err('Encounters', `Entry ${e.id} uses a Pokémon that doesn’t exist.`);
      else if (PP.Sprite && !PP.Sprite.has(p.folder)) warn('Encounters', `${p.name} (in ${e.table}) has no sprites, so it can’t be shown.`);
      if (e.minLevel > e.maxLevel) warn('Encounters', `Entry ${e.id}: lowest level is above highest level.`);
    });

    // ---- areas: encounters configured, circular and impossible requirements
    d.locations.filter(a => a.enabled).forEach(a => {
      if (a.environment !== 'town' && a.encounterChance > 0 && !PP.Encounters.tableFor(d, a)) warn('Areas', `${a.name} has a ${a.encounterChance}% wild Pokémon chance but no encounter table.`);
      if (!byId(d.regions, a.region)) err('Areas', `${a.name} belongs to a region that doesn’t exist.`);
      if (a.unlockLevel > d.settings.maxLevel) err('Areas', `${a.name} needs trainer Lv ${a.unlockLevel}, above the level cap (${d.settings.maxLevel}).`);
      (a.reqAreas || []).forEach(id => { const r = byId(d.locations, id); if (r && !r.enabled) err('Areas', `${a.name} needs a visit to ${r.name}, which is closed.`); });
    });
    // circular requirements (A needs B, B needs A)
    const state = {};
    const visit = (id, path) => {
      if (state[id] === 'done') return;
      if (state[id] === 'busy') { err('Areas', `Circular requirement: ${path.concat(id).map(locName).join(' → ')}.`); return; }
      state[id] = 'busy';
      const a = byId(d.locations, id);
      (a ? a.reqAreas || [] : []).forEach(r => visit(r, path.concat(id)));
      state[id] = 'done';
    };
    d.locations.forEach(a => visit(a.id, []));
    // unreachable: walk forward from areas with no area requirements
    const reach = new Set();
    let grew = true;
    while (grew) {
      grew = false;
      d.locations.filter(a => a.enabled && !reach.has(a.id) && (a.reqAreas || []).every(id => reach.has(id))).forEach(a => { reach.add(a.id); grew = true; });
    }
    d.locations.filter(a => a.enabled && !reach.has(a.id)).forEach(a => err('Areas', `${a.name} can never be unlocked: its required areas can’t be reached.`));
    d.regions.filter(r => r.enabled && !d.locations.some(a => a.enabled && a.region === r.id)).forEach(r => warn('Regions', `${r.name} has no open areas.`));

    // ---- story and trainers
    d.trainers.forEach(t => {
      const toks = String(t.team || '').split(',').map(x => x.trim()).filter(Boolean);
      if (!toks.length) err('Trainers', `${t.trainerClass} ${t.name} has no team.`);
      toks.forEach(tok => { const id = tok.split(':')[0].trim(); if (id !== 'counter' && !byId(d.pokemon, id)) err('Trainers', `${t.trainerClass} ${t.name}: “${id}” isn’t a Pokémon.`); });
      if (toks.length > 6) warn('Trainers', `${t.trainerClass} ${t.name} has more than 6 Pokémon.`);
    });
    d.storySteps.filter(st => st.enabled).forEach(st => {
      if (st.type === 'trainer' && (st.trainer === 'none' || !byId(d.trainers, st.trainer))) err('Story', `Step “${st.title}” is a trainer battle without a trainer.`);
      if (st.type === 'wild' && !byId(d.pokemon, st.species)) err('Story', `Step “${st.title}” is a set encounter without a Pokémon.`);
      if (st.type === 'arrive' && (st.area === 'none' || !byId(d.locations, st.area))) err('Story', `Step “${st.title}” arrives at an area that doesn’t exist.`);
      if (!byId(d.chapters, st.chapter)) err('Story', `Step “${st.title}” belongs to a chapter that doesn’t exist.`);
    });
    d.locations.filter(a => a.enabled && a.reqStep && a.reqStep !== 'none').forEach(a => {
      const st = byId(d.storySteps, a.reqStep);
      if (!st) err('Areas', `${a.name} opens at a story step that doesn’t exist.`);
      else if (!st.enabled) err('Areas', `${a.name} opens at “${st.title}”, which is switched off, so it never opens.`);
    });
    d.chapters.forEach(c => { if (!d.storySteps.some(st => st.enabled && st.chapter === c.id)) warn('Story', `Chapter ${c.number} has no steps yet.`); });

    // ---- quests that point at missing things
    const goals = new Set(PP.store.options('goals', d).map(o => o[0]).concat(d.storySteps.map(st => 'story:' + st.id)));
    d.quests.filter(q => q.active).forEach(q => {
      const m = /^explore:(.+)$/.exec(q.goal);
      if (m && m[1] !== 'any') { const a = byId(d.locations, m[1]); if (!a || !a.enabled) warn('Quests', `“${q.title}” asks to explore an area that’s closed or missing.`); }
      else if (!goals.has(q.goal)) err('Quests', `“${q.title}” has a goal that no longer exists (${q.goal}).`);
      if (/^(chapter|badge):/.test(q.goal) && q.target !== 1) warn('Quests', `“${q.title}” needs ${q.target}, but a chapter or badge only counts once. Set “How many” to 1.`);
      if (q.rewardItem && q.rewardItem !== 'none' && !byId(d.items, q.rewardItem)) err('Quests', `“${q.title}” rewards an item that doesn’t exist.`);
    });
    if (d.settings.dailyPick > 0 && !d.quests.some(q => q.active && q.kind === 'daily')) warn('Quests', 'There are no active daily quests, so the Daily tab is empty.');
    return out;
  };
})();
