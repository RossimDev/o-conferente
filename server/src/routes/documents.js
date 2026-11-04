import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { db, logHistory, getSetting } from '../db.js';
import { requireAuth } from '../auth.js';
import { TMP_DIR, MAX_UPLOAD_MB } from '../config.js';
import { storeOriginal, docPath, fileExists, readDocBuffer, moveToTrash, restoreFromTrash, deleteOriginal, safeFileName, purgeOldTrash } from '../services/files.js';
import { enqueueProcessing, renderPageHighlight, detectType, queueSize } from '../services/extract.js';

const router = Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}.tmp`)
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /pdf|image\//.test(file.mimetype) || /\.(pdf|jpe?g|png|gif|bmp|webp|tiff?|heic|avif)$/i.test(file.originalname);
    cb(ok ? null : new Error('Formato não suportado. Envie PDF ou imagem.'), ok);
  }
});

/** Importação de documentos (PDF/imagens). Processamento em segundo plano. */
router.post('/upload', upload.array('files', 20), (req, res) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
  const created = [];
  for (const f of files) {
    try {
      const originalName = safeFileName(f.originalname);
      const { seq, stored_name, size } = storeOriginal(f.path, originalName);
      const info = db.prepare(`
        INSERT INTO documents (seq, original_name, stored_name, mime_type, size, status, created_by)
        VALUES (?, ?, ?, ?, ?, 'pendente', ?)`)
        .run(seq, originalName, stored_name, f.mimetype || 'application/octet-stream', size, req.user.id);
      const docId = info.lastInsertRowid;
      logHistory({ document_id: docId, action: 'documento_importado', new_values: { nome: originalName, seq, tamanho: size }, user_id: req.user.id });
      enqueueProcessing(docId);
      created.push({ id: docId, seq, original_name: originalName, status: 'pendente' });
    } catch (err) {
      try { fs.unlinkSync(f.path); } catch { /* ignora */ }
    }
  }
  res.json({ documents: created, queue_size: queueSize() });
});

function docRow(row) {
  return {
    ...row,
    type: detectType(row.mime_type, row.original_name),
    file_available: row.file_available && fileExists(row.stored_name) ? 1 : 0
  };
}

/** Lista de documentos (inclui lixeira quando include_deleted=1). */
router.get('/', (req, res) => {
  const { include_deleted, include_archived, q } = req.query;
  let sql = 'SELECT * FROM documents WHERE 1=1';
  const params = [];
  if (include_deleted !== '1') sql += ' AND deleted_at IS NULL';
  if (include_archived !== '1') sql += ' AND archived = 0';
  if (q) { sql += ' AND (original_name LIKE ? COLLATE NOCASE)'; params.push(`%${q}%`); }
  sql += ' ORDER BY seq DESC';
  const rows = db.prepare(sql).all(...params).map(docRow);
  res.json({ documents: rows, queue_size: queueSize() });
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
  const records = db.prepare('SELECT COUNT(*) c FROM records WHERE document_id = ? AND deleted_at IS NULL').get(row.id).c;
  res.json({ document: { ...docRow(row), records } });
});

/** Arquivo original (preservado). ?download=1 força download. */
router.get('/:id/file', (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row || !fileExists(row.stored_name)) return res.status(404).json({ error: 'Arquivo não disponível.' });
  res.setHeader('Content-Type', row.mime_type);
  const disp = req.query.download === '1' ? 'attachment' : 'inline';
  res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
  fs.createReadStream(docPath(row.stored_name)).pipe(res);
});

/** Página renderizada (PNG) com destaque opcional de registro (?record=ID). */
router.get('/:id/pages/:page/render', async (req, res) => {
  try {
    const scale = Math.min(3, Math.max(1, Number(req.query.scale || 2)));
    const png = await renderPageHighlight(Number(req.params.id), Number(req.params.page), req.query.record ? String(req.query.record) : null, scale);
    if (!png) return res.status(404).json({ error: 'Página não disponível.' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(png);
  } catch (err) {
    res.status(500).json({ error: String(err.message || err) });
  }
});

/** Registros extraídos do documento. */
router.get('/:id/records', (req, res) => {
  const rows = db.prepare(`
    SELECT * FROM records
    WHERE document_id = ? AND deleted_at IS NULL
    ORDER BY page, table_no, row_no, id`).all(req.params.id);
  res.json({ records: rows });
});

router.post('/:id/reprocess', (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
  db.prepare(`UPDATE documents SET status = 'pendente', error = NULL WHERE id = ?`).run(row.id);
  enqueueProcessing(row.id);
  res.json({ ok: true });
});

router.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
  const { original_name, archived } = req.body || {};
  const newName = original_name ? safeFileName(original_name) : row.original_name;
  const newArchived = archived === undefined ? row.archived : (archived ? 1 : 0);
  db.prepare('UPDATE documents SET original_name = ?, archived = ? WHERE id = ?').run(newName, newArchived, row.id);
  logHistory({ document_id: row.id, action: newArchived !== row.archived ? (newArchived ? 'documento_arquivado' : 'documento_restaurado') : 'documento_renomeado', old_values: { original_name: row.original_name, archived: row.archived }, new_values: { original_name: newName, archived: newArchived }, user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/:id/archive', (req, res) => {
  db.prepare('UPDATE documents SET archived = 1 WHERE id = ?').run(req.params.id);
  logHistory({ document_id: Number(req.params.id), action: 'documento_arquivado', user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/:id/restore-archive', (req, res) => {
  db.prepare('UPDATE documents SET archived = 0 WHERE id = ?').run(req.params.id);
  logHistory({ document_id: Number(req.params.id), action: 'documento_restaurado', user_id: req.user.id });
  res.json({ ok: true });
});

/**
 * Exclusão de documento com as duas opções exigidas:
 *  ?mode=with_records  → exclui documento E registros relacionados (lixeira).
 *  ?mode=keep_records  → exclui somente o arquivo; registros permanecem sinalizados.
 *  ?permanent=1        → exclusão definitiva (apenas itens já na lixeira).
 */
router.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
  const mode = req.query.mode === 'keep_records' ? 'keep_records' : 'with_records';
  const permanent = req.query.permanent === '1';

  if (permanent) {
    deleteOriginal(row.stored_name);
    if (mode === 'with_records') {
      db.prepare('DELETE FROM records WHERE document_id = ?').run(row.id);
    }
    db.prepare('DELETE FROM documents WHERE id = ?').run(row.id);
    logHistory({ document_id: row.id, action: 'documento_excluido_definitivo', detail: `Modo: ${mode}`, user_id: req.user.id });
    return res.json({ ok: true, permanent: true });
  }

  moveToTrash(row.stored_name);
  if (mode === 'with_records') {
    db.prepare(`UPDATE records SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE document_id = ? AND deleted_at IS NULL`).run(row.id);
  }
  db.prepare(`UPDATE documents SET deleted_at = datetime('now'), file_available = 0 WHERE id = ?`).run(row.id);
  logHistory({
    document_id: row.id,
    action: 'documento_excluido',
    detail: mode === 'with_records' ? 'Documento e registros enviados à lixeira.' : 'Somente o arquivo foi excluído; registros mantidos.',
    user_id: req.user.id
  });
  res.json({ ok: true, mode });
});

router.post('/:id/restore', (req, res) => {
  const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
  restoreFromTrash(row.stored_name);
  db.prepare(`UPDATE documents SET deleted_at = NULL, file_available = 1 WHERE id = ?`).run(row.id);
  db.prepare(`UPDATE records SET deleted_at = NULL WHERE document_id = ? AND deleted_at IS NOT NULL`).run(row.id);
  logHistory({ document_id: row.id, action: 'documento_restaurado_lixeira', user_id: req.user.id });
  res.json({ ok: true });
});

router.post('/purge-trash', (req, res) => {
  const days = Number(getSetting('trash_days', '30'));
  const purgedFiles = purgeOldTrash(days);
  const docs = db.prepare(`SELECT id, stored_name FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)`).all(`-${days} days`);
  const tx = db.transaction(() => {
    for (const d of docs) {
      deleteOriginal(d.stored_name);
      db.prepare('DELETE FROM records WHERE document_id = ?').run(d.id);
      db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
    }
  });
  tx();
  res.json({ ok: true, purged_documents: docs.length, purged_files: purgedFiles });
});

export default router;
