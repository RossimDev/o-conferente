import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { PORT, CLIENT_DIST, TMP_DIR, STORAGE_DIR } from './config.js';
import { recoverQueue } from './services/extract.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import recordRoutes from './routes/records.js';
import searchRoutes from './routes/search.js';
import conferenceRoutes from './routes/conference.js';
import miscRoutes from './routes/misc.js';
import { userCount } from './auth.js';

fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, app: 'O Conferente', version: '1.0.0', needs_setup: userCount() === 0, time: new Date().toISOString() });
});

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/conference', conferenceRoutes);
app.use('/api', miscRoutes);

// PWA / frontend build (produção)
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: 'index.html' }));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

// Tratamento de erros
app.use((err, req, res, next) => {
  console.error('[erro]', err.message || err);
  res.status(400).json({ error: String(err.message || err) });
});

// Limpeza periódica da lixeira (a cada 6h)
import('./db.js').then(({ getSetting }) => {
  import('./services/files.js').then(({ purgeOldTrash }) => {
    setInterval(() => {
      try { purgeOldTrash(Number(getSetting('trash_days', '30'))); } catch { /* ignora */ }
    }, 6 * 3600 * 1000);
  });
});

recoverQueue();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`O Conferente — servidor em http://0.0.0.0:${PORT}`);
});
