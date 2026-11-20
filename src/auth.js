import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function hashPassword(pw) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pw), salt, 64);
  return `s1$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [, s, h] = stored.split('$');
    const hash = Buffer.from(h, 'base64');
    const test = scryptSync(String(pw), Buffer.from(s, 'base64'), hash.length);
    return timingSafeEqual(hash, test);
  } catch { return false; }
}

// What each role may do. The UI reads the same map so buttons match the server.
export const PERMS = {
  admin:   ['collab.create', 'collab.edit', 'collab.delete', 'collab.status', 'collab.items', 'collab.money',
            'influencer.edit', 'outlet.edit', 'product.edit', 'user.edit', 'report.view'],
  social:  ['collab.create', 'collab.edit', 'collab.status', 'collab.money', 'influencer.edit', 'report.view'],
  outlet:  ['collab.visit'],
};
export const can = (user, perm) => !!user && (PERMS[user.role] || []).includes(perm);
