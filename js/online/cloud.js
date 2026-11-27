// Online mode: Google sign-in and Firestore sync. Off when PP.FIREBASE_CONFIG is null.
//
// localStorage stays the working copy, so the game and admin code don't change: after sign-in this
// file loads the player's save and the game data from Firestore into localStorage, then copies every
// later write back up. Firestore layout (see firestore.rules):
//   config/game     { json }                 game data (settings + content); only admins write it
//   config/access   { players[], admins[] }  the email allowlist; only admins read or write it
//   saves/{uid}     { json, device, at }     a player's full save; only that player (and admins)
//   players/{uid}   { name, level, … }       public profile that friends can see
//   names/{name}    { uid, name }            unique in-game names
window.PP = window.PP || {};
(function () {
  'use strict';
  const CFG = PP.FIREBASE_CONFIG;
  const waiting = [];
  let ready = !CFG;
  /** run fn once the player is signed in and synced (straight away when offline) */
  PP.whenReady = fn => { if (ready) fn(); else waiting.push(fn); };
  const Cloud = PP.Cloud = { on: !!CFG, user: null, admin: false, db: null, claimName: async () => null, signOut() {}, flush() {} };
  if (!CFG) return;

  const S = PP.store, KEYS = S.KEYS, OWNER_KEY = 'pp2.uid';
  const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const PAGE = document.body.dataset.page || 'game';
  const DEVICE = Math.random().toString(36).slice(2, 10);   // tells this tab's writes from other devices'
  const SAVE_EVERY = 20000;                                   // at most one cloud save write per 20 s
  const nameKey = n => encodeURIComponent(String(n).trim().toLowerCase());
  const esc = PP.esc;
  let db, auth, uid, saveTimer = null, lastPushed = '';

  // ---------------- the sign-in screen ----------------
  const gateEl = document.createElement('div');
  gateEl.className = 'gate';
  document.body.appendChild(gateEl);
  function gate(state, text) {
    const u = Cloud.user;
    const out = u ? `<button class="gate-link" data-gate="out">Use a different Google account</button>` : '';
    const body = {
      busy: `<p class="gate-msg">${esc(text || 'Loading…')}</p>`,
      signin: `<p class="gate-msg">Sign in with Google to play and keep your progress.</p>
        <button class="gate-btn" data-gate="in"><span class="g-logo">G</span>Sign in with Google</button>${text ? `<p class="gate-err">${esc(text)}</p>` : ''}`,
      denied: `<p class="gate-msg"><b>${esc(u && u.email)}</b> isn’t on the friends list yet.</p>
        <p class="gate-sub">Ask the owner to add this email in Admin → Online, then reload.</p>${out}`,
      notadmin: `<p class="gate-msg"><b>${esc(u && u.email)}</b> can play, but can’t open the admin.</p>
        <a class="gate-btn" href="index.html">Open the game</a>${out}`,
      error: `<p class="gate-msg">${esc(text || 'Something went wrong.')}</p><button class="gate-btn" data-gate="reload">Try again</button>${out}`,
    }[state];
    gateEl.innerHTML = `<div class="gate-card"><div class="gate-title">Pocket Pals${PAGE === 'admin' ? ' Admin' : ''}</div>${body}</div>`;
    gateEl.hidden = false;
  }
  gateEl.addEventListener('click', e => {
    const b = e.target.closest('[data-gate]'); if (!b) return;
    if (b.dataset.gate === 'in') signIn();
    if (b.dataset.gate === 'out') auth.signOut().then(() => location.reload());
    if (b.dataset.gate === 'reload') location.reload();
  });
  function signIn() {
    const p = new firebase.auth.GoogleAuthProvider();
    p.setCustomParameters({ prompt: 'select_account' });
    auth.signInWithPopup(p).catch(e => {
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') return auth.signInWithRedirect(p);
      if (e.code !== 'auth/popup-closed-by-user' && e.code !== 'auth/cancelled-popup-request') gate('signin', 'Sign-in didn’t work. Try again.');
    });
  }

  // ---------------- start-up ----------------
  const script = src => new Promise((ok, bad) => { const s = document.createElement('script'); s.src = SDK + src; s.onload = ok; s.onerror = bad; document.head.appendChild(s); });
  gate('busy', 'Connecting…');
  script('firebase-app-compat.js').then(() => Promise.all([script('firebase-auth-compat.js'), script('firebase-firestore-compat.js')])).then(() => {
    firebase.initializeApp(CFG);
    auth = firebase.auth(); db = Cloud.db = firebase.firestore();
    let heard = false;
    auth.onAuthStateChanged(u => { heard = true; if (ready) return; if (u) start(u).catch(fail); else gate('signin'); });
    setTimeout(() => { if (!heard && !auth.currentUser) gate('signin'); }, 4000);   // slow to restore a session: offer sign-in anyway
  }).catch(() => gate('error', 'Couldn’t reach the online service. Check your internet connection.'));
  function fail(e) { console.error(e); gate('error', e && e.code === 'unavailable' ? 'You seem to be offline. Check your internet connection.' : 'Couldn’t load your game. Try again.'); }

  async function start(u) {
    uid = u.uid;
    Cloud.user = { uid, email: (u.email || '').toLowerCase(), name: u.displayName || '' };
    gate('busy', 'Checking your access…');
    Cloud.admin = await db.doc('config/access').get().then(() => true, () => false);   // only admins may read it
    let game;
    try { game = await db.doc('config/game').get(); }
    catch (e) { if (e.code === 'permission-denied') return gate('denied'); throw e; }
    if (PAGE === 'admin' && !Cloud.admin) return gate('notadmin');
    gate('busy', 'Loading your game…');

    // game data: the cloud copy wins; the first admin to sign in uploads theirs
    if (game.exists) localStorage.setItem(KEYS.data, game.data().json);
    else if (Cloud.admin) await pushData(S.loadData());

    // the save: the newer of this browser's copy (if it's this player's) and the cloud copy
    const snap = await db.doc('saves/' + uid).get();
    const local = S.rawSave(), localOwner = localStorage.getItem(OWNER_KEY);
    let upload = false;
    if (snap.exists) {
      const remote = JSON.parse(snap.data().json || 'null') || {};
      if (local && localOwner === uid && (Number(local.lastTick) || 0) > (Number(remote.lastTick) || 0)) upload = true;
      else localStorage.setItem(KEYS.save, snap.data().json);
    } else if (local && (!localOwner || localOwner === uid)) upload = true;    // first sign-in: bring this browser's progress along
    else localStorage.removeItem(KEYS.save);                                    // someone else's progress on a shared browser
    localStorage.setItem(OWNER_KEY, uid);

    if (PAGE === 'game') await checkName();
    hookWrites(); listen();
    gateEl.hidden = true;
    ready = true;
    waiting.splice(0).forEach(fn => fn());
    if (upload) pushSave(true);
  }

  /** a name taken by someone else (e.g. picked offline) has to be chosen again */
  async function checkName() {
    const s = S.rawSave(); if (!s || !s.named || !s.name) return;
    const ref = db.doc('names/' + nameKey(s.name)), n = await ref.get();
    if (!n.exists) await ref.set({ uid, name: s.name, at: Date.now() });
    else if (n.data().uid !== uid) { s.named = false; localStorage.setItem(KEYS.save, JSON.stringify(s)); }
  }

  // ---------------- keeping the cloud up to date ----------------
  function hookWrites() {
    const writeSave = S.writeSave, writeData = S.writeData;
    S.writeSave = function (s) { const r = writeSave.call(S, s); scheduleSave(); return r; };
    S.writeData = function (d) { const n = writeData.call(S, d); if (Cloud.admin) pushData(n).catch(e => console.warn('Game data not uploaded', e)); return n; };
    const flush = () => pushSave(true);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  }
  function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(() => pushSave(), SAVE_EVERY); }
  function pushSave(now) {
    clearTimeout(saveTimer); saveTimer = null;
    const json = localStorage.getItem(KEYS.save);
    if (!json || json === lastPushed || !uid) return Promise.resolve();
    lastPushed = json;
    const s = JSON.parse(json), box = Array.isArray(s.box) ? s.box : [];
    const partner = box.find(e => e.uid === s.partner) || box[0];
    const batch = db.batch(), at = firebase.firestore.FieldValue.serverTimestamp();
    batch.set(db.doc('saves/' + uid), { json, device: DEVICE, at });
    batch.set(db.doc('players/' + uid), {
      name: s.named ? s.name : '', level: s.level || 1, avatar: s.avatar || (partner ? partner.species : ''),
      badges: Object.keys(s.badges || {}).length, caught: Object.keys((s.dex || {}).caught || {}).length, at,
    }, { merge: true });
    return batch.commit().catch(e => { lastPushed = ''; console.warn('Save not uploaded', e); });
  }
  Cloud.flush = () => pushSave(true);
  function pushData(d) {
    return db.doc('config/game').set({ json: JSON.stringify(d), at: firebase.firestore.FieldValue.serverTimestamp(), by: Cloud.user.email });
  }
  /** changes made elsewhere (the admin, another device) reach this tab */
  function listen() {
    db.doc('config/game').onSnapshot(s => {
      if (!s.exists) return;
      const j = s.data().json;
      if (j && j !== localStorage.getItem(KEYS.data)) { localStorage.setItem(KEYS.data, j); S.emit('data'); }
    }, () => {});
    db.doc('saves/' + uid).onSnapshot(s => {
      if (!s.exists || s.metadata.hasPendingWrites || s.data().device === DEVICE) return;
      const j = s.data().json;
      if (j && j !== localStorage.getItem(KEYS.save)) { localStorage.setItem(KEYS.save, j); lastPushed = j; S.emit('save'); }
    }, () => {});
  }

  // ---------------- names, account, admin helpers ----------------
  /** take a unique name for this player; resolves to null, or the reason it can't be used */
  Cloud.claimName = async (name, old) => {
    const ref = db.doc('names/' + nameKey(name));
    try {
      await db.runTransaction(async t => {
        const n = await t.get(ref);
        if (n.exists && n.data().uid !== uid) throw new Error('taken');
        t.set(ref, { uid, name, at: Date.now() });
      });
    } catch (e) { return e.message === 'taken' ? 'That name is already taken. Try another one.' : 'Couldn’t check the name online. Try again.'; }
    if (old && nameKey(old) !== nameKey(name)) db.doc('names/' + nameKey(old)).delete().catch(() => {});
    return null;
  };
  Cloud.signOut = async () => { await pushSave(true); await auth.signOut(); location.reload(); };
  Cloud.getAccess = async () => { const s = await db.doc('config/access').get(); const d = s.exists ? s.data() : {}; return { players: d.players || [], admins: d.admins || [] }; };
  Cloud.setAccess = a => db.doc('config/access').set({ players: a.players, admins: a.admins, at: firebase.firestore.FieldValue.serverTimestamp() });
  Cloud.listPlayers = async () => (await db.collection('players').get()).docs.map(d => Object.assign({ uid: d.id }, d.data()));
})();
