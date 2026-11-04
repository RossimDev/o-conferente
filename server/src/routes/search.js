import { Router } from 'express';
import { db } from '../db.js';
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
 * Pesquisa inteligente:
 *  1. resultado EXATO por código (prioridade máxima, isolado);
 *  2. prefixo de código;
 *  3. código contendo o termo;
 *  4. nome/descrição/referência.
 * Códigos são texto — zeros à esquerda e alfanuméricos são preservados.
 */
router.get('/', (req, res) => {
  const raw = String(req.query.q || '').trim();
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(200, Math.max(10, Number(req.query.limit || 40)));
  const { status, document_id, category, date_from, date_to } = req.query;

  if (!raw) return res.json({ query: raw, exact: [], prefix: [], code_partial: [], text: [], totals: { exact: 0, prefix: 0, code_partial: 0, text: 0 } });

  const filters = [];
  const fparams = [];
  if (status) { filters.push('r.status = ?'); fparams.push(status); }
  if (document_id) { filters.push('r.document_id = ?'); fparams.push(document_id); }
  if (category) { filters.push('r.category LIKE ?'); fparams.push(`%${category}%`); }
  if (date_from) { filters.push("r.created_at >= ?"); fparams.push(date_from); }
  if (date_to) { filters.push("r.created_at <= ?"); fparams.push(date_to + ' 23:59:59'); }
  const filterSql = filters.length ? ' AND ' + filters.join(' AND ') : '';
  const base = `r.deleted_at IS NULL AND r.archived = 0${filterSql}`;

  const like = likeEscape(raw);
  const prefix = likeEscape(raw);

  const exact = db.prepare(`${SELECT} WHERE ${base} AND r.code = ? COLLATE NOCASE ORDER BY d.seq, r.page, r.row_no`)
    .all(...fparams, raw).map(withDoc);
  const prefixRows = db.prepare(`${SELECT} WHERE ${base} AND r.code LIKE ? ESCAPE '\\' COLLATE NOCASE AND NOT (r.code = ? COLLATE NOCASE) ORDER BY r.code COLLATE NOCASE, d.seq, r.page LIMIT ?`)
    .all(...fparams, prefix + '%', raw, limit * 3).map(withDoc);
  const codePartial = db.prepare(`${SELECT} WHERE ${base} AND r.code LIKE ? ESCAPE '\\' COLLATE NOCASE AND r.code NOT LIKE ? ESCAPE '\\' COLLATE NOCASE AND NOT (r.code = ? COLLATE NOCASE) ORDER BY r.code COLLATE NOCASE LIMIT ?`)
    .all(...fparams, '%' + like + '%', prefix + '%', raw, limit * 2).map(withDoc);

  // texto livre em nome/descrição/referência (FTS com fallback LIKE)
  let textRows = [];
  try {
    const ftsQuery = raw.split(/\s+/).filter(Boolean).map((t) => `"${t.replace(/"/g, '')}"*`).join(' ');
    textRows = db.prepare(`
      SELECT r.*, d.original_name AS doc_name, d.seq AS doc_seq, d.file_available AS doc_file_available,
             d.deleted_at AS doc_deleted_at, bm25(records_fts) AS rank
      FROM records_fts
      JOIN records r ON r.rowid = records_fts.rowid
      LEFT JOIN documents d ON d.id = r.document_id
      WHERE records_fts MATCH ? AND ${base}
      ORDER BY rank LIMIT ?`).all(ftsQuery, ...fparams, limit).map(withDoc);
  } catch {
    textRows = [];
  }
  if (textRows.length === 0) {
    textRows = db.prepare(`${SELECT} WHERE ${base} AND (
        r.name LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        r.description LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        r.reference LIKE ? ESCAPE '\\' COLLATE NOCASE OR
        r.snippet LIKE ? ESCAPE '\\' COLLATE NOCASE)
      ORDER BY r.code COLLATE NOCASE LIMIT ?`)
      .all(...fparams, ...Array(4).fill('%' + like + '%'), limit).map(withDoc);
  }

  // nunca misturar: remove dos resultados de texto os que já aparecem no exato
  const exactIds = new Set(exact.map((r) => r.id));
  const prefixIds = new Set(prefixRows.map((r) => r.id));
  const textClean = textRows.filter((r) => !exactIds.has(r.id) && !prefixIds.has(r.id));

  // códigos SEMELHANTES (prefixo comum ≥ 60%): ajudam em erros de digitação/leitura,
  // mas ficam sempre em grupo próprio, nunca misturados com o resultado exato
  const similarClean = [];
  if (raw.length >= 4) {
    const t = raw.toUpperCase();
    const cand = db.prepare(`${SELECT} WHERE ${base} AND r.code IS NOT NULL AND NOT (r.code = ? COLLATE NOCASE) LIMIT 400`)
      .all(...fparams, raw).map(withDoc);
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

  // paginação simples dentro de cada grupo (página se aplica ao conjunto prefix+text)
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
  db.prepare('INSERT INTO search_history (user_id, query, results) VALUES (?, ?, ?)').run(req.user.id, raw, total);

  res.json(result);
});

router.get('/recent', (req, res) => {
  const rows = db.prepare(`
    SELECT query, MAX(created_at) AS created_at, MAX(results) AS results
    FROM search_history WHERE user_id = ?
    GROUP BY query ORDER BY MAX(id) DESC LIMIT 12`).all(req.user.id);
  res.json({ recent: rows });
});

router.delete('/recent', (req, res) => {
  db.prepare('DELETE FROM search_history WHERE user_id = ?').run(req.user.id);
  res.json({ ok: true });
});

export default router;
