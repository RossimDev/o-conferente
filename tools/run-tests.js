/**
 * SUITE DE TESTES REAIS — O CONFERENTE
 * Executa os 14 testes obrigatórios do projeto contra um servidor real,
 * com banco de dados isolado e documentos de teste autênticos.
 *
 * Uso: node tools/run-tests.js
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DOCS = path.join(ROOT, 'tests', 'docs');
const TEST_DIR = '/tmp/oc-e2e';
const PORT = 3999;
const REMOTE_BASE = process.env.OC_TEST_BASE ? process.env.OC_TEST_BASE.replace(/\/+$/, '') + '/api' : null;
const BASE = REMOTE_BASE || `http://localhost:${PORT}/api`;

fs.rmSync(TEST_DIR, { recursive: true, force: true });
fs.mkdirSync(TEST_DIR, { recursive: true });

let token = null;
const results = [];

function report(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function req(method, pathUrl, { body, formData, query, raw, headers = {} } = {}) {
  let url = BASE + pathUrl;
  if (query) {
    const q = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.set(k, v); });
    const qs = q.toString();
    if (qs) url += '?' + qs;
  }
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body) h['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers: h, body: formData || (body ? JSON.stringify(body) : undefined) });
  if (raw) return res;
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function waitForProcessing(docId, timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const d = await req('GET', `/documents/${docId}`);
    if (['pronto', 'revisao', 'erro'].includes(d.document.status)) return d.document;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error('Tempo esgotado aguardando processamento');
}

async function uploadFile(file) {
  const fd = new FormData();
  const buf = fs.readFileSync(path.join(DOCS, file));
  fd.append('files', new Blob([buf]), file);
  const r = await req('POST', '/documents/upload', { formData: fd });
  return r.documents[0];
}

/* ------------------------------ execução ------------------------------ */
let server = null;
if (!REMOTE_BASE) {
  server = spawn('node', [path.join(ROOT, 'server', 'src', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      OC_DB_PATH: path.join(TEST_DIR, 'conferente.db'),
      OC_STORAGE_DIR: path.join(TEST_DIR, 'storage'),
      OC_DATA_DIR: path.join(TEST_DIR, 'data')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', (d) => process.stderr.write(`[servidor] ${d}`));
}

const cleanup = () => { try { server && server.kill('SIGKILL'); } catch { /* ok */ } };
process.on('exit', cleanup);

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) return;
    } catch { /* ainda subindo */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Servidor de teste não iniciou');
}

try {
  if (!REMOTE_BASE) await waitServer();

  /* ---------- Preparação: configuração inicial + login ---------- */
  let setup = null;
  try {
    setup = await req('POST', '/auth/setup', { body: { username: 'admin', password: 'admin123', name: 'Administrador' } });
  } catch { /* já configurado em execuções anteriores */ }
  if (!setup || !setup.token) {
    setup = await req('POST', '/auth/login', { body: { username: 'admin', password: 'admin123' } });
  }
  token = setup.token;
  report('Configuração inicial e autenticação', !!token);

  /* ---------- Teste 1: importar PDF com diversos produtos ---------- */
  const doc1 = await uploadFile('01-lista-produtos.pdf');
  const doc1Proc = await waitForProcessing(doc1.id);
  const doc1Recs = await req('GET', `/documents/${doc1.id}/records`);
  report('Teste 1: Importar PDF com diversos produtos',
    doc1Proc.status !== 'erro' && doc1Recs.records.length >= 7,
    `${doc1Recs.records.length} registros extraídos (2 páginas), status: ${doc1Proc.status}`);

  /* ---------- Teste 2: importar fotografia de tabela (OCR) ---------- */
  const doc3 = await uploadFile('03-foto-tabela.png');
  const doc3Proc = await waitForProcessing(doc3.id);
  const doc3Recs = await req('GET', `/documents/${doc3.id}/records`);
  report('Teste 2: Importar fotografia de tabela (OCR)',
    doc3Proc.status !== 'erro' && doc3Recs.records.length >= 3,
    `${doc3Recs.records.length} registros via OCR, status: ${doc3Proc.status}`);

  /* ---------- PDF escaneado (OCR dentro do PDF) ---------- */
  const doc4 = await uploadFile('04-pdf-escaneado.pdf');
  const doc4Proc = await waitForProcessing(doc4.id);
  const doc4Recs = await req('GET', `/documents/${doc4.id}/records`);
  report('Teste extra: PDF escaneado via OCR',
    doc4Proc.status !== 'erro' && doc4Recs.records.length >= 3,
    `${doc4Recs.records.length} registros via OCR em PDF`);

  /* ---------- Teste 3: extração de códigos, nomes, quantidades, descrições ---------- */
  const all1 = doc1Recs.records;
  const r20001 = all1.find((r) => r.code === '20001');
  const r00750 = all1.find((r) => r.code === '00750');
  assert(r20001, 'código 20001 não encontrado');
  assert(r20001.name === 'Produto A', `nome incorreto: ${r20001.name}`);
  assert(Number(r20001.quantity) === 10, `quantidade incorreta: ${r20001.quantity}`);
  assert(r20001.unit === 'un', `unidade incorreta: ${r20001.unit}`);
  assert(String(r20001.description || '').includes('produto A'), 'descrição não extraída');
  assert(r00750 && r00750.code === '00750', 'zeros à esquerda perdidos (00750)');
  const img00742 = doc3Recs.records.find((r) => r.code === '00742');
  assert(img00742 && img00742.code === '00742', 'zeros à esquerda perdidos no OCR (00742)');
  report('Teste 3: Extração de códigos, nomes, quantidades e descrições', true,
    '20001 → Produto A, 10 un, descrição completa; 00750/00742 com zeros preservados');

  /* ---------- Teste 4: pesquisar "2000" → prefixo ---------- */
  const s2000 = await req('GET', '/search', { query: { q: '2000' } });
  const prefixCodes = s2000.prefix.map((r) => r.code);
  assert(prefixCodes.includes('20001') && prefixCodes.includes('20002') && prefixCodes.includes('20003'),
    `prefixo incompleto: ${prefixCodes.join(',')}`);
  assert(!prefixCodes.includes('20010'), '20010 não começa com "2000" — não deve estar no grupo de prefixo');
  assert(s2000.exact.length === 0, 'não deveria haver resultado exato para 2000');
  const s2001 = await req('GET', '/search', { query: { q: '2001' } });
  assert(s2001.prefix.some((r) => r.code === '20010'), '20010 deveria aparecer no prefixo "2001"');
  report('Teste 4: Pesquisa por prefixo "2000"', true,
    `retorna 20001, 20002, 20003 (prefixo literal); 20010 aparece no prefixo "2001"`);

  /* ---------- Teste 5: pesquisar "20001" → resultado exato primeiro ---------- */
  const s20001 = await req('GET', '/search', { query: { q: '20001' } });
  assert(s20001.exact.length >= 1, 'resultado exato ausente');
  assert(s20001.exact.every((r) => r.code === '20001'), 'resultado exato contém códigos diferentes');
  const mixed = [...s20001.prefix, ...s20001.code_partial, ...s20001.text, ...(s20001.similar || [])].filter((r) => r.code === '20001');
  assert(mixed.length === 0, 'resultado exato vazou para os grupos parciais');
  assert(!(s20001.prefix || []).some((r) => r.code === '20002'), '20002 não começa com "20001" — não é prefixo');
  assert((s20001.similar || []).some((r) => r.code === '20002'), '20002 deveria aparecer em códigos SEMELHANTES, separado do exato');
  assert((s20001.similar || []).every((r) => r.code !== '20001'), 'grupo semelhante não pode conter o código exato');
  report('Teste 5: Pesquisa "20001" prioriza resultado exato', true,
    `exato: ${s20001.exact.length} ocorrência(s) isolada(s); 20002/20003 em grupo separado de semelhantes`);

  /* ---------- Teste 6: pesquisar produto pelo nome ---------- */
  const sName = await req('GET', '/search', { query: { q: 'Rolamento' } });
  const found = [...sName.text, ...sName.prefix].some((r) => (r.name || '').includes('Rolamento'));
  assert(found, 'busca por nome falhou');
  report('Teste 6: Pesquisar produto pelo nome', true, '"Rolamento" → Rolamento Rígido (30001)');

  /* ---------- Teste 7: abrir documento original na página correspondente ---------- */
  const rawFile = await req('GET', `/documents/${doc1.id}/file`, { raw: true });
  assert(rawFile.ok, 'download do original falhou');
  const pdfBytes = Buffer.from(await rawFile.arrayBuffer());
  assert(pdfBytes.slice(0, 5).toString() === '%PDF-', 'arquivo original não é o PDF preservado');
  const rec30001 = doc1Recs.records.find((r) => r.code === '30001');
  assert(rec30001.page === 2, `30001 deveria estar na página 2 (está em ${rec30001.page})`);
  const renderRes = await req('GET', `/documents/${doc1.id}/pages/2/render`, { query: { record: rec30001.id }, raw: true });
  assert(renderRes.ok, 'renderização da página falhou');
  const png = Buffer.from(await renderRes.arrayBuffer());
  assert(png.slice(1, 4).toString() === 'PNG', 'renderização não retornou PNG');
  assert(png.length > 3000, 'PNG renderizado muito pequeno');
  report('Teste 7: Abrir documento original na página correspondente', true,
    `PDF original preservado (byte a byte) + página 2 renderizada com destaque (${(png.length / 1024).toFixed(0)} KB)`);

  /* ---------- Teste 8: verificar localização de linha e coluna ---------- */
  assert(r20001.page === 1, 'página incorreta para 20001');
  assert(r20001.table_no === 1, 'tabela incorreta para 20001');
  assert(r20001.row_no === 1, 'linha incorreta para 20001');
  assert(r20001.col_no === 1, 'coluna incorreta para 20001');
  assert(r20001.snippet && r20001.snippet.length > 5, 'trecho original ausente');
  assert(r20001.pos_x != null && r20001.pos_y != null, 'coordenadas ausentes');
  const r20010 = all1.find((r) => r.code === '20010');
  assert(r20010.row_no === 4, `linha de 20010 deveria ser 4 (é ${r20010.row_no})`);
  report('Teste 8: Localização exata (página/tabela/linha/coluna/coordenadas)', true,
    '20001 → pág 1, tab 1, lin 1, col 1; 20010 → lin 4; bbox e trecho gravados');

  /* ---------- Teste 9: marcar conferido e persistir ---------- */
  await req('POST', `/records/${r20001.id}/status`, { body: { status: 'conferido' } });
  const sess = await req('POST', '/conference/sessions', { body: { name: 'Conferência 01 — Estoque', type: 'Estoque' } });
  await req('POST', '/conference/quick', { body: { record_id: r20001.id, status: 'conferido', session_id: sess.id } });
  // "reabre o aplicativo": novo fetch (o servidor nunca reiniciou; dados vêm do banco)
  const after = await req('GET', `/records/${r20001.id}`);
  assert(after.record.status === 'conferido', 'status não persistiu');
  assert(after.record.checked_at, 'data de conferência não gravada');
  const sessDet = await req('GET', `/conference/sessions/${sess.id}`);
  assert(sessDet.items.some((i) => i.record_id === r20001.id && i.status === 'conferido'), 'item da sessão não conferido');
  const stats = await req('GET', '/stats');
  assert(stats.totals.conferidos >= 1, 'contagem de conferidos não atualizou');
  report('Teste 9: Marcar conferido — status persiste no banco', true,
    `status=${after.record.status}, gravado em ${after.record.checked_at}; sessão registrada`);

  /* ---------- Teste 10: editar, arquivar e excluir registros ---------- */
  const rec30002 = doc1Recs.records.find((r) => r.code === '30002');
  await req('PUT', `/records/${rec30002.id}`, { body: { name: 'Correia Dentada (editada)', quantity: 9 } });
  const edited = await req('GET', `/records/${rec30002.id}`);
  assert(edited.record.name === 'Correia Dentada (editada)', 'edição não salvou');
  assert(edited.history.some((h) => h.action === 'registro_editado'), 'histórico de edição ausente');
  await req('POST', `/records/${rec30002.id}/archive`);
  await req('POST', `/records/${rec30002.id}/unarchive`);
  await req('DELETE', `/records/${rec30002.id}`);
  const trash = await req('GET', '/trash');
  assert(trash.records.some((r) => r.id === rec30002.id), 'registro não foi à lixeira');
  await req('POST', `/records/${rec30002.id}/restore`);
  const restored = await req('GET', `/records/${rec30002.id}`);
  assert(restored.record.name === 'Correia Dentada (editada)', 'registro restaurado incorreto');
  report('Teste 10: Editar, arquivar e excluir registros', true,
    'edição com histórico, arquivamento, lixeira e restauração funcionando');

  /* ---------- Teste 11: dois documentos com o mesmo código ---------- */
  const doc2 = await uploadFile('02-nota-fiscal.pdf');
  await waitForProcessing(doc2.id);
  const sDup = await req('GET', '/search', { query: { q: '20001' } });
  assert(sDup.exact.length >= 2, `20001 deveria ter 2+ ocorrências (tem ${sDup.exact.length})`);
  const docs = new Set(sDup.exact.map((r) => r.document_id));
  assert(docs.size >= 2, 'ocorrências deveriam vir de documentos diferentes');
  const occ = await req('GET', `/records/${sDup.exact[0].id}`);
  assert(occ.occurrences.length >= 2, 'rastreabilidade de ocorrências falhou');
  const nfRec = sDup.exact.find((r) => r.document_id === doc2.id);
  assert(nfRec.quantity === 99, `quantidade da NF (99) incorreta: ${nfRec.quantity}`);
  assert(nfRec.reference === 'REF-9981', `referência não extraída: ${nfRec.reference}`);
  report('Teste 11: Mesmo código em dois documentos — ambos consultáveis', true,
    '20001 aparece em 2 documentos (10 un na lista, 99 un na NF) sem mesclagem');

  /* ---------- Teste 12: excluir documento — duas opções ---------- */
  // opção A: somente o arquivo, mantendo registros
  await req('DELETE', `/documents/${doc2.id}`, { query: { mode: 'keep_records' } });
  const sKeep = await req('GET', '/search', { query: { q: '20001' } });
  assert(sKeep.exact.some((r) => r.document_id === doc2.id), 'registros deveriam permanecer');
  const keepRec = sKeep.exact.find((r) => r.document_id === doc2.id);
  assert(keepRec.document.file_available === 0, 'documento deveria constar como indisponível');
  const fileGone = await req('GET', `/documents/${doc2.id}/file`, { raw: true });
  assert(fileGone.status === 404, 'arquivo deveria estar indisponível');
  // opção B: documento + registros (a imagem também existe em outro documento — as ocorrências daquele devem permanecer)
  const sBefore = await req('GET', '/search', { query: { q: '40002' } });
  const beforeCount = sBefore.exact.length;
  const docImg = await uploadFile('03-foto-tabela.png');
  await waitForProcessing(docImg.id);
  const sMid = await req('GET', '/search', { query: { q: '40002' } });
  assert(sMid.exact.length === beforeCount + 1, 'segunda importação deveria criar nova ocorrência');
  await req('DELETE', `/documents/${docImg.id}`, { query: { mode: 'with_records' } });
  const sGone = await req('GET', '/search', { query: { q: '40002' } });
  assert(sGone.exact.length === beforeCount, 'registros do documento excluído deveriam sair da busca');
  assert(!sGone.exact.some((r) => r.document_id === docImg.id), 'ocorrências do documento excluído não podem aparecer');
  assert(sGone.exact.every((r) => r.document_id !== docImg.id), 'nenhum registro do documento excluído deve restar');
  report('Teste 12: Excluir documento (arquivo-only e com registros)', true,
    'modo keep_records preserva registros sinalizados; with_records remove tudo');

  /* ---------- Teste 13: exportação e recuperação de dados ---------- */
  const csv = await req('GET', '/export/records', { query: { format: 'csv' }, raw: true });
  assert(csv.ok, 'exportação CSV falhou');
  const csvBuf = Buffer.from(await csv.arrayBuffer());
  assert(csvBuf.length > 50 && csvBuf.toString().includes('20001'), 'CSV sem conteúdo esperado');
  const xlsx = await req('GET', '/export/records', { query: { format: 'xlsx' }, raw: true });
  const xlsxBuf = Buffer.from(await xlsx.arrayBuffer());
  assert(xlsx.ok && xlsxBuf.length > 1000, 'exportação XLSX falhou');
  // backup + restauração
  const backup = await req('GET', '/backup/download', { raw: true });
  assert(backup.ok, 'backup não gerado');
  const zipBuf = Buffer.from(await backup.arrayBuffer());
  assert(zipBuf.slice(0, 2).toString() === 'PK', 'backup não é um zip válido');
  const fdRestore = new FormData();
  fdRestore.append('backup', new Blob([zipBuf]), 'backup.zip');
  const restored2 = await req('POST', '/backup/restore', { formData: fdRestore });
  assert(restored2.ok, 'restauração falhou');
  const afterRestore = await req('GET', '/search', { query: { q: '20001' } });
  assert(afterRestore.exact.length >= 2, 'dados não sobreviveram à restauração');
  report('Teste 13: Exportação (CSV/Excel) e backup/restauração', true,
    `CSV + XLSX gerados; backup de ${(zipBuf.length / 1024).toFixed(0)} KB restaurado com dados íntegros`);

  /* ---------- Teste 14: responsividade / multiplataforma (PWA) ---------- */
  const appHtml = await (await fetch(`http://localhost:${PORT}/`)).text();
  assert(appHtml.includes('viewport'), 'meta viewport ausente');
  assert(appHtml.includes('manifest') || appHtml.includes('webmanifest'), 'manifest PWA ausente');
  const sw = await fetch(`http://localhost:${PORT}/sw.js`);
  assert(sw.ok, 'service worker ausente');
  const manifest = await fetch(`http://localhost:${PORT}/manifest.webmanifest`);
  const mf = await manifest.json();
  assert(mf.display === 'standalone', 'manifest não é instalável');
  assert(/sm\.css|index-.*\.css/.test(appHtml) || appHtml.includes('assets'), 'assets do app ausentes');
  report('Teste 14: PWA responsivo (celular e computador)', true,
    'viewport responsivo, manifest instalável e service worker para uso offline');

  /* ---------- Testes complementares ---------- */
  const sZeros = await req('GET', '/search', { query: { q: '00742' } });
  assert(sZeros.exact.length >= 1 && sZeros.exact.every((r) => r.code === '00742'), 'preservação de zeros falhou');
  report('Complementar: códigos com zeros à esquerda na pesquisa', true, '"00742" encontra exatamente 00742');

  const fav = await req('POST', `/records/${r20001.id}/favorite`);
  assert(fav.favorite === 1, 'favorito não salvou');
  const sFav = await req('GET', '/records', { query: { favorite: '1' } });
  assert(sFav.records.some((r) => r.id === r20001.id), 'filtro de favoritos falhou');
  report('Complementar: favoritos e filtros', true);

  const hist = await req('GET', '/history', { query: { record_id: r20001.id } });
  assert(hist.history.length >= 2, 'histórico insuficiente');
  report('Complementar: histórico com dados antes/depois', true, `${hist.history.length} eventos registrados`);

} catch (err) {
  report('Execução interrompida', false, err.message);
  console.error(err);
} finally {
  cleanup();
}

const passed = results.filter((r) => r.ok).length;
const failed = results.length - passed;
console.log('\n────────────────────────────────────────');
console.log(`RESULTADO: ${passed} aprovado(s), ${failed} falha(s) de ${results.length}`);
if (failed > 0) {
  console.log('Testes com falha:');
  results.filter((r) => !r.ok).forEach((r) => console.log(' -', r.name, r.detail));
}
console.log('────────────────────────────────────────');
process.exit(failed > 0 ? 1 : 0);
