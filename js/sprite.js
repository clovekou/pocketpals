// PMD SpriteCollab sprite renderer. Index data: PP.SPRITES (js/catalog-pokemon.js, built by tools/build_pokemon.py).
// Each animation sheet has one column per frame and one row per direction
// (0 Down, 1 DownRight, 2 Right, 3 UpRight, 4 Up, 5 UpLeft, 6 Left, 7 DownLeft); durations are in 1/60 s.
(function () {
  'use strict';
  const DIR = { down: 0, downright: 1, right: 2, upright: 3, up: 4, upleft: 5, left: 6, downleft: 7 };
  const FALLBACK = {
    Idle: ['Idle'], Walk: ['Walk', 'Idle'], Sleep: ['Sleep', 'Idle'], Eat: ['Eat', 'Nod', 'Idle'],
    Hop: ['Hop', 'Nod', 'Idle'], Nod: ['Nod', 'Idle'], Pose: ['Pose', 'Nod', 'Idle'],
    Attack: ['Attack', 'Idle'], Hurt: ['Hurt', 'Idle'],
  };
  const meta = {}, imgs = {};
  const base = folder => `assets/Pokemon Sprites/${folder}/`;

  function img(src) {
    let i = imgs[src];
    if (!i) { i = new Image(); i.decoding = 'async'; i.src = src; imgs[src] = i; }
    return i;
  }
  /** animation info for a folder, following the fallback chain when a sheet is missing */
  function anim(folder, name) {
    const s = PP.SPRITES && PP.SPRITES[folder];
    if (!s) return null;
    for (const n of FALLBACK[name] || [name, 'Idle']) {
      const e = s.a[n];
      if (!e) continue;
      const key = folder + '|' + n;
      if (!meta[key]) {
        const [fw, fh, frames, rows, dur, file] = e;
        meta[key] = { name: n, fw, fh, frames, rows, dur, total: dur.reduce((a, b) => a + b, 0) || 1,
          src: encodeURI(base(folder) + `sprite/${file || n}-Anim.png`), feet: null };
      }
      return meta[key];
    }
    return null;
  }
  // lowest opaque pixel of each direction's first frame, so every sprite stands on the same line
  function measure(a, im) {
    a.feet = [];
    try {
      const c = document.createElement('canvas');
      c.width = im.naturalWidth; c.height = im.naturalHeight;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(im, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data, W = c.width;
      for (let r = 0; r < a.rows; r++) {
        let lo = -1;
        for (let y = a.fh - 1; y >= 0 && lo < 0; y--) {
          const row = (r * a.fh + y) * W * 4;
          for (let x = 0; x < a.fw; x++) if (px[row + x * 4 + 3] > 0) { lo = y; break; }
        }
        a.feet[r] = lo >= 0 ? lo + 1 : Math.round(a.fh * 0.8);
      }
    } catch (e) {            // opened from file://: the browser won't let us read pixels, so estimate
      for (let r = 0; r < a.rows; r++) a.feet[r] = Math.round(a.fh * 0.8);
    }
  }
  function frameAt(a, t, once) {
    let tick = Math.floor(Math.max(0, t) * 60);
    if (once && tick >= a.total) return { f: a.frames - 1, done: true };
    tick %= a.total;
    let f = 0;
    for (let acc = 0; f < a.frames - 1; f++) { acc += a.dur[f]; if (tick < acc) break; }
    return { f, done: false };
  }

  PP.Sprite = {
    anim,
    has: folder => !!(PP.SPRITES && PP.SPRITES[folder]),
    /** portrait for an emotion (falls back to Normal, then to any portrait it has), or null */
    portrait(folder, emotion) {
      const s = PP.SPRITES && PP.SPRITES[folder], mask = s ? s.p : 0, E = PP.EMOTIONS || ['Normal'];
      if (!mask) return null;
      let i = E.indexOf(emotion || 'Normal');
      if (i < 0 || !(mask & (1 << i))) i = mask & 1 ? 0 : Math.log2(mask & -mask);
      return encodeURI(base(folder) + `portrait/${E[i]}.png`);
    },
    /** seconds a one-shot animation lasts */
    length(folder, name) { const a = anim(folder, name); return a ? a.total / 60 : 0; },
    preload(folder, names) { (names || ['Idle', 'Walk', 'Sleep', 'Hop', 'Eat', 'Nod']).forEach(n => { const a = anim(folder, n); if (a) img(a.src); }); },
    /** width/height of the idle frame in sprite pixels (for hit tests and shadows) */
    idleBox(folder) { const a = anim(folder, 'Idle'); return a ? { w: a.fw, h: a.feet ? a.feet[0] : a.fh * 0.8 } : { w: 32, h: 32 }; },
    /**
     * draw(ctx, folder, { x, y: feet line, scale: screen px per sprite px, t: seconds, anim, dir, once })
     * returns true when a one-shot (`once`) animation has finished
     */
    draw(ctx, folder, o) {
      const a = anim(folder, o.anim || 'Idle');
      if (!a) return true;
      const im = img(a.src);
      if (!im.complete || !im.naturalWidth) return false;
      if (!a.feet) measure(a, im);
      const { f, done } = frameAt(a, o.t || 0, o.once);
      const r = a.rows === 1 ? 0 : Math.min(a.rows - 1, DIR[o.dir] != null ? DIR[o.dir] : 0);
      const s = o.scale, w = a.fw * s, h = a.fh * s;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(im, f * a.fw, r * a.fh, a.fw, a.fh, Math.round(o.x - w / 2), Math.round(o.y - a.feet[r] * s), Math.round(w), Math.round(h));
      return done;
    },
  };
})();
