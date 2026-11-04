/**
 * Parser de linhas de texto (de PDF ou OCR) em registros de produtos,
 * preservando a localização exata (página, tabela, linha, coluna, bbox, trecho).
 *
 * REGRA DE OURO: nunca inventar informação. Campos ausentes ficam nulos.
 */

const HEADER_MAP = [
  { field: 'code', keys: ['código', 'codigo', 'cod.', 'cod', 'cód', 'code', 'codigo do produto', 'cód.', 'id', 'código do item', 'codigo item'] },
  { field: 'name', keys: ['produto', 'nome', 'product', 'item', 'mercadoria', 'material', 'descrição do produto', 'descricao do produto'] },
  { field: 'description', keys: ['descrição', 'descricao', 'description', 'detalhe', 'especificação', 'especificacao', 'observação', 'observacao'] },
  { field: 'reference', keys: ['referência', 'referencia', 'ref.', 'ref', 'reference', 'sku', 'part number', 'nº ref'] },
  { field: 'quantity', keys: ['quantidade', 'qtd.', 'qtd', 'qtde', 'qty', 'quant.', 'quant', 'quantity', 'volume', 'qtdade'] },
  { field: 'unit', keys: ['un.', 'un', 'und.', 'und', 'unidade', 'unit', 'um', 'medida', 'unid'] },
  { field: 'category', keys: ['categoria', 'category', 'grupo', 'classificação', 'classificacao', 'família', 'familia'] },
  { field: 'price', keys: ['valor unitário', 'valor unitario', 'valor unit.', 'preço unit.', 'preco unit.', 'vlr. unit', 'vlr unit', 'unitário', 'unitario', 'price'] },
  { field: 'total', keys: ['valor total', 'total', 'vlr total', 'preço total', 'preco total', 'amount'] }
];

const UNIT_RE = /^(un|und|un\.|unid|pç|pc|pca|kg|g|gr|mg|l|ml|m|mt|m2|m²|m3|m³|cx|cj|fd|ft|gl|lb|oz|par|pares|dz|sc|saco|rl|rolo|folha|jg|kit|pct|pacote|balde|bombona|tubo|barra|gb|mb|tb|mm|cm|km)$/i;

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isCodeLike(raw) {
  if (raw == null) return false;
  const t = String(raw).trim().replace(/^[\s:;.,-]+|[\s:;.,-]+$/g, '');
  if (t.length < 2 || t.length > 40) return false;
  if (!/[0-9]/.test(t)) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/\-]*$/.test(t)) return false;
  if (/^\d{1,3}([.,]\d{3})+([.,]\d{1,2})?$/.test(t)) return false; // milhar/moeda
  if (/^\d+[.,]\d+$/.test(t) && t.length <= 6) return false;        // decimal curto
  if (/^\d{1,2}$/.test(t)) return false;                            // número pequeno
  if (/^(19|20)\d{2}$/.test(t)) return false;                       // ano isolado
  return true;
}

export function parseQuantity(raw) {
  if (raw == null) return null;
  let s = String(raw).trim().replace(/[^\d.,-]/g, '');
  if (!s || s === '-') return null;
  const hasDot = s.includes('.'), hasComma = s.includes(',');
  if (hasDot && hasComma) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (hasComma) {
    if (/,\d{3}$/.test(s) && !/,\d{1,2}$/.test(s)) s = s.replace(/,/g, '');
    else s = s.replace(',', '.');
  } else if (hasDot) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function isNumericCell(raw) {
  const t = String(raw || '').trim();
  if (!t) return false;
  return /^\d{1,4}([.,]\d{3})*([.,]\d{1,2})?$/.test(t) || /^\d+([.,]\d+)?$/.test(t);
}

/** Divide as palavras de uma linha em células pelo tamanho das lacunas horizontais. */
export function splitCells(line) {
  const words = (line.words || []).slice().sort((a, b) => a.x - b.x);

  const fallbackText = (txt) => String(txt || '')
    .split(/\s{2,}|\t+|\s\|\s+|\s+;\s+/)
    .map((t, i) => ({ text: t.trim(), x: (line.x || 0) + i * 50, w: t.trim().length * 6 }))
    .filter((c) => c.text !== '');

  if (words.length === 0) return fallbackText(line.text);

  // largura média de caractere (exclui lacunas) — base estável para o limiar
  const totalChars = words.reduce((s, w) => s + Math.max(1, String(w.text || '').length), 0);
  const totalWidth = words.reduce((s, w) => s + Math.max(1, w.w || 0), 0);
  const charW = Math.max(2, totalWidth / totalChars);
  const threshold = Math.max(4, charW * 1.7);

  const cells = [];
  let cur = { words: [words[0]] };
  for (let i = 1; i < words.length; i++) {
    const gap = words[i].x - (words[i - 1].x + words[i - 1].w);
    if (gap > threshold) {
      cells.push(cur);
      cur = { words: [words[i]] };
    } else {
      cur.words.push(words[i]);
    }
  }
  cells.push(cur);

  let out = cells.map((c) => {
    const x0 = Math.min(...c.words.map((w) => w.x));
    const x1 = Math.max(...c.words.map((w) => w.x + w.w));
    const text = c.words.map((w) => w.text).join(' ').replace(/\s+/g, ' ').trim();
    return { text, x: x0, w: x1 - x0, words: c.words };
  }).filter((c) => c.text !== '');

  // fallback: se tudo virou uma célula mas o texto tem separadores explícitos, divide
  if (out.length < 2 && /\s{2,}|\t|\s\|\s|\s+;\s+/.test(line.text || '')) {
    out = fallbackText(line.text);
  }
  return out;
}

/** Identifica a linha de cabeçalho e o mapeamento célula→campo. */
function detectHeader(lines) {
  for (let i = 0; i < lines.length; i++) {
    const cells = lines[i].cells;
    if (!cells || cells.length < 2) continue;
    const mapping = {};
    let hits = 0;
    cells.forEach((cell, idx) => {
      const t = norm(cell.text).replace(/[.:]+$/, '');
      if (!t) return;
      for (const h of HEADER_MAP) {
        for (const k of h.keys) {
          if (t === k || t.startsWith(k + ' ') || t.startsWith(k + ' do')) {
            if (mapping[h.field] === undefined) {
              mapping[h.field] = idx;
              hits++;
            }
            return;
          }
        }
      }
    });
    if (hits >= 2 && (mapping.code !== undefined || mapping.name !== undefined)) {
      return { headerIndex: i, mapping, headerXs: cells.map((c) => c.x) };
    }
  }
  return null;
}

/** Heurística de campos quando não há cabeçalho reconhecido. */
function mapRowHeuristic(cells) {
  const rec = { code: null, name: null, description: null, reference: null, quantity: null, quantity_text: null, unit: null, category: null, extra: {} };
  const used = new Set();

  // 1) código
  for (let i = 0; i < cells.length; i++) {
    const t = cells[i].text.trim().replace(/[.,;:]+$/, '');
    if (isCodeLike(t)) {
      rec.code = t;
      used.add(i);
      break;
    }
  }

  // 2) quantidade + unidade (a unidade fica ao lado do número)
  let bestQty = null;
  for (let i = 0; i < cells.length; i++) {
    if (used.has(i)) continue;
    const t = cells[i].text.trim();
    if (isNumericCell(t)) {
      const n = parseQuantity(t);
      if (n !== null) {
        bestQty = { idx: i, n, text: t };
        break;
      }
    }
  }
  if (bestQty) {
    rec.quantity = bestQty.n;
    rec.quantity_text = bestQty.text;
    used.add(bestQty.idx);
    for (const j of [bestQty.idx + 1, bestQty.idx - 1]) {
      if (j >= 0 && j < cells.length && !used.has(j) && UNIT_RE.test(cells[j].text.trim())) {
        rec.unit = cells[j].text.trim().replace(/\.$/, '').toLowerCase();
        used.add(j);
        break;
      }
    }
    // unidade colada na mesma célula: "10 un"
    if (!rec.unit) {
      const m = bestQty.text.match(/^([\d.,]+)\s+([a-zA-Zçãéõáíóúâêôà]{1,6})\.?$/);
      if (m && UNIT_RE.test(m[2])) {
        rec.quantity = parseQuantity(m[1]);
        rec.quantity_text = m[1];
        rec.unit = m[2].toLowerCase();
      }
    }
  }

  // 3) textos restantes (ordem da esquerda p/ direita): 1º → name, 2º → description
  const rest = cells.map((c, i) => ({ i, t: c.text.trim() })).filter((c) => !used.has(c.i) && c.t.length > 0);
  if (rest.length > 0) { rec.name = rest[0].t; used.add(rest[0].i); }
  if (rest.length > 1) { rec.description = rest[1].t; used.add(rest[1].i); }
  for (let k = 2; k < rest.length; k++) {
    rec.extra[`campo_${k - 1}`] = rest[k].t;
  }
  return rec;
}

function mapRowByHeader(cells, mapping, headerXs) {
  const rec = { code: null, name: null, description: null, reference: null, quantity: null, quantity_text: null, unit: null, category: null, extra: {} };
  const assign = (field, text) => {
    const t = (text || '').trim();
    if (!t) return;
    if (field === 'quantity') {
      rec.quantity = parseQuantity(t);
      rec.quantity_text = t;
    } else if (field === 'price' || field === 'total') {
      rec.extra[field] = t;
    } else if (field === 'code') {
      rec.code = t.replace(/[.,;:]+$/, '');
    } else if (rec[field] == null) {
      rec[field] = t;
    } else {
      rec.extra[field + '_2'] = t;
    }
  };

  if (cells.length === headerXs.length) {
    // mesmo número de colunas: mapeamento direto por índice
    for (const [field, idx] of Object.entries(mapping)) {
      if (cells[idx]) assign(field, cells[idx].text);
    }
    cells.forEach((c, idx) => {
      const mapped = Object.entries(mapping).find(([, i]) => i === idx);
      if (!mapped && c.text.trim()) {
        const key = `col_${idx + 1}`;
        if (rec.code && c.text.trim() === rec.code) return;
        rec.extra[key] = c.text.trim();
      }
    });
  } else {
    // alinhamento pela posição x do cabeçalho
    for (const [field, hIdx] of Object.entries(mapping)) {
      const hx = headerXs[hIdx];
      let best = null, bestDist = Infinity;
      cells.forEach((c) => {
        const d = Math.abs(c.x - hx);
        if (d < bestDist && d < Math.max(60, (c.w || 40) * 1.4)) { bestDist = d; best = c; }
      });
      if (best) assign(field, best.text);
    }
    cells.forEach((c) => {
      const usedText = [rec.code, rec.name, rec.description, rec.reference, rec.quantity_text, rec.unit, rec.category].filter(Boolean);
      if (c.text.trim() && !usedText.includes(c.text.trim())) {
        const key = `col_x${Math.round(c.x)}`;
        rec.extra[key] = c.text.trim();
      }
    });
  }
  return rec;
}

/** Linha no formato "20001 - Produto A .... 10 un" */
function parseCompactLine(line) {
  const t = (line.text || '').trim();
  const m = t.match(/^([A-Za-z0-9][A-Za-z0-9._/\-]{1,39})\s*[-–—:.]\s+(.+)$/);
  if (!m || !isCodeLike(m[1])) return null;
  const rest = m[2].trim();

  // tenta separar quantidade no final: "... descrição  10 un"
  const qm = rest.match(/^(.*?)(?:\s{2,}|\s+[—–|]\s+)\s*(\d{1,3}(?:[.,]\d{3})*(?:[.,]\d{1,2})?|\d+[.,]?\d*)\s*([a-zA-Zçãéõáíóúâêôà]{1,6})?\.?\s*$/);
  if (qm && qm[1].trim().length >= 2) {
    return {
      code: m[1],
      name: qm[1].trim(),
      description: null,
      reference: null,
      quantity: parseQuantity(qm[2]),
      quantity_text: qm[2],
      unit: qm[3] ? qm[3].toLowerCase() : null,
      category: null,
      extra: {}
    };
  }
  // formato "código - nome, qtd 10 un"
  const qm2 = rest.match(/^(.*?)[,;]\s*(?:qtd|qtde|qtda|quantidade)\.?:?\s*(\d+[.,]?\d*)\s*([a-zA-Zçãéõáíóúâêôà]{1,6})?\.?\s*$/i);
  if (qm2) {
    return {
      code: m[1],
      name: qm2[1].trim(),
      description: null, reference: null,
      quantity: parseQuantity(qm2[2]),
      quantity_text: qm2[2],
      unit: qm2[3] ? qm2[3].toLowerCase() : null,
      category: null, extra: {}
    };
  }
  return {
    code: m[1],
    name: rest.slice(0, 400),
    description: null, reference: null,
    quantity: null, quantity_text: null, unit: null,
    category: null, extra: {}
  };
}

/**
 * Converte as linhas de uma página em registros.
 * ctx = { documentId, page, source: 'pdf'|'ocr', confidenceBase }
 */
export function linesToRecords(lines, ctx) {
  const prepared = lines
    .filter((l) => l.text && l.text.trim().length > 0)
    .map((l) => ({ ...l, cells: splitCells(l) }));

  const records = [];
  const used = new Set();
  const header = detectHeader(prepared);

  let tableNo = 0;
  let inTable = false;
  let lastCellCount = -1;

  for (let i = 0; i < prepared.length; i++) {
    if (used.has(i)) continue;
    const line = prepared[i];
    if (header && i === header.headerIndex) continue;

    const cells = line.cells;
    const cellCount = cells.length;

    // segmentação de tabela: linhas consecutivas com nº semelhante de células
    const isTableRow = cellCount >= 2 && (!header || i > header.headerIndex);
    if (isTableRow) {
      if (!inTable || Math.abs(cellCount - lastCellCount) > 1) {
        tableNo += 1;
        inTable = true;
      }
      lastCellCount = cellCount;
    } else {
      inTable = false;
      lastCellCount = -1;
    }

    let fields = null;
    if (isTableRow && header && i > header.headerIndex) {
      fields = mapRowByHeader(cells, header.mapping, header.headerXs);
    } else if (isTableRow) {
      fields = mapRowHeuristic(cells);
    } else {
      fields = parseCompactLine(line);
    }

    if (!fields) continue;

    // A linha precisa conter algo útil: código, ou nome + quantidade
    const hasCode = fields.code && isCodeLike(fields.code);
    const hasName = fields.name && fields.name.length >= 2;
    const hasQty = fields.quantity !== null && fields.quantity !== undefined;
    // nunca inventar: sem código, só aceitamos linha com nome E quantidade
    if (!hasCode && !(hasName && hasQty)) continue;

    // achar coluna do código p/ col_no
    let colNo = null;
    if (hasCode) {
      const idx = cells.findIndex((c) => c.text.trim().replace(/[.,;:]+$/, '') === fields.code);
      colNo = idx >= 0 ? idx + 1 : 1;
    }

    const conf = typeof line.confidence === 'number' ? line.confidence : (ctx.confidenceBase ?? 1);
    let confidence = conf;
    if (!hasCode) confidence = Math.min(confidence, 0.6);
    if (hasCode && !hasName && !hasQty) confidence = Math.min(confidence, 0.7);
    const needsReview = confidence < 0.75 || !hasCode || (!hasName && !hasQty);

    records.push({
      document_id: ctx.documentId,
      code: hasCode ? fields.code : null,
      name: fields.name || null,
      description: fields.description || null,
      reference: fields.reference || null,
      quantity: hasQty ? fields.quantity : null,
      quantity_text: fields.quantity_text || null,
      unit: fields.unit || null,
      category: fields.category || null,
      extra: fields.extra && Object.keys(fields.extra).length ? fields.extra : null,
      page: ctx.page,
      table_no: isTableRow ? tableNo : null,
      row_no: isTableRow ? null : null, // preenchido abaixo
      col_no: colNo,
      pos_x: line.x ?? null,
      pos_y: line.y ?? null,
      pos_w: line.w ?? null,
      pos_h: line.h ?? null,
      page_width: ctx.pageWidth ?? null,
      page_height: ctx.pageHeight ?? null,
      snippet: (line.text || '').slice(0, 500),
      confidence: Math.round(confidence * 100) / 100,
      needs_review: needsReview ? 1 : 0
    });

    // número da linha dentro da tabela
    if (isTableRow) {
      const tblRecords = records.filter((r) => r.table_no === tableNo);
      tblRecords.forEach((r, n) => { r.row_no = n + 1; });
    }
    used.add(i);
  }

  // garante row_no sequencial dentro de cada tabela
  const byTable = {};
  for (const r of records) {
    const key = r.table_no ?? 'none';
    byTable[key] = (byTable[key] ?? 0) + 1;
    if (r.table_no != null) r.row_no = byTable[key];
  }

  return records;
}
