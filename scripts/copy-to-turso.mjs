// One-time copy of your local database (data/qasr.db) into an EMPTY Turso database.
//
//   TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... npm run copy-to-turso
//
// Copies outlets, menu, influencers, logins (passwords stay hashed), collabs, products given
// and history. Login sessions are not copied, so everyone signs in once on the new site.
// Refuses to run if the Turso database already has data, so it can never overwrite anything.
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createClient } from '@libsql/client';
import { SCHEMA } from '../src/db.js';

const src = process.env.DB_PATH || fileURLToPath(new URL('../data/qasr.db', import.meta.url));
const { TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: authToken } = process.env;
if (!url) { console.error('Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN) first.'); process.exit(1); }
if (!existsSync(src)) { console.error(`No local database at ${src}`); process.exit(1); }

const local = new DatabaseSync(src, { readOnly: true });
const turso = createClient({ url, authToken });
const TABLES = ['outlets', 'products', 'influencers', 'users', 'collabs', 'collab_items', 'activity'];

await turso.executeMultiple(SCHEMA);
for (const t of TABLES) {
  const n = Number((await turso.execute(`SELECT COUNT(*) n FROM ${t}`)).rows[0].n);
  if (n) { console.error(`Turso already has data in "${t}" (${n} rows). Nothing was copied.`); process.exit(1); }
}

for (const t of TABLES) {
  const rows = local.prepare(`SELECT * FROM ${t}`).all();
  if (!rows.length) { console.log(`  ${t}: 0`); continue; }
  const cols = Object.keys(rows[0]);
  const sql = `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  for (let i = 0; i < rows.length; i += 200) {
    await turso.batch(rows.slice(i, i + 200).map((r) => ({ sql, args: cols.map((c) => r[c]) })), 'write');
  }
  console.log(`  ${t}: ${rows.length}`);
}
console.log('\nDone. Your data is now in Turso.');
