import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { one, all, run, batch, getSetting, setSetting, logHistory, isCloud, ensureSchema } from '../db.js';
import { requireAuth, userCount } from '../auth.js';
import { TMP_DIR } from '../config.js';
import { purgeOldTrash, deleteOriginal, putDocFile, readDocBuffer, fileExists, safeFileName } from '../services/files.js';

const router = Router();
// Autenticação padrão; exceção: em banco totalmente vazio (primeira carga de um
// novo ambiente), a restauração de backup é permitida sem login para que a conta
// e os dados salvos no dispositivo do usuário possam ser recarregados.
router.use(async (req, res, next) => {
  try {
    if (req.method === 'POST' && req.path === '/backup/restore' && (await userCount()) === 0) return next();
    return requireAuth(req, res, next);
  } catch (err) { return next(err); }
});

/* ----------------------------- Estatísticas ----------------------------- */
router.get('/stats', async (req, res, next) => {
  try {
    const c = async (sql, ...p) => {
      const row = await one(sql, ...p);
      return row ? Number(row.c) : 0;
    };
    const totals = {
      registros: await c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0`),
      conferidos: await c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0 AND status = 'conferido'`),
      pendentes: await c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0 AND status = 'pendente'`),
      divergentes: await c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0 AND status = 'divergente'`),
      revisar: await c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0 AND status = 'revisar'`),
      favoritos: await c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND favorite = 1`),
      revisao_dados: await c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND needs_review = 1`),
      documentos: await c(`SELECT COUNT(*) c FROM documents WHERE deleted_at IS NULL`),
      documentos_processando: await c(`SELECT COUNT(*) c FROM documents WHERE deleted_at IS NULL AND status IN ('pendente','processando')`),
      lixeira: await c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NOT NULL`) + await c(`SELECT COUNT(*) c FROM documents WHERE deleted_at IS NOT NULL`)
    };
    res.json({ totals });
  } catch (err) { next(err); }
});

/* ------------------------------- Histórico ------------------------------ */
router.get('/history', async (req, res, next) => {
  try {
    const { record_id, document_id, limit = 100 } = req.query;
    let sql = 'SELECT * FROM history WHERE 1=1';
    const params = [];
    if (record_id) { sql += ' AND record_id = ?'; params.push(record_id); }
    if (document_id) { sql += ' AND document_id = ?'; params.push(document_id); }
    sql += ' ORDER BY id DESC LIMIT ?';
    params.push(Math.min(1000, Number(limit)));
    const rows = await all(sql, ...params);
    res.json({
      history: rows.map((h) => ({
        ...h,
        old_values: h.old_values ? JSON.parse(h.old_values) : null,
        new_values: h.new_values ? JSON.parse(h.new_values) : null
      }))
    });
  } catch (err) { next(err); }
});

/* ------------------------------ Configurações --------------------------- */
router.get('/settings', async (req, res, next) => {
  try {
    const rows = await all('SELECT * FROM settings');
    const settings = Object.fromEntries(rows.filter((r) => !String(r.key).startsWith('upload:')).map((r) => [r.key, r.value]));
    res.json({ settings });
  } catch (err) { next(err); }
});

router.put('/settings', async (req, res, next) => {
  try {
    const allowed = ['trash_days', 'app_title', 'review_low_confidence'];
    for (const [k, v] of Object.entries(req.body || {})) {
      if (allowed.includes(k)) await setSetting(k, v);
    }
    await logHistory({ action: 'configuracoes_alteradas', new_values: req.body, user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

/* --------------------------------- Export -------------------------------- */
async function exportRows(filters) {
  let sql = `
    SELECT r.code AS "Código", r.name AS "Nome", r.description AS "Descrição", r.reference AS "Referência",
           r.quantity AS "Quantidade", r.quantity_text AS "Qtd. original", r.unit AS "Unidade", r.category AS "Categoria",
           r.status AS "Status", r.confidence AS "Confiança",
           d.original_name AS "Documento", d.seq AS "Nº importação",
           r.page AS "Página", r.table_no AS "Tabela", r.row_no AS "Linha", r.col_no AS "Coluna",
           r.snippet AS "Trecho original", r.created_at AS "Importado em", r.checked_at AS "Conferido em"
    FROM records r LEFT JOIN documents d ON d.id = r.document_id
    WHERE r.deleted_at IS NULL`;
  const params = [];
  if (filters.status) { sql += ' AND r.status = ?'; params.push(filters.status); }
  if (filters.document_id) { sql += ' AND r.document_id = ?'; params.push(filters.document_id); }
  return all(sql, ...params);
}

router.get('/export/records', async (req, res, next) => {
  try {
    const rows = await exportRows(req.query);
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'Nenhum registro' }]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Registros');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: format === 'csv' ? 'csv' : 'xlsx' });
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="o-conferente-registros.${format}"`);
    res.send(buf);
  } catch (err) { next(err); }
});

/* --------------------- Backup portátil (dump.json + arquivos) --------------------- */
const DUMP_TABLES = [
  ['users', 'id'],
  ['auth_tokens', 'token'],
  ['documents', 'id'],
  ['records', 'id'],
  ['conference_sessions', 'id'],
  ['conference_items', 'id'],
  ['history', 'id'],
  ['settings', 'key']
];

router.get('/backup/download', async (req, res, next) => {
  try {
    const zip = new AdmZip();
    const dump = { app: 'o-conferente', version: 1, created_at: new Date().toISOString() };
    for (const [table] of DUMP_TABLES) {
      dump[table] = await all(`SELECT * FROM ${table}`);
    }
    zip.addFile('dump.json', Buffer.from(JSON.stringify(dump, null, 1)));
    for (const doc of dump.documents) {
      try {
        if (await fileExists(doc.stored_name)) {
          zip.addFile(`storage/documents/${doc.stored_name}`, await readDocBuffer(doc.stored_name));
        }
      } catch { /* arquivo indisponível — segue sem ele */ }
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="o-conferente-backup-${stamp}.zip"`);
    res.send(zip.toBuffer());
  } catch (err) { next(err); }
});

const uploadRestore = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `restore-${Date.now()}.zip`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

router.post('/backup/restore', uploadRestore.single('backup'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Envie o arquivo de backup (.zip).' });
    const zip = new AdmZip(req.file.path);
    const dumpEntry = zip.getEntry('dump.json');
    if (!dumpEntry) return res.status(400).json({ error: 'Backup inválido: dump.json não encontrado.' });
    const dump = JSON.parse(dumpEntry.getData().toString('utf8'));
    if (dump.app !== 'o-conferente') return res.status(400).json({ error: 'Backup inválido: formato desconhecido.' });

    await ensureSchema();
    // limpa tabelas e regrava os dados do backup
    for (const [table, key] of DUMP_TABLES.slice().reverse()) {
      await run(`DELETE FROM ${table}`);
    }
    for (const [table, key] of DUMP_TABLES) {
      const rows = dump[table] || [];
      for (const r of rows) {
        const cols = Object.keys(r);
        const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
        await run(sql, ...cols.map((c) => (r[c] === undefined ? null : r[c])));
      }
    }
    // restaura arquivos originais preservando o nome de armazenamento do backup
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory || !entry.entryName.startsWith('storage/documents/')) continue;
      const name = path.basename(entry.entryName);
      await putDocFile(name, entry.getData());
    }
    await logHistory({ action: 'backup_restaurado', detail: 'Backup restaurado com sucesso.', user_id: req.user ? req.user.id : null });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Falha na restauração: ${err.message || err}` });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch { /* ok */ }
  }
});

/* -------------------------------- Lixeira -------------------------------- */
router.get('/trash', async (req, res, next) => {
  try {
    const records = await all(`
      SELECT r.*, d.original_name AS doc_name FROM records r LEFT JOIN documents d ON d.id = r.document_id
      WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC LIMIT 500`);
    const documents = await all(`SELECT * FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`);
    res.json({ records, documents, retention_days: Number(await getSetting('trash_days', '30')) });
  } catch (err) { next(err); }
});

router.post('/trash/purge', async (req, res, next) => {
  try {
    const days = Number(await getSetting('trash_days', '30'));
    const purgedFiles = await purgeOldTrash(days);
    const docs = await all(`SELECT id, stored_name FROM documents WHERE deleted_at IS NOT NULL`);
    let purgedDocs = 0, purgedRecords = 0;
    for (const d of docs) {
      await deleteOriginal(d.stored_name);
      const r = await run('DELETE FROM records WHERE document_id = ? AND deleted_at IS NOT NULL', d.id);
      purgedRecords += r.changes;
      await run('DELETE FROM documents WHERE id = ?', d.id);
      purgedDocs++;
    }
    const rr = await run(`DELETE FROM records WHERE deleted_at IS NOT NULL`);
    purgedRecords += rr.changes;
    await logHistory({ action: 'lixeira_esvaziada', detail: `${purgedDocs} documento(s), ${purgedRecords} registro(s).`, user_id: req.user.id });
    res.json({ ok: true, purged_docs: purgedDocs, purged_records: purgedRecords, purged_files: purgedFiles });
  } catch (err) { next(err); }
});

export default router;
