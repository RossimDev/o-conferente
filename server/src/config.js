import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const SERVER_DIR = path.join(ROOT, 'server');
export const DATA_DIR = process.env.OC_DATA_DIR || path.join(SERVER_DIR, 'data');
export const STORAGE_DIR = process.env.OC_STORAGE_DIR || path.join(SERVER_DIR, 'storage');
export const DOCS_DIR = path.join(STORAGE_DIR, 'documents');
export const TRASH_DIR = path.join(STORAGE_DIR, 'trash');
export const TMP_DIR = path.join(STORAGE_DIR, 'tmp');
export const TESSDATA_DIR = process.env.OC_TESSDATA_DIR || path.join(SERVER_DIR, 'tessdata');
export const DB_PATH = process.env.OC_DB_PATH || path.join(DATA_DIR, 'conferente.db');
export const CLIENT_DIST = path.join(ROOT, 'client', 'dist');

export const PORT = Number(process.env.PORT || 3001);
export const TOKEN_TTL_DAYS = 30;
export const MAX_UPLOAD_MB = 200;

export const OCR_LANGUAGES = process.env.OC_OCR_LANG || 'por+eng';
