/**
 * Baixa os dados de idioma do OCR (Tesseract) para server/tessdata/.
 * Uso: npm run download:ocr
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'server', 'tessdata');
fs.mkdirSync(OUT, { recursive: true });

const files = ['eng.traineddata.gz', 'por.traineddata.gz', 'osd.traineddata.gz'];
const mirrors = [
  (f) => `https://github.com/naptha/tessdata/raw/gh-pages/4.0.0/${f}`,
  (f) => `https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0/${f}`
];

let failed = false;
for (const f of files) {
  const dest = path.join(OUT, f);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) {
    console.log('✓', f, '(já baixado)');
    continue;
  }
  let ok = false;
  for (const url of mirrors) {
    try {
      console.log('Baixando', f, 'de', url(f).split('/').slice(0, 3).join('/'), '…');
      const res = await fetch(url(f));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
      ok = true;
      break;
    } catch (e) {
      console.log('  espelho falhou:', e.message);
    }
  }
  if (ok) console.log('✓', f);
  else {
    console.error('❌ Não foi possível baixar', f);
    console.error('   Baixe manualmente e coloque em server/tessdata/');
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('\n✅ Dados do OCR prontos em server/tessdata/');
