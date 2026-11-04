import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_DIST, TMP_DIR } from './config.js';
import { ensureSchema, one } from './db.js';
import { userCount } from './auth.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import recordRoutes from './routes/records.js';
import searchRoutes from './routes/search.js';
import conferenceRoutes from './routes/conference.js';
import miscRoutes from './routes/misc.js';

fs.mkdirSync(TMP_DIR, { recursive: true });

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', async (req, res, next) => {
  try {
    await ensureSchema();
    res.json({
      ok: true,
      app: 'O Conferente',
      version: '1.0.0',
      needs_setup: (await userCount()) === 0,
      upload_mode: process.env.TURSO_DATABASE_URL ? 'chunked' : 'multipart',
      cloud: !!process.env.TURSO_DATABASE_URL,
      time: new Date().toISOString()
    });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: 'Banco de dados não configurado',
      detail: String(err.message || err),
      hint: 'Defina TURSO_DATABASE_URL e TURSO_AUTH_TOKEN nas variáveis de ambiente do projeto.'
    });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/records', recordRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/conference', conferenceRoutes);
app.use('/api', miscRoutes);

// PWA / frontend build (produção e Vercel)
if (fs.existsSync(CLIENT_DIST)) {
  app.use(express.static(CLIENT_DIST, { maxAge: '1h', index: 'index.html' }));
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });
}

app.use((err, req, res, next) => {
  console.error('[erro]', err.message || err);
  res.status(400).json({ error: String(err.message || err) });
});

export default app;
