import { Router } from 'express';
import { one, all, run, logHistory } from '../db.js';
import { hashPassword, verifyPassword, createToken, revokeToken, requireAuth, userCount, getUserByToken } from '../auth.js';

const router = Router();

router.post('/setup', async (req, res, next) => {
  try {
    if ((await userCount()) > 0) return res.status(400).json({ error: 'O sistema já foi configurado.' });
    const { username, password, name } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    const info = await run('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)',
      String(username).trim(), hashPassword(password), name || String(username).trim(), 'admin');
    const token = await createToken(info.lastRowid);
    await logHistory({ action: 'usuario_criado', detail: `Administrador "${username}" criado (configuração inicial).`, user_id: info.lastRowid });
    res.json({ token: token.token, expires_at: token.expires_at, user: { id: info.lastRowid, username, role: 'admin', name: name || username } });
  } catch (err) { next(err); }
});

/** Criação de conta aberta (tela de entrada) ou por administrador (Ajustes). */
router.post('/register', async (req, res, next) => {
  try {
    const { username, password, name, role } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'Informe usuário e senha.' });
    if (String(password).length < 6) return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres.' });
    if (!/^[\w.\-@]{3,32}$/.test(String(username).trim())) {
      return res.status(400).json({ error: 'Usuário: 3 a 32 caracteres (letras, números, ponto, hífen ou @).' });
    }
    // Papel "admin" só quando quem está cadastrando é um administrador autenticado
    // (ou para a primeira conta do sistema).
    let wantRole = (await userCount()) === 0 ? 'admin' : 'user';
    const header = req.headers.authorization || '';
    if (role === 'admin' && header.startsWith('Bearer ')) {
      const actor = await getUserByToken(header.slice(7));
      if (actor && actor.role === 'admin') wantRole = 'admin';
    }
    try {
      const info = await run('INSERT INTO users (username, password_hash, name, role) VALUES (?, ?, ?, ?)',
        String(username).trim(), hashPassword(password), name || String(username).trim(), wantRole);
      const token = await createToken(info.lastRowid);
      await logHistory({ action: 'usuario_criado', detail: `Usuário "${username}" criado.`, user_id: info.lastRowid });
      res.json({
        id: info.lastRowid,
        token: token.token,
        expires_at: token.expires_at,
        user: { id: info.lastRowid, username: String(username).trim(), name: name || String(username).trim(), role: wantRole }
      });
    } catch {
      res.status(400).json({ error: 'Nome de usuário já existe.' });
    }
  } catch (err) { next(err); }
});

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const user = await one('SELECT * FROM users WHERE username = ? COLLATE NOCASE', String(username || '').trim());
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos.' });
    }
    const token = await createToken(user.id);
    res.json({ token: token.token, expires_at: token.expires_at, user: { id: user.id, username: user.username, name: user.name, role: user.role } });
  } catch (err) { next(err); }
});

router.post('/logout', requireAuth, async (req, res, next) => {
  try {
    await revokeToken(req.token);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

router.post('/change-password', requireAuth, async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body || {};
    const user = await one('SELECT * FROM users WHERE id = ?', req.user.id);
    if (!verifyPassword(String(current_password || ''), user.password_hash)) {
      return res.status(400).json({ error: 'Senha atual incorreta.' });
    }
    if (String(new_password || '').length < 6) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 6 caracteres.' });
    await run('UPDATE users SET password_hash = ? WHERE id = ?', hashPassword(new_password), req.user.id);
    await logHistory({ action: 'senha_alterada', user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get('/users', requireAuth, async (req, res, next) => {
  try {
    const users = await all('SELECT id, username, name, role, created_at FROM users ORDER BY id');
    res.json({ users });
  } catch (err) { next(err); }
});

router.get('/needs-setup', async (req, res, next) => {
  try {
    res.json({ needs_setup: (await userCount()) === 0 });
  } catch (err) { next(err); }
});

export default router;
