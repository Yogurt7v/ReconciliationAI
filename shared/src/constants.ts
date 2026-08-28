/** Общие константы системы */

/** Максимальный размер одного загружаемого файла, байт (50 МБ) */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

/** Разрешённые расширения файлов */
export const ALLOWED_EXTENSIONS = ['.xlsx', '.xls', '.pdf'] as const;

/**
 * Порог уверенности AI/эвристик в определении структуры.
 * Ниже порога — запрашиваем подтверждение у пользователя (Human-in-the-Loop).
 */
export const CONFIDENCE_THRESHOLD = 0.72;

/** Жёсткий лимит строк данных на сторону (защита от аномальных файлов) */
export const MAX_DATA_ROWS = 5000;

/** Если в текстовом PDF меньше символов на страницу — считаем его сканом и гоним через OCR */
export const OCR_MIN_CHARS_PER_PAGE = 120;

/** Сколько первых строк листа отправляем модели для определения структуры */
export const AI_STRUCTURE_SAMPLE_ROWS = 30;

/** Размер чанка строк скана для очистки через модель */
export const AI_OCR_CHUNK_ROWS = 60;

/** Сколько первых строк отправляем в testAnalyze (защита от превышения контекста) */
export const TEST_ANALYZE_SAMPLE_ROWS = 50;

/** Максимальное количество одновременных заданий */
export const MAX_ACTIVE_JOBS = 10;

/** TTL задания: 30 минут (safety, основная очистка — при старте нового анализа) */
export const JOB_TTL_MS = 30 * 60 * 1000;

/** Лимит запросов rate limiting */
export const RATE_LIMIT_MAX = 10;
export const RATE_LIMIT_WINDOW_MS = 60_000;
