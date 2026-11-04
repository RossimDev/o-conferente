import { Router } from 'express';
import { db, logHistory } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const RECORD_SELECT = `
  SELECT r.*, d.original_name AS doc_name, d.seq AS doc_seq, d.file_available AS doc_file_available, d.deleted_at AS doc_deleted_at
  FROM records r LEFT JOIN documents d ON d.id = r.document_id`;

function withDoc(row) {
  return {
    ...row,
    document: row.doc_name ? {
      id: row.document_id,
      seq: row.doc_seq,
      original_name: row.doc_name,
      file_available: row.doc_file_available,
      deleted: !!row.doc_deleted_at
    } : null
  };
}

/** Lista de registros com filtros e paginação. */
router.get('/', (req, res) => {
  const { q, status, document_id, category, favorite, needs_review, include_deleted, archived, page = 1, limit = 50, sort = 'recent' } = req.query;
  let sql = `${RECORD_SELECT} WHERE r.deleted_at IS NULL`;
  const params = [];
  if (include_deleted === '1') sql = `${RECORD_SELECT} WHERE 1=1`;
  if (archived !== '1') sql += ' AND r.archived = 0';
  if (status) { sql += ' AND r.status = ?'; params.push(status); }
  if (document_id) { sql += ' AND r.document_id = ?'; params.push(document_id); }
  if (category) { sql += ' AND r.category LIKE ?'; params.push(`%${category}%`); }
  if (favorite === '1') sql += ' AND r.favorite = 1';
  if (needs_review === '1') sql += ' AND r.needs_review = 1';
  if (q) {
    sql += ' AND (r.code LIKE ? COLLATE NOCASE OR r.name LIKE ? COLLATE NOCASE OR r.description LIKE ? COLLATE NOCASE OR r.reference LIKE ? COLLATE NOCASE)';
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  const order = sort === 'code' ? 'r.code COLLATE NOCASE, r.id' : 'r.updated_at DESC, r.id';
  const countSql = sql.replace(RECORD_SELECT, 'SELECT COUNT(*) as c FROM records r LEFT JOIN documents d ON d.id = r.document_id');
  const total = db.prepare(countSql).get(...params).c;
  const lim = Math.min(500, Math.max(1, Number(limit)));
  const off = (Math.max(1, Number(page)) - 1) * lim;
  const rows = db.prepare(`${sql} ORDER BY ${order} LIMIT ? OFFSET ?`).all(...params, lim, off);
  res.json({ records: rows.map(withDoc), total, page: Number(page), pages: Math.ceil(total / lim) });
});

/** Detalhe completo + todas as ocorrências do mesmo código (rastreabilidade). */
router.get('/:id', (req, res) => {
  const row = db.prepare(`${RECORD_SELECT} WHERE r.id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  const occurrences = row.code
    ? db.prepare(`${RECORD_SELECT} WHERE r.code = ? COLLATE NOCASE AND r.deleted_at IS NULL ORDER BY d.seq`).all(row.code).map(withDoc)
    : [];
  const history = db.prepare('SELECT * FROM history WHERE record_id = ? ORDER BY id DESC LIMIT 100').all(req.params.id);
  res.json({ record: withDoc(row), occurrences, history: history.map((h) => ({ ...h, old_values: h.old_values ? JSON.parse(h.old_values) : null, new_values: h.new_values ? JSON.parse(h.new_values) : null })) });
});

function diffRecord(oldR, newR) {
  const fields = ['code', 'name', 'description', 'reference', 'quantity', 'quantity_text', 'unit', 'category', 'status'];
  const old_values = {}, new_values = {};
  for (const f of fields) {
    if (String(oldR[f] ?? '') !== String(newR[f] ?? '')) {
      old_values[f] = oldR[f];
      new_values[f] = newR[f];
    }
  }
  return { old_values, new_values };
}

const EDITABLE = ['code', 'name', 'description', 'reference', 'quantity', 'quantity_text', 'unit', 'category', 'status', 'extra'];

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  const upd = { ...row };
  for (const f of EDITABLE) {
    if (req.body[f] !== undefined) {
      upd[f] = f === 'extra' ? (req.body[f] ? JSON.stringify(req.body[f]) : null) : req.body[f];
    }
  }
  if (req.body.quantity !== undefined) {
    const q = req.body.quantity === null || req.body.quantity === '' ? null : Number(String(req.body.quantity).replace(',', '.'));
    upd.quantity = Number.isFinite(q) ? q : null;
  }
  db.prepare(`
    UPDATE records SET code=@code, name=@name, description=@description, reference=@reference,
      quantity=@quantity, quantity_text=@quantity_text, unit=@unit, category=@category, extra=@extra,
      status=@status, needs_review=0, updated_at=datetime('now')
    WHERE id=@id`).run({ ...upd, id: row.id });
  const { old_values, new_values } = diffRecord(row, upd);
  logHistory({ record_id: row.id, document_id: row.document_id, action: 'registro_editado', old_values, new_values, user_id: req.user.id });
  res.json({ ok: true });
});

/** Exclusão (lixeira) com restauração posterior. */
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  if (req.query.permanent === '1') {
    db.prepare('DELETE FROM records WHERE id = ?').run(row.id);
    logHistory({ record_id: row.id, document_id: row.document_id, action: 'registro_excluido_definitivo', old_values: row, user_id: req.user.id });
    return res.json({ ok: true, permanent: true });
  }
  db.prepare(`UPDATE records SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(row.id);
  logHistory({ record_id: row.id, document_id: row.document_id, action: 'registro_excluido', old_values: { code: row.code, name: row.name }, user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/:id/restore', (req, res) => {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  db.prepare(`UPDATE records SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`).run(row.id);
  logHistory({ record_id: row.id, action: 'registro_restaurado', user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/:id/archive', (req, res) => {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  db.prepare('UPDATE records SET archived = 1, updated_at = datetime(\'now\') WHERE id = ?').run(row.id);
  logHistory({ record_id: row.id, action: 'registro_arquivado', user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/:id/unarchive', (req, res) => {
  db.prepare('UPDATE records SET archived = 0, updated_at = datetime(\'now\') WHERE id = ?').run(req.params.id);
  logHistory({ record_id: req.params.id, action: 'registro_restaurado_arquivo', user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/:id/favorite', (req, res) => {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  const fav = row.favorite ? 0 : 1;
  db.prepare('UPDATE records SET favorite = ?, updated_at = datetime(\'now\') WHERE id = ?').run(fav, row.id);
  res.json({ ok: true, favorite: fav });
});

/** Lixeira de registros. */
router.get('/trash/all', (req, res) => {
  const rows = db.prepare(`${RECORD_SELECT} WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC LIMIT 500`).all();
  res.json({ records: rows.map(withDoc) });
});

/** Status de conferência rápido (fora de sessão). */
router.post('/:id/status', (req, res) => {
  const row = db.prepare('SELECT * FROM records WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
  const status = ['pendente', 'conferido', 'divergente', 'revisar'].includes(req.body.status) ? req.body.status : 'pendente';
  const checked = status === 'conferido' ? "datetime('now')" : 'NULL';
  db.prepare(`UPDATE records SET status = ?, checked_at = ${status === 'conferido' ? "datetime('now')" : 'NULL'}, updated_at = datetime('now') WHERE id = ?`).run(status, row.id);
  if (req.body.session_id) {
    db.prepare(`
      INSERT INTO conference_items (session_id, record_id, status, checked_at, updated_at)
      VALUES (?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(session_id, record_id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at, updated_at = datetime('now')`)
      .run(req.body.session_id, row.id, status);
  }
  logHistory({ record_id: row.id, document_id: row.document_id, action: 'status_conferencia', old_values: { status: row.status }, new_values: { status }, user_id: req.user.id });
  res.json({ ok: true, status });
});

export default router;
