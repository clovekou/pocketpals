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
  // Soft, cozy instruments (electric piano, music box, warm pads, round bass, mellow horn, light drums) with a
  // room reverb. Battle tracks have a short intro, then loop from `loop` (a bar number).
  const PIECES = {
    cozy: {
      name: 'Hearthmoor Town (home)', bpm: 92, loop: 0,
      chords: ['C', 'Am', 'F', 'G', 'C', 'Em', 'F', 'G'],
      lead: { wave: 'keys', vol: .2, div: 2, notes:
        'G4 C5 E5 - D5 C5 D5 - | E5 - A4 - C5 - B4 A4 | A4 - F5 - E5 D5 C5 - | D5 - - - G4 - B4 D5 | ' +
        'G5 - E5 - C5 E5 G5 - | B4 - E5 - G5 - E5 D5 | C5 - A4 - F5 - E5 D5 | D5 - B4 - G4 - - .' },
      arp: { wave: 'musicbox', vol: .045, div: 2, oct: 5, pattern: [0, 2, 1, 3] },
      bass: { wave: 'bass', vol: .2, div: 2, oct: 2, pattern: 'R - - - 5 - - -' },
      pad: { wave: 'pad', vol: .018, oct: 4 },
      drums: { vol: .18, kick: 'x.......x.......', hat: '..x...x...x...x.' },
    },
    wild: {
      name: 'Route Rumble (wild battle)', bpm: 172, loop: 2,
      chords: ['E', 'E', 'Em', 'C', 'D', 'B', 'Em', 'C', 'Am', 'B'],
      lead: { wave: 'horn', vol: .075, div: 2, vib: true, notes:
        'E5 F5 F#5 G5 G#5 A5 A#5 B5 | E6 - - - . . B4 . | ' +
        'B4 . E5 . G5 - F#5 E5 | G5 - E5 - C5 - E5 G5 | F#5 - D5 - A4 - D5 F#5 | F#5 - - - D#5 - B4 . | ' +
        'E5 G5 B5 - A5 G5 F#5 G5 | E5 - - G5 C6 - B5 A5 | A5 - G5 - E5 - C5 E5 | D#5 - F#5 - B5 - A5 F#5' },
      arp: { wave: 'pluck', vol: .06, div: 4, oct: 4, pattern: [0, 2, 1, 2] },
      bass: { wave: 'bass', vol: .22, div: 4, oct: 2, pattern: 'R . R O R . R O 5 . 5 O R . R O' },
      pad: { wave: 'pad', vol: .014, oct: 4 },
      drums: { vol: .42, kick: 'x...x...x...x...', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.' },
    },
    trainer: {
      name: 'Trainer Showdown (trainer battle)', bpm: 180, loop: 2,
      chords: ['Am', 'Am', 'Am', 'F', 'G', 'E', 'Am', 'F', 'Dm', 'E'],
      lead: { wave: 'horn', vol: .075, div: 2, vib: true, notes:
        'A4 . A4 . A4 . C5 . | E5 . E5 . G5 - A5 . | ' +
        'A5 - E5 - A5 - C6 B5 | A5 - F5 - C5 - F5 A5 | B5 - G5 - D5 - G5 B5 | G#5 - - - E5 - G#5 B5 | ' +
        'C6 - B5 A5 E5 - A5 C6 | D6 - C6 A5 F5 - A5 C6 | D6 - A5 - F5 - D5 F5 | E5 - G#5 - B5 - D6 B5' },
      arp: { wave: 'pluck', vol: .055, div: 4, oct: 4, pattern: [0, 1, 2, 1] },
      bass: { wave: 'bass', vol: .22, div: 4, oct: 2, pattern: 'R . R R O . R . R . R R 5 . O .' },
      pad: { wave: 'pad', vol: .014, oct: 4 },
      drums: { vol: .45, kick: 'x..x..x.x..x..x.', snare: '....x.......x...', hat: 'xxxxxxxxxxxxxxxx' },
    },
    gym: {
      name: 'Badge on the Line (Gym Leader, epic)', bpm: 158, loop: 2,
      chords: ['Dm', 'A', 'Dm', 'Bb', 'C', 'A', 'Dm', 'Bb', 'Gm', 'A'],
      lead: { wave: 'horn', vol: .08, div: 2, vib: true, double: -12, doubleWave: 'keys', notes:
        'D5 - D5 D5 F5 - A5 - | A5 - - - C#6 - E6 . | ' +
        'D6 - - A5 F5 - D5 F5 | F5 - D5 - Bb5 - A5 G5 | G5 - - E5 C6 - Bb5 A5 | A5 - - - C#6 - E6 - | ' +
        'F6 - E6 D6 A5 - D6 F6 | D6 - - Bb5 F5 - Bb5 D6 | G6 - F6 - D6 - Bb5 G5 | A5 - C#6 - E6 - A6 .' },
      arp: { wave: 'pluck', vol: .05, div: 4, oct: 4, pattern: [0, 1, 2, 1] },
      bass: { wave: 'bass', vol: .24, div: 4, oct: 2, pattern: 'R . R O R . R O R . R O 5 . O .' },
      pad: { wave: 'pad', vol: .024, oct: 3 },
      drums: { vol: .5, kick: 'x...x.x.x...x.x.', snare: '....x.......x..x', hat: 'x.x.x.x.x.x.x.x.', tom: '..........xx.xxx' },
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
  let cfg = { sfxOn: true, musicOn: true, musicVol: .45, sfxVol: .7, tracks: {}, cries: true, cryVol: .8, cryDir: '', cryExt: 'ogg', cryNaming: 'number', crySlow: 80 };
  let want = null;          // the track that should be playing
  let cur = null;           // { id, stop() }
  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain(); musicBus = ctx.createGain(); sfxBus = ctx.createGain();
      musicBus.connect(master); sfxBus.connect(master); master.connect(comp); comp.connect(ctx.destination);
      // a soft room reverb on the music
      const verb = ctx.createConvolver(), send = ctx.createGain(), len = ctx.sampleRate * 2.4, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
      verb.buffer = ir; send.gain.value = .32; musicBus.connect(send); send.connect(verb); verb.connect(master);
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
    if (/^pulse/.test(o.wave || '')) osc.setPeriodicWave(pulse(Number(o.wave.slice(5)) / 100)); else osc.type = o.wave || 'square';
    osc.frequency.setValueAtTime(f, t);
    if (o.vib && dur > .22) {          // a little delayed vibrato on held notes, like the old handhelds
      const lfo = ctx.createOscillator(), depth = ctx.createGain();
      lfo.frequency.value = 5.5; depth.gain.setValueAtTime(0, t); depth.gain.linearRampToValueAtTime(f * .012, t + .18);
      lfo.connect(depth); depth.connect(osc.frequency); lfo.start(t); lfo.stop(t + dur + .05);
    }
    if (o.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.slide), t + dur);
    if (o.detune) osc.detune.setValueAtTime(o.detune, t);
    const a = o.attack || .008, v = o.vol || .2;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(v, t + a);
    let end;
    if (o.decay) {                     // piano-like: fades while held, then a soft release
      const rel = o.release || .3;
      g.gain.setTargetAtTime(v * (o.sustain || .25), t + a, o.decay);
      g.gain.setTargetAtTime(0.0001, t + dur, rel / 3);
      end = t + dur + rel;
    } else {
      const r = Math.min(o.release || .06, dur);
      g.gain.setValueAtTime(v * (o.sustain || .8), Math.max(t + a, t + dur - r));
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur + .02);
      end = t + dur + .02;
    }
    let out = g;
    if (o.cutoff) { const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = o.cutoff; lp.Q.value = o.q || .7; g.connect(lp); out = lp; }
    osc.connect(g); out.connect(bus);
    osc.start(t); osc.stop(end + .05);
  }
  // soft instruments for the music (anything else is a plain wave name, e.g. 'pulse25' or 'triangle')
  function inst(bus, f, t, dur, name, vol, vib) {
    switch (name) {
      case 'keys':        // warm electric piano
        tone(bus, f, t, dur, { wave: 'sine', vol, attack: .006, decay: .55, sustain: .3, release: .45, vib });
        tone(bus, f * 2, t, dur, { wave: 'sine', vol: vol * .22, attack: .004, decay: .18, sustain: .1, release: .3 });
        tone(bus, f, t, dur, { wave: 'triangle', vol: vol * .35, attack: .01, decay: .4, sustain: .2, release: .4, cutoff: 1800 });
        return;
      case 'musicbox':    // tiny bell
        tone(bus, f, t, .5, { wave: 'sine', vol, attack: .002, decay: .22, sustain: .05, release: .5 });
        tone(bus, f * 3, t, .3, { wave: 'sine', vol: vol * .25, attack: .002, decay: .08, sustain: .02, release: .3 });
        return;
      case 'pluck':       // soft guitar-ish pluck
        tone(bus, f, t, dur, { wave: 'triangle', vol, attack: .004, decay: .14, sustain: .12, release: .2, cutoff: 2200 });
        return;
      case 'pad':         // slow, warm strings
        tone(bus, f, t, dur, { wave: 'sawtooth', vol, attack: .5, sustain: .9, release: .9, cutoff: 850, detune: -7 });
        tone(bus, f, t, dur, { wave: 'sawtooth', vol, attack: .5, sustain: .9, release: .9, cutoff: 850, detune: 7 });
        return;
      case 'bass':        // round, soft bass
        tone(bus, f, t, dur, { wave: 'sine', vol, attack: .01, sustain: .75, release: .12 });
        tone(bus, f, t, dur, { wave: 'triangle', vol: vol * .45, attack: .01, sustain: .6, release: .1, cutoff: 500 });
        return;
      case 'horn':        // mellow brass for the battle melodies
        tone(bus, f, t, dur, { wave: 'sawtooth', vol, attack: .035, sustain: .75, release: .14, cutoff: 1700, q: 1.2, vib });
        tone(bus, f, t, dur, { wave: 'sine', vol: vol * .9, attack: .02, sustain: .8, release: .14 });
        return;
      default: tone(bus, f, t, dur, { wave: name, vol, release: .08, vib });
    }
  }
  const waves = {};
  /** a pulse wave with the given duty cycle (0.125, 0.25, 0.5) */
  function pulse(d) {
    if (waves[d]) return waves[d];
    const n = 48, re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) { re[k] = Math.sin(2 * Math.PI * k * d) / (k * Math.PI); im[k] = (1 - Math.cos(2 * Math.PI * k * d)) / (k * Math.PI); }
    return (waves[d] = ctx.createPeriodicWave(re, im));
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
            inst(bus, hz(m), t, dur, P.lead.wave, P.lead.vol, P.lead.vib);
            if (P.lead.double) inst(bus, hz(m + P.lead.double), t, dur, P.lead.doubleWave || 'keys', P.lead.vol * .8);
          }
        }
      }
      if (P.arp) {
        const per = 4 / P.arp.div;
        if (s % per === 0) { const ct = chordTones(chord, P.arp.oct), n = s / per; inst(bus, hz(ct[P.arp.pattern[n % P.arp.pattern.length]]), t, per * step * .9, P.arp.wave, P.arp.vol); }
      }
      if (P.bass) {
        const per = 4 / P.bass.div, perBar = 4 * P.bass.div;
        if (s % per === 0) {
          const idx = s / per, tok = bass[idx % perBar], root = chordTones(chord, P.bass.oct)[0];
          const m = tok === 'R' ? root : tok === 'O' ? root + 12 : tok === '5' ? root + 7 : null;
          if (m != null) inst(bus, hz(m), t, span(bass, idx, per * step) * .9, P.bass.wave, P.bass.vol);
        }
      }
      if (P.pad && s === 0) chordTones(chord, P.pad.oct).slice(0, 3).forEach(m => inst(bus, hz(m), t, 16 * step, P.pad.wave, P.pad.vol));
      const D = P.drums;
      if (D) {
        if (D.kick && D.kick[s] === 'x') kick(bus, t, D.vol);
        if (D.snare && D.snare[s] === 'x') { hit(bus, t, { type: 'bandpass', freq: 2200, dur: .14, vol: D.vol * .35 }); tone(bus, 190, t, .08, { wave: 'sine', vol: D.vol * .25, slide: 140 }); }
        if (D.hat && D.hat[s] === 'x') hit(bus, t, { type: 'bandpass', freq: 8500, dur: .03, vol: D.vol * .1 });
        if (D.tom && D.tom[s] === 'x' && bar === bars - 1) tom(bus, t, D.vol);
      }
    }
    const timer = setInterval(() => {
      if (!alive) return;
      while (next < ctx.currentTime + .15) { schedule(i, next); next += step; i++; if (i >= total) i = (P.loop || 0) * 16; }   // the intro plays once
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
    catch: t => [72, 76, 79, 84].forEach((m, k) => tone(sfxBus, hz(m), t + k * .09, .12, { wave: 'pulse25', vol: .2 })),
    breakout: t => [76, 71].forEach((m, k) => tone(sfxBus, hz(m), t + k * .1, .12, { wave: 'square', vol: .18 })),
    heal: t => [72, 76, 79, 84, 88].forEach((m, k) => tone(sfxBus, hz(m), t + k * .07, .22, { wave: 'sine', vol: .18 })),
    levelup: t => [[67, 0], [72, .1], [76, .2], [79, .3], [84, .4]].forEach(([m, d]) => tone(sfxBus, hz(m), t + d, d === .4 ? .4 : .1, { wave: 'pulse50', vol: .16 })),
    run: t => [0, .08, .16].forEach(d => tone(sfxBus, 500, t + d, .07, { wave: 'triangle', slide: 900, vol: .14 })),
    victory: t => [[72, 0, .12], [72, .14, .12], [72, .28, .12], [76, .42, .5], [74, .95, .12], [76, 1.1, .12], [79, 1.25, .7]]
      .forEach(([m, d, l]) => { tone(sfxBus, hz(m), t + d, l, { wave: 'pulse25', vol: .15 }); tone(sfxBus, hz(m - 12), t + d, l, { wave: 'triangle', vol: .16 }); }),
    lose: t => [[67, 0], [63, .25], [60, .5]].forEach(([m, d]) => tone(sfxBus, hz(m), t + d, .3, { wave: 'triangle', vol: .2 })),
    coin: t => { tone(sfxBus, 988, t, .07, { wave: 'square', vol: .12 }); tone(sfxBus, 1319, t + .07, .2, { wave: 'square', vol: .12 }); },
    alert: t => { tone(sfxBus, hz(84), t, .08, { wave: 'square', vol: .14 }); tone(sfxBus, hz(91), t + .09, .16, { wave: 'square', vol: .14 }); },
    click: t => tone(sfxBus, 1200, t, .03, { wave: 'square', vol: .06 }),
    pop: t => tone(sfxBus, 500, t, .09, { wave: 'sine', slide: 900, vol: .16 }),
  };

  // ---------------- Pokémon cries ----------------
  // A file in the cry folder (e.g. "assets/Pokemon sound/pikachu.mp3") is used when there is one; otherwise every
  // species gets its own made-up cry (always the same for that species).
  const missing = new Set();           // cry files that failed once (not tried again this visit)
  let cryKey = '';
  /** where a species' cry file is: the folder (a local folder or a web address) + its ID or Pokédex number */
  function cryUrl(id, dex) {
    if (!cfg.cryDir) return null;
    const name = cfg.cryNaming === 'number' ? (dex ? String(dex) : null) : id;
    if (!name) return null;
    const dir = cfg.cryDir.endsWith('/') ? cfg.cryDir : cfg.cryDir + '/';
    return (/^https?:/i.test(dir) ? dir : encodeURI(dir)) + name + '.' + cfg.cryExt;
  }
  const canPlay = ext => { try { return !!new Audio().canPlayType({ ogg: 'audio/ogg; codecs="vorbis"', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4' }[ext] || 'audio/' + ext); } catch (e) { return false; } };
  /** play a cry file with the browser's audio player (works for files on other sites too); resolves true if it played */
  function playFile(url, rate) {
    return new Promise(res => {
      const a = new Audio(); let done = false;
      const end = ok => { if (done) return; done = true; clearTimeout(to); try { a.pause(); } catch (e) {} res(ok); };
      a.preload = 'auto'; a.volume = Math.max(0, Math.min(1, cfg.cryVol * cfg.sfxVol * 1.2));
      a.playbackRate = rate; a.preservesPitch = false; a.mozPreservesPitch = false; a.webkitPreservesPitch = false;   // slower = deeper
      a.onended = () => end(true);
      a.onerror = () => { missing.add(url); end(false); };
      let to = setTimeout(() => end(!a.paused), 3500);
      // once the length is known, don't wait longer than the cry itself (some browsers never report the end)
      a.onloadedmetadata = () => { if (isFinite(a.duration) && a.duration > 0) { clearTimeout(to); to = setTimeout(() => end(true), Math.min(3000, a.duration / rate * 1000 + 150)); } };   // at most 3 s
      a.src = url;
      const p = a.play(); if (p && p.catch) p.catch(() => { missing.add(url); end(false); });
    });
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  /** a made-up cry: 2–3 chirps whose pitch, shape and length come from the species id */
  function synthCry(id, t, rate, bus) {
    let h = hash(id); const r = () => { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; return h / 4294967296; };
    const base = 260 + r() * 520, n = 2 + Math.floor(r() * 2), wave = ['square', 'sawtooth', 'triangle'][Math.floor(r() * 3)];
    let at = t, total = 0;
    for (let k = 0; k < n; k++) {
      const len = (.09 + r() * .16) / rate, f0 = base * (.8 + r() * .6) * rate, f1 = f0 * (r() < .5 ? .55 + r() * .3 : 1.2 + r() * .5);
      tone(bus, f0, at, len, { wave, slide: f1, vol: .16, attack: .01, release: .05, cutoff: 2600 });
      tone(bus, f0 * 1.5, at, len, { wave: 'sine', slide: f1 * 1.5, vol: .06, attack: .01, release: .05 });
      at += len + .03 / rate; total += len + .03 / rate;
    }
    hit(bus, t, { type: 'bandpass', freq: 1200 + r() * 2000, dur: .12 / rate, vol: .05 });
    return total;
  }
  /** play a species' cry; resolves when it has finished. slow = the fainting version */
  async function cry(id, slow, dex) {
    if (!cfg.cries || !sfxAllowed() || !ensure() || !id) return;
    const rate = slow ? Math.max(.5, cfg.crySlow / 100) : 1;
    const url = cryUrl(id, dex);
    if (url && !missing.has(url) && canPlay(cfg.cryExt) && await playFile(url, rate)) return;
    // no file (or this browser can't play it): the game's own cry for this species
    const bus = ctx.createGain(); bus.gain.value = cfg.cryVol; bus.connect(sfxBus);
    const secs = synthCry(id, ctx.currentTime + .02, rate, bus);
    await new Promise(r => setTimeout(r, Math.min(4000, secs * 1000 + 80)));
    setTimeout(() => bus.disconnect(), 500);
  }

  PP.Audio = {
    cry,
    PIECES,
    configure(d) {
      const s = d.settings;
      cfg = { sfxOn: s.soundOn, musicOn: s.musicOn, musicVol: s.musicVolume / 100, sfxVol: s.sfxVolume / 100,
        tracks: Object.fromEntries((d.music || []).filter(t => t.enabled).map(t => [t.id, t])),
        cries: s.criesOn, cryVol: s.cryVolume / 100, cryDir: s.cryFolder.trim(), cryExt: s.cryFileType, cryNaming: s.cryNaming, crySlow: s.cryFaintSpeed };
      if (cryKey !== cfg.cryDir + cfg.cryExt + cfg.cryNaming) { cryKey = cfg.cryDir + cfg.cryExt + cfg.cryNaming; missing.clear(); }
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
