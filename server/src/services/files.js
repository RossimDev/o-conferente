import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DOCS_DIR, TRASH_DIR, TMP_DIR, STORAGE_DIR } from '../config.js';

for (const d of [DOCS_DIR, TRASH_DIR, TMP_DIR]) fs.mkdirSync(d, { recursive: true });

export function nextDocSeq() {
  // número sequencial de importação, monotônico
  const file = path.join(STORAGE_DIR, 'seq.txt');
  let n = 0;
  try { n = parseInt(fs.readFileSync(file, 'utf8').trim(), 10) || 0; } catch { /* primeiro uso */ }
  n += 1;
  fs.writeFileSync(file, String(n));
  return n;
}

export function storeOriginal(tmpPath, originalName) {
  const seq = nextDocSeq();
  const ext = path.extname(originalName).toLowerCase() || '.bin';
  const storedName = `doc${String(seq).padStart(6, '0')}-${crypto.randomUUID()}${ext}`;
  const dest = path.join(DOCS_DIR, storedName);
  fs.renameSync(tmpPath, dest);
  return { seq, stored_name: storedName, size: fs.statSync(dest).size };
}

export function docPath(storedName) {
  return path.join(DOCS_DIR, storedName);
}

export function fileExists(storedName) {
  try { return fs.existsSync(docPath(storedName)); } catch { return false; }
}

export function readDocBuffer(storedName) {
  return fs.readFileSync(docPath(storedName));
}

export function moveToTrash(storedName) {
  const src = docPath(storedName);
  const dest = path.join(TRASH_DIR, storedName);
  if (fs.existsSync(src)) fs.renameSync(src, dest);
  return dest;
}

export function restoreFromTrash(storedName) {
  const src = path.join(TRASH_DIR, storedName);
  const dest = docPath(storedName);
  if (fs.existsSync(src)) fs.renameSync(src, dest);
  return dest;
}

export function deleteOriginal(storedName) {
  for (const p of [docPath(storedName), path.join(TRASH_DIR, storedName)]) {
    try { if (fs.existsSync(p)) fs.unlinkSync(p); } catch { /* ignora */ }
  }
}

export function purgeOldTrash(days) {
  const cutoff = Date.now() - days * 86400000;
  let purged = 0;
  for (const f of fs.readdirSync(TRASH_DIR)) {
    const p = path.join(TRASH_DIR, f);
    try {
      if (fs.statSync(p).mtimeMs < cutoff) { fs.unlinkSync(p); purged++; }
    } catch { /* ignora */ }
  }
  return purged;
}

export function safeFileName(name) {
  return String(name || 'arquivo').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 180);
}
