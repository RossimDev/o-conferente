/**
 * Armazenamento de arquivos originais — dois modos:
 *  - LOCAL: disco (server/storage) — instalação própria
 *  - CLOUD: pedaços (chunks) no banco — Vercel (sistema de arquivos efêmero)
 * O arquivo original é sempre preservado byte a byte.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DOCS_DIR, TRASH_DIR, TMP_DIR, STORAGE_DIR } from '../config.js';
import { one, all, run, batch, getSetting, setSetting, isCloud } from '../db.js';

for (const d of [DOCS_DIR, TRASH_DIR, TMP_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch { /* ok */ }
}

const CHUNK = 512 * 1024; // 512 KB por pedaço no modo cloud

/* --------------------------- numeração de importação ---------------------- */
export async function nextDocSeq() {
  const cur = Number(await getSetting('doc_seq', '0')) + 1;
  await setSetting('doc_seq', String(cur));
  return cur;
}

/* ------------------------------- chunks cloud ----------------------------- */
async function putChunks(ownerKey, buffer) {
  await run('DELETE FROM file_chunks WHERE owner_key = ?', ownerKey);
  const stmts = [];
  for (let i = 0, idx = 0; i < buffer.length; i += CHUNK, idx++) {
    stmts.push({ sql: 'INSERT INTO file_chunks (owner_key, idx, data) VALUES (?, ?, ?)', args: [ownerKey, idx, buffer.subarray(i, i + CHUNK)] });
  }
  // em lotes de 40 para não estourar limites de transação
  for (let i = 0; i < stmts.length; i += 40) {
    await batch(stmts.slice(i, i + 40));
  }
}

async function getChunks(ownerKey) {
  const rows = await all('SELECT idx, data FROM file_chunks WHERE owner_key = ? ORDER BY idx', ownerKey);
  return Buffer.concat(rows.map((r) => (Buffer.isBuffer(r.data) ? r.data : Buffer.from(r.data))));
}

async function deleteChunks(ownerKey) {
  await run('DELETE FROM file_chunks WHERE owner_key = ?', ownerKey);
}

/* --------------------------------- API ---------------------------------- */
export async function storeOriginalFromBuffer(buffer, originalName) {
  const seq = await nextDocSeq();
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  const storedName = `doc${String(seq).padStart(6, '0')}-${crypto.randomUUID()}${ext}`;
  await putDocFile(storedName, buffer);
  return { seq, stored_name: storedName, size: buffer.length };
}

/** Grava o conteúdo sob um nome de armazenamento específico (restauração de backup). */
export async function putDocFile(storedName, buffer) {
  if (isCloud()) {
    await putChunks(`doc:${storedName}`, buffer);
  } else {
    fs.writeFileSync(path.join(DOCS_DIR, storedName), buffer);
  }
}

export async function storeOriginal(tmpPath, originalName) {
  const buffer = fs.readFileSync(tmpPath);
  try { fs.unlinkSync(tmpPath); } catch { /* ok */ }
  return storeOriginalFromBuffer(buffer, originalName);
}

export async function fileExists(storedName) {
  if (isCloud()) {
    const row = await one('SELECT COUNT(*) c FROM file_chunks WHERE owner_key = ?', `doc:${storedName}`);
    return row && Number(row.c) > 0;
  }
  try { return fs.existsSync(path.join(DOCS_DIR, storedName)); } catch { return false; }
}

export async function readDocBuffer(storedName) {
  if (isCloud()) return getChunks(`doc:${storedName}`);
  return fs.readFileSync(path.join(DOCS_DIR, storedName));
}

/** Upload em pedaços (modo cloud) — limita o corpo de cada requisição serverless. */
export async function createUploadSession(originalName) {
  const uploadId = crypto.randomUUID();
  await setSetting(`upload:${uploadId}:name`, originalName || 'arquivo');
  return uploadId;
}

export async function appendUploadChunk(uploadId, index, buffer) {
  await putChunks(`up:${uploadId}:${index}`, buffer);
  return true;
}

export async function completeUploadSession(uploadId) {
  const name = await getSetting(`upload:${uploadId}:name`, 'arquivo');
  const parts = await all(`SELECT owner_key FROM file_chunks WHERE owner_key LIKE ?`, `up:${uploadId}:%`);
  const idxs = parts.map((p) => Number(p.owner_key.split(':').pop())).sort((a, b) => a - b);
  const buffers = [];
  for (const i of idxs) {
    buffers.push(await getChunks(`up:${uploadId}:${i}`));
    await deleteChunks(`up:${uploadId}:${i}`);
  }
  await run('DELETE FROM settings WHERE key = ?', `upload:${uploadId}:name`);
  return storeOriginalFromBuffer(Buffer.concat(buffers), name);
}

export async function moveToTrash(storedName) {
  // marca como removido; o conteúdo permanece até a purga (recuperável)
  if (isCloud()) return;
  const src = path.join(DOCS_DIR, storedName);
  const dest = path.join(TRASH_DIR, storedName);
  if (fs.existsSync(src)) fs.renameSync(src, dest);
}

export async function restoreFromTrash(storedName) {
  if (isCloud()) return;
  const src = path.join(TRASH_DIR, storedName);
  const dest = path.join(DOCS_DIR, storedName);
  if (fs.existsSync(src)) fs.renameSync(src, dest);
}

export async function deleteOriginal(storedName) {
  if (isCloud()) {
    await deleteChunks(`doc:${storedName}`);
    return;
  }
  for (const p of [path.join(DOCS_DIR, storedName), path.join(TRASH_DIR, storedName)]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ok */ }
  }
}

export async function purgeOldTrash(days) {
  if (isCloud()) return 0;
  const cutoff = Date.now() - days * 86400000;
  let purged = 0;
  for (const f of fs.readdirSync(TRASH_DIR)) {
    const p = path.join(TRASH_DIR, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); purged++; }
    } catch { /* ok */ }
  }
  return purged;
}

export function safeFileName(name) {
  return String(name || 'arquivo').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180);
}

export function docDir() {
  return DOCS_DIR;
}
