import { structuredParse } from './structuredParse';
import { generateReport } from './reportGenerator';

interface CompareOptions {
  apiKey?: string;
  model?: string;
}

export async function compareDocuments(files: Express.Multer.File[], options: CompareOptions = {}) {
  if (files.length !== 2) {
    throw new Error('Для сравнения требуется ровно 2 файла');
  }

  console.log('🔄 Запуск сравнения документов...');

  // Парсим оба документа
  const result1 = await structuredParse([files[0]], options);
  const result2 = await structuredParse([files[1]], options);

  const data1 = result1.extractedData;
  const data2 = result2.extractedData;

  const matches: any[] = [];
  const discrepancies: any[] = [];

  // Простая логика сравнения по номеру документа
  const map1 = new Map(data1.map((r: any) => [r.docNumber, r]));
  const map2 = new Map(data2.map((r: any) => [r.docNumber, r]));

  // Поиск совпадений и расхождений
  for (const [docNumber, row1] of map1.entries()) {
    const row2 = map2.get(docNumber);

    if (!row2) {
      discrepancies.push({
        type: 'missing_in_second',
        docNumber,
        data: row1
      });
      continue;
    }

    // Сравнение сумм (с допуском)
    const sum1 = parseFloat(String(row1.amount).replace(',', '.'));
    const sum2 = parseFloat(String(row2.amount).replace(',', '.'));

    if (Math.abs(sum1 - sum2) > 0.01) {
      discrepancies.push({
        type: 'amount_mismatch',
        docNumber,
        amount1: sum1,
        amount2: sum2,
        diff: sum1 - sum2
      });
    } else {
      matches.push({
        docNumber,
        amount: sum1
      });
    }
  }

  // Поиск документов, есть только во втором файле
  for (const [docNumber, row2] of map2.entries()) {
    if (!map1.has(docNumber)) {
      discrepancies.push({
        type: 'missing_in_first',
        docNumber,
        data: row2
      });
    }
  }

  return {
    matches,
    discrepancies,
    summary: `Найдено совпадений: ${matches.length}, Расхождений: ${discrepancies.length}`,
    reasoningLog: [
      ...result1.reasoningLog,
      '---',
      ...result2.reasoningLog,
      `🔍 Сравнение завершено. Обработано строк: ${data1.length} vs ${data2.length}`
    ]
  };
}
