/**
 * Semeia a instância principal com um administrador e os documentos de demonstração.
 * Uso: node tools/seed.js  (com o servidor rodando em http://localhost:3001)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOCS = path.join(__dirname, '..', 'tests', 'docs');
const BASE = process.env.OC_BASE || 'http://localhost:3001/api';

let token = null;
async function req(method, p, { body, formData, query } = {}) {
  let url = BASE + p;
  if (query) url += '?' + new URLSearchParams(query);
  const h = {};
  if (token) h.Authorization = `Bearer ${token}`;
  if (body) h['Content-Type'] = 'application/json';
  const res = await fetch(url, { method, headers: h, body: formData || (body ? JSON.stringify(body) : undefined) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const health = await req('GET', '/health');
if (health.needs_setup) {
  const r = await req('POST', '/auth/setup', { body: { username: 'admin', password: 'admin123', name: 'Administrador' } });
  token = r.token;
  console.log('✅ Usuário administrador criado: admin / admin123');
} else {
  const r = await req('POST', '/auth/login', { body: { username: 'admin', password: 'admin123' } });
  token = r.token;
  console.log('✅ Login realizado como admin');
}

if (!fs.existsSync(DOCS)) {
  console.log('⚠ Documentos de demonstração não encontrados. Execute: node tools/make-test-docs.js');
  process.exit(0);
}

for (const file of fs.readdirSync(DOCS)) {
  const fd = new FormData();
  fd.append('files', new Blob([fs.readFileSync(path.join(DOCS, file))]), file);
  const r = await req('POST', '/documents/upload', { formData: fd });
  console.log(`📄 Importado: ${file} (id ${r.documents[0].id})`);
}

// aguarda processamento
for (let i = 0; i < 60; i++) {
  const d = await req('GET', '/documents');
  const pending = d.documents.filter((x) => ['pendente', 'processando'].includes(x.status));
  if (pending.length === 0) break;
  await new Promise((r) => setTimeout(r, 1000));
}
const stats = await req('GET', '/stats');
console.log('✅ Semente concluída:', stats.totals);
