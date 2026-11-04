import { Router } from 'express';
import { db, logHistory } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

/** Sessões de conferência independentes (Estoque, Recebimento, Separação...). */
router.get('/sessions', (req, res) => {
  const rows = db.prepare(`
    SELECT s.*,
      (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id) AS total_items,
      (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id AND ci.status = 'conferido') AS conferidos,
      (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id AND ci.status = 'divergente') AS divergentes,
      (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id AND ci.status = 'revisar') AS revisar,
      (SELECT COUNT(*) FROM conference_items ci WHERE ci.session_id = s.id AND ci.status = 'pendente') AS pendentes
    FROM conference_sessions s ORDER BY s.id DESC`).all();
  res.json({ sessions: rows });
});

router.post('/sessions', (req, res) => {
  const { name, type, notes } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Informe o nome da sessão.' });
  const info = db.prepare('INSERT INTO conference_sessions (name, type, notes, created_by) VALUES (?, ?, ?, ?)')
    .run(String(name).trim(), type || null, notes || null, req.user.id);
  logHistory({ action: 'sessao_criada', detail: `Sessão "${name}" criada.`, user_id: req.user.id });
  res.json({ id: info.lastInsertRowid, name });
});

router.get('/sessions/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM conference_sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sessão não encontrada.' });
  const items = db.prepare(`
    SELECT ci.*, r.code, r.name, r.description, r.quantity, r.quantity_text, r.unit, r.page, r.table_no, r.row_no, r.col_no,
           d.original_name AS doc_name, d.seq AS doc_seq
    FROM conference_items ci
    JOIN records r ON r.id = ci.record_id
    LEFT JOIN documents d ON d.id = r.document_id
    WHERE ci.session_id = ? ORDER BY ci.id`).all(req.params.id);
  const counts = db.prepare(`
    SELECT status, COUNT(*) c FROM conference_items WHERE session_id = ? GROUP BY status`).all(req.params.id);
  res.json({ session: s, items, counts });
});

router.put('/sessions/:id', (req, res) => {
  const s = db.prepare('SELECT * FROM conference_sessions WHERE id = ?').get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Sessão não encontrada.' });
  const { name, type, notes, status } = req.body || {};
  db.prepare('UPDATE conference_sessions SET name = ?, type = ?, notes = ?, status = ? WHERE id = ?')
    .run(name ?? s.name, type ?? s.type, notes ?? s.notes, status ?? s.status, s.id);
  if (status === 'fechada' && s.status !== 'fechada') {
    db.prepare(`UPDATE conference_sessions SET closed_at = datetime('now') WHERE id = ?`).run(s.id);
  }
  res.json({ ok: true });
});

router.delete('/sessions/:id', (req, res) => {
  db.prepare('DELETE FROM conference_sessions WHERE id = ?').run(req.params.id);
  logHistory({ action: 'sessao_excluida', detail: `Sessão #${req.params.id} excluída.`, user_id: req.user.id });
  res.json({ ok: true });
});

/** Adiciona um item à sessão (pendente por padrão). */
router.post('/sessions/:id/items', (req, res) => {
  const { record_id, status } = req.body || {};
  const rec = db.prepare('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL').get(record_id);
  if (!rec) return res.status(404).json({ error: 'Registro não encontrado.' });
  const st = ['pendente', 'conferido', 'divergente', 'revisar'].includes(status) ? status : 'pendente';
  db.prepare(`
    INSERT INTO conference_items (session_id, record_id, status, checked_at, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(session_id, record_id) DO UPDATE SET status = excluded.status, updated_at = datetime('now')`)
    .run(req.params.id, rec.id, st, st === 'conferido' ? new Date().toISOString() : null);
  res.json({ ok: true });
});

/** Marca status de um item da sessão (e reflete no registro). */
router.post('/items/:itemId/status', (req, res) => {
  const item = db.prepare('SELECT * FROM conference_items WHERE id = ?').get(req.params.itemId);
  if (!item) return res.status(404).json({ error: 'Item não encontrado.' });
  const status = ['pendente', 'conferido', 'divergente', 'revisar'].includes(req.body.status) ? req.body.status : 'pendente';
  const checkedAt = status === 'conferido' ? new Date().toISOString() : null;
  db.prepare('UPDATE conference_items SET status = ?, checked_at = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(status, checkedAt, item.id);
  db.prepare(`UPDATE records SET status = ?, checked_at = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(status, checkedAt, item.record_id);
  logHistory({
    record_id: item.record_id,
    action: 'status_conferencia',
    old_values: { status: item.status },
    new_values: { status, session_id: item.session_id },
    user_id: req.user.id
  });
  res.json({ ok: true, status });
});

/** Fluxo rápido: marcar item diretamente (com ou sem sessão ativa). */
router.post('/quick', (req, res) => {
  const { record_id, status, session_id } = req.body || {};
  const rec = db.prepare('SELECT * FROM records WHERE id = ? AND deleted_at IS NULL').get(record_id);
  if (!rec) return res.status(404).json({ error: 'Registro não encontrado.' });
  const st = ['pendente', 'conferido', 'divergente', 'revisar'].includes(status) ? status : 'pendente';
  const checkedAt = st === 'conferido' ? new Date().toISOString() : null;
  db.prepare(`UPDATE records SET status = ?, checked_at = ?, updated_at = datetime('now') WHERE id = ?`).run(st, checkedAt, rec.id);
  if (session_id) {
    db.prepare(`
      INSERT INTO conference_items (session_id, record_id, status, checked_at, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id, record_id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at, updated_at = datetime('now')`)
      .run(session_id, rec.id, st, checkedAt);
  }
  logHistory({ record_id: rec.id, document_id: rec.document_id, action: 'status_conferencia', old_values: { status: rec.status }, new_values: { status: st }, user_id: req.user.id });
  res.json({ ok: true, status: st });
});

/** Remove item da sessão (desmarcar). */
router.delete('/items/:itemId', (req, res) => {
  db.prepare('DELETE FROM conference_items WHERE id = ?').run(req.params.itemId);
  res.json({ ok: true });
});

export default router;
