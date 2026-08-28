/**
 * AI-ассистент определения структуры таблицы (OpenRouter).
 *
 * Стратегия:
 *  1. Всегда считаем эвристику (analyzeAndMap) — это база и запасной путь.
 *  2. Первые AI_STRUCTURE_SAMPLE_ROWS строк сетки отправляем модели:
 *     она определяет строку шапки, начало данных и колонки полей,
 *     объясняет решение по-русски.
 *  3. Сливаем: колонки модели приоритетнее, пустые значения добираем
 *     из эвристики; source='ai+heuristic'.
 *  4. Любая ошибка/отсутствие ключа → деградация к чистой эвристике,
 *     причина фиксируется в reasoning (попадёт в «Логику AI»).
 */

import { AI_STRUCTURE_SAMPLE_ROWS } from '@recon/shared';
import type { ColumnMapping, Grid, MappingFieldKey } from '@recon/shared';

import { cellToString } from '@recon/shared';
import { analyzeAndMap } from '../heuristics.js';
import { AiUnavailableError, aiConfigFromEnv, requestJson } from './client.js';

interface AiStructureResponse {
  headerRowIndex?: number;
  dataStartRowIndex?: number;
  columns?: Partial<Record<MappingFieldKey, number | null>>;
  confidence?: number;
  reasoning?: string[];
}

const SYSTEM_PROMPT = `Ты помогаешь разобрать бухгалтерскую таблицу (акт сверки / реестр документов).
Тебе дают первые строки сетки как массив массивов строк (индексация с 0).
Определи:
- headerRowIndex: индекс строки шапки таблицы (или 0, если шапки нет);
- dataStartRowIndex: индекс первой строки данных после шапки;
- columns: индексы колонок (с 0) для полей docNumber (номер документа),
  docDate (дата документа), amount (сумма), debit (дебет), credit (кредит);
  если колонки нет — null. Индексы не должны повторяться.
- confidence: уверенность 0..1;
- reasoning: 2–5 коротких объяснений на русском, почему выбраны колонки.
Отвечай строго JSON без markdown.`;

export interface StructureAssistResult {
  mapping: ColumnMapping;
  /** Была ли реально задействована модель */
  aiUsed: boolean;
}

/** Деградация: помечаем эвристический результат причиной */
function degrade(mapping: ColumnMapping, reason: string): ColumnMapping {
  return {
    ...mapping,
    source: 'heuristic',
    reasoning: [...mapping.reasoning, `⚠ ${reason}`],
  };
}

/** Валидация ответа модели; возвращает null при мусоре */
function validateAiResponse(
  raw: AiStructureResponse,
  rowCount: number,
  colCount: number,
): Required<Pick<ColumnMapping, 'headerRowIndex' | 'dataStartRowIndex' | 'columns'>> & {
  confidence: number;
  reasoning: string[];
} | null {
  const colsRaw = raw.columns ?? {};
  const keys: MappingFieldKey[] = ['docNumber', 'docDate', 'amount', 'debit', 'credit'];

  const columns: Record<MappingFieldKey, number | null> = {
    docNumber: null,
    docDate: null,
    amount: null,
    debit: null,
    credit: null,
  };
  const seen = new Set<number>();
  for (const key of keys) {
    const value = colsRaw[key];
    if (value === null || value === undefined) continue;
    if (!Number.isInteger(value) || value < 0 || value >= colCount) return null;
    if (seen.has(value)) return null;
    seen.add(value);
    columns[key] = value;
  }

  const headerRowIndex =
    typeof raw.headerRowIndex === 'number' && raw.headerRowIndex >= 0 && raw.headerRowIndex < rowCount
      ? raw.headerRowIndex
      : null;
  const dataStartRaw =
    typeof raw.dataStartRowIndex === 'number' && raw.dataStartRowIndex >= 0 && raw.dataStartRowIndex <= rowCount
      ? raw.dataStartRowIndex
      : null;
  if (headerRowIndex === null || dataStartRaw === null || dataStartRaw <= headerRowIndex) return null;

  const confidence =
    typeof raw.confidence === 'number' && raw.confidence >= 0 && raw.confidence <= 1
      ? raw.confidence
      : 0.5;

  const reasoning = Array.isArray(raw.reasoning)
    ? raw.reasoning.filter((r): r is string => typeof r === 'string').slice(0, 6)
    : [];

  return { headerRowIndex, dataStartRowIndex: dataStartRaw, columns, confidence, reasoning };
}

/**
 * Главная функция: эвристика + AI → итоговый маппинг структуры.
 */
export async function assistStructure(grid: Grid): Promise<StructureAssistResult> {
  const { analysis, mapping } = analyzeAndMap(grid);
  const config = aiConfigFromEnv();

  if (!config.apiKey) {
    return {
      mapping: degrade(mapping, 'OPENROUTER_API_KEY не задан: структура определена эвристиками.'),
      aiUsed: false,
    };
  }

  if (grid.length === 0) {
    return { mapping, aiUsed: false };
  }

  const sample = grid.slice(0, AI_STRUCTURE_SAMPLE_ROWS).map((row) => row.map(cellToString));
  const colCount = grid.reduce((m, r) => Math.max(m, r.length), 0);

  try {
    const { data: raw } = await requestJson<AiStructureResponse>(
      config,
      SYSTEM_PROMPT,
      { rowCount: Math.min(grid.length, AI_STRUCTURE_SAMPLE_ROWS), totalColumns: colCount, rows: sample },
    );

    const parsed = validateAiResponse(raw, Math.min(grid.length, AI_STRUCTURE_SAMPLE_ROWS), colCount);
    if (!parsed) {
      return {
        mapping: degrade(mapping, 'Модель вернула некорректную структуру — используется эвристика.'),
        aiUsed: true,
      };
    }

    // Слияние: колонки модели приоритетны, пробелы закрываем эвристикой
    const columns = { ...parsed.columns };
    for (const field of Object.keys(columns) as MappingFieldKey[]) {
      if (columns[field] === null && mapping.columns[field] !== null) {
        columns[field] = mapping.columns[field];
        parsed.reasoning.push(
          `Колонка для «${field}» взята из эвристики: модель не предложила варианта.`,
        );
      }
    }

    let confidence = Math.max(parsed.confidence, mapping.confidence);
    const missing = (['docNumber', 'docDate', 'amount'] as MappingFieldKey[]).filter(
      (f) => columns[f] === null,
    );
    if (missing.length > 0) {
      confidence = Math.min(confidence, 0.5);
      parsed.reasoning.push(
        `После слияния не определены обязательные поля: ${missing.join(', ')}. Требуется подтверждение.`,
      );
    }

    return {
      mapping: {
        headerRowIndex: parsed.headerRowIndex,
        dataStartRowIndex: parsed.dataStartRowIndex,
        columns,
        confidence: Math.min(confidence, 0.97),
        source: 'ai+heuristic',
        reasoning: [
          ...parsed.reasoning.map((line) => `AI: ${line}`),
          ...mapping.reasoning,
        ],
      },
      aiUsed: true,
    };
  } catch (err) {
    const reason =
      err instanceof AiUnavailableError
        ? `Сервис AI недоступен (${err.detail ?? err.message}) — используется эвристика.`
        : 'Неизвестная ошибка AI — используется эвристика.';
    return { mapping: degrade(mapping, reason), aiUsed: false };
  }
}
