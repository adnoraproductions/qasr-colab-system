import { state, can, api, clearCache, html, icon, initials, loadLookups, toast, oops, closeAllSheets, ROLE, relDay, fmtDate, fmtTime, compact, groupBy, today, statusPill, emptyState } from './lib.js';
import { openCollabForm } from './collab.js';
import { dashboardView, scheduleView } from './views.js';
import { listsView } from './lists.js';
import { reportsView, outletsView, menuView, teamView, profileView } from './admin.js';

const app = document.getElementById('app');

// route → [icon, label, view, permission check]
const ROUTES = {
  home:        ['home', 'Home', dashboardView, (r) => ['admin', 'social'].includes(r)],
  schedule:    ['calendar', 'Schedule', scheduleView, () => true],
  lists:       ['send', 'Lists', listsView, (r) => r === 'admin'],
  reports:     ['chart', 'Reports', reportsView, (r) => ['admin', 'social'].includes(r)],
  outlets:     ['store', 'Outlets', outletsView, (r) => r === 'admin'],
  menu:        ['cake', 'Menu', menuView, (r) => r === 'admin'],
  team:        ['key', 'Team', teamView, (r) => r === 'admin'],
  profile:     ['user', 'Profile', null, () => true],
};
const BOTTOM = {
  admin: ['home', 'schedule', 'lists', 'profile'],
  social: ['home', 'schedule', 'reports', 'profile'],
  outlet: ['schedule', 'profile'],
};
const DEFAULT = { admin: 'home', social: 'home', outlet: 'schedule' };

const allowed = () => Object.keys(ROUTES).filter((k) => ROUTES[k][3](state.user.role));
const parseHash = () => {
  const [path, qs] = location.hash.replace(/^#\/?/, '').split('?');
  return { name: path || DEFAULT[state.user.role], params: Object.fromEntries(new URLSearchParams(qs || '')) };
};

// ───────────── login ─────────────
function renderLogin() {
  app.innerHTML = String(html`
    <div class="login">
      <div class="top"><img src="/assets/logo-white.png" alt="Qasr Laban" /><p>Collab Manager · Barter & Paid</p></div>
      <form data-login>
        <h2>Welcome back</h2>
        <p class="muted small" style="margin:0 0 18px">Sign in with the login given by your manager.</p>
        <label class="field"><span>Username</span><input class="input" name="username" autocomplete="username" autocapitalize="none" required /></label>
        <label class="field"><span>Password</span><input class="input" name="password" type="password" autocomplete="current-password" required /></label>
        <div class="err" data-err></div>
        <button class="btn block" style="margin-top:8px">Sign in</button>
      </form>
    </div>`);
  const f = app.querySelector('[data-login]');
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = f.querySelector('button'); btn.disabled = true; f.querySelector('[data-err]').textContent = '';
    try { await api('/login', { method: 'POST', body: { username: f.username.value, password: f.password.value } }); await start(); }
    catch (err) { f.querySelector('[data-err]').textContent = err.message; btn.disabled = false; }
  });
}

// ───────────── shell ─────────────
function renderShell() {
  const r = state.user.role;
  const nav = allowed().filter((k) => k !== 'profile');
  const bottom = BOTTOM[r];
  const fab = can('collab.create');
  app.innerHTML = String(html`
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><img src="/assets/logo-white.png" alt="Qasr Laban" /></div>
        ${fab ? html`<button class="btn new-btn" data-new>${icon('plus', 'sm')}New collab</button>` : ''}
        ${nav.map((k) => html`<a class="nav" href="#/${k}" data-nav="${k}">${icon(ROUTES[k][0])}${ROUTES[k][1]}</a>`)}
        <div class="grow"></div>
        <a class="me" href="#/profile" data-nav="profile"><div class="avatar">${initials(state.user.name)}</div><div class="grow"><div class="bold ellipsis">${state.user.name}</div><small>${ROLE[r]}${state.user.outlet_name ? ' · ' + state.user.outlet_name : ''}</small></div></a>
      </aside>
      <div>
        <header class="topbar">
          <div class="logo-chip"><img src="/assets/logo-white.png" alt="" /></div>
          <h1 data-title></h1>
        </header>
        <main class="page" data-main></main>
      </div>
      <nav class="bottomnav">
        ${bottom.map((k, i) => html`${fab && i === 2 ? html`<div class="fab-slot"><button class="fab" data-new aria-label="New collab">${icon('plus')}</button></div>` : ''}
          <a href="#/${k}" data-nav="${k}">${icon(k === 'profile' && nav.length > bottom.length - 1 ? 'grid' : ROUTES[k][0])}${k === 'profile' && nav.length > bottom.length - 1 ? 'More' : ROUTES[k][1]}</a>`)}
      </nav>
    </div>`);
  app.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => {
    const { name, params } = parseHash();
    openCollabForm({ date: name === 'schedule' && params.date ? params.date : undefined }, (c) => { location.hash = `#/schedule?date=${c.date}`; });
  }));
}

let renderSeq = 0;
async function route({ keepScroll = false } = {}) {
  if (!state.user) return;
  const { name, params } = parseHash();
  if (!ROUTES[name] || !ROUTES[name][3](state.user.role)) { location.hash = `#/${DEFAULT[state.user.role]}`; return; }
  const main = app.querySelector('[data-main]');
  const seq = ++renderSeq; const y = window.scrollY;
  app.querySelectorAll('[data-nav]').forEach((a) => a.classList.toggle('on', a.dataset.nav === name));
  const title = name === 'lists' ? 'Outlet lists' : name === 'schedule' && state.user.role === 'outlet' ? `${state.user.outlet_name || 'My'} outlet` : name === 'profile' ? (allowed().length > BOTTOM[state.user.role].length ? 'More' : 'Profile') : ROUTES[name][1];
  app.querySelector('[data-title]').innerHTML = String(html`${title}${name === 'home' ? html`<span class="sub">${fmtDate(today(), true)}</span>` : ''}`);
  document.title = `${title} · Qasr Laban Collabs`;
  try {
    // Render into a fresh <main>, then swap it in. Old listeners go away with the old node,
    // and a slow response can never overwrite a newer page.
    const next = document.createElement('main');
    next.className = 'page'; next.setAttribute('data-main', '');
    if (name === 'profile') {
      const bottom = BOTTOM[state.user.role];
      profileView(next, params, allowed().filter((k) => !bottom.includes(k)).map((k) => [`#/${k}`, ROUTES[k][0], ROUTES[k][1]]));
    } else await ROUTES[name][2](next, params);
    if (seq !== renderSeq) return;
    main.replaceWith(next);
    window.scrollTo(0, keepScroll ? y : 0);
    if (keepScroll) requestAnimationFrame(() => window.scrollTo(0, y));
  } catch (e) { if (seq === renderSeq) { main.innerHTML = String(emptyState('alert', 'Could not load', e.message)); } }
}

async function start() {
  try {
    // Ask for the login and the app's lookup data together: one wait instead of two.
    const [me, lookups] = await Promise.all([api('/me'), api('/bootstrap')]);
    state.user = me.user; state.perms = me.perms;
    Object.assign(state, lookups);
  } catch { state.user = null; return renderLogin(); }
  renderShell();
  route();
}

window.addEventListener('hashchange', () => { closeAllSheets(); route(); });
window.addEventListener('ql:changed', () => route({ keepScroll: true }));
// Background refresh brought newer data than the saved copy on screen: update quietly.
let refreshTimer;
window.addEventListener('ql:refreshed', (e) => {
  const { path, data } = e.detail;
  if (path === '/bootstrap') Object.assign(state, data);
  if (path === '/me') { state.user = data.user; state.perms = data.perms; }
  if (!state.user) return;
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    // Don't redraw under someone who is typing in a search or filter box
    const a = document.activeElement;
    if (a && a.closest('[data-main]') && /INPUT|TEXTAREA|SELECT/.test(a.tagName)) return;
    route({ keepScroll: true });
  }, 120);
});
window.addEventListener('ql:logout', () => { clearCache(); if (state.user) { state.user = null; closeAllSheets(); toast('Session expired — please sign in again', 'err'); renderLogin(); } });

// ───────────── public outlet link (/o/:token) ─────────────
async function renderShare(token) {
  try {
    const d = await api(`/share/${token}`);
    const t = today();
    const upcoming = d.collabs.filter((c) => c.date >= t);
    const past = d.collabs.filter((c) => c.date < t).reverse();
    const card = (c) => html`<div class="collab">
      <div class="c-head"><div class="c-name">${c.inf_name}</div>${c.time ? html`<div class="c-when">${fmtTime(c.time)}</div>` : ''}</div>
      <div class="c-sub">${[c.inf_handle && '@' + c.inf_handle, c.inf_followers && compact(c.inf_followers) + ' followers', c.guests > 1 && c.guests + ' people'].filter(Boolean).join(' · ')}</div>
      <div class="c-prod ${c.items.length ? '' : 'warn'}">${c.items.length ? c.items.map((i) => `${i.label}\u00a0×${i.qty}`).join('  ·  ') : 'Products to be confirmed'}</div>
      ${c.notes ? html`<div class="small muted" style="margin-top:6px">${c.notes}</div>` : ''}
      <div class="c-foot"><span class="c-type">${c.deliverables || ''}</span>
        <span class="row" style="gap:8px">${c.inf_url ? html`<a class="small" href="${c.inf_url}" target="_blank" rel="noopener">Profile ${icon('ext', 'xs')}</a>` : ''}${statusPill(c.status)}</span></div>
    </div>`;
    const byDate = (rows) => Object.entries(groupBy(rows, (c) => c.date)).map(([dt, cs]) => html`<div class="date-h"><b>${relDay(dt)}</b><span>${fmtDate(dt)} · ${cs.length}</span></div>${cs.map(card)}`);
    document.title = `${d.outlet.name} · Qasr Laban Collabs`;
    app.innerHTML = String(html`
      <div class="share-head"><img src="/assets/logo-white.png" alt="Qasr Laban" /><h1>${d.outlet.name} outlet</h1><p>Influencer collab schedule</p></div>
      <main class="share-main">
        <div class="stats" style="grid-template-columns:1fr 1fr">
          <div class="stat accent"><div class="k">Today</div><div class="v">${upcoming.filter((c) => c.date === t).length}</div></div>
          <div class="stat"><div class="k">Upcoming</div><div class="v">${upcoming.length}</div></div>
        </div>
        ${upcoming.length ? byDate(upcoming) : html`<div class="card" style="margin-top:14px">${emptyState('calendar', 'No upcoming collabs', 'New visits will appear here as soon as they are scheduled.')}</div>`}
        ${past.length ? html`<details style="margin-top:22px"><summary class="bold muted" style="cursor:pointer">Last 7 days (${past.length})</summary>${byDate(past)}</details>` : ''}
        <button class="btn light block" style="margin-top:22px" onclick="location.reload()">${icon('refresh', 'sm')}Refresh</button>
      </main>`);
  } catch (e) {
    app.innerHTML = String(html`<div class="share-head"><img src="/assets/logo-white.png" alt="Qasr Laban" /></div><main class="share-main"><div class="card">${emptyState('link', 'Link not available', e.message)}</div></main>`);
  }
}

const shareMatch = location.pathname.match(/^\/o\/([\w-]+)/);
if (shareMatch) renderShare(shareMatch[1]); else start();
