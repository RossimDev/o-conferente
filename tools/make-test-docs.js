/**
 * Gera documentos de teste REAIS para validar o pipeline do O Conferente:
 *  1) PDF com camada de texto e tabela de produtos (códigos do exemplo do projeto)
 *  2) PDF com códigos repetidos em outro documento (rastreabilidade)
 *  3) Imagem "fotografia de tabela" (OCR)
 *  4) PDF escaneado (só imagem, sem camada de texto → OCR dentro do PDF)
 */
import PDFDocument from 'pdfkit';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'tests', 'docs');
fs.mkdirSync(OUT, { recursive: true });

function pdfBuffer(build) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

function drawTable(doc, { title, subtitle, headers, rows, x0 = 46, y0 = 150, widths }) {
  doc.fontSize(18).font('Helvetica-Bold').text(title, x0, 70);
  if (subtitle) doc.fontSize(11).font('Helvetica').fillColor('#444').text(subtitle, x0, 96);
  doc.fillColor('#000');

  // cabeçalho
  let x = x0;
  doc.fontSize(11).font('Helvetica-Bold');
  headers.forEach((h, i) => {
    doc.text(h, x, y0, { width: widths[i] });
    x += widths[i];
  });
  doc.moveTo(x0, y0 + 16).lineTo(x0 + widths.reduce((a, b) => a + b, 0), y0 + 16).stroke();

  // linhas
  doc.font('Helvetica').fontSize(11);
  rows.forEach((row, r) => {
    const y = y0 + 30 + r * 24;
    let cx = x0;
    row.forEach((cell, i) => {
      doc.text(String(cell), cx, y, { width: widths[i] });
      cx += widths[i];
    });
    doc.moveTo(x0, y + 15).lineTo(x0 + widths.reduce((a, b) => a + b, 0), y + 15).lineWidth(0.4).strokeColor('#bbb').stroke();
    doc.strokeColor('#000');
  });
}

/* ---------- 1) Lista de Produtos (2 páginas, texto selecionável) ---------- */
const pdf1 = await pdfBuffer((doc) => {
  drawTable(doc, {
    title: 'Lista de Produtos — Depósito Central',
    subtitle: 'Relação oficial de itens em estoque — documento nº 1188/2026',
    headers: ['CÓDIGO', 'PRODUTO', 'DESCRIÇÃO', 'QUANT.', 'UN'],
    widths: [80, 150, 210, 60, 40],
    rows: [
      ['20001', 'Produto A', 'Descrição completa do produto A', '10', 'un'],
      ['20002', 'Produto B', 'Descrição completa do produto B', '25', 'cx'],
      ['20003', 'Produto C', 'Descrição completa do produto C', '7', 'un'],
      ['20010', 'Produto D', 'Descrição completa do produto D', '100', 'kg']
    ]
  });
  doc.addPage();
  drawTable(doc, {
    title: 'Lista de Produtos — Página 2',
    subtitle: 'Itens complementares',
    headers: ['CÓDIGO', 'PRODUTO', 'DESCRIÇÃO', 'QUANT.', 'UN'],
    widths: [80, 150, 210, 60, 40],
    rows: [
      ['30001', 'Rolamento Rígido', 'Rolamento de esferas 6205', '12', 'un'],
      ['30002', 'Correia Dentada', 'Correia dentada HTD 5M', '4', 'un'],
      ['00750', 'Filtro de Ar', 'Filtro de ar industrial tipo painel', '30', 'pc']
    ]
  });
});

/* ---------- 2) Nota Fiscal (mesmos códigos em outro documento) ---------- */
const pdf2 = await pdfBuffer((doc) => {
  drawTable(doc, {
    title: 'Nota Fiscal de Entrada 004521',
    subtitle: 'Fornecedor: Distribuidora Exemplo Ltda. — CNPJ 00.000.000/0001-00',
    headers: ['CÓDIGO', 'DESCRIÇÃO', 'REFERÊNCIA', 'QTD', 'UN'],
    widths: [80, 240, 110, 60, 40],
    rows: [
      ['20001', 'Produto A — lote recebimento', 'REF-9981', '99', 'un'],
      ['20002', 'Produto B — lote recebimento', 'REF-9982', '50', 'cx'],
      ['AB-1001', 'Conjunto de Vedação', 'REF-7741', '8', 'kit'],
      ['00742', 'Arruela Lisa 3/8', 'REF-3320', '500', 'pc']
    ]
  });
});

/* ---------- 3) Imagem "foto de tabela" (OCR puro) ---------- */
const rows = [
  ['40001', 'Parafuso Sextavado', '150', 'un'],
  ['40002', 'Porca Zincada 8mm', '320', 'un'],
  ['00742', 'Arruela Lisa 3/8', '75', 'pc'],
  ['40010', 'Tarugo Nylon 10mm', '60', 'un']
];
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="900">
  <rect width="1500" height="900" fill="#ffffff"/>
  <text x="80" y="90" font-family="DejaVu Sans" font-size="44" font-weight="bold" fill="#111">Contagem de Estoque — Galpão 2</text>
  <text x="80" y="140" font-family="DejaVu Sans" font-size="28" fill="#333">Conferência manual — 12/03/2026</text>
  <rect x="80" y="190" width="1340" height="4" fill="#111"/>
  <text x="80" y="250" font-family="DejaVu Sans" font-size="30" font-weight="bold">CÓDIGO</text>
  <text x="360" y="250" font-family="DejaVu Sans" font-size="30" font-weight="bold">PRODUTO</text>
  <text x="1050" y="250" font-family="DejaVu Sans" font-size="30" font-weight="bold">QUANTIDADE</text>
  <text x="1330" y="250" font-family="DejaVu Sans" font-size="30" font-weight="bold">UN</text>
  <rect x="80" y="270" width="1340" height="3" fill="#111"/>`;
rows.forEach((r, i) => {
  const y = 340 + i * 90;
  svg += `
  <text x="80" y="${y}" font-family="DejaVu Sans" font-size="32" fill="#111">${r[0]}</text>
  <text x="360" y="${y}" font-family="DejaVu Sans" font-size="32" fill="#111">${r[1]}</text>
  <text x="1050" y="${y}" font-family="DejaVu Sans" font-size="32" fill="#111">${r[2]}</text>
  <text x="1330" y="${y}" font-family="DejaVu Sans" font-size="32" fill="#111">${r[3]}</text>
  <rect x="80" y="${y + 25}" width="1340" height="1.5" fill="#999"/>`;
});
svg += `
  <text x="80" y="780" font-family="DejaVu Sans" font-size="26" fill="#333">Responsável: equipe de inventário</text>
  <text x="80" y="830" font-family="DejaVu Sans" font-size="26" fill="#333">Observação: contagem realizada em 12/03/2026</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png().toBuffer();
fs.writeFileSync(path.join(OUT, '03-foto-tabela.png'), png);

/* ---------- 4) PDF escaneado (a página é apenas a imagem) ---------- */
const pdf4 = await pdfBuffer((doc) => {
  doc.image(png, 40, 60, { width: 515 });
});

fs.writeFileSync(path.join(OUT, '01-lista-produtos.pdf'), pdf1);
fs.writeFileSync(path.join(OUT, '02-nota-fiscal.pdf'), pdf2);
fs.writeFileSync(path.join(OUT, '04-pdf-escaneado.pdf'), pdf4);

console.log('Documentos de teste gerados em', OUT);
for (const f of fs.readdirSync(OUT)) {
  console.log(' -', f, fs.statSync(path.join(OUT, f)).size, 'bytes');
}
