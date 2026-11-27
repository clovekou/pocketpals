// Friends, presence, chat, trades and live battles over Firestore. No UI here (see js/game.js).
// Only active when online (PP.Cloud.on). Firestore layout (permissions in firestore.rules):
//   players/{uid}                     profile + presence { name, nameKey, avatar, level, lastActive, online }
//   requests/{fromUid_toUid}          a friend request { from, to, fromName, toName, at }
//   friends/{pairId}                  a friendship { users: [a, b], names: {uid: name}, since, last: {from, text, at} }
//   friends/{pairId}/messages/{id}    chat { from, text, at }
//   trades/{id}                       { from, to, fromName, toName, offer, give, status, at }
//        status: offered → accepted → done | offered → declined → closed | offered → cancelled
//   battles/{id}                      { a, b, names, teams: {a, b}, seed, status, moves: {turn: {a, b}}, winner }
//        status: invited → active → over | invited → declined | invited → cancelled
window.PP = window.PP || {};
(function () {
  'use strict';
  const C = PP.Cloud || {};
  const Social = PP.Social = { on: !!C.on, state: null };
  if (!C.on) return;

  const ONLINE_MS = 3 * 60 * 1000;      // "online" = seen in the last 3 minutes and not signed off
  const BEAT_MS = 60 * 1000;            // presence heartbeat
  const TURN_TIMEOUT_MS = 120 * 1000;   // a live-battle turn the other player never answers
  const ms = v => v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : 0;
  const pairId = (a, b) => [a, b].sort().join('_');
  const nameKey = n => encodeURIComponent(String(n).trim().toLowerCase());
  const now = () => firebase.firestore.FieldValue.serverTimestamp();
  let db, me, myName = '', started = false;

  const S = Social.state = { friends: [], profiles: {}, reqIn: [], reqOut: [], tradesIn: [], tradesOut: [], battlesIn: [], battlesOut: [] };
  const subs = new Set();
  let emitTimer = null;
  const emit = () => { if (!emitTimer) emitTimer = setTimeout(() => { emitTimer = null; subs.forEach(fn => { try { fn(); } catch (e) { console.error(e); } }); }, 30); };
  /** fn() whenever anything social changes; returns an unsubscribe */
  Social.subscribe = fn => { subs.add(fn); return () => subs.delete(fn); };
  const list = q => q.docs.map(d => Object.assign({ id: d.id }, d.data()));

  // ---------------- start / presence ----------------
  Social.start = (opts) => {
    if (started) return; started = true;
    db = C.db; me = C.user.uid; myName = opts.name || '';
    beat(true);
    setInterval(() => { if (!document.hidden) beat(true); }, BEAT_MS);
    document.addEventListener('visibilitychange', () => beat(!document.hidden));
    window.addEventListener('pagehide', () => beat(false));

    db.collection('friends').where('users', 'array-contains', me).onSnapshot(q => {
      S.friends = list(q).map(f => { const uid = f.users.find(u => u !== me) || me; return Object.assign(f, { uid, name: (f.names || {})[uid] || '?' }); });
      S.friends.forEach(f => watchProfile(f.uid));
      emit();
    }, err);
    db.collection('requests').where('to', '==', me).onSnapshot(q => { S.reqIn = list(q); emit(); }, err);
    db.collection('requests').where('from', '==', me).onSnapshot(q => { S.reqOut = list(q); emit(); }, err);
    db.collection('trades').where('to', '==', me).onSnapshot(q => { S.tradesIn = list(q); emit(); }, err);
    db.collection('trades').where('from', '==', me).onSnapshot(q => { S.tradesOut = list(q); emit(); }, err);
    db.collection('battles').where('b', '==', me).onSnapshot(q => { S.battlesIn = list(q); emit(); }, err);
    db.collection('battles').where('a', '==', me).onSnapshot(q => { S.battlesOut = list(q); emit(); }, err);
  };
  const err = e => console.warn('Social sync', e && (e.code || e.message));
  function beat(online) {
    if (!db) return;
    db.doc('players/' + me).set({ lastActive: now(), online }, { merge: true }).catch(err);
  }
  Social.setName = n => { myName = n; };
  const watching = {};
  function watchProfile(uid) {
    if (watching[uid]) return;
    watching[uid] = db.doc('players/' + uid).onSnapshot(s => { S.profiles[uid] = s.exists ? s.data() : {}; emit(); }, err);
  }
  /** is this player online right now? */
  Social.isOnline = uid => { const p = S.profiles[uid]; return !!(p && p.online && Date.now() - ms(p.lastActive) < ONLINE_MS); };
  Social.lastSeen = uid => ms((S.profiles[uid] || {}).lastActive);
  Social.ms = ms;

  // ---------------- finding players and friend requests ----------------
  /** players whose name starts with q (not you) → [{ uid, name }] */
  Social.search = async q => {
    const key = nameKey(q); if (!key) return [];
    const docId = firebase.firestore.FieldPath.documentId();
    const snap = await db.collection('names').where(docId, '>=', key).where(docId, '<', key + '').limit(12).get();
    return snap.docs.map(d => d.data()).filter(x => x.uid && x.uid !== me).map(x => ({ uid: x.uid, name: x.name }));
  };
  Social.relation = uid => S.friends.some(f => f.uid === uid) ? 'friend' : S.reqOut.some(r => r.to === uid) ? 'sent' : S.reqIn.some(r => r.from === uid) ? 'received' : 'none';
  Social.sendRequest = async (uid, name) => {
    const back = S.reqIn.find(r => r.from === uid);
    if (back) return Social.accept(back);                         // they already asked you: just accept
    await db.doc(`requests/${me}_${uid}`).set({ from: me, to: uid, fromName: myName, toName: name, at: now() });
  };
  Social.accept = async r => {
    const pair = pairId(r.from, r.to), batch = db.batch();
    batch.set(db.doc('friends/' + pair), { users: [r.from, r.to].sort(), names: { [r.from]: r.fromName, [r.to]: r.toName || myName }, since: now(), last: null });
    batch.delete(db.doc('requests/' + r.id));
    await batch.commit();
  };
  Social.decline = r => db.doc('requests/' + r.id).delete();
  Social.unfriend = f => db.doc('friends/' + f.id).delete();
  Social.friend = uid => S.friends.find(f => f.uid === uid) || null;

  // ---------------- chat ----------------
  /** live messages with a friend: cb([{ from, text, at }]); returns an unsubscribe */
  Social.openChat = (pair, cb) => db.collection(`friends/${pair}/messages`).orderBy('at').limitToLast(60)
    .onSnapshot(q => cb(list(q)), err);
  Social.sendMessage = async (pair, text) => {
    text = String(text || '').trim().slice(0, 300); if (!text) return;
    const batch = db.batch();
    batch.set(db.collection(`friends/${pair}/messages`).doc(), { from: me, text, at: now() });
    batch.update(db.doc('friends/' + pair), { last: { from: me, text, at: now() } });
    await batch.commit();
  };
  const READ_KEY = 'pp2.chatRead';
  const readMap = () => { try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}'); } catch (e) { return {}; } };
  Social.markRead = pair => { const m = readMap(); m[pair] = Date.now(); try { localStorage.setItem(READ_KEY, JSON.stringify(m)); } catch (e) {} emit(); };
  Social.unread = f => !!(f.last && f.last.from !== me && ms(f.last.at) > (readMap()[f.id] || 0));

  // ---------------- trades ----------------
  // The offered Pokémon leaves the sender's save when offered (held by the trade), so it can't be traded twice.
  Social.offerTrade = (uid, name, entry) => db.collection('trades').add({ from: me, to: uid, fromName: myName, toName: name, offer: entry, give: null, status: 'offered', at: now() });
  /** accept with one of your Pokémon; resolves true, or false if the offer was withdrawn meanwhile */
  Social.acceptTrade = (id, entry) => db.runTransaction(async t => {
    const ref = db.doc('trades/' + id), s = await t.get(ref);
    if (!s.exists || s.data().status !== 'offered') return false;
    t.update(ref, { status: 'accepted', give: entry, at: now() });
    return true;
  });
  Social.declineTrade = id => db.doc('trades/' + id).update({ status: 'declined', at: now() });
  /** take an offer back; false if the friend accepted first */
  Social.cancelTrade = id => db.runTransaction(async t => {
    const ref = db.doc('trades/' + id), s = await t.get(ref);
    if (!s.exists || s.data().status !== 'offered') return false;
    t.update(ref, { status: 'cancelled', at: now() });
    return true;
  });
  Social.closeTrade = (id, status) => db.doc('trades/' + id).update({ status, at: now() });

  // ---------------- live battles ----------------
  Social.challenge = (uid, name, team) => db.collection('battles').add({
    a: me, b: uid, names: { a: myName, b: name }, teams: { a: team, b: [] }, seed: Math.floor(Math.random() * 2 ** 31),
    status: 'invited', moves: {}, winner: '', at: now() });
  Social.acceptBattle = (id, team) => db.doc('battles/' + id).update({ status: 'active', 'teams.b': team, at: now() });
  Social.declineBattle = id => db.doc('battles/' + id).update({ status: 'declined', at: now() });
  Social.cancelBattle = id => db.doc('battles/' + id).update({ status: 'cancelled', at: now() });
  Social.endBattle = (id, winner) => db.doc('battles/' + id).update({ status: 'over', winner, at: now() }).catch(err);
  /**
   * Send this turn's choice and wait for the other player's. Both players run the same turn with the
   * same random numbers, so their screens stay in step. Resolves to the other choice, or
   * { type: 'timeout' } if they don't answer in time.
   */
  Social.exchange = (id, side, turn, choice) => new Promise(resolve => {
    const other = side === 'a' ? 'b' : 'a', ref = db.doc('battles/' + id);
    let done = false, unsub = null;
    const finish = v => { if (done) return; done = true; clearTimeout(timer); if (unsub) unsub(); resolve(v); };
    const timer = setTimeout(() => finish({ type: 'timeout' }), TURN_TIMEOUT_MS);
    ref.update({ [`moves.${turn}.${side}`]: choice }).catch(err);
    unsub = ref.onSnapshot(s => {
      const d = s.data() || {}, mv = ((d.moves || {})[turn] || {})[other];
      if (mv) finish(mv);
      else if (d.status === 'over' || d.status === 'cancelled') finish({ type: 'forfeit' });
    }, () => {});
  });
})();
