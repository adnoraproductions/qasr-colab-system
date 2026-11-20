import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { OUTLETS, MENU, DEFAULT_ADMIN } from './seed-data.js';
import { hashPassword } from './auth.js';

const DB_PATH = process.env.DB_PATH || fileURLToPath(new URL('../data/qasr.db', import.meta.url));
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

db.exec(`
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
  category TEXT NOT NULL DEFAULT '', -- unused; kept so older databases still open
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
`);

export const newToken = (n = 18) => randomBytes(n).toString('base64url');

export function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function seed() {
  const hasUsers = db.prepare('SELECT COUNT(*) c FROM users').get().c;
  if (hasUsers) return;
  const fromEnv = !!process.env.ADMIN_PASSWORD;
  const password = process.env.ADMIN_PASSWORD || randomBytes(6).toString('base64url');
  tx(() => {
    const insO = db.prepare('INSERT INTO outlets (name, district, share_token) VALUES (?, ?, ?)');
    for (const [name, district] of OUTLETS) insO.run(name, district, newToken());

    const insP = db.prepare("INSERT INTO products (category, name, price, sort) VALUES ('', ?, ?, ?)");
    MENU.forEach(([name, price], i) => insP.run(name, price, i));
    db.prepare('INSERT INTO users (name, username, pass_hash, role) VALUES (?, ?, ?, ?)')
      .run(DEFAULT_ADMIN.name, DEFAULT_ADMIN.username, hashPassword(password), 'admin');
  });
  console.log(`\n  First run: seeded ${OUTLETS.length} outlets and the menu.`);
  console.log(`  Sign in as "${DEFAULT_ADMIN.username}" with ${fromEnv ? 'the ADMIN_PASSWORD you set' : `password: ${password}`}`);
  console.log('  Change it from More → Profile after signing in.\n');
}
seed();

// Clean expired sessions on boot
db.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run();
