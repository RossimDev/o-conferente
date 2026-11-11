/**
 * Camada de banco de dados — funciona em DOIS modos:
 *  - LOCAL:  SQLite em disco (better-sqlite3) — instalação própria
 *  - CLOUD:  Turso (libSQL) — quando TURSO_DATABASE_URL + TURSO_AUTH_TOKEN existem (Vercel)
 * A API é assíncrona nos dois modos para manter um único código de rotas.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH, DATA_DIR } from './config.js';

const CLOUD = !!(process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN);

let impl = null;
let schemaReady = null;

/* ------------------------------ driver local ------------------------------ */
async function localDriver() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  const cache = new Map();
  const prep = (sql) => {
    let st = cache.get(sql);
    if (!st) { st = db.prepare(sql); cache.set(sql, st); }
    return st;
  };
  return {
    cloud: false,
    db,
    one: async (sql, args) => prep(sql).get(...args),
    all: async (sql, args) => prep(sql).all(...args),
    run: async (sql, args) => {
      const r = prep(sql).run(...args);
      return { changes: r.changes, lastRowid: r.lastInsertRowid };
    },
    batch: async (list) => {
      const tx = db.transaction((stmts) => {
        const out = [];
        for (const s of stmts) out.push(prep(s.sql).run(...(s.args || [])));
        return out;
      });
      return tx(list).map((r) => ({ changes: r.changes, lastRowid: r.lastInsertRowid }));
    },
    close: () => { try { db.close(); } catch { /* ok */ } },
    checkpoint: () => { try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ok */ } }
  };
}

/* ------------------------------- driver cloud ------------------------------ */
async function cloudDriver() {
  const { createClient } = await import('@libsql/client');
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL,
    authToken: process.env.TURSO_AUTH_TOKEN
  });
  const toArgs = (args) => (args || []).map((a) => (a === undefined ? null : a));
  return {
    cloud: true,
    db: client,
    one: async (sql, args) => {
      const r = await client.execute({ sql, args: toArgs(args) });
      return r.rows[0] ? { ...r.rows[0] } : undefined;
    },
    all: async (sql, args) => {
      const r = await client.execute({ sql, args: toArgs(args) });
      return r.rows.map((row) => ({ ...row }));
    },
    run: async (sql, args) => {
      const r = await client.execute({ sql, args: toArgs(args) });
      return { changes: r.rowsAffected ?? 0, lastRowid: r.lastInsertRowid ?? 0 };
    },
    batch: async (list) => {
      const stmts = list.map((s) => ({ sql: s.sql, args: toArgs(s.args) }));
      const rs = await client.batch(stmts, 'write');
      return rs.map((r) => ({ changes: r.rowsAffected ?? 0, lastRowid: r.lastInsertRowid ?? 0 }));
    },
    close: () => { try { client.close(); } catch { /* ok */ } },
    checkpoint: () => {}
  };
}

async function getImpl() {
  if (!impl) {
    impl = CLOUD ? await cloudDriver() : await localDriver();
  }
  return impl;
}

export function isCloud() {
  return CLOUD;
}

export function dbConfigured() {
  return true; // local sempre configurado; cloud requer env vars (já verificadas em CLOUD)
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS auth_tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pendente',
  error TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  file_available INTEGER NOT NULL DEFAULT 1,
  page_count INTEGER NOT NULL DEFAULT 0,
  record_count INTEGER NOT NULL DEFAULT 0,
  low_confidence_count INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  processed_at TEXT,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS records (
  id TEXT PRIMARY KEY,
  document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  user_id INTEGER,
  code TEXT,
  name TEXT,
  description TEXT,
  reference TEXT,
  quantity REAL,
  quantity_text TEXT,
  unit TEXT,
  category TEXT,
  extra TEXT,
  page INTEGER,
  table_no INTEGER,
  row_no INTEGER,
  col_no INTEGER,
  pos_x REAL, pos_y REAL, pos_w REAL, pos_h REAL,
  page_width REAL, page_height REAL,
  snippet TEXT,
  confidence REAL NOT NULL DEFAULT 1,
  needs_review INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pendente',
  checked_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS search_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  query TEXT NOT NULL,
  results INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS conference_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  type TEXT,
  status TEXT NOT NULL DEFAULT 'aberta',
  notes TEXT,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS conference_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES conference_sessions(id) ON DELETE CASCADE,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pendente',
  checked_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(session_id, record_id)
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_id TEXT,
  document_id INTEGER,
  action TEXT NOT NULL,
  old_values TEXT,
  new_values TEXT,
  detail TEXT,
  user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS file_chunks (
  owner_key TEXT NOT NULL,
  idx INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY (owner_key, idx)
);
CREATE INDEX IF NOT EXISTS idx_records_code ON records(code);
CREATE INDEX IF NOT EXISTS idx_records_code_ci ON records(code COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_records_doc ON records(document_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_records_del ON records(deleted_at);
CREATE INDEX IF NOT EXISTS idx_records_arch ON records(archived);
CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id);
CREATE INDEX IF NOT EXISTS idx_docs_del ON documents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_hist_record ON history(record_id);
CREATE INDEX IF NOT EXISTS idx_hist_doc ON history(document_id);
CREATE INDEX IF NOT EXISTS idx_conf_item ON conference_items(session_id);
`;

async function initSchema() {
  const d = await getImpl();
  for (const stmt of SCHEMA.split(';').map((s) => s.trim()).filter(Boolean)) {
    await d.run(stmt, []);
  }
  // FTS5 (se disponível no motor) — a busca usa fallback LIKE se falhar
  try {
    await d.run(`CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
      code, name, description, reference, snippet,
      content='records', content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2')`, []);
    await d.run(`CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
      INSERT INTO records_fts(rowid, code, name, description, reference, snippet)
      VALUES (new.rowid, new.code, new.name, new.description, new.reference, new.snippet);
    END`, []);
    await d.run(`CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
      INSERT INTO records_fts(records_fts, rowid, code, name, description, reference, snippet)
      VALUES ('delete', old.rowid, old.code, old.name, old.description, old.reference, old.snippet);
    END`, []);
    await d.run(`CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
      INSERT INTO records_fts(records_fts, rowid, code, name, description, reference, snippet)
      VALUES ('delete', old.rowid, old.code, old.name, old.description, old.reference, old.snippet);
      INSERT INTO records_fts(rowid, code, name, description, reference, snippet)
      VALUES (new.rowid, new.code, new.name, new.description, new.reference, new.snippet);
    END`, []);
    await d.run(`INSERT INTO records_fts(records_fts) VALUES('rebuild')`, []);
  } catch (err) {
    console.warn('FTS5 indisponível — busca usará fallback LIKE:', err.message);
  }
  // Migração: dados por conta (records.user_id) — bancos antigos ganham a coluna
  // e os dados existentes são atribuídos ao dono do documento (ou ao 1º usuário).
  try { await d.run(`ALTER TABLE records ADD COLUMN user_id INTEGER`, []); } catch { /* coluna já existe */ }
  try {
    await d.run(`UPDATE records SET user_id = (SELECT created_by FROM documents WHERE documents.id = records.document_id) WHERE user_id IS NULL AND document_id IS NOT NULL`, []);
    await d.run(`UPDATE records SET user_id = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE user_id IS NULL`, []);
    await d.run(`UPDATE documents SET created_by = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE created_by IS NULL`, []);
    await d.run(`UPDATE conference_sessions SET created_by = (SELECT id FROM users ORDER BY id LIMIT 1) WHERE created_by IS NULL`, []);
    await d.run(`CREATE INDEX IF NOT EXISTS idx_records_user ON records(user_id)`, []);
  } catch { /* melhor esforço */ }

  const defaults = { trash_days: '30', app_title: 'O Conferente', review_low_confidence: '0.75' };
  for (const [k, v] of Object.entries(defaults)) {
    await d.run('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)', [k, v]);
  }
}

export function ensureSchema() {
  if (!schemaReady) schemaReady = initSchema();
  return schemaReady;
}

/* -------------------------------- helpers -------------------------------- */
export async function one(sql, ...args) {
  await ensureSchema();
  const d = await getImpl();
  return d.one(sql, args);
}

export async function all(sql, ...args) {
  await ensureSchema();
  const d = await getImpl();
  return d.all(sql, args);
}

export async function run(sql, ...args) {
  await ensureSchema();
  const d = await getImpl();
  return d.run(sql, args);
}

export async function batch(list) {
  await ensureSchema();
  const d = await getImpl();
  return d.batch(list);
}

export async function getSetting(key, fallback = null) {
  const row = await one('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  await run('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

export async function logHistory({ record_id = null, document_id = null, action, old_values = null, new_values = null, detail = null, user_id = null }) {
  await run(
    `INSERT INTO history (record_id, document_id, action, old_values, new_values, detail, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    record_id, document_id, action,
    old_values ? JSON.stringify(old_values) : null,
    new_values ? JSON.stringify(new_values) : null,
    detail, user_id
  );
}

/** Para rotinas internas que precisam do driver (backup etc.). */
export async function rawDriver() {
  return getImpl();
}
