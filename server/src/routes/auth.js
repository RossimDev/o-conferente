import { Router } from 'express';
import { db, logHistory } from '../db.js';
import { hashPassword, verifyPassword, createToken, revokeToken, requireAuth, userCount } from '../auth.js';

const router = Router();

/** Configuração inicial: cria o primeiro usuário (administrador) quando não há contas. */
router.post('/setup', (req, res) => {
  if (userCount() > 0) return res.status(400).json({ error: 'O sistema já foi configurado.' });
  const { username, password, name } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  const info = db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
    .run(String(username).trim(), hashPassword(password), name || String(username).trim(), 'admin');
  const token = createToken(info.lastInsertRowid);
  logHistory({ action: 'usuario_criado', detail: `Administrador "${username}" criado (configuração inicial).`, user_id: info.lastInsertRowid });
  res.json({ token: token.token, expires_at: token.expires_at, user: { id: info.lastInsertRowid, username, role: 'admin', name: name || username } });
});

router.post('/register', requireAuth, (req, res) => {
  const { username, password, name, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });
  if (String(password).length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
  try {
    const info = db.prepare('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)')
      .run(String(username).trim(), hashPassword(password), name || String(username).trim(), role === 'admin' ? 'admin' : 'user');
    logHistory({ action: 'usuario_criado', detail: `Usuário "${username}" criado.`, user_id: req.user.id });
    res.json({ id: info.lastInsertRowid, username });
  } catch {
    res.status(400).json({ error: 'Nome de usuário já existe.' });
  }
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(String(username || '').trim());
  if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
  }
  const token = createToken(user.id);
  res.json({ token: token.token, expires_at: token.expires_at, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
});

router.post('/logout', requireAuth, (req, res) => {
  revokeToken(req.token);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(String(current_password || ''), user.password_hash)) {
    return res.status(400).json({ error: 'Senha atual incorreta.' });
  }
  if (String(new_password || '').length < 6) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(new_password), req.user.id);
  logHistory({ action: 'senha_alterada', user_id: req.user.id });
  res.json({ ok: true });
});

router.get('/users', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, username, name, role, created_at FROM users ORDER BY id').all();
  res.json({ users });
});

router.get('/needs-setup', (req, res) => {
  res.json({ needs_setup: userCount() === 0 });
});

export default router;
