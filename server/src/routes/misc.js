import { Router } from 'express';
import multer from 'multer';
import XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import fs from 'node:fs';
import path from 'node:path';
import { db, getSetting, setSetting, logHistory } from '../db.js';
import { requireAuth } from '../auth.js';
import { DATA_DIR, DB_PATH, DOCS_DIR, TRASH_DIR, STORAGE_DIR, TMP_DIR } from '../config.js';
import { deleteOriginal, purgeOldTrash } from '../services/files.js';

const router = Router();
router.use(requireAuth);

/* ----------------------------- Estatísticas ----------------------------- */
router.get('/stats', (req, res) => {
  const c = (sql, ...p) => db.prepare(sql).get(...p).c;
  const totals = {
    registros: c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0`),
    conferidos: c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0 AND status = 'conferido'`),
    pendentes: c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0 AND status = 'pendente'`),
    divergentes: c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0 AND status = 'divergente'`),
    revisar: c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND archived = 0 AND status = 'revisar'`),
    favoritos: c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND favorite = 1`),
    revisao_dados: c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NULL AND needs_review = 1`),
    documentos: c(`SELECT COUNT(*) c FROM documents WHERE deleted_at IS NULL`),
    documentos_processando: c(`SELECT COUNT(*) c FROM documents WHERE deleted_at IS NULL AND status IN ('pendente','processando')`),
    lixeira: c(`SELECT COUNT(*) c FROM records WHERE deleted_at IS NOT NULL`) + c(`SELECT COUNT(*) c FROM documents WHERE deleted_at IS NOT NULL`)
  };
  res.json({ totals });
});

/* ------------------------------- Histórico ------------------------------ */
router.get('/history', (req, res) => {
  const { record_id, document_id, limit = 100 } = req.query;
  let sql = 'SELECT * FROM history WHERE 1=1';
  const params = [];
  if (record_id) { sql += ' AND record_id = ?'; params.push(record_id); }
  if (document_id) { sql += ' AND document_id = ?'; params.push(document_id); }
  sql += ' ORDER BY id DESC LIMIT ?';
  params.push(Math.min(1000, Number(limit)));
  const rows = db.prepare(sql).all(...params).map((h) => ({
    ...h,
    old_values: h.old_values ? JSON.parse(h.old_values) : null,
    new_values: h.new_values ? JSON.parse(h.new_values) : null
  }));
  res.json({ history: rows });
});

/* ------------------------------- Configurações -------------------------- */
router.get('/settings', (req, res) => {
  const rows = db.prepare('SELECT * FROM settings').all();
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  res.json({ settings });
});

router.put('/settings', (req, res) => {
  const allowed = ['trash_days', 'app_title', 'review_low_confidence'];
  for (const [k, v] of Object.entries(req.body || {})) {
    if (allowed.includes(k)) setSetting(k, v);
  }
  logHistory({ action: 'configuracoes_alteradas', new_values: req.body, user_id: req.user.id });
  res.json({ ok: true });
});

/* --------------------------------- Export -------------------------------- */
function exportRows(filters) {
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
  return db.prepare(sql).all(...params);
}

router.get('/export/records', (req, res) => {
  const rows = exportRows(req.query);
  const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Info: 'Nenhum registro' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registros');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: format === 'csv' ? 'csv' : 'xlsx' });
  res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="o-conferente-registros.${format}"`);
  res.send(buf);
});

/* --------------------------------- Backup -------------------------------- */
router.get('/backup/download', (req, res) => {
  // força checkpoint do WAL para que o arquivo .db no backup esteja completo
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ok */ }
  const zip = new AdmZip();
  zip.addLocalFile(DB_PATH, 'data');
  const addDir = (dir, entry) => {
    if (!fs.existsSync(dir)) return;
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isFile()) zip.addLocalFile(p, entry);
    }
  };
  addDir(DOCS_DIR, 'storage/documents');
  addDir(TRASH_DIR, 'storage/trash');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="o-conferente-backup-${stamp}.zip"`);
  res.send(zip.toBuffer());
});

/* ---------------------------- Lixeira / limpeza --------------------------- */
router.get('/trash', (req, res) => {
  const records = db.prepare(`
    SELECT r.*, d.original_name AS doc_name FROM records r LEFT JOIN documents d ON d.id = r.document_id
    WHERE r.deleted_at IS NOT NULL ORDER BY r.deleted_at DESC LIMIT 500`).all();
  const documents = db.prepare(`SELECT * FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500`).all();
  res.json({ records, documents, retention_days: Number(getSetting('trash_days', '30')) });
});

router.post('/trash/purge', (req, res) => {
  const days = Number(getSetting('trash_days', '30'));
  const purgedFiles = purgeOldTrash(days);
  const docs = db.prepare(`SELECT id, stored_name FROM documents WHERE deleted_at IS NOT NULL`).all();
  let purgedDocs = 0, purgedRecords = 0;
  const tx = db.transaction(() => {
    for (const d of docs) {
      deleteOriginal(d.stored_name);
      purgedRecords += db.prepare('DELETE FROM records WHERE document_id = ? AND deleted_at IS NOT NULL').run(d.id).changes;
      db.prepare('DELETE FROM documents WHERE id = ?').run(d.id);
      purgedDocs++;
    }
    purgedRecords += db.prepare(`DELETE FROM records WHERE deleted_at IS NOT NULL`).run().changes;
  });
  tx();
  logHistory({ action: 'lixeira_esvaziada', detail: `${purgedDocs} documento(s), ${purgedRecords} registro(s).`, user_id: req.user.id });
  res.json({ ok: true, purged_docs: purgedDocs, purged_records: purgedRecords, purged_files: purgedFiles });
});

/* --------------------------- Restauração de backup -------------------------- */
const uploadRestore = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => cb(null, `restore-${Date.now()}.zip`)
  }),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }
});

router.post('/backup/restore', uploadRestore.single('backup'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Envie o arquivo de backup (.zip).' });
  const zipPath = req.file.path;
  try {
    const zip = new AdmZip(zipPath);
    const dbEntry = zip.getEntry('data/conferente.db') || zip.getEntries().find((e) => e.entryName.endsWith('conferente.db'));
    if (!dbEntry) return res.status(400).json({ error: 'Arquivo de backup inválido: banco de dados não encontrado.' });

    // valida o banco do backup antes de substituir
    const testPath = path.join(TMP_DIR, `restore-check-${Date.now()}.db`);
    fs.writeFileSync(testPath, dbEntry.getData());
    try {
      const { default: Database } = await import('better-sqlite3');
      const t = new Database(testPath, { readonly: true });
      t.prepare('SELECT COUNT(*) c FROM sqlite_master').get();
      t.close();
    } catch {
      return res.status(400).json({ error: 'O banco de dados do backup está corrompido.' });
    }

    const { replaceDbConnection, db: current } = await import('../db.js');
    // fecha conexão atual e preserva cópia de segurança
    try { current.close(); } catch { /* ok */ }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    if (fs.existsSync(DB_PATH)) fs.renameSync(DB_PATH, `${DB_PATH}.pre-restore-${stamp}`);
    for (const suf of ['-wal', '-shm']) {
      try { if (fs.existsSync(DB_PATH + suf)) fs.unlinkSync(DB_PATH + suf); } catch { /* ok */ }
    }
    fs.copyFileSync(testPath, DB_PATH);

    // restaura arquivos de documentos
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (entry.entryName.startsWith('storage/documents/')) {
        zip.extractEntryTo(entry, DOCS_DIR, false, true);
      } else if (entry.entryName.startsWith('storage/trash/')) {
        zip.extractEntryTo(entry, TRASH_DIR, false, true);
      }
    }

    const { default: Database } = await import('better-sqlite3');
    const fresh = new Database(DB_PATH);
    replaceDbConnection(fresh);
    logHistory({ action: 'backup_restaurado', detail: 'Backup restaurado com sucesso.', user_id: req.user.id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: `Falha na restauração: ${err.message || err}` });
  } finally {
    try { fs.unlinkSync(zipPath); } catch { /* ok */ }
  }
});

export default router;
