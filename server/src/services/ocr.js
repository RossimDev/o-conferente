import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { TESSDATA_DIR, OCR_LANGUAGES } from '../config.js';

let workerPromise = null;

export async function getOcrWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker(OCR_LANGUAGES, 1, {
        langPath: TESSDATA_DIR,
        gzip: true,
        cachePath: TESSDATA_DIR,
        logger: () => {}
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function terminateOcr() {
  if (workerPromise) {
    try {
      const w = await workerPromise;
      await w.terminate();
    } catch { /* ignora */ }
    workerPromise = null;
  }
}

/** Pré-processa imagem para melhorar o OCR (nunca altera o arquivo original). */
export async function preprocessImage(buffer) {
  let img = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await img.metadata();
  let pipeline = img.greyscale().normalize();
  if (meta.width && meta.width < 1400) {
    pipeline = pipeline.resize({ width: 2000, kernel: 'lanczos3' });
  }
  pipeline = pipeline.sharpen({ sigma: 0.8 });
  return pipeline.png().toBuffer();
}

/**
 * Executa OCR e devolve linhas normalizadas:
 * [{ text, x, y, w, h, words: [{text,x,y,w,h,confidence}], confidence }]
 */
export async function ocrToLines(imageBuffer) {
  const prepared = await preprocessImage(imageBuffer);
  const worker = await getOcrWorker();
  const { data } = await worker.recognize(prepared, {}, { blocks: true, text: false });

  // fator de escala: o preprocessamento pode ter redimensionado
  const srcMeta = await sharp(imageBuffer, { failOn: 'none' }).metadata();
  const prepMeta = await sharp(prepared).metadata();
  const sx = (srcMeta.width || prepMeta.width) / prepMeta.width;
  const sy = (srcMeta.height || prepMeta.height) / prepMeta.height;

  const lines = [];
  for (const block of data.blocks || []) {
    for (const para of block.paragraphs || []) {
      for (const line of para.lines || []) {
        const words = (line.words || []).map((wd) => ({
          text: wd.text,
          x: wd.bbox.x0 * sx,
          y: wd.bbox.y0 * sy,
          w: (wd.bbox.x1 - wd.bbox.x0) * sx,
          h: (wd.bbox.y1 - wd.bbox.y0) * sy,
          confidence: (wd.confidence ?? 0) / 100
        })).filter((wd) => wd.text && wd.text.trim() !== '');
        if (words.length === 0) continue;
        const x0 = Math.min(...words.map((w) => w.x));
        const y0 = Math.min(...words.map((w) => w.y));
        const x1 = Math.max(...words.map((w) => w.x + w.w));
        const y1 = Math.max(...words.map((w) => w.y + w.h));
        const conf = words.reduce((s, w) => s + w.confidence, 0) / words.length;
        const text = words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        lines.push({ text, x: x0, y: y0, w: x1 - x0, h: y1 - y0, words, confidence: conf });
      }
    }
  }
  lines.sort((a, b) => a.y - b.y);
  return { lines, width: srcMeta.width, height: srcMeta.height };
}
