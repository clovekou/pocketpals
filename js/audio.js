// Sound: chiptune music and battle sound effects, made live with the Web Audio API (no audio files needed).
//
//   PP.Audio.configure(data)    read volumes, switches and tracks from the admin's settings
//   PP.Audio.play(trackId)      start a music track (Content → Music); the same id keeps playing
//   PP.Audio.sfx(name)          hit, super, weak, crit, miss, faint, throw, shake, catch, breakout,
//                               heal, levelup, run, victory, lose, coin, click, pop
//   PP.Audio.prefs()/setPrefs() this player's own music / sound switches (kept on this device)
//
// Each track in Content → Music either plays one of the built-in pieces below or the player's own
// audio file. All the pieces are original compositions written for this game.
window.PP = window.PP || {};
(function () {
  'use strict';
  const PREF_KEY = 'pp2.audio';

  // ---------------- the built-in pieces ----------------
  // chords: one per bar. lead/arp/bass: `div` steps per beat; tokens: note, '-' hold, '.' rest.
  // bass tokens: R root, O octave up, 5 fifth. drums: 16 steps per bar ('x' = hit).
  const PIECES = {
    cozy: {
      name: 'Meadow Home (cozy)', bpm: 88,
      chords: ['F', 'Am', 'Bb', 'C', 'F', 'Dm', 'Bb', 'C'],
      lead: { wave: 'triangle', vol: .22, div: 2, notes:
        'A4 - C5 - A4 G4 F4 - | E4 - A4 - C5 - A4 G4 | F4 - D5 - C5 Bb4 A4 - | G4 - - - C5 - - . | ' +
        'A4 - C5 - F5 - E5 D5 | C5 - A4 - D5 - C5 A4 | Bb4 - D5 - C5 - Bb4 A4 | G4 - A4 - G4 - - .' },
      arp: { wave: 'sine', vol: .07, div: 4, oct: 4, pattern: [0, 1, 2, 1] },
      bass: { wave: 'sine', vol: .2, div: 2, oct: 2, pattern: 'R - - . 5 - - .' },
      pad: { wave: 'sine', vol: .035, oct: 4 },
      drums: { vol: .25, hat: '....x.......x...' },
    },
    wild: {
      name: 'Tall Grass Clash (wild battle)', bpm: 152,
      chords: ['Am', 'F', 'C', 'G', 'Am', 'F', 'G', 'E'],
      lead: { wave: 'square', vol: .1, div: 2, notes:
        'A4 . A4 C5 E5 - D5 C5 | D5 - C5 - A4 - F4 . | G4 . G4 C5 E5 - G5 E5 | D5 - - - B4 - G4 . | ' +
        'A4 . A4 C5 E5 - A5 G5 | F5 - E5 - D5 - C5 . | B4 - D5 - G5 - F5 D5 | E5 - - - G#4 - B4 .' },
      arp: { wave: 'triangle', vol: .06, div: 4, oct: 5, pattern: [0, 2, 1, 2] },
      bass: { wave: 'triangle', vol: .26, div: 4, oct: 2, pattern: 'R . R . O . R . R . R . O . 5 .' },
      drums: { vol: .5, kick: 'x.....x.x.......', snare: '....x.......x...', hat: 'x.x.x.x.x.x.x.x.' },
    },
    trainer: {
      name: 'Rival Steps (trainer battle)', bpm: 168,
      chords: ['Dm', 'Bb', 'C', 'A', 'Dm', 'Bb', 'Gm', 'A'],
      lead: { wave: 'square', vol: .1, div: 2, notes:
        'D5 . F5 . A5 - G5 F5 | F5 - D5 - Bb4 - D5 . | E5 . G5 . C6 - Bb5 A5 | A5 - - - C#5 - E5 . | ' +
        'D5 F5 A5 F5 D6 - C6 A5 | Bb5 - A5 - F5 - D5 . | G5 - Bb5 - D6 - C6 Bb5 | A5 - G5 - E5 - C#5 .' },
      arp: { wave: 'square', vol: .035, div: 4, oct: 4, pattern: [0, 1, 2, 3] },
      bass: { wave: 'triangle', vol: .27, div: 4, oct: 2, pattern: 'R R . R O . R . R R . R 5 . O .' },
      drums: { vol: .55, kick: 'x...x...x...x.x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
    },
    gym: {
      name: 'Leader’s Arena (Gym Leader, epic)', bpm: 138,
      chords: ['Cm', 'Ab', 'Bb', 'G', 'Cm', 'Ab', 'Fm', 'G'],
      lead: { wave: 'square', vol: .1, div: 2, double: -12, notes:
        'C5 - - Eb5 G5 - - C6 | Bb5 - Ab5 - G5 - Eb5 . | F5 - - Bb4 D5 - F5 - | G5 - - - - - B4 D5 | ' +
        'C6 - Bb5 - G5 - Eb5 G5 | Ab5 - - - C6 - Ab5 . | F5 - Ab5 - C6 - Bb5 Ab5 | G5 - - - B5 - D6 .' },
      arp: { wave: 'triangle', vol: .06, div: 4, oct: 4, pattern: [0, 1, 2, 1] },
      bass: { wave: 'sawtooth', vol: .12, div: 4, oct: 2, pattern: 'R . . R O . R . R . . R O . 5 .' },
      pad: { wave: 'sawtooth', vol: .025, oct: 3, cutoff: 1400 },
      drums: { vol: .6, kick: 'x..x..x.x..x..x.', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', tom: '..............xx' },
    },
  };
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(n) {
    const m = /^([A-G])([#b]?)(-?\d)$/.exec(n);
    return m ? (Number(m[3]) + 1) * 12 + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) : null;
  }
  const hz = m => 440 * Math.pow(2, (m - 69) / 12);
  /** chord name → [root, third, fifth, seventh-ish] as MIDI numbers in octave `oct` */
  function chordTones(name, oct) {
    const m = /^([A-G][#b]?)(m?)$/.exec(name) || [, 'C', ''];
    const root = midi(m[1] + oct);
    return [root, root + (m[2] ? 3 : 4), root + 7, root + 12];
  }
  const tokens = s => s.replace(/\|/g, ' ').trim().split(/\s+/);

  // ---------------- engine ----------------
  let ctx = null, master, musicBus, sfxBus, noise = null;
  let cfg = { sfxOn: true, musicOn: true, musicVol: .45, sfxVol: .7, tracks: {} };
  let want = null;          // the track that should be playing
  let cur = null;           // { id, stop() }
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain(); musicBus = ctx.createGain(); sfxBus = ctx.createGain();
      musicBus.connect(master); sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const ch = noise.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      levels();
    }
    if (ctx.state === 'suspended') ctx.resume();
    if (want && (!cur || cur.id !== want)) start(want);    // music asked for before sound was allowed
    return ctx;
  }
  // browsers only allow sound after a tap or key press: start then
  const unlock = () => { ensure(); };
  ['pointerdown', 'keydown', 'touchend', 'click'].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));

  function prefs() { try { return Object.assign({ music: true, sfx: true }, JSON.parse(localStorage.getItem(PREF_KEY) || '{}')); } catch (e) { return { music: true, sfx: true }; } }
  function setPrefs(p) { try { localStorage.setItem(PREF_KEY, JSON.stringify(Object.assign(prefs(), p))); } catch (e) {} levels(); if (musicAllowed()) { if (want) start(want, true); } else stopMusic(); }
  const musicAllowed = () => cfg.musicOn && prefs().music;
  const sfxAllowed = () => cfg.sfxOn && prefs().sfx;
  function levels() { if (!ctx) return; musicBus.gain.value = cfg.musicVol; sfxBus.gain.value = cfg.sfxVol; master.gain.value = 1; }

  /** a single note with an envelope */
  function tone(bus, f, t, dur, o) {
    const osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = o.wave || 'square'; osc.frequency.setValueAtTime(f, t);
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
    const a = o.attack || .008, r = Math.min(o.release || .06, dur), v = o.vol || .2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    g.gain.setValueAtTime(v * (o.sustain || .8), Math.max(t + a, t + dur - r));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + .02);
    let out = g;
    if (o.cutoff) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.cutoff; g.connect(lp); out = lp; }
    osc.connect(g); out.connect(bus);
    osc.start(t); osc.stop(t + dur + .05);
  }
  function hit(bus, t, o) {
    const src = ctx.createBufferSource(), g = ctx.createGain(), f = ctx.createBiquadFilter();
    src.buffer = noise; f.type = o.type || 'highpass'; f.frequency.value = o.freq || 1000;
    g.gain.setValueAtTime(o.vol || .3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + (o.dur || .1));
    src.connect(f); f.connect(g); g.connect(bus); src.start(t); src.stop(t + (o.dur || .1) + .02);
  }
  const kick = (bus, t, v) => tone(bus, 150, t, .14, { wave: 'sine', slide: 42, vol: v, release: .1, sustain: 1 });
  const tom = (bus, t, v) => tone(bus, 210, t, .16, { wave: 'sine', slide: 90, vol: v * .8, release: .12, sustain: 1 });

  // ---------------- music ----------------
  function stopMusic() { if (cur) { cur.stop(); cur = null; } }
  function start(id, force) {
    if (!ctx || !musicAllowed()) return;
    if (cur && cur.id === id && !force) return;
    stopMusic();
    const tr = cfg.tracks[id];
    if (!tr) return;
    cur = tr.file ? fileTrack(id, tr) : synthTrack(id, tr);
  }
  function fileTrack(id, tr) {
    const el = new Audio(tr.file); el.loop = true; el.crossOrigin = 'anonymous';
    const src = ctx.createMediaElementSource(el), g = ctx.createGain();
    g.gain.value = tr.volume / 100; src.connect(g); g.connect(musicBus);
    el.play().catch(() => {});
    return { id, stop() { g.gain.setTargetAtTime(0, ctx.currentTime, .15); setTimeout(() => { el.pause(); g.disconnect(); }, 600); } };
  }
  function synthTrack(id, tr) {
    const P = PIECES[tr.style]; if (!P) return null;
    const bus = ctx.createGain(); bus.gain.value = tr.volume / 100; bus.connect(musicBus);
    const step = 60 / (P.bpm * tr.tempo / 100) / 4, bars = P.chords.length, total = bars * 16;
    const lead = P.lead ? tokens(P.lead.notes) : [];
    const bass = P.bass ? tokens(P.bass.pattern) : [];
    let i = 0, next = ctx.currentTime + .08, alive = true;
    const span = (list, k, unit) => { let n = 1; while (list[(k + n) % list.length] === '-') n++; return n * unit; };
    function schedule(k, t) {
      const bar = Math.floor(k / 16), s = k % 16, chord = P.chords[bar];
      if (P.lead) {
        const per = 4 / P.lead.div;
        if (s % per === 0) {
          const idx = bar * 4 * P.lead.div + s / per, tok = lead[idx % lead.length], m = midi(tok);
          if (m != null) {
            const dur = span(lead, idx, per * step) * .92;
            tone(bus, hz(m), t, dur, { wave: P.lead.wave, vol: P.lead.vol, release: .08 });
            if (P.lead.double) tone(bus, hz(m + P.lead.double), t, dur, { wave: 'triangle', vol: P.lead.vol * .9, release: .08 });
          }
        }
      }
      if (P.arp) {
        const per = 4 / P.arp.div;
        if (s % per === 0) { const ct = chordTones(chord, P.arp.oct), n = s / per; tone(bus, hz(ct[P.arp.pattern[n % P.arp.pattern.length]]), t, per * step * .9, { wave: P.arp.wave, vol: P.arp.vol, release: .05 }); }
      }
      if (P.bass) {
        const per = 4 / P.bass.div, perBar = 4 * P.bass.div;
        if (s % per === 0) {
          const idx = s / per, tok = bass[idx % perBar], root = chordTones(chord, P.bass.oct)[0];
          const m = tok === 'R' ? root : tok === 'O' ? root + 12 : tok === '5' ? root + 7 : null;
          if (m != null) tone(bus, hz(m), t, span(bass, idx, per * step) * .9, { wave: P.bass.wave, vol: P.bass.vol, release: .05, cutoff: P.bass.wave === 'sawtooth' ? 900 : 0 });
        }
      }
      if (P.pad && s === 0) chordTones(chord, P.pad.oct).slice(0, 3).forEach(m => tone(bus, hz(m), t, 16 * step, { wave: P.pad.wave, vol: P.pad.vol, attack: .3, release: .4, cutoff: P.pad.cutoff || 1200 }));
      const D = P.drums;
      if (D) {
        if (D.kick && D.kick[s] === 'x') kick(bus, t, D.vol);
        if (D.snare && D.snare[s] === 'x') hit(bus, t, { freq: 1800, dur: .12, vol: D.vol * .45 });
        if (D.hat && D.hat[s] === 'x') hit(bus, t, { freq: 7000, dur: .035, vol: D.vol * .16 });
        if (D.tom && D.tom[s] === 'x' && bar === bars - 1) tom(bus, t, D.vol);
      }
    }
    const timer = setInterval(() => {
      if (!alive) return;
      while (next < ctx.currentTime + .15) { schedule(i, next); next += step; i = (i + 1) % total; }
    }, 25);
    return { id, stop() { alive = false; clearInterval(timer); bus.gain.setTargetAtTime(0, ctx.currentTime, .12); setTimeout(() => bus.disconnect(), 800); } };
  }

  // ---------------- sound effects ----------------
  const SFX = {
    hit: t => { hit(sfxBus, t, { freq: 900, dur: .12, vol: .5 }); tone(sfxBus, 320, t, .12, { wave: 'square', slide: 90, vol: .25 }); },
    weak: t => { hit(sfxBus, t, { type: 'lowpass', freq: 900, dur: .1, vol: .45 }); tone(sfxBus, 200, t, .1, { wave: 'triangle', slide: 80, vol: .25 }); },
    super: t => { hit(sfxBus, t, { freq: 700, dur: .16, vol: .65 }); tone(sfxBus, 420, t, .1, { wave: 'square', slide: 120, vol: .3 }); tone(sfxBus, 620, t + .1, .14, { wave: 'square', slide: 160, vol: .28 }); },
    crit: t => { hit(sfxBus, t, { freq: 2500, dur: .08, vol: .5 }); tone(sfxBus, 980, t, .06, { wave: 'square', vol: .2 }); SFX.hit(t + .06); },
    miss: t => tone(sfxBus, 700, t, .18, { wave: 'sine', slide: 1400, vol: .15 }),
    faint: t => tone(sfxBus, 620, t, .7, { wave: 'square', slide: 70, vol: .22, release: .3 }),
    throw: t => tone(sfxBus, 300, t, .32, { wave: 'sine', slide: 1000, vol: .22 }),
    shake: t => { tone(sfxBus, 260, t, .05, { wave: 'square', vol: .18 }); tone(sfxBus, 200, t + .07, .05, { wave: 'square', vol: .15 }); },
    catch: t => [72, 76, 79, 84].forEach((m, k) => tone(sfxBus, hz(m), t + k * .09, .12, { wave: 'square', vol: .18 })),
    breakout: t => [76, 71].forEach((m, k) => tone(sfxBus, hz(m), t + k * .1, .12, { wave: 'square', vol: .18 })),
    heal: t => [72, 76, 79, 84, 88].forEach((m, k) => tone(sfxBus, hz(m), t + k * .07, .22, { wave: 'sine', vol: .18 })),
    levelup: t => [[67, 0], [72, .1], [76, .2], [79, .3], [84, .4]].forEach(([m, d]) => tone(sfxBus, hz(m), t + d, d === .4 ? .4 : .1, { wave: 'square', vol: .16 })),
    run: t => [0, .08, .16].forEach(d => tone(sfxBus, 500, t + d, .07, { wave: 'triangle', slide: 900, vol: .14 })),
    victory: t => [[72, 0, .12], [72, .14, .12], [72, .28, .12], [76, .42, .5], [74, .95, .12], [76, 1.1, .12], [79, 1.25, .7]]
      .forEach(([m, d, l]) => { tone(sfxBus, hz(m), t + d, l, { wave: 'square', vol: .14 }); tone(sfxBus, hz(m - 12), t + d, l, { wave: 'triangle', vol: .16 }); }),
    lose: t => [[67, 0], [63, .25], [60, .5]].forEach(([m, d]) => tone(sfxBus, hz(m), t + d, .3, { wave: 'triangle', vol: .2 })),
    coin: t => { tone(sfxBus, 988, t, .07, { wave: 'square', vol: .12 }); tone(sfxBus, 1319, t + .07, .2, { wave: 'square', vol: .12 }); },
    click: t => tone(sfxBus, 1200, t, .03, { wave: 'square', vol: .06 }),
    pop: t => tone(sfxBus, 500, t, .09, { wave: 'sine', slide: 900, vol: .16 }),
  };

  PP.Audio = {
    PIECES,
    configure(d) {
      const s = d.settings;
      cfg = { sfxOn: s.soundOn, musicOn: s.musicOn, musicVol: s.musicVolume / 100, sfxVol: s.sfxVolume / 100,
        tracks: Object.fromEntries((d.music || []).filter(t => t.enabled).map(t => [t.id, t])) };
      levels();
      if (cur && want) start(want, true);         // pick up tempo / volume / file changes
    },
    play(id) {
      want = id && id !== 'none' ? id : null;
      if (!want) return stopMusic();
      if (ctx) start(want);                         // before the first tap, unlock() starts it
    },
    stop() { want = null; stopMusic(); },
    /** the track playing now (or null) */
    current: () => cur && cur.id,
    sfx(name) { if (!sfxAllowed() || !ensure() || !SFX[name]) return; try { SFX[name](ctx.currentTime + .01); } catch (e) {} },
    prefs, setPrefs,
  };
})();
