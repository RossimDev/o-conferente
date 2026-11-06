import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { one, all, run, logHistory, getSetting, isCloud } from '../db.js';
import { requireAuth } from '../auth.js';
import { TMP_DIR, MAX_UPLOAD_MB } from '../config.js';
import {
  storeOriginal, readDocBuffer, fileExists, moveToTrash, restoreFromTrash,
  deleteOriginal, safeFileName, purgeOldTrash, createUploadSession,
  appendUploadChunk, completeUploadSession
} from '../services/files.js';
import { enqueueProcessing, processDocument, renderPageHighlight, detectType, queueSize } from '../services/extract.js';

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

/* --------- Upload em pedaços (modo cloud; evita limite de corpo da Vercel) --------- */
router.post('/uploads/start', async (req, res, next) => {
  try {
    const uploadId = await createUploadSession(safeFileName(req.body?.original_name));
    res.json({ upload_id: uploadId, chunk_size: 2 * 1024 * 1024 });
  } catch (err) { next(err); }
});

router.put('/uploads/:id/chunk/:index', async (req, res, next) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    await appendUploadChunk(req.params.id, Number(req.params.index), Buffer.concat(chunks));
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/uploads/:id/complete', async (req, res, next) => {
  try {
    const { seq, stored_name, size } = await completeUploadSession(req.params.id);
    const info = await run(`
      INSERT INTO documents (seq, original_name, stored_name, mime_type, size, status, created_by)
      VALUES (?, ?, ?, ?, ?, 'pendente', ?)`,
      seq, safeFileName(req.body?.original_name), stored_name, req.body?.mime_type || 'application/octet-stream', size, req.user.id);
    const docId = info.lastRowid;
    await logHistory({ document_id: docId, action: 'documento_importado', new_values: { nome: req.body?.original_name, seq, tamanho: size }, user_id: req.user.id });
    res.json({ id: docId, seq, status: 'pendente' });
  } catch (err) { next(err); }
});

/* ----------------------- Upload multipart (modo local) ---------------------- */
router.post('/upload', upload.array('files', 20), async (req, res, next) => {
  try {
    const files = req.files || [];
    if (files.length === 0) return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    const created = [];
    for (const f of files) {
      try {
        const originalName = safeFileName(f.originalname);
        const { seq, stored_name, size } = await storeOriginal(f.path, originalName);
        const info = await run(`
          INSERT INTO documents (seq, original_name, stored_name, mime_type, size, status, created_by)
          VALUES (?, ?, ?, ?, ?, 'pendente', ?)`,
          seq, originalName, stored_name, f.mimetype || 'application/octet-stream', size, req.user.id);
        const docId = info.lastRowid;
        await logHistory({ document_id: docId, action: 'documento_importado', new_values: { nome: originalName, seq, tamanho: size }, user_id: req.user.id });
        if (isCloud() || process.env.VERCEL) {
          // Serverless: não há fila em segundo plano — processa dentro da requisição.
          await processDocument(docId);
          const st = await one('SELECT status FROM documents WHERE id = ?', docId);
          created.push({ id: docId, seq, original_name: originalName, status: st ? st.status : 'pendente' });
        } else {
          enqueueProcessing(docId);
          created.push({ id: docId, seq, original_name: originalName, status: 'pendente' });
        }
      } catch (err) {
        try { fs.unlinkSync(f.path); } catch { /* ok */ }
      }
    }
    res.json({ documents: created, queue_size: queueSize() });
  } catch (err) { next(err); }
});

/** Processamento explícito (modo cloud): roda dentro da requisição. */
router.post('/:id/process', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM documents WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
    if (isCloud() || process.env.VERCEL) {
      await processDocument(row.id);
    } else {
      await run(`UPDATE documents SET status = 'pendente', error = NULL WHERE id = ?`, row.id);
      enqueueProcessing(row.id);
    }
    const after = await one('SELECT status, record_count, low_confidence_count FROM documents WHERE id = ?', row.id);
    res.json({ ok: true, ...after });
  } catch (err) { next(err); }
});

async function docRow(row) {
  return {
    ...row,
    type: detectType(row.mime_type, row.original_name),
    file_available: row.file_available && (await fileExists(row.stored_name)) ? 1 : 0
  };
}

router.get('/', async (req, res, next) => {
  try {
    const { include_deleted, q } = req.query;
    let sql = 'SELECT * FROM documents WHERE 1=1';
    const params = [];
    if (include_deleted !== '1') sql += ' AND deleted_at IS NULL';
    sql += ' AND archived = 0';
    if (q) { sql += ' AND (original_name LIKE ? COLLATE NOCASE)'; params.push(`%${q}%`); }
    sql += ' ORDER BY seq DESC';
    const rows = await all(sql, ...params);
    const out = [];
    for (const r of rows) out.push(await docRow(r));
    res.json({ documents: out, queue_size: queueSize() });
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM documents WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
    const rec = await one('SELECT COUNT(*) c FROM records WHERE document_id = ? AND deleted_at IS NULL', row.id);
    res.json({ document: { ...(await docRow(row)), records: rec ? Number(rec.c) : 0 } });
  } catch (err) { next(err); }
});

/** Arquivo original preservado (com suporte a Range para visualizadores de PDF). */
router.get('/:id/file', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM documents WHERE id = ?', req.params.id);
    if (!row || !(await fileExists(row.stored_name))) return res.status(404).json({ error: 'Arquivo não disponível.' });
    const buffer = await readDocBuffer(row.stored_name);
    res.setHeader('Content-Type', row.mime_type);
    const disp = req.query.download === '1' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disp}; filename*=UTF-8''${encodeURIComponent(row.original_name)}`);
    res.setHeader('Accept-Ranges', 'bytes');
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      const start = m && m[1] ? parseInt(m[1], 10) : 0;
      const end = m && m[2] ? parseInt(m[2], 10) : buffer.length - 1;
      if (start >= buffer.length) {
        res.status(416).setHeader('Content-Range', `bytes */${buffer.length}`);
        return res.end();
      }
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${buffer.length}`);
      res.setHeader('Content-Length', end - start + 1);
      return res.end(buffer.subarray(start, end + 1));
    }
    res.setHeader('Content-Length', buffer.length);
    res.end(buffer);
  } catch (err) { next(err); }
});

router.get('/:id/pages/:page/render', async (req, res, next) => {
  try {
    const scale = Math.min(3, Math.max(1, Number(req.query.scale || 2)));
    const png = await renderPageHighlight(Number(req.params.id), Number(req.params.page), req.query.record ? String(req.query.record) : null, scale);
    if (!png) return res.status(404).json({ error: 'Página não disponível.' });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(png);
  } catch (err) { next(err); }
});

router.get('/:id/records', async (req, res, next) => {
  try {
    const rows = await all(`
      SELECT * FROM records
      WHERE document_id = ? AND deleted_at IS NULL
      ORDER BY page, table_no, row_no, id`, req.params.id);
    res.json({ records: rows });
  } catch (err) { next(err); }
});

router.post('/:id/reprocess', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM documents WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
    await run(`UPDATE documents SET status = 'pendente', error = NULL WHERE id = ?`, row.id);
    if (isCloud() || process.env.VERCEL) {
      await processDocument(row.id);
    } else {
      enqueueProcessing(row.id);
    }
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM documents WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
    const { original_name, archived } = req.body || {};
    const newName = original_name ? safeFileName(original_name) : row.original_name;
    const newArchived = archived === undefined ? row.archived : (archived ? 1 : 0);
    await run('UPDATE documents SET original_name = ?, archived = ? WHERE id = ?', newName, newArchived, row.id);
    await logHistory({
      document_id: row.id,
      action: newArchived !== row.archived ? (newArchived ? 'documento_arquivado' : 'documento_restaurado') : 'documento_renomeado',
      old_values: { original_name: row.original_name, archived: row.archived },
      new_values: { original_name: newName, archived: newArchived },
      user_id: req.user.id
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/archive', async (req, res, next) => {
  try {
    await run('UPDATE documents SET archived = 1 WHERE id = ?', req.params.id);
    await logHistory({ document_id: Number(req.params.id), action: 'documento_arquivado', user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/:id/restore-archive', async (req, res, next) => {
  try {
    await run('UPDATE documents SET archived = 0 WHERE id = ?', req.params.id);
    await logHistory({ document_id: Number(req.params.id), action: 'documento_restaurado', user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM documents WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
    const mode = req.query.mode === 'keep_records' ? 'keep_records' : 'with_records';
    const permanent = req.query.permanent === '1';

    if (permanent) {
      await deleteOriginal(row.stored_name);
      if (mode === 'with_records') {
        await run('DELETE FROM records WHERE document_id = ?', row.id);
      }
      await run('DELETE FROM documents WHERE id = ?', row.id);
      await logHistory({ document_id: row.id, action: 'documento_excluido_definitivo', detail: `Modo: ${mode}`, user_id: req.user.id });
      return res.json({ ok: true, permanent: true });
    }

    await moveToTrash(row.stored_name);
    if (mode === 'with_records') {
      await run(`UPDATE records SET deleted_at = datetime('now'), updated_at = datetime('now') WHERE document_id = ? AND deleted_at IS NULL`, row.id);
    }
    await run(`UPDATE documents SET deleted_at = datetime('now'), file_available = 0 WHERE id = ?`, row.id);
    await logHistory({
      document_id: row.id,
      action: 'documento_excluido',
      detail: mode === 'with_records' ? 'Documento e registros enviados à lixeira.' : 'Somente o arquivo foi excluído; registros mantidos.',
      user_id: req.user.id
    });
    res.json({ ok: true, mode });
  } catch (err) { next(err); }
});

router.post('/:id/restore', async (req, res, next) => {
  try {
    const row = await one('SELECT * FROM documents WHERE id = ?', req.params.id);
    if (!row) return res.status(404).json({ error: 'Documento não encontrado.' });
    await restoreFromTrash(row.stored_name);
    await run(`UPDATE documents SET deleted_at = NULL, file_available = 1 WHERE id = ?`, row.id);
    await run(`UPDATE records SET deleted_at = NULL WHERE document_id = ? AND deleted_at IS NOT NULL`, row.id);
    await logHistory({ document_id: row.id, action: 'documento_restaurado_lixeira', user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post('/purge-trash', async (req, res, next) => {
  try {
    const days = Number(await getSetting('trash_days', '30'));
    const purgedFiles = await purgeOldTrash(days);
    const docs = await all(`SELECT id, stored_name FROM documents WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)`, `-${days} days`);
    for (const d of docs) {
      await deleteOriginal(d.stored_name);
      await run('DELETE FROM records WHERE document_id = ?', d.id);
      await run('DELETE FROM documents WHERE id = ?', d.id);
    }
    res.json({ ok: true, purged_documents: docs.length, purged_files: purgedFiles });
  } catch (err) { next(err); }
});

export default router;
