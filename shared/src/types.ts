/**
 * Общие типы предметной области «Сверка актов».
 * Используются и backend'ом (парсинг, сверка, отчёт), и frontend'ом (отображение).
 */

/** Роль стороны сверки */
export type SideRole = 'ours' | 'partner';

/** Откуда извлечены данные */
export type SourceKind = 'excel' | 'pdf-text' | 'pdf-ocr' | 'ai-structured';

/** Значение ячейки «сырой» сетки после парсинга файла */
export type CellValue = string | number | boolean | null;

/** Двумерная сетка строк/колонок (Excel-лист или восстановленная таблица PDF/OCR) */
export type Grid = CellValue[][];

/** Результат разбора исходного файла в сырую сетку (до определения структуры) */
export interface RawSource {
  grid: Grid;
  kind: SourceKind;
  fileName: string;
  sheetName?: string | null;
  pages?: number | null;
  /** Текстового слоя слишком мало — файл похож на скан, нужен OCR */
  needsOcr?: boolean;
}

/** Поля документа, которые ищем в файле */
export type MappingFieldKey = 'docNumber' | 'docDate' | 'amount' | 'debit' | 'credit';

export const MAPPING_FIELD_LABELS: Record<MappingFieldKey, string> = {
  docNumber: 'Номер документа',
  docDate: 'Дата документа',
  amount: 'Сумма',
  debit: 'Дебет',
  credit: 'Кредит',
};

/** Обязательные для сверки поля (ТЗ) */
export const REQUIRED_FIELDS: MappingFieldKey[] = ['docNumber', 'docDate', 'amount'];

/**
 * Маппинг структуры файла: где какая колонка.
 * confidence — уверенность 0..1; source — кто определил структуру.
 */
export interface ColumnMapping {
  headerRowIndex: number;
  dataStartRowIndex: number;
  columns: Record<MappingFieldKey, number | null>;
  confidence: number;
  source: 'heuristic' | 'ai' | 'ai+heuristic' | 'user';
  /** Человекочитаемые объяснения (логика AI/эвристик) */
  reasoning: string[];
}

/** Статистика по колонке — показывается пользователю при подтверждении маппинга */
export interface ColumnStats {
  index: number;
  letter: string;
  header: string | null;
  fillRatio: number;
  numericRatio: number;
  dateLikeRatio: number;
  samples: string[];
}

/** Превью таблицы для экрана подтверждения структуры */
export interface PreviewTable {
  headers: (string | null)[];
  columnLetters: string[];
  rows: string[][];
  stats: ColumnStats[];
  totalRows: number;
}

/** Строка документа после нормализации. Суммы — десятичные строки вида "1234.56" */
export interface ParsedRow {
  rowIndex: number;
  /** Номер документа как в исходнике (для отображения) */
  docNumber: string | null;
  /** Нормализованный номер — ключ сопоставления */
  docNumberNorm: string | null;
  /** Дата в формате ISO YYYY-MM-DD или null */
  docDate: string | null;
  amount: string | null;
  debit: string | null;
  credit: string | null;
}

/** Метаданные стороны сверки */
export interface SideMeta {
  fileName: string;
  kind: SourceKind;
  sheetName: string | null;
  pages: number | null;
  rowsExtracted: number;
  rowsSkipped: number;
}

/** Полностью разобранная сторона сверки */
export interface ParsedSide {
  role: SideRole;
  meta: SideMeta;
  rows: ParsedRow[];
  openingBalance: string | null;
  closingBalance: string | null;
  turnoverDebit: string | null;
  turnoverCredit: string | null;
  /** Допущения, принятые при извлечении (попадают в логику AI и гипотезы) */
  assumptions: string[];
}

/* ---------------------------------- Отчёт --------------------------------- */

export interface SummaryCounts {
  ourTotal: number;
  partnerTotal: number;
  matched: number;
  onlyOurs: number;
  onlyPartner: number;
  amountMismatches: number;
  dateMismatches: number;
  balanceIssues: number;
}

export interface OnlyItem {
  docNumber: string | null;
  docDate: string | null;
  amount: string | null;
  sourceRowIndex: number;
}

export interface AmountMismatchItem {
  docNumber: string | null;
  docDateOurs: string | null;
  docDatePartner: string | null;
  ourAmount: string | null;
  partnerAmount: string | null;
  /** our − partner; > 0 → контрагент должен нам, < 0 → мы должны контрагенту.
   *  null — суммы не удалось разобрать хотя бы с одной стороны. */
  difference: string | null;
  direction: 'we_owe' | 'they_owe' | 'unknown';
  dateMismatch: boolean;
}

export interface DateMismatchItem {
  docNumber: string | null;
  ourDate: string | null;
  partnerDate: string | null;
  amount: string | null;
}

export interface BalanceCheck {
  key: 'openingBalance' | 'closingBalance' | 'turnoverDebit' | 'turnoverCredit';
  label: string;
  ours: string | null;
  partner: string | null;
  status: 'match' | 'mismatch' | 'missing';
}

export interface FinalBalance {
  amount: string;
  direction: 'they_owe' | 'we_owe' | 'even';
  explanation: string;
}

export interface Hypothesis {
  scope: 'general' | 'doc';
  docNumber?: string | null;
  text: string;
  recommendation: string | null;
}

export interface ReasoningStep {
  id: string;
  stage: JobStage;
  title: string;
  detail: string;
  confidence?: number;
  createdAt: string;
}

export interface ReconciliationReport {
  id: string;
  createdAt: string;
  sides: { ours: SideMeta; partner: SideMeta };
  period: { from: string | null; to: string | null };
  summary: SummaryCounts;
  onlyOurs: OnlyItem[];
  onlyPartner: OnlyItem[];
  amountMismatches: AmountMismatchItem[];
  dateMismatches: DateMismatchItem[];
  balanceChecks: BalanceCheck[];
  totals: {
    onlyOursSum: string;
    onlyPartnerSum: string;
    mismatchSum: string;
  };
  finalBalance: FinalBalance;
  hypotheses: Hypothesis[];
  aiLogic: ReasoningStep[];
}

/* ------------------------------ Задания (jobs) ---------------------------- */

export type JobStage =
  | 'uploaded'
  | 'parsing'
  | 'structure'
  | 'awaiting_confirmation'
  | 'extraction'
  | 'reconciliation'
  | 'analysis'
  | 'done'
  | 'failed'
  | 'cancelled';

/** Что пользователь должен подтвердить (Human-in-the-Loop) */
export interface PendingConfirmation {
  side: SideRole;
  reason: string;
  preview: PreviewTable;
  suggested: ColumnMapping;
}

/** Тело ответа GET /status */
export interface JobStatus {
  id: string;
  stage: JobStage;
  progress: number;
  etaSeconds: number | null;
  message: string;
  error: string | null;
  pendingConfirmation: PendingConfirmation | null;
  reportReady: boolean;
  reasoningLog: ReasoningStep[];
  files: { ours: string; partner: string };
}

/** Тело POST /mapping — скорректированный пользователем маппинг */
export interface ConfirmPayload {
  headerRowIndex: number;
  dataStartRowIndex: number;
  columns: Record<MappingFieldKey, number | null>;
}

/** Результат AI-парсинга двухстороннего акта сверки */
export interface AiStructuredResult {
  ours: ParsedSide;
  partner: ParsedSide;
  /** Оригинальный ответ AI для отладки и логирования */
  raw: unknown;
}
