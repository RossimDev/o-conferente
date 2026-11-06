import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, '..', '..');
export const SERVER_DIR = path.join(ROOT, 'server');

// Em ambiente serverless (Vercel) o sistema de arquivos é somente leitura
// exceto /tmp — todo caminho gravável é redirecionado para lá.
const IS_VERCEL = !!process.env.VERCEL;
const TMP_BASE = process.env.OC_TMP_DIR || (IS_VERCEL ? '/tmp/oc' : path.join(SERVER_DIR, 'storage', 'tmp'));

export const DATA_DIR = process.env.OC_DATA_DIR || (IS_VERCEL ? path.join('/tmp/oc', 'data') : path.join(SERVER_DIR, 'data'));
export const STORAGE_DIR = process.env.OC_STORAGE_DIR || (IS_VERCEL ? path.join('/tmp/oc', 'storage') : path.join(SERVER_DIR, 'storage'));
export const DOCS_DIR = path.join(STORAGE_DIR, 'documents');
export const TRASH_DIR = path.join(STORAGE_DIR, 'trash');
export const TMP_DIR = TMP_BASE;
export const TESSDATA_DIR = process.env.OC_TESSDATA_DIR || path.join(SERVER_DIR, 'tessdata');
export const DB_PATH = process.env.OC_DB_PATH || path.join(DATA_DIR, 'conferente.db');
export const CLIENT_DIST = path.join(ROOT, 'client', 'dist');

export const PORT = Number(process.env.PORT || 3001);
export const TOKEN_TTL_DAYS = 30;
export const MAX_UPLOAD_MB = 200;

export const OCR_LANGUAGES = process.env.OC_OCR_LANG || 'por+eng';
