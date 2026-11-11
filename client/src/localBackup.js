/**
 * Cópia local automática da conta e dos dados.
 *
 * O banco do servidor pode ser recriado (reinício da hospedagem), mas o que o
 * usuário fez fica salvo aqui, neste dispositivo (IndexedDB), e é restaurado
 * automaticamente na próxima visita — sem cadastro em serviços externos.
 */

const DB_NAME = 'oc-local';
const STORE = 'kv';
const BACKUP_KEY = 'backup_zip';
const USER_KEY = 'backup_username';
const SAVED_AT_KEY = 'backup_saved_at';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(key) {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function authHeaders() {
  const t = localStorage.getItem('oc_token');
  return t ? { Authorization: `Bearer ${t}` } : {};
}

/** Guarda neste dispositivo um backup completo (dados + arquivos originais). */
export async function saveLocalBackup() {
  const token = localStorage.getItem('oc_token');
  if (!token) return false;

  let username = null;
  try {
    const me = await fetch('/api/auth/me', { headers: authHeaders() });
    if (me.ok) username = (await me.json()).user?.username || null;
  } catch { /* segue sem o nome */ }

  const res = await fetch('/api/backup/download', { headers: authHeaders() });
  if (!res.ok) return false;
  const zip = await res.blob();
  if (zip.size === 0) return false;

  await idbSet(BACKUP_KEY, zip);
  if (username) await idbSet(USER_KEY, username);
  await idbSet(SAVED_AT_KEY, new Date().toISOString());
  return true;
}

/** Dispara o salvamento automático (com atraso, para agrupar mudanças seguidas). */
let backupTimer = null;
export function scheduleLocalBackup(delayMs = 6000) {
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => { saveLocalBackup().catch(() => { /* melhor esforço */ }); }, delayMs);
}

/** Cópia salva neste dispositivo, se existir. */
export async function loadLocalBackup() {
  const zip = await idbGet(BACKUP_KEY);
  if (!zip) return null;
  return {
    zip,
    username: await idbGet(USER_KEY),
    savedAt: await idbGet(SAVED_AT_KEY)
  };
}

export async function getSavedUsername() {
  return idbGet(USER_KEY);
}

/**
 * Restaura a conta e os dados salvos no servidor (permitido apenas quando o
 * banco está vazio, ou com login ativo).
 */
export async function restoreFromLocal() {
  const saved = await loadLocalBackup();
  if (!saved) return false;
  const fd = new FormData();
  fd.append('backup', saved.zip, 'backup-local.zip');
  const res = await fetch('/api/backup/restore', { method: 'POST', headers: authHeaders(), body: fd });
  if (!res.ok) {
    let msg = 'Falha ao restaurar a conta salva.';
    try { const j = await res.json(); if (j.error) msg = j.error; } catch { /* corpo vazio */ }
    throw new Error(msg);
  }
  return true;
}

/** Remove a cópia deste dispositivo. */
export async function clearLocalBackup() {
  clearTimeout(backupTimer);
  await idbDel(BACKUP_KEY);
  await idbDel(USER_KEY);
  await idbDel(SAVED_AT_KEY);
}
