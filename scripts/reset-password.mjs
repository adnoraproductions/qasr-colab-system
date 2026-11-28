// Set a new password for any login, directly in the database the live site uses.
//   npm run reset-password
// Asks for the Turso URL and token (leave the URL empty to use the local data/qasr.db),
// the username and the new password. Nothing you type is printed.
import { createInterface } from 'node:readline';

// One reader for every question, so answers typed (or pasted) ahead are never lost.
const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
const lines = []; const waiting = [];
rl.on('line', (l) => (waiting.length ? waiting.shift()(l) : lines.push(l)));
let mute = false;
const write = rl._writeToOutput.bind(rl);
rl._writeToOutput = (s) => { if (!mute) write(s); };
async function ask(question, hidden = false) {
  process.stdout.write(question);
  mute = hidden;
  const answer = lines.length ? lines.shift() : await new Promise((res) => waiting.push(res));
  mute = false; if (hidden) process.stdout.write('\n');
  return answer.trim();
}

if (!process.env.TURSO_DATABASE_URL) {
  const url = await ask('Turso database URL (leave empty for the local database): ');
  if (url) { process.env.TURSO_DATABASE_URL = url; process.env.TURSO_AUTH_TOKEN ||= await ask('Turso token (hidden): ', true); }
}
const { ready, get, all, run } = await import('../src/db.js');
const { hashPassword } = await import('../src/auth.js');

await ready();
const logins = await all('SELECT username, role, active FROM users ORDER BY role, username');
console.log('\nLogins in this database:', logins.map((u) => `${u.username} (${u.role}${u.active ? '' : ', disabled'})`).join(', ') || 'none');

const username = (await ask('Username to reset [admin]: ')) || 'admin';
const user = await get('SELECT id, username FROM users WHERE username = ?', username);
if (!user) { console.error(`No login called "${username}".`); process.exit(1); }

const pw = await ask('New password (at least 6 characters, hidden): ', true);
if (pw.length < 6) { console.error('Password must be at least 6 characters.'); process.exit(1); }
if ((await ask('Type it again (hidden): ', true)) !== pw) { console.error('The two passwords did not match. Nothing was changed.'); process.exit(1); }

await run('UPDATE users SET pass_hash = ?, active = 1 WHERE id = ?', hashPassword(pw), user.id);
await run('DELETE FROM sessions WHERE user_id = ?', user.id);
console.log(`\nDone. "${user.username}" can now sign in with the new password.`);
process.exit(0);
