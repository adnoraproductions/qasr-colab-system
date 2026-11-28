// Database layer with one async API over two backends:
//   • Turso / libSQL (used on Vercel, or anywhere TURSO_DATABASE_URL is set)
//   • a local SQLite file via Node's built-in node:sqlite (default for `npm start`)
// Both speak the same SQLite dialect, so every query in the app runs unchanged on either.
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes } from 'node:crypto';
import { OUTLETS, MENU, DEFAULT_ADMIN } from './seed-data.js';
import { hashPassword } from './auth.js';

export const newToken = (n = 18) => randomBytes(n).toString('base64url');

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS outlets (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  district TEXT DEFAULT '',
  address TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  manager_name TEXT DEFAULT '',
  maps_url TEXT DEFAULT '',
  share_token TEXT UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS influencers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  handle TEXT DEFAULT '',
  platform TEXT DEFAULT 'Instagram',
  profile_url TEXT DEFAULT '',
  followers INTEGER DEFAULT 0,
  phone TEXT DEFAULT '',
  city TEXT DEFAULT '',
  niche TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','social','kitchen','outlet')),
  outlet_id INTEGER REFERENCES outlets(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS collabs (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  time TEXT DEFAULT '',
  outlet_id INTEGER NOT NULL REFERENCES outlets(id),
  influencer_id INTEGER NOT NULL REFERENCES influencers(id),
  type TEXT NOT NULL CHECK (type IN ('barter','paid')),
  amount REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'na',
  status TEXT NOT NULL DEFAULT 'scheduled',
  kitchen_status TEXT NOT NULL DEFAULT 'pending',
  deliverables TEXT DEFAULT '',
  guests INTEGER DEFAULT 1,
  post_link TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  kitchen_notes TEXT DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  assigned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_collabs_date ON collabs(date);
CREATE INDEX IF NOT EXISTS idx_collabs_outlet ON collabs(outlet_id, date);
CREATE TABLE IF NOT EXISTS collab_items (
  id INTEGER PRIMARY KEY,
  collab_id INTEGER NOT NULL REFERENCES collabs(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  qty INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_items_collab ON collab_items(collab_id);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY,
  collab_id INTEGER REFERENCES collabs(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_collab ON activity(collab_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`;

// ───────────── backends ─────────────
// Each exposes exec(sql, args) → { rows, lastId }, execScript(sql) and begin() → a transaction.

function libsqlBackend(client) {
  const shape = (rs) => ({
    rows: rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]]))),
    lastId: rs.lastInsertRowid != null ? Number(rs.lastInsertRowid) : undefined,
  });
  return {
    exec: async (sql, args) => shape(await client.execute({ sql, args })),
    execScript: (sql) => client.executeMultiple(sql),
    async begin() {
      const t = await client.transaction('write');
      return { exec: async (sql, args) => shape(await t.execute({ sql, args })), commit: () => t.commit(), rollback: () => t.rollback(), close: () => t.close() };
    },
  };
}

async function sqliteFileBackend(path) {
  const { DatabaseSync } = await import('node:sqlite'); // only loaded for local runs
  const { mkdirSync } = await import('node:fs');
  const { dirname } = await import('node:path');
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const exec = async (sql, args) => {
    const st = db.prepare(sql);
    if (/^\s*(SELECT|WITH|PRAGMA)/i.test(sql)) return { rows: st.all(...args) };
    const r = st.run(...args);
    return { rows: [], lastId: Number(r.lastInsertRowid) };
  };
  // One connection is shared by every request, so transactions take turns.
  let queue = Promise.resolve();
  return {
    exec,
    execScript: async (sql) => db.exec(sql),
    async begin() {
      let release; const prev = queue; queue = new Promise((r) => { release = r; }); await prev;
      db.exec('BEGIN');
      return { exec, commit: async () => db.exec('COMMIT'), rollback: async () => db.exec('ROLLBACK'), close: () => release() };
    },
  };
}

// ───────────── public API ─────────────
let backend;
const txStore = new AsyncLocalStorage();
const conn = () => txStore.getStore() || backend;

export const all = async (sql, ...args) => (await conn().exec(sql, args)).rows;
export const get = async (sql, ...args) => (await conn().exec(sql, args)).rows[0];
export const run = async (sql, ...args) => conn().exec(sql, args);

export async function tx(fn) {
  if (txStore.getStore()) return fn(); // already inside one
  const t = await backend.begin();
  try {
    const out = await txStore.run(t, fn);
    await t.commit();
    return out;
  } catch (e) {
    try { await t.rollback(); } catch { /* already closed */ }
    throw e;
  } finally { t.close(); }
}

async function seed() {
  if ((await get('SELECT COUNT(*) c FROM users')).c) return;
  const fromEnv = !!process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || randomBytes(6).toString('base64url');
  await tx(async () => {
    for (const [name, district] of OUTLETS) await run('INSERT INTO outlets (name, district, share_token) VALUES (?, ?, ?)', name, district, newToken());
    for (const [i, [name, price]] of MENU.entries()) await run("INSERT INTO products (category, name, price, sort) VALUES ('', ?, ?, ?)", name, price, i);
    await run('INSERT INTO users (name, username, pass_hash, role) VALUES (?, ?, ?, ?)', DEFAULT_ADMIN.name, DEFAULT_ADMIN.username, hashPassword(password), 'admin');
  });
  console.log(`\n  First run: seeded ${OUTLETS.length} outlets and the menu.`);
  console.log(`  Sign in as "${DEFAULT_ADMIN.username}" with ${fromEnv ? 'the ADMIN_PASSWORD you set' : `password: ${password}`}`);
  console.log('  Change it from More → Profile after signing in.\n');
}

// Settings pasted into a hosting dashboard often pick up quotes or spaces — ignore them.
const setting = (name) => (process.env[name] || '').trim().replace(/^["']+|["']+$/g, '').trim();
export const usingTurso = () => !!setting('TURSO_DATABASE_URL');

let readyPromise;
/** Connect, create tables if missing and seed an empty database. Cheap to call on every request. */
export function ready() {
  return (readyPromise ||= (async () => {
    const url = setting('TURSO_DATABASE_URL');
    if (url) {
      // The fetch-based client runs anywhere (Vercel Functions included); file: URLs need the full client.
      const { createClient } = url.startsWith('file:') ? await import('@libsql/client') : await import('@libsql/client/web');
      backend = libsqlBackend(createClient({ url, authToken: setting('TURSO_AUTH_TOKEN') || undefined }));
    } else {
      const { fileURLToPath } = await import('node:url');
      backend = await sqliteFileBackend(process.env.DB_PATH || fileURLToPath(new URL('../data/qasr.db', import.meta.url)));
    }
    await backend.execScript(SCHEMA);
    await seed();
    await run("DELETE FROM sessions WHERE expires_at < datetime('now')");
  })().catch((e) => { readyPromise = null; throw e; }));
}
