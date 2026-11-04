import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { TOKEN_TTL_DAYS } from './config.js';

export function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

export function verifyPassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

export function createToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + TOKEN_TTL_DAYS * 86400000).toISOString();
  db.prepare('INSERT INTO auth_tokens (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return { token, expires_at: expires };
}

export function revokeToken(token) {
  db.prepare('DELETE FROM auth_tokens WHERE token = ?').run(token);
}

export function getUserByToken(token) {
  if (!token) return null;
  const row = db.prepare(`
    SELECT u.id, u.username, u.name, u.role, t.expires_at
    FROM auth_tokens t JOIN users u ON u.id = t.user_id
    WHERE t.token = ? AND t.expires_at > datetime('now')`).get(token);
  return row || null;
}

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : (req.query.token || null);
  const user = getUserByToken(token);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  req.user = user;
  req.token = token;
  next();
}

export function userCount() {
  return db.prepare('SELECT COUNT(*) c FROM users').get().c;
}
