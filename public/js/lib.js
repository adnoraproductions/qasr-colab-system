// Shared helpers: API, templating, icons, formatting, sheets, toasts.

// ───── state ─────
export const state = { user: null, perms: [], outlets: [], products: [], influencers: [] };
export const can = (p) => state.perms.includes(p);

// ───── api ─────
async function request(path, opts = {}) {
  const res = await fetch('/api' + path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/share')) { location.hash = ''; window.dispatchEvent(new Event('ql:logout')); }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

// Instant loading: every screen's last data is kept on this device. A screen opens straight
// from that copy and is refreshed in the background; if anything changed, the app re-draws
// (event "ql:refreshed"). Any change you make clears the copy, so you never act on old data.
const CACHE_KEY = 'ql-cache-v1';
const NO_CACHE = /^\/(login|logout|share|me\/password|reports\/export)/;
const FRESH_MS = 3000;
let cache = {};
let generation = 0; // bumps whenever the copy is cleared
try { cache = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}') || {}; } catch { cache = {}; }
let saveTimer;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(cache).sort((a, b) => cache[b].t - cache[a].t);
    for (const k of keys.slice(40)) delete cache[k]; // keep the 40 most recent screens
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { try { localStorage.removeItem(CACHE_KEY); } catch { /* storage blocked */ } }
  }, 300);
}
function remember(path, data) {
  const s = JSON.stringify(data);
  if (s.length > 400_000) return; // very large reports are not worth keeping
  cache[path] = { t: Date.now(), s };
  persist();
}
export function clearCache() {
  cache = {}; generation++;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* storage blocked */ }
}
const inFlight = new Set();
function revalidate(path) {
  if (inFlight.has(path)) return;
  inFlight.add(path);
  const gen = generation;
  request(path).then((data) => {
    if (gen !== generation) return; // something was changed meanwhile; that data is already out of date
    const s = JSON.stringify(data);
    const changed = cache[path]?.s !== s;
    remember(path, data);
    if (changed) window.dispatchEvent(new CustomEvent('ql:refreshed', { detail: { path, data } }));
  }).catch(() => { /* offline or signed out: keep showing the saved copy */ }).finally(() => inFlight.delete(path));
}

export async function api(path, opts = {}) {
  const method = opts.method || 'GET';
  if (method !== 'GET') {
    const data = await request(path, opts);
    clearCache();
    return data;
  }
  if (NO_CACHE.test(path) || opts.fresh) return request(path, opts);
  const hit = cache[path];
  if (hit) {
    if (Date.now() - hit.t > FRESH_MS) revalidate(path);
    return JSON.parse(hit.s); // a fresh copy, so screens can't change the saved one
  }
  const data = await request(path, opts);
  remember(path, data);
  return data;
}

export async function loadLookups() {
  const b = await api('/bootstrap');
  Object.assign(state, b);
}

// ───── templating ─────
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
const val = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : v === false || v == null ? '' : esc(v));
export const html = (strings, ...vals) => raw(strings.reduce((a, s, i) => a + s + (i < vals.length ? val(vals[i]) : ''), ''));

// ───── icons (lucide-style paths) ─────
const P = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  calendar: '<rect x="3" y="4.5" width="18" height="17" rx="3"/><path d="M8 2.5v4M16 2.5v4M3 10h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chef: '<path d="M6 13.9A4 4 0 0 1 7.5 6a5 5 0 0 1 9 0A4 4 0 0 1 18 13.9V20H6z"/><path d="M6 17h12"/>',
  users: '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 3.5a4 4 0 0 1 0 9M22 21a7 7 0 0 0-4-6.3"/>',
  user: '<circle cx="12" cy="8" r="4.5"/><path d="M3.5 21a8.5 8.5 0 0 1 17 0"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  store: '<path d="M3 9.5 4.5 4h15L21 9.5M3 9.5h18M3 9.5a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0M5 12v8h14v-8"/><path d="M10 20v-4h4v4"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h10"/>',
  cake: '<path d="M4 21h16v-8a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2zM4 16c2 0 2-1.5 4-1.5s2 1.5 4 1.5 2-1.5 4-1.5 2 1.5 4 1.5M12 11V7"/><path d="M12 7a1.5 1.5 0 0 0 1.5-1.5C13.5 4 12 2.5 12 2.5S10.5 4 10.5 5.5A1.5 1.5 0 0 0 12 7z"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  pin: '<path d="M12 21s7-5.5 7-11.5a7 7 0 0 0-14 0C5 15.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  insta: '<rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  wa: '<path d="M3 21l1.6-4.7A9 9 0 1 1 8 19.6z"/><path d="M9 9.5c.3 2 2.5 4.6 5 5l1.2-1.3-1.8-1-1 .8c-.8-.4-1.6-1.2-2-2l.8-1-1-1.8z"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  edit: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
  dup: '<rect x="8" y="8" width="13" height="13" rx="3"/><path d="M14.5 12v5M12 14.5h5M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  download: '<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>',
  print: '<path d="M7 9V3h10v6M7 17H4v-7a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v7h-3"/><rect x="7" y="14" width="10" height="7" rx="1"/>',
  refresh: '<path d="M20 11a8 8 0 0 0-14.8-4M4 4v4h4M4 13a8 8 0 0 0 14.8 4M20 20v-4h-4"/>',
  box: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="m3 8 9 5 9-5M12 13v8"/>',
  rupee: '<path d="M6 4h12M6 9h12M14 20 7 13h2a4.5 4.5 0 0 0 0-9"/>',
  gift: '<rect x="3" y="8" width="18" height="5" rx="1"/><path d="M5 13v8h14v-8M12 8v13M12 8S11 3 8 3a2.5 2.5 0 0 0 0 5M12 8s1-5 4-5a2.5 2.5 0 0 1 0 5"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6"/>',
  eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  alert: '<path d="M12 3 2 20h20zM12 10v4M12 17.5v.5"/>',
  filter: '<path d="M3 5h18l-7 8v6l-4 2v-8z"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
  send: '<path d="M22 2 11 13M22 2l-7 20-4-9-9-4z"/>',
  more: '<circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="19" cy="12" r="1.3" fill="currentColor"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
};
export const icon = (name, cls = '') => raw(`<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${P[name] || ''}</svg>`);

// ───── formatting ─────
export const inr = (n) => '₹' + Math.round(n || 0).toLocaleString('en-IN');
export const compact = (n) => { n = Number(n) || 0; if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'K'; return String(n); };
export const initials = (s) => String(s || '?').replace(/^@/, '').split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const today = () => ymd(new Date());
export const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return ymd(d); };
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const dow = (s) => DOW[parse(s).getDay()];
export const fmtDate = (s, withYear = false) => { if (!s) return ''; const d = parse(s); return `${DOW[d.getDay()]}, ${d.getDate()} ${MON[d.getMonth()]}${withYear ? ' ' + d.getFullYear() : ''}`; };
export const shortDate = (s) => { const d = parse(s); return `${d.getDate()} ${MON[d.getMonth()]}`; };
export const relDay = (s) => { const t = today(); if (s === t) return 'Today'; if (s === addDays(t, 1)) return 'Tomorrow'; if (s === addDays(t, -1)) return 'Yesterday'; return fmtDate(s); };
export const fmtTime = (t) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`; };
export const fmtStamp = (s) => { if (!s) return ''; const d = new Date(s.replace(' ', 'T') + 'Z'); return `${d.getDate()} ${MON[d.getMonth()]}, ${fmtTime(`${d.getHours()}:${d.getMinutes()}`)}`; };
export const monthRange = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + offset); const s = ymd(d); d.setMonth(d.getMonth() + 1); d.setDate(0); return [s, ymd(d)]; };

// ───── labels ─────
export const STATUS = {
  scheduled: { label: 'Scheduled', cls: 'brand' },
  confirmed: { label: 'Confirmed', cls: 'sky' },
  completed: { label: 'Visited', cls: 'violet' },
  posted: { label: 'Posted', cls: 'green' },
  cancelled: { label: 'Cancelled', cls: 'red' },
  no_show: { label: 'No show', cls: 'amber' },
};
export const ROLE = { admin: 'Manager', social: 'Social media', outlet: 'Outlet' };
export const statusPill = (s) => html`<span class="pill ${STATUS[s]?.cls}"><span class="dot"></span>${STATUS[s]?.label || s}</span>`;
export const typePill = (c) => c.type === 'paid' ? html`<span class="pill paid">${icon('rupee', 'xs')}Paid${c.amount ? ' · ' + inr(c.amount) : ''}</span>` : html`<span class="pill brand">${icon('gift', 'xs')}Barter</span>`;

// ───── toast ─────
export function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = String(html`${icon(type === 'err' ? 'alert' : 'check', 'sm')}<span>${msg}</span>`);
  document.getElementById('toast-root').appendChild(el);
  setTimeout(() => { el.style.transition = 'opacity .3s'; el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, type === 'err' ? 4000 : 2400);
}
export const oops = (e) => toast(e.message || 'Something went wrong', 'err');

// ───── sheets ─────
const sheets = [];
export function openSheet({ title, body, foot = '', wide = false, onMount, onClose }) {
  const root = document.getElementById('sheet-root');
  const bd = document.createElement('div'); bd.className = 'sheet-backdrop';
  const el = document.createElement('div'); el.className = `sheet${wide ? ' wide' : ''}`; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
  root.append(bd, el);
  const api = {
    el,
    set(parts) {
      if (parts.title !== undefined) el.querySelector('.sheet-head h3').innerHTML = String(parts.title);
      if (parts.body !== undefined) el.querySelector('.sheet-body').innerHTML = String(parts.body);
      if (parts.foot !== undefined) { const f = el.querySelector('.sheet-foot'); f.innerHTML = String(parts.foot); f.classList.toggle('hidden', !String(parts.foot)); }
    },
    close() {
      el.classList.remove('open'); bd.classList.remove('open');
      setTimeout(() => { el.remove(); bd.remove(); }, 260);
      sheets.splice(sheets.indexOf(api), 1);
      if (!sheets.length) document.body.style.overflow = '';
      onClose?.();
    },
  };
  el.innerHTML = String(html`<div class="grab"></div><div class="sheet-head"><h3></h3><button class="icon-btn plain" data-close aria-label="Close">${icon('x')}</button></div><div class="sheet-body"></div><div class="sheet-foot"></div>`);
  api.set({ title, body, foot });
  bd.addEventListener('click', () => api.close());
  el.querySelector('[data-close]').addEventListener('click', () => api.close());
  sheets.push(api); document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => { el.classList.add('open'); bd.classList.add('open'); });
  onMount?.(api);
  return api;
}
export const closeAllSheets = () => [...sheets].reverse().forEach((s) => s.close());
window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheets.length) sheets[sheets.length - 1].close(); });

export function confirmSheet({ title, message, ok = 'Confirm', danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const s = openSheet({
      title, body: html`<p class="muted" style="margin:0 2px 6px">${message}</p>`,
      foot: html`<button class="btn light" data-no>Cancel</button><button class="btn ${danger ? 'danger' : ''}" data-yes>${ok}</button>`,
      onClose: () => { if (!done) resolve(false); },
    });
    s.el.querySelector('[data-no]').onclick = () => s.close();
    s.el.querySelector('[data-yes]').onclick = () => { done = true; resolve(true); s.close(); };
  });
}

// ───── misc ─────
export const formData = (form) => {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked; else o[el.name] = el.value;
  }
  return o;
};
export const on = (root, event, selector, fn) => root.addEventListener(event, (e) => { const t = e.target.closest(selector); if (t && root.contains(t)) fn(e, t); });
export async function copyText(text, msg = 'Copied') { try { await navigator.clipboard.writeText(text); toast(msg); } catch { prompt('Copy this:', text); } }
export const waLink = (text, phone = '') => `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
export const emptyState = (ic, title, text, action = '') => html`<div class="empty"><div class="ico">${icon(ic)}</div><h3>${title}</h3><p>${text}</p>${action}</div>`;
export const productLabel = (p) => p.name;
export const groupBy = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); (m[k] ||= []).push(x); return m; }, {});
