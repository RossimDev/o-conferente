import crypto from 'node:crypto';
import { db, logHistory, getSetting } from '../db.js';
import { readDocBuffer, fileExists } from './files.js';
import { extractPdfPageLines, getPdfPageCount, isPdf, renderPdfPageToPng } from './pdfio.js';
import { ocrToLines } from './ocr.js';
import { linesToRecords } from './parser.js';

const PDF_EXT = /\.pdf$/i;
const IMG_EXT = /\.(jpe?g|png|gif|bmp|webp|tiff?|heic|avif)$/i;

export function detectType(mime, name) {
  if (PDF_EXT.test(name) || mime === 'application/pdf') return 'pdf';
  if (IMG_EXT.test(name) || String(mime).startsWith('image/')) return 'image';
  return 'image'; // tratamos desconhecidos como imagem (o OCR falhará com erro claro)
}

function insertRecordsBatch(records) {
  const insertRecord = db.prepare(`
    INSERT INTO records (
      id, document_id, code, name, description, reference, quantity, quantity_text, unit, category, extra,
      page, table_no, row_no, col_no, pos_x, pos_y, pos_w, pos_h, page_width, page_height,
      snippet, confidence, needs_review, status
    ) VALUES (
      @id, @document_id, @code, @name, @description, @reference, @quantity, @quantity_text, @unit, @category, @extra,
      @page, @table_no, @row_no, @col_no, @pos_x, @pos_y, @pos_w, @pos_h, @page_width, @page_height,
      @snippet, @confidence, @needs_review, 'pendente'
    )
  `);
  const tx = db.transaction((list) => {
    for (const r of list) {
      insertRecord.run({
        ...r,
        id: crypto.randomUUID(),
        extra: r.extra ? JSON.stringify(r.extra) : null
      });
    }
  });
  tx(records);
}

/**
 * Processa um documento: extrai texto (PDF) ou aplica OCR (imagens/PDFs escaneados),
 * interpreta tabelas e grava registros com localização completa.
 */
export async function processDocument(documentId) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!doc || doc.deleted_at) return;
  if (!fileExists(doc.stored_name)) {
    db.prepare(`UPDATE documents SET status = 'erro', error = ? WHERE id = ?`)
      .run('Arquivo original não encontrado no armazenamento.', documentId);
    return;
  }

  db.prepare(`UPDATE documents SET status = 'processando', error = NULL WHERE id = ?`).run(documentId);

  try {
    const buffer = readDocBuffer(doc.stored_name);
    const type = detectType(doc.mime_type, doc.original_name);
    let allRecords = [];
    let pageCount = 1;

    if (type === 'pdf' || (await isPdf(buffer))) {
      pageCount = await getPdfPageCount(buffer);
      for (let p = 1; p <= pageCount; p++) {
        const { lines, width, height } = await extractPdfPageLines(buffer, p);
        const textLen = lines.reduce((s, l) => s + l.text.length, 0);
        if (textLen < 24) {
          // página escaneada (sem camada de texto) → OCR
          const { png } = await renderPdfPageToPng(buffer, p, 2);
          const ocr = await ocrToLines(png);
          const recs = linesToRecords(ocr.lines, {
            documentId, page: p, source: 'ocr', pageWidth: ocr.width, pageHeight: ocr.height
          });
          allRecords.push(...recs);
        } else {
          const recs = linesToRecords(lines, {
            documentId, page: p, source: 'pdf', pageWidth: width, pageHeight: height
          });
          allRecords.push(...recs);
        }
      }
    } else {
      const ocr = await ocrToLines(buffer);
      pageCount = 1;
      const recs = linesToRecords(ocr.lines, {
        documentId, page: 1, source: 'ocr', pageWidth: ocr.width, pageHeight: ocr.height
      });
      allRecords.push(...recs);
    }

    // Remove registros anteriores deste documento (reprocessamento)
    db.prepare('DELETE FROM records WHERE document_id = ?').run(documentId);

    insertRecordsBatch(allRecords);

    const lowCount = allRecords.filter((r) => r.needs_review).length;
    const status = lowCount > 0 ? 'revisao' : 'pronto';
    db.prepare(`
      UPDATE documents
      SET status = ?, page_count = ?, record_count = ?, low_confidence_count = ?, processed_at = datetime('now')
      WHERE id = ?`).run(status, pageCount, allRecords.length, lowCount, documentId);

    logHistory({
      document_id: documentId,
      action: 'documento_processado',
      new_values: { registros: allRecords.length, paginas: pageCount, revisao: lowCount },
      detail: `Extração concluída: ${allRecords.length} registro(s) em ${pageCount} página(s).`
    });
  } catch (err) {
    db.prepare(`UPDATE documents SET status = 'erro', error = ? WHERE id = ?`)
      .run(String(err.message || err), documentId);
    logHistory({
      document_id: documentId,
      action: 'documento_erro',
      detail: String(err.message || err)
    });
  }
}

/* ---------------- Fila de processamento em segundo plano ---------------- */

const queue = [];
let running = false;

export function enqueueProcessing(documentId) {
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

/** Reanexa documentos pendentes após reinício do servidor. */
export function recoverQueue() {
  const rows = db.prepare(`SELECT id FROM documents WHERE deleted_at IS NULL AND status IN ('pendente','processando')`).all();
  for (const r of rows) enqueueProcessing(r.id);
}

export function queueSize() {
  return queue.length + (running ? 1 : 0);
}

/** Renderiza página com destaque de um registro (para visualização/localização). */
export async function renderPageHighlight(documentId, pageNum, recordId = null, scale = 2) {
  const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(documentId);
  if (!doc || !fileExists(doc.stored_name)) return null;
  const buffer = readDocBuffer(doc.stored_name);
  const type = detectType(doc.mime_type, doc.original_name);

  let png, width, height;
  if (type === 'pdf' || (await isPdf(buffer))) {
    const r = await renderPdfPageToPng(buffer, pageNum, scale);
    png = r.png; width = r.width; height = r.height;
  } else {
    const sharp = (await import('sharp')).default;
    const img = sharp(buffer, { failOn: 'none' }).rotate();
    const meta = await img.metadata();
    const pipeline = img.resize({ width: Math.round((meta.width || 1000) * (scale / 2) * 2) });
    png = await pipeline.png().toBuffer();
    const outMeta = await sharp(png).metadata();
    width = (meta.width || outMeta.width);
    height = (meta.height || outMeta.height);
  }

  if (recordId) {
    const rec = db.prepare('SELECT * FROM records WHERE id = ? AND document_id = ?').get(recordId, documentId);
    if (rec && rec.pos_x != null) {
      const sharp = (await import('sharp')).default;
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
