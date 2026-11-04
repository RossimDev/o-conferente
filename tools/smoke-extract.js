/** Smoke test do pipeline de extração (sem servidor). */
process.env.OC_DB_PATH = '/tmp/smoke-test.db';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, '..', 'tests', 'docs');

const { extractPdfPageLines, getPdfPageCount } = await import('../server/src/services/pdfio.js');
const { ocrToLines } = await import('../server/src/services/ocr.js');
const { linesToRecords } = await import('../server/src/services/parser.js');
const { terminateOcr } = await import('../server/src/services/ocr.js');

async function runPdf(file) {
  const buf = fs.readFileSync(path.join(DOCS, file));
  const n = await getPdfPageCount(buf);
  console.log(`\n=== ${file} (${n} páginas) ===`);
  for (let p = 1; p <= n; p++) {
    const { lines, width, height } = await extractPdfPageLines(buf, p);
    const textLen = lines.reduce((s, l) => s + l.text.length, 0);
    if (textLen < 24) {
      const { renderPdfPageToPng } = await import('../server/src/services/pdfio.js');
      const { png } = await renderPdfPageToPng(buf, p, 2);
      const ocr = await ocrToLines(png);
      const recs = linesToRecords(ocr.lines, { documentId: 0, page: p, source: 'ocr', pageWidth: ocr.width, pageHeight: ocr.height });
      console.log(`pág ${p}: OCR → ${ocr.lines.length} linhas, ${recs.length} registros`);
      for (const r of recs) console.log('   ', JSON.stringify({ code: r.code, name: r.name, qty: r.quantity, unit: r.unit, ref: r.reference, page: r.page, tbl: r.table_no, row: r.row_no, col: r.col_no, conf: r.confidence, snippet: (r.snippet || '').slice(0, 60) }));
    } else {
      const recs = linesToRecords(lines, { documentId: 0, page: p, source: 'pdf', pageWidth: width, pageHeight: height });
      console.log(`pág ${p}: texto → ${lines.length} linhas, ${recs.length} registros`);
      for (const r of recs) console.log('   ', JSON.stringify({ code: r.code, name: r.name, desc: (r.description || '').slice(0, 30), qty: r.quantity, unit: r.unit, ref: r.reference, page: r.page, tbl: r.table_no, row: r.row_no, col: r.col_no, conf: r.confidence }));
    }
  }
}

async function runImage(file) {
  const buf = fs.readFileSync(path.join(DOCS, file));
  console.log(`\n=== ${file} (imagem → OCR) ===`);
  const ocr = await ocrToLines(buf);
  console.log(`linhas OCR: ${ocr.lines.length}`);
  const recs = linesToRecords(ocr.lines, { documentId: 0, page: 1, source: 'ocr', pageWidth: ocr.width, pageHeight: ocr.height });
  console.log(`${recs.length} registros`);
  for (const r of recs) console.log('   ', JSON.stringify({ code: r.code, name: r.name, qty: r.quantity, unit: r.unit, page: r.page, tbl: r.table_no, row: r.row_no, col: r.col_no, conf: r.confidence, snippet: (r.snippet || '').slice(0, 50) }));
}

await runPdf('01-lista-produtos.pdf');
await runPdf('02-nota-fiscal.pdf');
await runImage('03-foto-tabela.png');
await runPdf('04-pdf-escaneado.pdf');
await terminateOcr();
console.log('\nSmoke test concluído.');
