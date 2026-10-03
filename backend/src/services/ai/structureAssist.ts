/**
 * AI-ассистент определения структуры таблицы.
 *
 * Стратегия:
 *  1. Всегда считаем эвристику (analyzeAndMap) — это база и запасной путь.
 *  2. Первые AI_STRUCTURE_SAMPLE_ROWS строк сетки отправляем модели:
 *     она определяет строку шапки, начало данных и колонки полей,
 *     объясняет решение по-русски.
 *  3. Сливаем: колонки модели приоритетнее, пустые значения добираем
 *     из эвристики; source='ai+heuristic'.
 *  4. Любая ошибка модели → деградация к чистой эвристике,
 *     причина фиксируется в reasoning (попадёт в «Логику AI»).
 *
 * Модель задаёт вызывающий код (`AiConfig`): локальная Ollama или удалённый
 * профиль оператора. Сбор конфига из настроек здесь больше не происходит —
 * иначе стадия structure продолжала бы работать на локальной модели, пока
 * остальные стадии пайплайна уже используют выбранную удалённую.
 *
 * Исключение из правила 4: отказ провайдера, который повтор не исправит
 * (отвергнутый ключ, нет денег, нет такой модели), деградацией **не**
 * считается — он попадает в `terminalError`, и вызывающий код роняет задание.
 * Локальная модель этим каналом не пользуется: её ошибки operator чинит сам,
 * и пайплайн продолжает считать эвристиками, как и раньше.
 */

import { AI_STRUCTURE_SAMPLE_ROWS, missingRequiredFields } from '@recon/shared';
import type { ColumnMapping, Grid, MappingFieldKey } from '@recon/shared';

import { cellToString } from '@recon/shared';
import { analyzeAndMap } from '../heuristics.js';
import { AiUnavailableError, requestJson } from './client.js';
import type { AiConfig, AiProgressCallback } from './client.js';

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

/**
 * Нелечимый отказ провайдера: ни повтор, ни деградация к эвристике его не
 * скроют. Заполняется только для удалённого провайдера (см. шапку модуля).
 */
export interface StructureTerminalError {
  /** null — провайдер вернул ошибку внутри «успешного» ответа, статуса нет */
  status: number | null;
  /** Причина от провайдера; ключ оператора обезличен в client.ts */
  message: string;
  /** Класс ошибки шлюза — по нему причина называется точно, а не по статусу */
  errorType?: string;
}

export interface StructureAssistResult {
  mapping: ColumnMapping;
  /** Была ли реально задействована модель */
  aiUsed: boolean;
  /** Отказ, который повтор не исправит (только удалённый провайдер) */
  terminalError?: StructureTerminalError;
}

/** Деградация: помечаем эвристический результат причиной */
function degrade(mapping: ColumnMapping, reason: string): ColumnMapping {
  return {
    ...mapping,
    source: 'heuristic',
    reasoning: [...mapping.reasoning, `⚠ ${reason}`],
  };
}

/** Статус в скобках; у ошибки внутри «успешного» ответа статуса нет вовсе */
function statusText(status: number | undefined): string {
  return status === undefined ? '' : ` (HTTP ${status})`;
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
 *
 * `config` — конфигурация модели конкретного запуска: локальная Ollama или
 * удалённый профиль оператора. Пайплайн передаёт сюда ровно тот же конфиг,
 * что и остальным стадиям.
 */
export async function assistStructure(
  grid: Grid,
  config: AiConfig,
  onProgress?: AiProgressCallback,
): Promise<StructureAssistResult> {
  const { analysis, mapping } = analyzeAndMap(grid);

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
      { onProgress, label: 'структура таблицы' },
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
    const missing = missingRequiredFields(columns);
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
    // Отказ, который не лечится ни повтором, ни эвристикой, деградацией **не**
    // является: пайплайн роняет задание сразу после этой стадии, и обещание
    // «используется эвристика» было бы ложью ровно там, где ключ не заработает
    // никогда. Текст шага поэтому зависит от `refusal`, а не от факта ошибки.
    //
    // Пояснение провайдера сюда намеренно не попадает: причина с кодом отказа уже
    // названа в тексте ошибки и в шаге `failed`, а повтор статуса в детали сделал
    // бы строку вида «(HTTP 403): HTTP 403».
    const refusal =
      config.provider === 'openrouter' && err instanceof AiUnavailableError && err.terminal
        ? err
        : null;
    const reason = refusal
      ? `Отказ удалённого провайдера${statusText(refusal.status)} — запуск прерывается, эвристика не подставляется.`
      : err instanceof AiUnavailableError
        ? `Сервис AI недоступен (${err.detail ?? err.message}) — используется эвристика.`
        : 'Неизвестная ошибка AI — используется эвристика.';
    const degraded: StructureAssistResult = {
      mapping: degrade(mapping, reason),
      aiUsed: false,
    };

    // Отвергнутый ключ, отсутствие денег и несуществующая модель не чинятся ни
    // повтором, ни эвристикой: молчаливый отчёт по эвристикам выглядел бы
    // успешным запуском на выбранной оператором модели. Поэтому такие ошибки
    // идут дальше по цепочке, и пайплайн роняет задание с названной причиной.
    //
    // Локальная модель сюда не попадает: её отказ оператор чинит сам, и путь
    // «посчитать эвристиками» для неё остаётся ровно прежним.
    if (refusal) {
      return {
        ...degraded,
        terminalError: {
          status: refusal.status ?? null,
          message: refusal.detail ?? refusal.message,
          errorType: refusal.errorType,
        },
      };
    }

    return degraded;
  }
}
