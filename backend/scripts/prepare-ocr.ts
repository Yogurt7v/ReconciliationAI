/**
 * Предзагрузка traineddata для OCR (rus+eng), чтобы первый запрос со сканом
 * не ждал скачивания. Данные кладутся в backend/.tessdata (переопределяется
 * переменной TESSDATA_DIR).
 *
 * Запуск: pnpm prepare-ocr  (из корня — pnpm --filter @recon/backend prepare-ocr)
 */

import { warmUpOcr } from '../src/parsers/ocrPipeline.js';

const { dir, files } = await warmUpOcr();

if (files.length === 0) {
  console.error('Не удалось загрузить traineddata в', dir);
  process.exit(1);
}

console.log(`Tessdata готова: ${dir}`);
for (const file of files) console.log(`  - ${file}`);
