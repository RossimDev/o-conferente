import { Router } from 'express';
import { one, all, run, logHistory } from '../db.js';
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

router.get('/', async (req, res, next) => {
  try {
    const { q, status, document_id, category, favorite, needs_review, include_deleted, archived, page = 1, limit = 50, sort = 'recent' } = req.query;
    let sql = `${RECORD_SELECT} WHERE r.user_id = ? AND r.deleted_at IS NULL`;
    const params = [req.user.id];
    if (include_deleted === '1') sql = `${RECORD_SELECT} WHERE r.user_id = ?`;
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
    const countRow = await one(countSql, ...params);
    const total = countRow ? Number(countRow.c) : 0;
    const lim = Math.min(500, Math.max(1, Number(limit)));
    const off = (Math.max(1, Number(page)) - 1) * lim;
    const rows = await all(`${sql} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, lim, off);
    res.json({ records: rows.map(withDoc), total, page: Number(page), pages: Math.ceil(total / lim) });
  } catch (err) { next(err); }
});

router.get('/trash/all', async (req, res, next) => {
  try {
    const rows = await all(`${RECORD_SELECT} WHERE r.user_id = ? AND r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC LIMIT 500`, req.user.id);
    res.json({ records: rows.map(withDoc) });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await one(`${RECORD_SELECT} WHERE r.id = ? AND r.user_id = ?`, req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
    const occurrences = row.code
      ? (await all(`${RECORD_SELECT} WHERE r.code = ? COLLATE NOCASE AND r.user_id = ? AND r.deleted_at IS NULL ORDER BY d.seq`, row.code, req.user.id)).map(withDoc)
      : [];
    const history = await all('SELECT * FROM history WHERE record_id = ? ORDER BY id DESC LIMIT 100', req.params.id);
    res.json({
      record: withDoc(row),
      occurrences,
      history: history.map((h) => ({ ...h, old_values: h.old_values ? JSON.parse(h.old_values) : null, new_values: h.new_values ? JSON.parse(h.new_values) : null }))
    });
  } catch (err) { next(err); }
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

router.put('/:id', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM records WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
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
    await run(`
      UPDATE records SET code=?, name=?, description=?, reference=?,
        quantity=?, quantity_text=?, unit=?, category=?, extra=?,
        status=?, needs_review=0, updated_at=datetime('now')
      WHERE id=?`,
      upd.code, upd.name, upd.description, upd.reference,
      upd.quantity, upd.quantity_text, upd.unit, upd.category, upd.extra,
      upd.status, row.id);
    const { old_values, new_values } = diffRecord(row, upd);
    await logHistory({ record_id: row.id, document_id: row.document_id, action: 'registro_editado', old_values, new_values, user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM records WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
    if (req.query.permanent === '1') {
      await run('DELETE FROM records WHERE id = ?', row.id);
      await logHistory({ record_id: row.id, document_id: row.document_id, action: 'registro_excluido_definitivo', old_values: row, user_id: req.user.id });
      return res.json({ ok: true, permanent: true });
    }
    await run(`UPDATE records SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, row.id);
    await logHistory({ record_id: row.id, document_id: row.document_id, action: 'registro_excluido', old_values: { code: row.code, name: row.name }, user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM records WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
    await run(`UPDATE records SET deleted_at = NULL, updated_at = datetime('now') WHERE id = ?`, row.id);
    await logHistory({ record_id: row.id, action: 'registro_restaurado', user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/archive', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM records WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
    await run(`UPDATE records SET archived = 1, updated_at = datetime('now') WHERE id = ?`, row.id);
    await logHistory({ record_id: row.id, action: 'registro_arquivado', user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/unarchive', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM records WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
    await run(`UPDATE records SET archived = 0, updated_at = datetime('now') WHERE id = ?`, row.id);
    await logHistory({ record_id: req.params.id, action: 'registro_restaurado_arquivo', user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/favorite', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM records WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
    const fav = row.favorite ? 0 : 1;
    await run(`UPDATE records SET favorite = ?, updated_at = datetime('now') WHERE id = ?`, fav, row.id);
    res.json({ ok: true, favorite: fav });
  } catch (err) { next(err); }
});

router.post('/:id/status', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM records WHERE id = ? AND user_id = ?', req.params.id, req.user.id);
    if (!row) return res.status(404).json({ error: 'Registro não encontrado.' });
    const status = ['pendente', 'conferido', 'divergente', 'revisar'].includes(req.body.status) ? req.body.status : 'pendente';
    const checkedAt = status === 'conferido' ? new Date().toISOString() : null;
    await run(`UPDATE records SET status = ?, checked_at = ?, updated_at = datetime('now') WHERE id = ?`, status, checkedAt, row.id);
    if (req.body.session_id) {
      await run(`
        INSERT INTO conference_items (session_id, record_id, status, checked_at, updated_at)
        VALUES (?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(session_id, record_id) DO UPDATE SET status = excluded.status, checked_at = excluded.checked_at, updated_at = datetime('now')`,
        req.body.session_id, row.id, status);
    }
    await logHistory({ record_id: row.id, document_id: row.document_id, action: 'status_conferencia', old_values: { status: row.status }, new_values: { status }, user_id: req.user.id });
    res.json({ ok: true, status });
  } catch (err) { next(err); }
});

export default router;
