// Netlify Function that serves every /api/* request (see the redirect in netlify.toml).
// The data lives in Turso; set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Netlify's environment variables.
import { handle } from '../../src/api.js';

export default async (request, context) => {
  if (!process.env.TURSO_DATABASE_URL) {
    return Response.json({ error: 'Database not configured: add TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in Netlify → Site configuration → Environment variables, then redeploy.' }, { status: 500 });
  }
  const u = new URL(request.url);
  // Requests may arrive as /api/... or, after the rewrite, as /.netlify/functions/api/...
  const path = u.pathname.replace(/^\/\.netlify\/functions\/api(?=\/|$)/, '/api');
  const out = await handle({
    method: request.method,
    path,
    query: Object.fromEntries(u.searchParams),
    cookie: request.headers.get('cookie') || '',
    body: ['POST', 'PUT', 'PATCH'].includes(request.method) ? await request.text() : '',
    ip: context?.ip || request.headers.get('x-nf-client-connection-ip') || '',
    secure: u.protocol === 'https:' || request.headers.get('x-forwarded-proto') === 'https',
  });
  return new Response(out.body, { status: out.status, headers: out.headers });
};
