// "A new version is ready": checks whether the site has been updated since this page loaded, and offers a
// Refresh button. The version is the ?v= number on the page's scripts, which goes up with every update.
window.PP = window.PP || {};
(function () {
  'use strict';
  const CHECK_EVERY = 3 * 60 * 1000;          // while playing
  const page = location.pathname.split('/').pop() || 'index.html';
  const own = (() => { const s = document.querySelector('script[src*="?v="]'); const m = s && /[?&]v=(\d+)/.exec(s.getAttribute('src')); return m ? Number(m[1]) : 0; })();
  let shown = false, busy = false;

  async function check() {
    if (shown || busy || !own || document.hidden) return;
    busy = true;
    try {
      const r = await fetch(page + '?check=' + Date.now(), { cache: 'no-store' });
      if (r.ok) {
        const m = /[?&]v=(\d+)/.exec(await r.text());
        if (m && Number(m[1]) > own) show();
      }
    } catch (e) { /* offline: try again later */ }
    busy = false;
  }

  function show() {
    shown = true;
    const bar = document.createElement('div');
    bar.className = 'update-bar';
    bar.setAttribute('role', 'status');
    bar.innerHTML = '<span class="update-dot"></span><span class="update-text"><b>A new version of Pocket Pals is ready</b><small>Refresh to get the latest update.</small></span>' +
      '<button class="update-later" aria-label="Later">Later</button><button class="update-go">Refresh</button>';
    (document.getElementById('app') || document.body).appendChild(bar);
    requestAnimationFrame(() => bar.classList.add('in'));
    bar.querySelector('.update-go').addEventListener('click', refresh);
    bar.querySelector('.update-later').addEventListener('click', () => {
      bar.classList.remove('in'); setTimeout(() => bar.remove(), 300);
      setTimeout(() => { shown = false; }, 15 * 60 * 1000);      // ask again in 15 minutes
    });
  }

  async function refresh() {
    const btn = document.querySelector('.update-go'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    try { window.dispatchEvent(new Event('pagehide')); } catch (e) {}          // the game saves on pagehide
    try { if (PP.Cloud && PP.Cloud.on && PP.Cloud.flush) await Promise.race([PP.Cloud.flush(), new Promise(r => setTimeout(r, 2500))]); } catch (e) {}
    const u = new URL(location.href); u.searchParams.set('v', String(Date.now()).slice(-6));
    location.replace(u.toString());
  }

  setTimeout(check, 20000);
  setInterval(check, CHECK_EVERY);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) check(); });
  PP.Update = { check, show };
})();
