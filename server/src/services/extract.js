import crypto from 'node:crypto';
import { one, all, run, batch, logHistory, isCloud } from '../db.js';
import { readDocBuffer, fileExists } from './files.js';
import { extractPdfPageLines, getPdfPageCount, isPdf, renderPdfPageToPng } from './pdfio.js';
import { ocrToLines } from './ocr.js';
import { linesToRecords } from './parser.js';

const PDF_EXT = /\.pdf$/i;
const IMG_EXT = /\.(jpe?g|png|gif|bmp|webp|tiff?|heic|avif)$/i;

export function detectType(mime, name) {
  if (PDF_EXT.test(name) || mime === 'application/pdf') return 'pdf';
  if (IMG_EXT.test(name) || String(mime).startsWith('image/')) return 'image';
  return 'image';
}

function insertStmts(records) {
  return records.map((r) => ({
    sql: `INSERT INTO records (
      id, document_id, user_id, code, name, description, reference, quantity, quantity_text, unit, category, extra,
      page, table_no, row_no, col_no, pos_x, pos_y, pos_w, pos_h, page_width, page_height,
      snippet, confidence, needs_review, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendente')`,
    args: [
      crypto.randomUUID(), r.document_id, r.user_id ?? null, r.code, r.name, r.description, r.reference,
      r.quantity, r.quantity_text, r.unit, r.category, r.extra ? JSON.stringify(r.extra) : null,
      r.page, r.table_no, r.row_no, r.col_no, r.pos_x, r.pos_y, r.pos_w, r.pos_h, r.page_width, r.page_height,
      r.snippet, r.confidence, r.needs_review ? 1 : 0
    ]
  }));
}

/**
 * Processa um documento: extrai texto (PDF) ou aplica OCR (imagens/PDFs escaneados),
 * interpreta tabelas e grava registros com localização completa.
 */
export async function processDocument(documentId) {
  const doc = await one('SELECT * FROM documents WHERE id = ?', documentId);
  if (!doc || doc.deleted_at) return;
  if (!(await fileExists(doc.stored_name))) {
    await run(`UPDATE documents SET status = 'erro', error = ? WHERE id = ?`,
      'Arquivo original não encontrado no armazenamento.', documentId);
    return;
  }

  await run(`UPDATE documents SET status = 'processando', error = NULL WHERE id = ?`, documentId);

  try {
    const buffer = await readDocBuffer(doc.stored_name);
    const type = detectType(doc.mime_type, doc.original_name);
    let allRecords = [];
    let pageCount = 1;

    if (type === 'pdf' || (await isPdf(buffer))) {
      pageCount = await getPdfPageCount(buffer);
      for (let p = 1; p <= pageCount; p++) {
        const { lines, width, height } = await extractPdfPageLines(buffer, p);
        const textLen = lines.reduce((s, l) => s + l.text.length, 0);
        if (textLen < 24) {
          const { png } = await renderPdfPageToPng(buffer, p, 2);
          const ocr = await ocrToLines(png);
          allRecords.push(...linesToRecords(ocr.lines, { documentId, page: p, source: 'ocr', pageWidth: ocr.width, pageHeight: ocr.height }));
        } else {
          allRecords.push(...linesToRecords(lines, { documentId, page: p, source: 'pdf', pageWidth: width, pageHeight: height }));
        }
      }
    } else {
      const ocr = await ocrToLines(buffer);
      pageCount = 1;
      allRecords.push(...linesToRecords(ocr.lines, { documentId, page: 1, source: 'ocr', pageWidth: ocr.width, pageHeight: ocr.height }));
    }

    for (const r of allRecords) r.user_id = doc.created_by;
    await run('DELETE FROM records WHERE document_id = ?', documentId);
    for (let i = 0; i < allRecords.length; i += 50) {
      await batch(insertStmts(allRecords.slice(i, i + 50)));
    }

    const lowCount = allRecords.filter((r) => r.needs_review).length;
    const status = lowCount > 0 ? 'revisao' : 'pronto';
    await run(`
      UPDATE documents
      SET status = ?, page_count = ?, record_count = ?, low_confidence_count = ?, processed_at = datetime('now')
      WHERE id = ?`, status, pageCount, allRecords.length, lowCount, documentId);

    await logHistory({
      document_id: documentId,
      action: 'documento_processado',
      new_values: { registros: allRecords.length, paginas: pageCount, revisao: lowCount },
      detail: `Extração concluída: ${allRecords.length} registro(s) em ${pageCount} página(s).`
    });
  } catch (err) {
    await run(`UPDATE documents SET status = 'erro', error = ? WHERE id = ?`, String(err.message || err), documentId);
    await logHistory({ document_id: documentId, action: 'documento_erro', detail: String(err.message || err) });
  }
}

/* ---------------- Fila de processamento (modo local — em segundo plano) ---------------- */
const queue = [];
let running = false;

export function enqueueProcessing(documentId) {
  if (isCloud()) {
    // em ambiente serverless o processamento acontece sob demanda (POST /:id/process)
    processDocument(documentId).catch((err) => console.error('Falha ao processar', documentId, err));
    return;
  }
  if (!queue.includes(documentId)) queue.push(documentId);
  pump();
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length > 0) {
    const id = queue.shift();
    try {
      await processDocument(id);
    } catch (err) {
      console.error('Falha ao processar documento', id, err);
    }
  }
  running = false;
}

export async function recoverQueue() {
  const rows = await all(`SELECT id FROM documents WHERE deleted_at IS NULL AND status IN ('pendente','processando')`);
  for (const r of rows) enqueueProcessing(r.id);
}

export function queueSize() {
  return queue.length + (running ? 1 : 0);
}

/** Renderiza página com destaque de um registro (localização visual exata). */
export async function renderPageHighlight(documentId, pageNum, recordId = null, scale = 2) {
  const doc = await one('SELECT * FROM documents WHERE id = ?', documentId);
  if (!doc || !(await fileExists(doc.stored_name))) return null;
  const buffer = await readDocBuffer(doc.stored_name);
  const type = detectType(doc.mime_type, doc.original_name);

  let png, width, height;
  const sharp = (await import('sharp')).default;
  if (type === 'pdf' || (await isPdf(buffer))) {
    const r = await renderPdfPageToPng(buffer, pageNum, scale);
    png = r.png; width = r.width; height = r.height;
  } else {
    const img = sharp(buffer, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    const pipeline = img.resize({ width: Math.round((meta.width || 1000) * scale) });
    png = await pipeline.png().toBuffer();
    const outMeta = await sharp(png).metadata();
    width = (meta.width || outMeta.width);
    height = (meta.height || outMeta.height);
  }

  if (recordId) {
    const rec = await one('SELECT * FROM records WHERE id = ? AND document_id = ?', recordId, documentId);
    if (rec && rec.pos_x != null) {
      const meta = await sharp(png).metadata();
      const fx = meta.width / (rec.page_width || width);
      const fy = meta.height / (rec.page_height || height);
      const x = Math.max(0, Math.round(rec.pos_x * fx) - 8);
      const y = Math.max(0, Math.round(rec.pos_y * fy) - 6);
      const w = Math.min(meta.width - x, Math.round((rec.pos_w || 120) * fx) + 16);
      const h = Math.min(meta.height - y, Math.round((rec.pos_h || 18) * fy) + 12);
      const overlay = Buffer.from(
        `<svg width="${meta.width}" height="${meta.height}">
           <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(255,214,0,0.28)" stroke="#e11d48" stroke-width="4"/>
         </svg>`);
      png = await sharp(png).composite([{ input: overlay }]).png().toBuffer();
    }
  }
  return png;
}
