import { Router } from 'express';
import { one, all, run, logHistory } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

router.get('/sessions', async (req, res, next) => {
  try {
    const rows = await all(`
      SELECT s.*,
        (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id) AS total_items,
        (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id AND ci.status = 'conferido') AS conferidos,
        (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id AND ci.status = 'divergente') AS divergentes,
        (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id AND ci.status = 'revisar') AS revisar,
        (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id AND ci.status = 'pendente') AS pendentes
      FROM conference_sessions s ORDER BY s.id DESC`);
    res.json({ sessions: rows });
  } catch (err) { next(err); }
});

router.post('/sessions', async (req, res, next) => {
  try {
    const { name, type, notes } = req.body || {};
    if (!name) return res.status(400).json({ error: 'Informe o nome da sessão.' });
    const info = await run('INSERT INTO conference_sessions (name, type, notes, created_by) VALUES (?, ?, ?, ?)',
      String(name).trim(), type || null, notes || null, req.user.id);
    await logHistory({ action: 'sessao_criada', detail: `Sessão "${name}" criada.`, user_id: req.user.id });
    res.json({ id: info.lastRowid, name });
  } catch (err) { next(err); }
});

router.get('/sessions/:id', async (req, res, next) => {
  try {
    const s = await one('SELECT * FROM conference_sessions WHERE id = ?', req.params.id);
    if (!s) return res.status(404).json({ error: 'Sessão não encontrada.' });
    const items = await all(`
      SELECT ci.*, r.code, r.name, r.description, r.quantity, r.quantity_text, r.unit, r.page, r.table_no, r.row_no, r.col_no,
             d.original_name AS doc_name, d.seq AS doc_seq
      FROM conference_items ci
      JOIN records r ON r.id = ci.record_id
      LEFT JOIN documents d ON d.id = r.document_id
      WHERE ci.session_id = ? ORDER BY ci.id`, req.params.id);
    const counts = await all(`SELECT status, COUNT(*) c FROM conference_items WHERE session_id = ? GROUP BY status`, req.params.id);
    res.json({ session: s, items, counts });
  } catch (err) { next(err); }
});

router.put('/sessions/:id', async (req, res, next) => {
  try {
    const s = await one('SELECT * FROM conference_sessions WHERE id = ?', req.params.id);
    if (!s) return res.status(404).json({ error: 'Sessão não encontrada.' });
    const { name, type, notes, status } = req.body || {};
    await run('UPDATE conference_sessions SET name = ?, type = ?, notes = ?, status = ? WHERE id = ?',
      name ?? s.name, type ?? s.type, notes ?? s.notes, status ?? s.status, s.id);
    if (status === 'fechada' && s.status !== 'fechada') {
      await run(`UPDATE conference_sessions SET closed_at = datetime('now') WHERE id = ?`, s.id);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/sessions/:id', async (req, res, next) => {
  try {
    await run('DELETE FROM conference_sessions WHERE id = ?', req.params.id);
    await logHistory({ action: 'sessao_excluida', detail: `Sessão #${req.params.id} excluída.`, user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/sessions/:id/items', async (req, res, next) => {
  try {
    const { record_id, status } = req.body || {};
    const rec = await one('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL', record_id);
    if (!rec) return res.status(404).json({ error: 'Registro não encontrado.' });
    const st = ['pendente', 'conferido', 'divergente', 'revisar'].includes(status) ? status : 'pendente';
    await run(`
      INSERT INTO conference_items (session_id, record_id, status, checked_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id, record_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`,
      req.params.id, rec.id, st, st === 'conferido' ? new Date().toISOString() : null);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/items/:itemId/status', async (req, res, next) => {
  try {
    const item = await one('SELECT * FROM conference_items WHERE id = ?', req.params.itemId);
    if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
    const status = ['pendente', 'conferido', 'divergente', 'revisar'].includes(req.body.status) ? req.body.status : 'pendente';
    const checkedAt = status === 'conferido' ? new Date().toISOString() : null;
    await run(`UPDATE conference_items SET status = ?, checked_at = ?, updated_at = datetime('now') WHERE id = ?`, status, checkedAt, item.id);
    await run(`UPDATE records SET status = ?, checked_at = ?, updated_at = datetime('now') WHERE id = ?`, status, checkedAt, item.record_id);
    await logHistory({
      record_id: item.record_id,
      action: 'status_conferencia',
      old_values: { status: item.status },
      new_values: { status, session_id: item.session_id },
      user_id: req.user.id
    });
    res.json({ ok: true, status });
  } catch (err) { next(err); }
});

router.post('/quick', async (req, res, next) => {
  try {
    const { record_id, status, session_id } = req.body || {};
    const rec = await one('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL', record_id);
    if (!rec) return res.status(404).json({ error: 'Registro não encontrado.' });
    const st = ['pendente', 'conferido', 'divergente', 'revisar'].includes(status) ? status : 'pendente';
    const checkedAt = st === 'conferido' ? new Date().toISOString() : null;
    await run(`UPDATE records SET status = ?, checked_at = ?, updated_at = datetime('now') WHERE id = ?`, st, checkedAt, rec.id);
    if (session_id) {
      await run(`
        INSERT INTO conference_items (session_id, record_id, status, checked_at, updated_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(session_id, record_id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at, updated_at = datetime('now')`,
        session_id, rec.id, st, checkedAt);
    }
    await logHistory({ record_id: rec.id, document_id: rec.document_id, action: 'status_conferencia', old_values: { status: rec.status }, new_values: { status: st }, user_id: req.user.id });
    res.json({ ok: true, status: st });
  } catch (err) { next(err); }
});

router.delete('/items/:itemId', async (req, res, next) => {
  try {
    await run('DELETE FROM conference_items WHERE id = ?', req.params.itemId);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
