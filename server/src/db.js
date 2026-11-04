import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DB_PATH, DATA_DIR } from './config.js';

fs.mkdirSync(DATA_DIR, { recursive: true });

export let db = new Database(DB_PATH);

/** Substitui a conexão (usado na restauração de backup). Bindings ESM são vivas. */
export function replaceDbConnection(newDb) {
  db = newDb;
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
}

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('synchronous = NORMAL');

db.exec(`
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

CREATE VIRTUAL TABLE IF NOT EXISTS records_fts USING fts5(
  code, name, description, reference, snippet,
  content='records', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);

CREATE TRIGGER IF NOT EXISTS records_ai AFTER INSERT ON records BEGIN
  INSERT INTO records_fts(rowid, code, name, description, reference, snippet)
  VALUES (new.rowid, new.code, new.name, new.description, new.reference, new.snippet);
END;
CREATE TRIGGER IF NOT EXISTS records_ad AFTER DELETE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, code, name, description, reference, snippet)
  VALUES ('delete', old.rowid, old.code, old.name, old.description, old.reference, old.snippet);
END;
CREATE TRIGGER IF NOT EXISTS records_au AFTER UPDATE ON records BEGIN
  INSERT INTO records_fts(records_fts, rowid, code, name, description, reference, snippet)
  VALUES ('delete', old.rowid, old.code, old.name, old.description, old.reference, old.snippet);
  INSERT INTO records_fts(rowid, code, name, description, reference, snippet)
  VALUES (new.rowid, new.code, new.name, new.description, new.reference, new.snippet);
END;

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

CREATE INDEX IF NOT EXISTS idx_records_code ON records(code);
CREATE INDEX IF NOT EXISTS idx_records_code_ci ON records(code COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_records_doc ON records(document_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON records(status);
CREATE INDEX IF NOT EXISTS idx_records_del ON records(deleted_at);
CREATE INDEX IF NOT EXISTS idx_records_arch ON records(archived);
CREATE INDEX IF NOT EXISTS idx_docs_del ON documents(deleted_at);
CREATE INDEX IF NOT EXISTS idx_hist_record ON history(record_id);
CREATE INDEX IF NOT EXISTS idx_hist_doc ON history(document_id);
CREATE INDEX IF NOT EXISTS idx_conf_item ON conference_items(session_id);
`);

const DEFAULT_SETTINGS = {
  trash_days: '30',
  app_title: 'O Conferente',
  review_low_confidence: '0.75'
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

export function getSetting(key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

export function logHistory({ record_id = null, document_id = null, action, old_values = null, new_values = null, detail = null, user_id = null }) {
  db.prepare(`INSERT INTO history (record_id, document_id, action, old_values, new_values, detail, user_id)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(record_id, document_id, action,
      old_values ? JSON.stringify(old_values) : null,
      new_values ? JSON.stringify(new_values) : null,
      detail, user_id);
}
