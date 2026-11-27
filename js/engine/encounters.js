// Encounters: two separate rolls, as designed.
//   1. does this explore find a wild Pokémon at all?  (the area's encounterChance)
//   2. which one?  (weighted pick from the area's table for the method, by each entry's share)
window.PP = window.PP || {};
(function () {
  'use strict';
  const METHOD_FOR = { cave: 'cave', water: 'surf', hideout: 'cave' };       // other environments walk through grass

  /** the table used when exploring an area normally (cave areas use cave tables, and so on) */
  function tableFor(d, area, method) {
    const want = method || METHOD_FOR[area.environment] || 'walking';
    const tables = d.encounterTables.filter(t => t.enabled && t.location === area.id);
    return tables.find(t => t.method === want) || tables.find(t => t.method === 'walking') || null;
  }
  const entriesOf = (d, table) => d.encounters.filter(e => e.table === table.id && e.weight > 0 && d.pokemon.some(p => p.id === e.species));

  /** weighted pick: an entry with 30% is picked about 30% of the time */
  function pick(entries, rnd = Math.random) {
    const total = entries.reduce((s, e) => s + e.weight, 0);
    if (!total) return null;
    let r = rnd() * total;
    for (const e of entries) { r -= e.weight; if (r < 0) return e; }
    return entries[entries.length - 1];
  }
  /** roll an explore: null (no Pokémon) or { species, level, table, rarity } */
  function roll(d, area, rnd = Math.random) {
    if (area.environment === 'town' || !(rnd() * 100 < area.encounterChance)) return null;
    const table = tableFor(d, area); if (!table) return null;
    const e = pick(entriesOf(d, table), rnd); if (!e) return null;
    const lo = Math.min(e.minLevel, e.maxLevel), hi = Math.max(e.minLevel, e.maxLevel);
    return { species: e.species, level: lo + Math.floor(rnd() * (hi - lo + 1)), table: table.id, rarity: e.rarity };
  }

  PP.Encounters = { tableFor, entriesOf, pick, roll };
})();
