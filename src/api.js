// The whole REST API, independent of any web server. Both the local Node server (server.js)
// and the Vercel Function (api/index.mjs) call handle() with a plain request object.
import { all, get, run, tx, ready, newToken, usingTurso } from './db.js';
import { hashPassword, verifyPassword, can, PERMS } from './auth.js';

const SESSION_DAYS = 30;
const STATUSES = ['scheduled', 'confirmed', 'completed', 'posted', 'cancelled', 'no_show'];
const PAYMENT = ['na', 'pending', 'paid'];
const ROLES = Object.keys(PERMS);

// ───────────────────────── helpers ─────────────────────────
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const need = (user, perm) => { if (!can(user, perm)) fail(403, 'You do not have permission for this action'); };
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
// Calendar day in the business's time zone (servers usually run on UTC).
const TZ = process.env.APP_TZ || 'Asia/Kolkata';
const localDay = (offsetDays = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(Date.now() + offsetDays * 86400e3));
const url = (v) => { const s = str(v, 600); if (!s) return ''; return /^https?:\/\//i.test(s) ? s : `https://${s}`; };

const cookies = (header) => Object.fromEntries((header || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));

async function currentUser(cookieHeader) {
  const token = cookies(cookieHeader).ql_session;
  if (!token) return null;
  return (await get(`SELECT u.id, u.name, u.username, u.role, u.outlet_id, o.name outlet_name
              FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN outlets o ON o.id = u.outlet_id
              WHERE s.token = ? AND s.expires_at > datetime('now') AND u.active = 1 AND u.role IN ('admin','social','outlet')`, token)) || null;
}

const log = (collabId, userId, action) => run('INSERT INTO activity (collab_id, user_id, action) VALUES (?, ?, ?)', collabId, userId, action);

// ───────────────────────── collabs ─────────────────────────
const COLLAB_SELECT = `
  SELECT c.*, o.name outlet_name, o.district outlet_district,
         i.name inf_name, i.handle inf_handle, i.profile_url inf_url, i.followers inf_followers, i.platform inf_platform, i.phone inf_phone,
         cu.name created_by_name, au.name assigned_by_name,
         (SELECT COALESCE(SUM(qty * price), 0) FROM collab_items WHERE collab_id = c.id) product_value,
         (SELECT COALESCE(SUM(qty), 0) FROM collab_items WHERE collab_id = c.id) item_count,
         (SELECT json_group_array(json_object('id', id, 'collab_id', collab_id, 'product_id', product_id, 'label', label, 'price', price, 'qty', qty))
            FROM (SELECT * FROM collab_items WHERE collab_id = c.id ORDER BY id)) items_json
  FROM collabs c
  JOIN outlets o ON o.id = c.outlet_id
  JOIN influencers i ON i.id = c.influencer_id
  LEFT JOIN users cu ON cu.id = c.created_by
  LEFT JOIN users au ON au.id = c.assigned_by`;

function collabFilters(q, user) {
  const where = []; const p = [];
  if (isDate(q.from)) { where.push('c.date >= ?'); p.push(q.from); }
  if (isDate(q.to)) { where.push('c.date <= ?'); p.push(q.to); }
  if (q.outlet) { where.push('c.outlet_id = ?'); p.push(num(q.outlet)); }
  if (q.influencer) { where.push('c.influencer_id = ?'); p.push(num(q.influencer)); }
  if (['barter', 'paid'].includes(q.type)) { where.push('c.type = ?'); p.push(q.type); }
  if (STATUSES.includes(q.status)) { where.push('c.status = ?'); p.push(q.status); }
  if (q.status === 'active') where.push("c.status NOT IN ('cancelled','no_show')");
  if (q.q) { where.push('(i.name LIKE ? OR i.handle LIKE ? OR o.name LIKE ? OR c.notes LIKE ?)'); const s = `%${str(q.q, 80)}%`; p.push(s, s, s, s); }
  if (user.role === 'outlet') { where.push('c.outlet_id = ?'); p.push(user.outlet_id || -1); }
  return { sql: where.length ? ` WHERE ${where.join(' AND ')}` : '', p };
}

// Products arrive as JSON inside each collab row, so a list needs a single database round trip.
function withItems(rows) {
  for (const r of rows) { r.items = r.items_json ? JSON.parse(r.items_json) : []; delete r.items_json; }
  return rows;
}

function mask(rows, user) {
  if (can(user, 'collab.money')) return rows;
  for (const r of rows) { delete r.amount; delete r.payment_status; delete r.inf_phone; }
  return rows;
}

async function listCollabs(q, user, limit = 1000) {
  const f = collabFilters(q, user);
  const order = q.order === 'desc' ? 'DESC' : 'ASC';
  const rows = await all(`${COLLAB_SELECT}${f.sql} ORDER BY c.date ${order}, c.time ${order}, c.id ${order} LIMIT ${limit}`, ...f.p);
  return mask(withItems(rows), user);
}

async function getCollab(id, user) {
  const [row, activity] = await Promise.all([
    get(`${COLLAB_SELECT} WHERE c.id = ?`, id),
    all('SELECT a.action, a.created_at, u.name user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id WHERE a.collab_id = ? ORDER BY a.id DESC LIMIT 50', id),
  ]);
  if (!row) fail(404, 'Collab not found');
  if (user.role === 'outlet' && row.outlet_id !== user.outlet_id) fail(404, 'Collab not found');
  withItems([row]);
  row.activity = activity;
  return mask([row], user)[0];
}

async function collabInput(b) {
  const d = {
    date: str(b.date, 10), time: str(b.time, 10), outlet_id: num(b.outlet_id), influencer_id: num(b.influencer_id),
    type: b.type === 'paid' ? 'paid' : 'barter', amount: Math.max(0, num(b.amount)),
    payment_status: PAYMENT.includes(b.payment_status) ? b.payment_status : 'na',
    deliverables: (Array.isArray(b.deliverables) ? b.deliverables : str(b.deliverables).split(',')).map((s) => str(s, 40)).filter(Boolean).join(', '),
    guests: Math.max(1, Math.min(50, num(b.guests, 1))), notes: str(b.notes, 2000), post_link: url(b.post_link),
  };
  if (d.type === 'barter') { d.amount = 0; d.payment_status = 'na'; } else if (d.payment_status === 'na') d.payment_status = 'pending';
  if (!isDate(d.date)) fail(400, 'Please choose a valid date');
  if (!(await get('SELECT id FROM outlets WHERE id = ?', d.outlet_id))) fail(400, 'Please choose an outlet');
  return d;
}

// Influencer details come in with each collab. Match a repeat influencer by @handle,
// then profile link, then name, and refresh their details; otherwise create them.
// `currentId` is the influencer already on the collab when editing.
async function resolveInfluencer(raw, currentId = null) {
  if (!raw || !(str(raw.name) || str(raw.profile_url) || str(raw.handle))) fail(400, "Enter the influencer's name or profile link");
  const d = influencerInput(raw);
  let row = (d.handle && await get('SELECT * FROM influencers WHERE lower(handle) = lower(?)', d.handle))
    || (d.profile_url && await get('SELECT * FROM influencers WHERE lower(profile_url) = lower(?)', d.profile_url))
    || await get("SELECT * FROM influencers WHERE lower(name) = lower(?) AND (handle = '' OR ? = '')", d.name, d.handle);
  if (!row && currentId) {
    // Editing: a corrected name, or a link added to a name-only influencer, updates the same person
    const cur = await get('SELECT * FROM influencers WHERE id = ?', currentId);
    if (cur && (!cur.handle || !d.handle)) row = cur;
  }
  if (!row) return createInfluencer(d);
  await run('UPDATE influencers SET name = ?, handle = ?, platform = ?, profile_url = ?, followers = ?, phone = ? WHERE id = ?',
    d.name || row.name, d.handle || row.handle, d.profile_url ? d.platform : row.platform, d.profile_url || row.profile_url,
    d.followers || row.followers, d.phone || row.phone, row.id);
  return row.id;
}

async function setItems(collabId, items, user) {
  const clean = (Array.isArray(items) ? items : []).map((it) => ({ product_id: num(it.product_id), qty: Math.max(1, Math.min(99, num(it.qty, 1))) })).filter((it) => it.product_id);
  await run('DELETE FROM collab_items WHERE collab_id = ?', collabId);
  let n = 0;
  for (const it of clean) {
    const p = await get('SELECT * FROM products WHERE id = ?', it.product_id);
    if (p) { await run('INSERT INTO collab_items (collab_id, product_id, label, price, qty) VALUES (?, ?, ?, ?, ?)', collabId, p.id, p.name, p.price, it.qty); n++; }
  }
  await run("UPDATE collabs SET assigned_by = ?, assigned_at = datetime('now'), updated_at = datetime('now') WHERE id = ?", user.id, collabId);
  return n;
}

function influencerInput(b) {
  const d = { name: str(b.name, 120), handle: str(b.handle, 80).replace(/^@?/, ''), platform: str(b.platform, 30) || 'Instagram',
    profile_url: url(b.profile_url), followers: Math.max(0, Math.round(num(b.followers))), phone: str(b.phone, 30), city: str(b.city, 80), niche: str(b.niche, 80), notes: str(b.notes, 1000) };
  if (!d.handle && d.profile_url) { const m = d.profile_url.match(/(?:instagram\.com|youtube\.com\/@?|facebook\.com)\/?([A-Za-z0-9._-]+)/i); if (m) d.handle = m[1]; }
  if (!str(b.platform) && d.profile_url) d.platform = /youtu/i.test(d.profile_url) ? 'YouTube' : /facebook/i.test(d.profile_url) ? 'Facebook' : 'Instagram';
  if (!d.name) d.name = d.handle;
  if (!d.name) fail(400, 'Influencer name or profile link is required');
  return d;
}
async function createInfluencer(b) {
  const d = influencerInput(b);
  return (await run('INSERT INTO influencers (name, handle, platform, profile_url, followers, phone, city, niche, notes) VALUES (?,?,?,?,?,?,?,?,?)',
    d.name, d.handle, d.platform, d.profile_url, d.followers, d.phone, d.city, d.niche, d.notes)).lastId;
}

// ───────────────────────── reports ─────────────────────────
async function report(q, user) {
  const rows = await listCollabs({ ...q, order: 'asc' }, user, 100000);
  const live = rows.filter((r) => !['cancelled', 'no_show'].includes(r.status));
  const sum = (arr, f) => arr.reduce((a, r) => a + (f(r) || 0), 0);
  const group = (arr, key, init) => { const m = new Map(); for (const r of arr) { const k = key(r); if (!m.has(k)) m.set(k, init(r)); m.get(k).rows.push(r); } return [...m.values()]; };

  const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, rows.filter((r) => r.status === s).length]));
  const totals = {
    collabs: rows.length, active: live.length,
    barter: live.filter((r) => r.type === 'barter').length, paid: live.filter((r) => r.type === 'paid').length,
    product_value: sum(live, (r) => r.product_value), paid_amount: sum(live, (r) => r.amount),
    paid_settled: sum(live.filter((r) => r.payment_status === 'paid'), (r) => r.amount),
    items: sum(live, (r) => r.item_count), influencers: new Set(live.map((r) => r.influencer_id)).size,
    outlets: new Set(live.map((r) => r.outlet_id)).size, reach: sum(live, (r) => r.inf_followers),
    posted: statusCounts.posted,
  };
  totals.investment = totals.product_value + totals.paid_amount;
  totals.cost_per_collab = totals.active ? Math.round(totals.investment / totals.active) : 0;

  const byOutlet = group(live, (r) => r.outlet_id, (r) => ({ id: r.outlet_id, name: r.outlet_name, district: r.outlet_district, rows: [] }))
    .map((g) => ({ id: g.id, name: g.name, district: g.district, count: g.rows.length, barter: g.rows.filter((r) => r.type === 'barter').length,
      paid: g.rows.filter((r) => r.type === 'paid').length, product_value: sum(g.rows, (r) => r.product_value), paid_amount: sum(g.rows, (r) => r.amount) }))
    .map((g) => ({ ...g, total: g.product_value + g.paid_amount })).sort((a, b) => b.count - a.count || b.total - a.total);

  const byInfluencer = group(live, (r) => r.influencer_id, (r) => ({ id: r.influencer_id, name: r.inf_name, handle: r.inf_handle, url: r.inf_url, followers: r.inf_followers, rows: [] }))
    .map((g) => ({ id: g.id, name: g.name, handle: g.handle, url: g.url, followers: g.followers, count: g.rows.length, posted: g.rows.filter((r) => r.status === 'posted').length,
      product_value: sum(g.rows, (r) => r.product_value), paid_amount: sum(g.rows, (r) => r.amount) }))
    .map((g) => ({ ...g, total: g.product_value + g.paid_amount })).sort((a, b) => b.total - a.total);

  const prod = new Map();
  for (const r of live) for (const it of r.items) {
    const k = it.label; if (!prod.has(k)) prod.set(k, { label: k, qty: 0, value: 0 });
    const p = prod.get(k); p.qty += it.qty; p.value += it.qty * it.price;
  }
  const byProduct = [...prod.values()].sort((a, b) => b.qty - a.qty);

  const days = new Map();
  for (const r of rows) { if (!days.has(r.date)) days.set(r.date, { date: r.date, count: 0, value: 0 }); const d = days.get(r.date); d.count++; if (live.includes(r)) d.value += r.product_value + (r.amount || 0); }
  const byDay = [...days.values()];

  if (!can(user, 'collab.money')) { delete totals.paid_amount; delete totals.paid_settled; delete totals.investment; }
  return { totals, statusCounts, byOutlet, byInfluencer, byProduct, byDay, rows };
}

function csv(rows) {
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ['Date', 'Time', 'Outlet', 'District', 'Influencer', 'Handle', 'Profile link', 'Followers', 'Type', 'Status', 'Products', 'Item qty', 'Product value', 'Paid amount', 'Payment', 'Total cost', 'Deliverables', 'Post link', 'Notes', 'Created by', 'Assigned by'];
  const lines = rows.map((r) => [r.date, r.time, r.outlet_name, r.outlet_district, r.inf_name, r.inf_handle ? '@' + r.inf_handle : '', r.inf_url, r.inf_followers, r.type, r.status,
    r.items.map((i) => `${i.label} x${i.qty}`).join('; '), r.item_count, r.product_value, r.amount ?? '', r.payment_status ?? '', r.product_value + (r.amount || 0), r.deliverables, r.post_link, r.notes, r.created_by_name, r.assigned_by_name].map(esc).join(','));
  return '﻿' + [head.join(','), ...lines].join('\n');
}

// ───────────────────────── routes ─────────────────────────
const routes = [];
const route = (method, path, handler, opts = {}) => {
  const keys = []; const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler, auth: opts.auth !== false });
};
// A route can return plain data (sent as JSON) or a full response via raw().
const raw = (body, headers = {}, status = 200) => ({ __raw: true, status, headers, body });

const loginAttempts = new Map();

route('POST', '/api/login', async ({ req, body }) => {
  // Count failures per username + address: behind a hosting proxy every user shares one
  // address, so keying on the address alone would lock the whole team out.
  const key = `${str(body.username, 60).toLowerCase()}|${req.ip}`; const now = Date.now();
  if (loginAttempts.size > 5000) loginAttempts.clear();
  const a = loginAttempts.get(key) || { n: 0, t: now };
  if (now - a.t > 15 * 60e3) { a.n = 0; a.t = now; }
  if (a.n >= 10) fail(429, 'Too many attempts. Try again in a few minutes.');
  const u = await get("SELECT * FROM users WHERE username = ? AND active = 1 AND role IN ('admin','social','outlet')", str(body.username, 60));
  if (!u || !verifyPassword(body.password || '', u.pass_hash)) { a.n++; loginAttempts.set(key, a); fail(401, 'Incorrect username or password'); }
  loginAttempts.delete(key);
  const token = newToken(32);
  await run(`INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, datetime('now', '+${SESSION_DAYS} days'))`, token, u.id);
  await run("UPDATE users SET last_login = datetime('now') WHERE id = ?", u.id);
  return raw(JSON.stringify({ ok: true }), { 'Set-Cookie': `ql_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}` });
}, { auth: false });

route('POST', '/api/logout', async ({ req }) => {
  const t = cookies(req.cookie).ql_session; if (t) await run('DELETE FROM sessions WHERE token = ?', t);
  return raw(JSON.stringify({ ok: true }), { 'Set-Cookie': `ql_session=; Path=/; HttpOnly; Max-Age=0${req.secure ? '; Secure' : ''}` });
}, { auth: false });

route('GET', '/api/me', ({ user }) => ({ user, perms: PERMS[user.role] }));
route('POST', '/api/me/password', async ({ user, body }) => {
  const u = await get('SELECT * FROM users WHERE id = ?', user.id);
  if (!verifyPassword(body.current || '', u.pass_hash)) fail(400, 'Current password is incorrect');
  if (str(body.next).length < 6) fail(400, 'New password must be at least 6 characters');
  await run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(body.next), user.id);
  return { ok: true };
});

// Lookup data the app needs everywhere
route('GET', '/api/bootstrap', async ({ user }) => {
  const [outlets, products, influencers] = await Promise.all([
    all(`SELECT id, name, district, active${can(user, 'outlet.edit') ? ', address, phone, manager_name, maps_url, share_token' : ''} FROM outlets ORDER BY active DESC, name`),
    all('SELECT * FROM products ORDER BY active DESC, sort, id'),
    can(user, 'influencer.edit') ? all('SELECT id, name, handle, platform, profile_url, followers, phone FROM influencers ORDER BY name COLLATE NOCASE') : [],
  ]);
  return { outlets, products, influencers };
});

// Dashboard summary
route('GET', '/api/dashboard', async ({ user, query }) => {
  const today = isDate(query.today) ? query.today : localDay();
  const monthStart = today.slice(0, 8) + '01';
  const [upcoming, r, pending] = await Promise.all([
    listCollabs({ from: today, status: 'active' }, user, 40),
    report({ from: monthStart, to: today.slice(0, 8) + '31' }, user),
    can(user, 'collab.status') ? get("SELECT COUNT(*) n FROM collabs WHERE status = 'completed'") : { n: 0 },
  ]);
  const needsItems = can(user, 'collab.items') ? upcoming.filter((c) => !c.items.length).length : 0;
  const pendingPosts = Number(pending.n);
  return { today, upcoming, month: { totals: r.totals, statusCounts: r.statusCounts, topOutlets: r.byOutlet.slice(0, 5) }, needsItems, pendingPosts };
});

route('GET', '/api/collabs', ({ user, query }) => listCollabs(query, user));
route('GET', '/api/collabs/:id', ({ user, params }) => getCollab(num(params.id), user));

route('POST', '/api/collabs', async ({ user, body }) => {
  need(user, 'collab.create');
  const id = await tx(async () => {
    const d = await collabInput(body); d.influencer_id = await resolveInfluencer(body.influencer);
    const id = (await run(`INSERT INTO collabs (date, time, outlet_id, influencer_id, type, amount, payment_status, deliverables, guests, notes, post_link, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`, d.date, d.time, d.outlet_id, d.influencer_id, d.type, d.amount, d.payment_status, d.deliverables, d.guests, d.notes, d.post_link, user.id)).lastId;
    await log(id, user.id, `Scheduled ${d.type} collab for ${d.date}`);
    if (Array.isArray(body.items) && body.items.length && can(user, 'collab.items')) { await setItems(id, body.items, user); await log(id, user.id, 'Assigned products'); }
    return id;
  });
  return getCollab(id, user);
});

route('PUT', '/api/collabs/:id', async ({ user, body, params }) => {
  need(user, 'collab.edit');
  const id = num(params.id); const before = await getCollab(id, user);
  await tx(async () => {
    const d = await collabInput({ ...before, ...body });
    d.influencer_id = body.influencer ? await resolveInfluencer(body.influencer, before.influencer_id) : before.influencer_id;
    await run(`UPDATE collabs SET date=?, time=?, outlet_id=?, influencer_id=?, type=?, amount=?, payment_status=?, deliverables=?, guests=?, notes=?, post_link=?, updated_at=datetime('now') WHERE id=?`,
      d.date, d.time, d.outlet_id, d.influencer_id, d.type, d.amount, d.payment_status, d.deliverables, d.guests, d.notes, d.post_link, id);
    const changes = [];
    if (before.date !== d.date) changes.push(`date ${before.date} → ${d.date}`);
    if (before.outlet_id !== d.outlet_id) changes.push('outlet changed');
    if (before.type !== d.type) changes.push(`type → ${d.type}`);
    await log(id, user.id, changes.length ? `Updated: ${changes.join(', ')}` : 'Updated details');
  });
  return getCollab(id, user);
});

route('DELETE', '/api/collabs/:id', async ({ user, params }) => {
  need(user, 'collab.delete'); const id = num(params.id);
  // Explicit clean-up: Turso connections don't enforce ON DELETE CASCADE
  await tx(async () => {
    await run('DELETE FROM collab_items WHERE collab_id = ?', id);
    await run('DELETE FROM activity WHERE collab_id = ?', id);
    await run('DELETE FROM collabs WHERE id = ?', id);
  });
  return { ok: true };
});

route('POST', '/api/collabs/:id/duplicate', async ({ user, body, params }) => {
  need(user, 'collab.create');
  const src = await getCollab(num(params.id), user);
  const id = await tx(async () => {
    const id = (await run(`INSERT INTO collabs (date, time, outlet_id, influencer_id, type, amount, payment_status, deliverables, guests, notes, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`, isDate(body.date) ? body.date : src.date, src.time, src.outlet_id, src.influencer_id, src.type, src.amount || 0,
      src.type === 'paid' ? 'pending' : 'na', src.deliverables, src.guests, src.notes, user.id)).lastId;
    await log(id, user.id, `Duplicated from collab #${src.id}`);
    if (src.items.length && can(user, 'collab.items')) await setItems(id, src.items, user);
    return id;
  });
  return getCollab(id, user);
});

route('PUT', '/api/collabs/:id/items', async ({ user, body, params }) => {
  need(user, 'collab.items');
  const id = num(params.id); await getCollab(id, user);
  await tx(async () => { const n = await setItems(id, body.items, user); await log(id, user.id, n ? `Assigned ${n} product line(s)` : 'Cleared products'); });
  return getCollab(id, user);
});

route('PATCH', '/api/collabs/:id', async ({ user, body, params }) => {
  const id = num(params.id); const c = await getCollab(id, user);
  // Check every permission before writing anything
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) fail(400, 'Invalid status');
    const visitOnly = ['completed', 'no_show'].includes(body.status) && can(user, 'collab.visit');
    if (!can(user, 'collab.status') && !visitOnly) fail(403, 'You do not have permission for this action');
  }
  if (body.post_link !== undefined) need(user, 'collab.status');
  if (body.payment_status !== undefined) { need(user, 'collab.money'); if (!PAYMENT.includes(body.payment_status) || c.type !== 'paid') fail(400, 'Invalid payment status'); }
  await tx(async () => {
    if (body.status !== undefined) { await run("UPDATE collabs SET status = ?, updated_at = datetime('now') WHERE id = ?", body.status, id); await log(id, user.id, `Status → ${body.status.replace('_', ' ')}`); }
    if (body.post_link !== undefined) { await run('UPDATE collabs SET post_link = ? WHERE id = ?', url(body.post_link), id); await log(id, user.id, 'Added post link'); }
    if (body.payment_status !== undefined) { await run('UPDATE collabs SET payment_status = ? WHERE id = ?', body.payment_status, id); await log(id, user.id, `Payment → ${body.payment_status}`); }
  });
  return getCollab(id, user);
});

// Outlets
const outletInput = (b) => { const d = { name: str(b.name, 80), district: str(b.district, 80), address: str(b.address, 300), phone: str(b.phone, 30), manager_name: str(b.manager_name, 80), maps_url: url(b.maps_url), active: b.active === false || b.active === 0 ? 0 : 1 }; if (!d.name) fail(400, 'Outlet name is required'); return d; };
route('GET', '/api/outlets', ({ user }) => {
  need(user, 'outlet.edit');
  return all(`SELECT o.*, (SELECT COUNT(*) FROM collabs c WHERE c.outlet_id = o.id) collabs,
      (SELECT COUNT(*) FROM collabs c WHERE c.outlet_id = o.id AND c.date >= ? AND c.status NOT IN ('cancelled','no_show')) upcoming
    FROM outlets o ORDER BY o.active DESC, o.name`, localDay());
});
route('POST', '/api/outlets', async ({ user, body }) => {
  need(user, 'outlet.edit'); const d = outletInput(body);
  const id = (await run('INSERT INTO outlets (name, district, address, phone, manager_name, maps_url, active, share_token) VALUES (?,?,?,?,?,?,?,?)', d.name, d.district, d.address, d.phone, d.manager_name, d.maps_url, d.active, newToken())).lastId;
  return get('SELECT * FROM outlets WHERE id = ?', id);
});
route('PUT', '/api/outlets/:id', async ({ user, body, params }) => {
  need(user, 'outlet.edit'); const d = outletInput(body);
  await run('UPDATE outlets SET name=?, district=?, address=?, phone=?, manager_name=?, maps_url=?, active=? WHERE id=?', d.name, d.district, d.address, d.phone, d.manager_name, d.maps_url, d.active, num(params.id));
  return get('SELECT * FROM outlets WHERE id = ?', num(params.id));
});
route('POST', '/api/outlets/:id/token', async ({ user, params }) => { need(user, 'outlet.edit'); await run('UPDATE outlets SET share_token = ? WHERE id = ?', newToken(), num(params.id)); return get('SELECT * FROM outlets WHERE id = ?', num(params.id)); });
route('DELETE', '/api/outlets/:id', async ({ user, params }) => {
  need(user, 'outlet.edit'); const id = num(params.id);
  if (await get('SELECT id FROM collabs WHERE outlet_id = ? LIMIT 1', id)) fail(400, 'This outlet has collabs. Mark it inactive instead.');
  await tx(async () => { await run('UPDATE users SET outlet_id = NULL, active = 0 WHERE outlet_id = ?', id); await run('DELETE FROM outlets WHERE id = ?', id); });
  return { ok: true };
});

// Products
const productInput = (b) => { const d = { name: str(b.name, 80), price: Math.max(0, num(b.price)), active: b.active === false || b.active === 0 ? 0 : 1 }; if (!d.name) fail(400, 'Product name is required'); return d; };
route('POST', '/api/products', async ({ user, body }) => {
  need(user, 'product.edit'); const d = productInput(body);
  const sort = ((await get('SELECT MAX(sort) m FROM products')).m ?? 0) + 1;
  const id = (await run('INSERT INTO products (name, price, active, sort) VALUES (?,?,?,?)', d.name, d.price, d.active, sort)).lastId;
  return get('SELECT * FROM products WHERE id = ?', id);
});
route('PUT', '/api/products/:id', async ({ user, body, params }) => {
  need(user, 'product.edit'); const d = productInput(body);
  await run('UPDATE products SET name=?, price=?, active=? WHERE id=?', d.name, d.price, d.active, num(params.id));
  return get('SELECT * FROM products WHERE id = ?', num(params.id));
});
route('DELETE', '/api/products/:id', async ({ user, params }) => {
  need(user, 'product.edit'); const id = num(params.id);
  await tx(async () => { await run('UPDATE collab_items SET product_id = NULL WHERE product_id = ?', id); await run('DELETE FROM products WHERE id = ?', id); });
  return { ok: true };
});

// Users
route('GET', '/api/users', ({ user }) => { need(user, 'user.edit'); return all('SELECT u.id, u.name, u.username, u.role, u.outlet_id, u.active, u.last_login, o.name outlet_name FROM users u LEFT JOIN outlets o ON o.id = u.outlet_id ORDER BY u.role, u.name'); });
const userInput = (b) => {
  const d = { name: str(b.name, 80), username: str(b.username, 40).toLowerCase(), role: ROLES.includes(b.role) ? b.role : 'social', outlet_id: num(b.outlet_id) || null, active: b.active === false || b.active === 0 ? 0 : 1 };
  if (!d.name || !/^[a-z0-9._-]{3,40}$/.test(d.username)) fail(400, 'Name and a username (3+ letters/numbers) are required');
  if (d.role === 'outlet' && !d.outlet_id) fail(400, 'Choose the outlet for this login');
  if (d.role !== 'outlet') d.outlet_id = null;
  return d;
};
route('POST', '/api/users', async ({ user, body }) => {
  need(user, 'user.edit'); const d = userInput(body);
  if (str(body.password).length < 6) fail(400, 'Password must be at least 6 characters');
  if (await get('SELECT id FROM users WHERE username = ?', d.username)) fail(400, 'Username already taken');
  await run('INSERT INTO users (name, username, pass_hash, role, outlet_id, active) VALUES (?,?,?,?,?,?)', d.name, d.username, hashPassword(body.password), d.role, d.outlet_id, d.active);
  return { ok: true };
});
route('PUT', '/api/users/:id', async ({ user, body, params }) => {
  need(user, 'user.edit'); const id = num(params.id); const d = userInput(body);
  if (await get('SELECT id FROM users WHERE username = ? AND id != ?', d.username, id)) fail(400, 'Username already taken');
  if (id === user.id && (d.role !== 'admin' || !d.active)) fail(400, 'You cannot remove your own admin access');
  if (str(body.password) && str(body.password).length < 6) fail(400, 'Password must be at least 6 characters');
  await tx(async () => {
    await run('UPDATE users SET name=?, username=?, role=?, outlet_id=?, active=? WHERE id=?', d.name, d.username, d.role, d.outlet_id, d.active, id);
    if (str(body.password)) { await run('UPDATE users SET pass_hash = ? WHERE id = ?', hashPassword(body.password), id); await run('DELETE FROM sessions WHERE user_id = ?', id); }
    if (!d.active) await run('DELETE FROM sessions WHERE user_id = ?', id);
  });
  return { ok: true };
});
route('DELETE', '/api/users/:id', async ({ user, params }) => {
  need(user, 'user.edit'); const id = num(params.id);
  if (id === user.id) fail(400, 'You cannot delete yourself');
  await tx(async () => { await run('DELETE FROM sessions WHERE user_id = ?', id); await run('DELETE FROM users WHERE id = ?', id); });
  return { ok: true };
});

// Reports
route('GET', '/api/reports', ({ user, query }) => { need(user, 'report.view'); return report(query, user); });
route('GET', '/api/reports/export.csv', async ({ user, query }) => {
  need(user, 'report.view');
  const rows = await listCollabs({ ...query, order: 'asc' }, user, 100000);
  return raw(csv(rows), { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="qasr-laban-collabs-${query.from || 'all'}-to-${query.to || 'all'}.csv"` });
});

// Public outlet schedule link (no login) — read only, no money, no phone numbers
route('GET', '/api/share/:token', async ({ params, query }) => {
  const o = await get('SELECT id, name, district FROM outlets WHERE share_token = ? AND active = 1', str(params.token, 60));
  if (!o) fail(404, 'This link is no longer valid');
  const from = isDate(query.from) ? query.from : localDay(-7);
  const rows = withItems(await all(`${COLLAB_SELECT} WHERE c.outlet_id = ? AND c.date >= ? AND c.status != 'cancelled' ORDER BY c.date, c.time LIMIT 200`, o.id, from));
  return { outlet: o, collabs: rows.map((r) => ({ id: r.id, date: r.date, time: r.time, type: r.type, status: r.status, guests: r.guests, deliverables: r.deliverables, notes: r.notes,
    inf_name: r.inf_name, inf_handle: r.inf_handle, inf_url: r.inf_url, inf_followers: r.inf_followers, items: r.items.map((i) => ({ label: i.label, qty: i.qty })) })) };
}, { auth: false });

// ───────────────────────── entry point ─────────────────────────
const json = (status, data, headers = {}) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }, body: JSON.stringify(data) });

/**
 * @param {{ method: string, path: string, query: object, cookie?: string, body?: string, ip?: string, secure?: boolean }} req
 * @returns {Promise<{ status: number, headers: object, body: string }>}
 */
// Explain database connection failures in plain words (Turso error codes never include the token).
function dbProblem(e) {
  const m = `${e?.code || ''} ${e?.message || e}`;
  let hint = 'Check TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in your hosting settings, then redeploy.';
  if (/URL_INVALID|URL_SCHEME/i.test(m)) hint = 'TURSO_DATABASE_URL is not a valid address. It should look like libsql://your-db-name.turso.io';
  else if (/\b401\b|unauthori[sz]ed|token|jwt/i.test(m)) hint = 'Turso rejected the token. Create a new token (Read & Write, never expires) and update TURSO_AUTH_TOKEN, then redeploy.';
  else if (/\b404\b|not found/i.test(m)) hint = 'Turso could not find that database. Copy the URL again from the database page and update TURSO_DATABASE_URL, then redeploy.';
  else if (/ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(m)) hint = 'Could not reach Turso. Check TURSO_DATABASE_URL for typos, then redeploy.';
  return { error: `Can't connect to the database. ${hint}`, detail: m.replace(/\s+/g, ' ').trim().slice(0, 160) };
}

export async function handle(req) {
  try {
    await ready();
  } catch (e) {
    console.error('Database connection failed:', e);
    return json(503, dbProblem(e));
  }
  if (req.method === 'GET' && req.path === '/api/health') return json(200, { ok: true, database: usingTurso() ? 'turso' : 'local file' });
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = req.path.match(r.re); if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const user = await currentUser(req.cookie);
      if (r.auth && !user) fail(401, 'Please sign in');
      let body = {};
      if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
        if (req.body.length > 1e6) fail(413, 'Request too large');
        try { body = JSON.parse(req.body); } catch { fail(400, 'Invalid JSON'); }
      }
      const out = await r.handler({ req, user, params, body, query: req.query || {} });
      if (out?.__raw) return { status: out.status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...out.headers }, body: out.body };
      return json(200, out ?? { ok: true });
    }
    fail(404, 'Not found');
  } catch (e) {
    if (!(e instanceof HttpError)) console.error(e);
    return json(e.status || 500, { error: e instanceof HttpError ? e.message : 'Something went wrong' });
  }
}
