// Diagnose a Turso connection with the same values you put in your hosting settings.
//   npm run check-turso      (asks for the URL and token; the token is never printed)
import { createInterface } from 'node:readline';
import { createClient } from '@libsql/client/web';

const clean = (v) => (v || '').trim().replace(/^["']+|["']+$/g, '').trim();

async function ask(question, hidden = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (hidden) rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
  const answer = await new Promise((res) => rl.question(question, res));
  rl.close(); if (hidden) process.stdout.write('\n');
  return answer;
}

const url = clean(process.env.TURSO_DATABASE_URL || await ask('Turso database URL: '));
const token = clean(process.env.TURSO_AUTH_TOKEN || await ask('Turso token (hidden): ', true));
const httpUrl = url.replace(/^libsql:\/\//, 'https://').replace(/\/+$/, '');

console.log('\nURL host :', (() => { try { return new URL(httpUrl).host; } catch { return '(not a valid URL)'; } })());
console.log('URL type :', /^libsql:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.turso\.io\/?$/i.test(url) ? 'looks right (libsql://….turso.io)' : 'UNUSUAL — expected libsql://<name>-<org>.<region>.turso.io');
const parts = token.split('.');
console.log('Token    :', `${token.length} characters, ${parts.length === 3 ? 'JWT format (good)' : 'NOT a JWT — this is probably not a database token'}`);
if (parts.length === 3) {
  try {
    const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    console.log('Token for:', p.id ? `database id ${p.id}` : p.gid ? `database group ${p.gid}` : 'unknown scope', '| access:', p.a || 'full', '| expires:', p.exp ? new Date(p.exp * 1000).toISOString().slice(0, 10) : 'never');
  } catch { console.log('Token    : could not read its details'); }
}

console.log('\n1) Raw request to Turso…');
try {
  const r = await fetch(`${httpUrl}/v2/pipeline`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt: { sql: 'SELECT 1' } }, { type: 'close' }] }),
  });
  const body = (await r.text()).replace(token, '<token>').slice(0, 300);
  console.log(`   HTTP ${r.status}: ${body}`);
} catch (e) { console.log('   Could not reach Turso:', e.cause?.code || e.message); }

console.log('2) Same check through the app\'s database client…');
const client = createClient({ url, authToken: token });
for (const [name, fn] of [['simple query', () => client.execute('SELECT 1')], ['multi-statement', () => client.executeMultiple('SELECT 1; SELECT 2;')], ['transaction', async () => { const t = await client.transaction('write'); await t.execute('SELECT 1'); await t.commit(); t.close(); }]]) {
  try { await fn(); console.log(`   ${name}: OK`); } catch (e) { console.log(`   ${name}: FAILED — ${e.code || ''} ${e.message}`); }
}
