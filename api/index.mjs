// Vercel Function that serves every /api/* request (vercel.json rewrites them here).
// The data lives in Turso; set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel's environment variables.
import { handle } from '../src/api.js';

async function serve(request) {
  if (!process.env.TURSO_DATABASE_URL) {
    return Response.json({ error: 'Database not configured: add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Vercel → Project → Settings → Environment Variables, then redeploy.' }, { status: 500 });
  }
  const u = new URL(request.url);
  // vercel.json passes the original path as __p (e.g. "/collabs/12"); fall back to the URL path.
  const original = u.searchParams.get('__p');
  u.searchParams.delete('__p');
  const path = original != null ? `/api${original.startsWith('/') ? original : '/' + original}`.replace(/\/+$/, '') : u.pathname;
  const out = await handle({
    method: request.method,
    path,
    query: Object.fromEntries(u.searchParams),
    cookie: request.headers.get('cookie') || '',
    body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? await request.text() : '',
    ip: (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '',
    secure: u.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
  });
  return new Response(out.body, { status: out.status, headers: out.headers });
}

export const GET = serve;
export const POST = serve;
export const PUT = serve;
export const PATCH = serve;
export const DELETE = serve;
