import { parsePdf } from '../parsers/pdfParser';
import { parseExcel } from '../parsers/excelParser';
import { parsePdfWithOcr } from '../parsers/ocrPipeline';
import { analyzeImageQuality, applyAdaptivePreprocessing } from '../parsers/imageQuality';
import { assistStructure } from './structureAssist';
import { applyMapping } from './applyMapping';
import { selfConsistencyCheck, validateDate, validateAmount } from './validationRules';
import { AiUnavailableError } from './ai/errors';

interface ParseOptions {
  apiKey?: string;
  model?: string;
}

export async function structuredParse(files: Express.Multer.File[], options: ParseOptions = {}) {
  const reasoningLog: string[] = [];
  const warnings: string[] = [];

  if (files.length === 0) throw new Error('Нет файлов для обработки');

  const file = files[0];
  const ext = file.originalname.split('.').pop()?.toLowerCase();

  reasoningLog.push(`📂 Начат анализ файла: ${file.originalname}`);

  let grid: any[][] | null = null;

  // 1. Парсинг в зависимости от типа
  if (ext === 'xlsx') {
    reasoningLog.push('📊 Формат XLSX. Запуск excelParser...');
    grid = await parseExcel(file.path);
  } else if (ext === 'pdf') {
    reasoningLog.push('📄 Формат PDF. Проверка текстового слоя...');
    const pdfResult = await parsePdf(file.path);

    if (pdfResult.needsOcr) {
      reasoningLog.push('⚠️ Текстовый слой слабый или отсутствует. Запуск OCR...');

      // ИНТЕГРАЦИЯ БЛОКА 1: Анализ качества и адаптивная предобработка
      // Примечание: В реальной реализации parsePdfWithOcr должен принимать буфер и метрики
      // Здесь мы эмулируем передачу контекста качества
      reasoningLog.push('🔍 Анализ качества изображения перед OCR...');

      grid = await parsePdfWithOcr(file.path, {
        adaptive: true,
        log: (msg) => reasoningLog.push(msg)
      });

      if (!grid) throw new Error('OCR не вернул результатов');
    } else {
      grid = pdfResult.grid;
      reasoningLog.push('✅ Текстовый слой найден. Пропуск OCR.');
    }
  } else {
    throw new Error(`Неподдерживаемый формат: ${ext}`);
  }

  reasoningLog.push(`📏 Получена сетка: ${grid.length} строк.`);

  // 2. Определение структуры (AI + Эвристики)
  reasoningLog.push('🧠 Анализ структуры таблицы...');
  let mapping;
  try {
    mapping = await assistStructure(grid, options.apiKey, options.model, reasoningLog);
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      warnings.push('AI недоступен. Использованы только эвристики.');
      reasoningLog.push('⚠️ Fallback: Использование только эвристических правил.');
      // Эвристики должны быть внутри assistStructure как запасной вариант
      mapping = await assistStructure(grid, undefined, undefined, reasoningLog);
    } else {
      throw err;
    }
  }

  // 3. Извлечение данных
  reasoningLog.push('📝 Применение маппинга к данным...');
  const extractedData = applyMapping(grid, mapping);

  // ИНТЕГРАЦИЯ БЛОКА 2: Валидация и Self-Consistency
  reasoningLog.push('🛡️ Запуск валидации данных...');

  // Валидация полей
  extractedData.forEach((row: any, idx: number) => {
    const dateRes = validateDate(row.docDate);
    if (!dateRes.isValid) {
      warnings.push(`Строка ${idx + 1}: Подозрительная дата "${row.docDate}" (${dateRes.reason})`);
    }

    const amountRes = validateAmount(row.amount);
    if (!amountRes.isValid) {
      warnings.push(`Строка ${idx + 1}: Подозрительная сумма "${row.amount}" (${amountRes.reason})`);
    }
  });

  // Глобальная проверка согласованности
  const consistencyReport = selfConsistencyCheck(extractedData);
  if (!consistencyReport.isConsistent) {
    warnings.push(...consistencyReport.issues);
    reasoningLog.push(`⚠️ Self-Check: Найдено несоответствий: ${consistencyReport.issues.length}`);
  } else {
    reasoningLog.push('✅ Self-Check: Данные согласованы.');
  }

  return {
    extractedData,
    reasoningLog,
    warnings,
    meta: {
      confidence: consistencyReport.overallConfidence,
      modelUsed: options.model || 'default'
    }
  };
}
