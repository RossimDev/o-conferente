import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { one, run } from './db.js';
import { TOKEN_TTL_DAYS } from './config.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export async function createToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000).toISOString();
  await run('INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)', token, userId, expires);
  return { token, expires_at: expires };
}

export async function revokeToken(token) {
  await run('DELETE FROM auth_tokens WHERE token = ?', token);
}

export async function getUserByToken(token) {
  if (!token) return null;
  const row = await one(`
    SELECT u.id, u.username, u.name, u.role, t.expires_at
    FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = ? AND t.expires_at > datetime('now')`, token);
  return row || null;
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
    const user = await getUserByToken(token);
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    req.user = user;
    req.token = token;
    next();
  } catch (err) {
    next(err);
  }
}

export async function userCount() {
  const row = await one('SELECT COUNT(*) c FROM users');
  return row ? Number(row.c) : 0;
}
