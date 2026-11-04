import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';

// Polyfills exigidos pelo pdf.js no ambiente Node
if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D;

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
import path from 'node:path';
import { ROOT } from '../config.js';

const STANDARD_FONTS = path.join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;

async function openPdf(buffer) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONTS
  });
  return task.promise;
}

/**
 * Extrai a camada de texto de uma página em linhas com bbox (origem topo-esquerda).
 * Retorna { width, height, lines: [{text,x,y,w,h,words,confidence}] }
 */
export async function extractPdfPageLines(buffer, pageNum) {
  const pdf = await openPdf(buffer);
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale: 1 });
  const width = viewport.width;
  const height = viewport.height;
  const content = await page.getTextContent({ includeMarkedContent: false });

  // Agrupa itens em linhas por proximidade vertical
  const rawItems = content.items
    .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
    .map((it) => {
      const [a, b, c, d, e, f] = it.transform;
      const fontH = Math.abs(d) || Math.abs(b) || 10;
      return {
        text: it.str,
        x: e,
        yBaseline: f,
        w: it.width || (it.str.length * fontH * 0.5),
        h: fontH,
        endX: e + (it.width || (it.str.length * fontH * 0.5))
      };
    });

  rawItems.sort((p, q) => (q.yBaseline - p.yBaseline) || (p.x - q.x));

  const lines = [];
  for (const it of rawItems) {
    const tol = Math.max(2.2, it.h * 0.42);
    let line = lines.find((L) => Math.abs(L.yBaseline - it.yBaseline) <= tol);
    if (!line) {
      line = { yBaseline: it.yBaseline, items: [] };
      lines.push(line);
    }
    line.items.push(it);
    line.yBaseline = (line.yBaseline * (line.items.length - 1) + it.yBaseline) / line.items.length;
  }

  const out = lines.map((L) => {
    L.items.sort((p, q) => p.x - q.x);
    const first = L.items[0];
    const last = L.items[L.items.length - 1];
    const x = first.x;
    const w = Math.max(last.endX - first.x, 1);
    const h = Math.max(...L.items.map((i) => i.h), 6);
    const yTop = height - L.yBaseline - h * 0.78; // aprox. topo da linha em coord. topo-esquerda
    const words = L.items.map((i) => ({
      text: i.text,
      x: i.x,
      y: height - i.yBaseline - i.h * 0.78,
      w: Math.max(i.w, 1),
      h: i.h,
      confidence: 1
    }));
    const text = L.items.map((i) => i.text).join(' ').replace(/\s+/g, ' ').trim();
    return { text, x, y: yTop, w, h, words, confidence: 1 };
  }).filter((L) => L.text.length > 0);

  out.sort((a, b) => a.y - b.y);
  await pdf.destroy();
  return { width, height, lines: out };
}

export async function getPdfPageCount(buffer) {
  const pdf = await openPdf(buffer);
  const n = pdf.numPages;
  await pdf.destroy();
  return n;
}

/** Renderiza uma página do PDF como PNG. scale 2 ≈ 150dpi. */
export async function renderPdfPageToPng(buffer, pageNum, scale = 2) {
  const pdf = await openPdf(buffer);
  const page = await pdf.getPage(pageNum);
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport }).promise;
  await pdf.destroy();
  return { png: canvas.toBuffer('image/png'), width: viewport.width, height: viewport.height, pixelWidth: canvas.width, pixelHeight: canvas.height };
}

export async function isPdf(buffer) {
  return buffer.slice(0, 5).toString('latin1') === '%PDF-';
}
