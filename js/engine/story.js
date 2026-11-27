// Story: where the player is in the journey. Pure functions over (data, save); no UI.
// Steps run in list order (Admin → Content → Story steps); the current step is the first one not done.
window.PP = window.PP || {};
(function () {
  'use strict';
  const steps = d => d.storySteps.filter(s => s.enabled && d.chapters.some(c => c.id === s.chapter));
  const current = (d, save) => steps(d).find(s => !save.story.done[s.id]) || null;
  const chapterOf = (d, id) => d.chapters.find(c => c.id === id) || null;
  /** the chapter to show: the one with the current step, or the last one when the story is finished */
  function currentChapter(d, save) {
    const s = current(d, save);
    if (s) return chapterOf(d, s.chapter);
    const all = steps(d);
    return all.length ? chapterOf(d, all[all.length - 1].chapter) : null;
  }
  const chapterSteps = (d, id) => steps(d).filter(s => s.chapter === id);
  const chapterDone = (d, save, id) => { const l = chapterSteps(d, id); return l.length > 0 && l.every(s => save.story.done[s.id]); };

  /** a trainer's team as [{ species, level }]. "counter:7" = the starter that beats the player's starter */
  function team(d, save, trainer) {
    const out = [];
    String(trainer.team || '').split(',').map(x => x.trim()).filter(Boolean).forEach(tok => {
      const [id, lv] = tok.split(':').map(x => x.trim());
      const level = Math.max(1, Math.min(100, parseInt(lv, 10) || 5));
      if (id === 'counter') {
        const sp = counterStarter(d, save);
        if (sp) out.push({ species: sp.id, level });
      } else if (d.pokemon.some(p => p.id === id)) out.push({ species: id, level });
    });
    return out;
  }
  function counterStarter(d, save) {
    const starters = d.pokemon.filter(p => p.starter);
    const mine = save && (save.box.find(e => e.caughtAt === 'Starter') || save.box[0]);
    const myType = mine && (d.pokemon.find(p => p.id === mine.species) || {}).type1;
    const beats = sp => PP.Battle && myType ? PP.Battle.effect(sp.type1, { types: [myType] }) > 1 : false;
    return starters.find(beats) || starters.find(sp => !mine || sp.id !== mine.species) || starters[0] || null;
  }
  const trainerName = t => `${t.trainerClass} ${t.name}`.trim();

  PP.Story = { steps, current, currentChapter, chapterOf, chapterSteps, chapterDone, team, trainerName };
})();
