import { Router } from 'express';
import { one, all, run } from '../db.js';
import { requireAuth } from '../auth.js';

const router = Router();
router.use(requireAuth);

const SELECT = `
  SELECT r.*, d.original_name AS doc_name, d.seq AS doc_seq, d.file_available AS doc_file_available, d.deleted_at AS doc_deleted_at
  FROM records r LEFT JOIN documents d ON d.id = r.document_id`;

function withDoc(row) {
  return {
    ...row,
    document: row.doc_name ? {
      id: row.document_id, seq: row.doc_seq, original_name: row.doc_name,
      file_available: row.doc_file_available, deleted: !!row.doc_deleted_at
    } : null
  };
}

function likeEscape(s) {
  return String(s).replace(/[\\%_]/g, (m) => '\\' + m);
}

/**
 * Pesquisa inteligente: exato (isolado) → prefixo → parcial → semelhantes → texto.
 * Códigos são texto: zeros à esquerda e alfanuméricos preservados.
 */
router.get('/', async (req, res, next) => {
  try {
    const raw = String(req.query.q || '').trim();
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(200, Math.max(10, Number(req.query.limit || 40)));
    const { status, document_id, category, date_from, date_to } = req.query;

    if (!raw) {
      return res.json({ query: raw, exact: [], prefix: [], code_partial: [], similar: [], text: [], totals: { exact: 0, prefix: 0, code_partial: 0, similar: 0, text: 0 } });
    }

    const filters = [];
    const fparams = [];
    if (status) { filters.push('r.status = ?'); fparams.push(status); }
    if (document_id) { filters.push('r.document_id = ?'); fparams.push(document_id); }
    if (category) { filters.push('r.category LIKE ?'); fparams.push(`%${category}%`); }
    if (date_from) { filters.push('r.created_at >= ?'); fparams.push(date_from); }
    if (date_to) { filters.push('r.created_at <= ?'); fparams.push(date_to + ' 23:59:59'); }
    const filterSql = filters.length ? ' AND ' + filters.join(' AND ') : '';
    const base = `r.deleted_at IS NULL AND r.archived = 0${filterSql}`;

    const like = likeEscape(raw);
    const prefix = likeEscape(raw);

    const exact = (await all(`${SELECT} WHERE ${base} AND r.code = ? COLLATE NOCASE ORDER BY d.seq, r.page, r.row_no`, ...fparams, raw)).map(withDoc);
    const prefixRows = (await all(`${SELECT} WHERE ${base} AND r.code LIKE ? ESCAPE '\\' COLLATE NOCASE AND NOT (r.code = ? COLLATE NOCASE) ORDER BY r.code COLLATE NOCASE, d.seq, r.page LIMIT ?`,
      ...fparams, prefix + '%', raw, limit * 3)).map(withDoc);
    const codePartial = (await all(`${SELECT} WHERE ${base} AND r.code LIKE ? ESCAPE '\\' COLLATE NOCASE AND r.code NOT LIKE ? ESCAPE '\\' COLLATE NOCASE AND NOT (r.code = ? COLLATE NOCASE) ORDER BY r.code COLLATE NOCASE LIMIT ?`,
      ...fparams, '%' + like + '%', prefix + '%', raw, limit * 2)).map(withDoc);

    let textRows = [];
    try {
      const ftsQuery = raw.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
      textRows = (await all(`
        SELECT r.*, d.original_name AS doc_name, d.seq AS doc_seq, d.file_available AS doc_file_available,
               d.deleted_at AS doc_deleted_at, bm25(records_fts) AS rank
        FROM records_fts
        JOIN records r ON r.rowid = records_fts.rowid
        LEFT JOIN documents d ON d.id = r.document_id
        WHERE records_fts MATCH ? AND ${base}
        ORDER BY rank LIMIT ?`, ftsQuery, ...fparams, limit)).map(withDoc);
    } catch {
      textRows = [];
    }
    if (textRows.length === 0) {
      textRows = (await all(`${SELECT} WHERE ${base} AND (
          r.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
          r.description LIKE ? ESCAPE '\\' COLLATE NOCASE OR
          r.reference LIKE ? ESCAPE '\\' COLLATE NOCASE OR
          r.snippet LIKE ? ESCAPE '\\' COLLATE NOCASE)
        ORDER BY r.code COLLATE NOCASE LIMIT ?`,
        ...fparams, ...Array(4).fill('%' + like + '%'), limit)).map(withDoc);
    }

    const exactIds = new Set(exact.map((r) => r.id));
    const prefixIds = new Set(prefixRows.map((r) => r.id));
    const textClean = textRows.filter((r) => !exactIds.has(r.id) && !prefixIds.has(r.id));

    const similarClean = [];
    if (raw.length >= 4) {
      const t = raw.toUpperCase();
      const cand = (await all(`${SELECT} WHERE ${base} AND r.code IS NOT NULL AND NOT (r.code = ? COLLATE NOCASE) LIMIT 400`, ...fparams, raw)).map(withDoc);
      const seen = new Set([...exactIds, ...prefixIds]);
      for (const r of cand) {
        if (seen.has(r.id)) continue;
        const c = String(r.code).toUpperCase();
        let i = 0;
        while (i < c.length && i < t.length && c[i] === t[i]) i++;
        const ok = c.startsWith(t) || t.startsWith(c) || i >= Math.max(3, Math.ceil(t.length * 0.6));
        if (ok && i >= 3) {
          seen.add(r.id);
          similarClean.push(r);
          if (similarClean.length >= limit) break;
        }
      }
    }

    const slice = (arr) => arr.slice((page - 1) * limit, page * limit);

    const result = {
      query: raw,
      exact,
      prefix: slice(prefixRows),
      code_partial: slice(codePartial),
      similar: slice(similarClean),
      text: slice(textClean),
      totals: {
        exact: exact.length,
        prefix: prefixRows.length,
        code_partial: codePartial.length,
        similar: similarClean.length,
        text: textClean.length
      },
      page,
      limit
    };

    const total = result.totals.exact + result.totals.prefix + result.totals.code_partial + result.totals.similar + result.totals.text;
    await run('INSERT INTO search_history (user_id, query, results) VALUES (?, ?, ?)', req.user.id, raw, total);

    res.json(result);
  } catch (err) { next(err); }
});

router.get('/recent', async (req, res, next) => {
  try {
    const rows = await all(`
      SELECT query, MAX(created_at) AS created_at, MAX(results) AS results
      FROM search_history WHERE user_id = ?
      GROUP BY query ORDER BY MAX(id) DESC LIMIT 12`, req.user.id);
    res.json({ recent: rows });
  } catch (err) { next(err); }
});

router.delete('/recent', async (req, res, next) => {
  try {
    await run('DELETE FROM search_history WHERE user_id = ?', req.user.id);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
