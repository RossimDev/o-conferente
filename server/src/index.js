import app from './app.js';
import { PORT } from './config.js';
import { ensureSchema, getSetting } from './db.js';
import { recoverQueue } from './services/extract.js';
import { purgeOldTrash } from './services/files.js';

await ensureSchema();
recoverQueue();

// Limpeza periódica da lixeira (a cada 6h)
setInterval(() => {
  Promise.resolve()
    .then(() => getSetting('trash_days', '30'))
    .then((days) => purgeOldTrash(Number(days)))
    .catch(() => {});
}, 6 * 3600 * 1000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`O Conferente — servidor em http://0.0.0.0:${PORT}`);
});
