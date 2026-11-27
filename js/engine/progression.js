// Progression: is an area unlocked, and if not, exactly what is still needed.
// Pure functions over (data, save); no UI. Used by the game and by the admin's content check.
window.PP = window.PP || {};
(function () {
  'use strict';
  const name = (list, id) => (list.find(x => x.id === id) || {}).name || id;
  const visited = (save, id) => ((save.areas[id] || {}).explores || 0) > 0;

  /** every requirement of an area, each with whether the player meets it */
  function requirements(d, save, area) {
    const reqs = [];
    if (area.reqStep && area.reqStep !== 'none') {
      const st = d.storySteps.find(x => x.id === area.reqStep);
      reqs.push({ kind: 'story', id: area.reqStep, ok: !!(save.story && save.story.done[area.reqStep]), text: `Story: “${st ? st.title : area.reqStep}”` });
    }
    if (area.unlockLevel > 1) reqs.push({ kind: 'level', ok: save.level >= area.unlockLevel, text: `Trainer Lv ${area.unlockLevel}`, have: `Lv ${save.level}` });
    (area.reqAreas || []).forEach(id => reqs.push({ kind: 'area', id, ok: visited(save, id), text: `Visit ${name(d.locations, id)}` }));
    (area.reqItems || []).forEach(id => reqs.push({ kind: 'item', id, ok: (save.inventory[id] || 0) > 0, text: `Have ${name(d.items, id)}` }));
    return reqs;
  }
  const unlocked = (d, save, area) => area.enabled && requirements(d, save, area).every(r => r.ok);
  /** the requirements still missing, as short text ("Trainer Lv 5 · Visit Mossglow Woods") */
  const missingText = (d, save, area) => requirements(d, save, area).filter(r => !r.ok).map(r => r.text).join(' · ');

  /** species that can appear in an area (from its enabled tables) */
  function areaSpecies(d, areaId) {
    const tables = new Set(d.encounterTables.filter(t => t.enabled && t.location === areaId).map(t => t.id));
    return [...new Set(d.encounters.filter(e => tables.has(e.table)).map(e => e.species))];
  }
  /** how complete an area is: discovered species, or visits for areas without wild Pokémon */
  function completion(d, save, areaId) {
    const all = areaSpecies(d, areaId), st = save.areas[areaId] || { explores: 0, seen: {} };
    const found = all.filter(id => st.seen[id]).length;
    const pct = all.length ? found / all.length * 100 : Math.min(100, st.explores * 20);
    return { found, total: all.length, explores: st.explores, pct: Math.round(pct) };
  }

  PP.Progress = { requirements, unlocked, missingText, areaSpecies, completion, visited };
})();
