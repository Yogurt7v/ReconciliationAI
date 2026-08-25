<!-- stm:v1 -->
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- …

### Long Horizon Context
- …

### Decisions
- …

### Conclusions
- …

### Active References
- …

<existing_memory>
## Session Memory

### User Instructions
- None captured yet.

### Long Horizon Context
- None captured yet.

### Decisions
- None captured yet.

### Conclusions
- None captured yet.

### Active References
- None captured yet.

</existing_memory>

<conversation_update>
USER:
План полностью верифицирован по коду проекта (все файлы исследованы в предыдущих шагах). Итоговый документ:
📋 План реализации Reconciliation AI Agent
✅ Завершено — к этим пунктам не возвращаемся
Блок	Что готово
Каркас монорепо	pnpm workspaces (shared/backend/frontend), tsconfig.base, .gitignore, .env.example (OPENROUTER_API_KEY/MODEL, PORT=5000), зависимости установлены (fastify 5, multipart, cors, xlsx, exceljs, pdfjs-dist, tesseract.js, sharp, @napi-rs/canvas, pdfkit, decimal.js)
shared — типы	Полный API-контракт: Grid/RawSource, ColumnMapping (+confidence/source/reasoning), PreviewTable, ColumnStats, ParsedRow/ParsedSide; отчёт целиком: ReconciliationReport, SummaryCounts, OnlyItem, AmountMismatchItem (difference+direction), DateMismatchItem, BalanceCheck, FinalBalance, Hypothesis, ReasoningStep; джобы: JobStage, JobStatus, PendingConfirmation, ConfirmPayload
shared — нормализация	parseMoney → десятичные строки "1234.56" (скобки/минус в конце/₽/$/«руб.», RU+EN разделители); parseDate → ISO (русские месяцы «5 марта 2026», Excel serial, короткие годы); normalizeDocNumber (тире/№/пробелы); formatMoney; константы: confidence 0.72, 50 МБ, MAX_DATA_ROWS 5000, OCR-порог 120 симв.; тесты
backend — Excel-парсер	SheetJS: merged cells (мастер→slave протягивание значения), trim пустых краёв, выбор листа по заполненности ячеек
backend — эвристики структуры	Поиск шапки по бухгалтерскому словарю заголовков (№, Дата, Сумма, Дебет, Кредит…), статистика колонок (fill/numeric/dateLike/samples), маппинг полей с русскими объяснениями, confidence с понижением при пропуске обязательных полей, buildPreview для экрана уточнения
backend — извлечение строк	applyMapping: fallback Дебет/Кредит (+assumptions → логика AI), поиск «Сальдо на начало/конец», обороты дебет/кредит, пропуск итоговых строк со счётчиком rowsSkipped, лимит MAX_DATA_ROWS
backend — движок сверки	Детерминированный без AI: группировка по нормализованному номеру, каждый экземпляр дубля — отдельная позиция, пары по порядку дат→строк, все 3 типа расхождений ТЗ, направление долга they_owe/we_owe, строгое Decimal-равенство до копейки
backend — тесты ядра	11 тестов вкл. перфоманс 1000×1000 < 3 c
frontend — конфиги	React 19 + Vite, порт 3000, прокси /api → localhost:5000
⬜ ОСТАЛОСЬ — продолжаем отсюда
Этап A. Backend (строго последовательно)
- A1. PDF-парсер — src/parsers/pdfParser.ts: pdfjs-dist → текстовые items с координатами → кластеризация строк по Y → сортировка по X → Grid; подсчёт символов/страницу, <120 (OCR_MIN_CHARS_PER_PAGE) → флаг скана (needsOcr)
- A2. OCR-конвейер — src/parsers/ocrPipeline.ts: рендер PDF-страницы → canvas (@napi-rs/canvas) → PNG → sharp предобработка (grayscale/contrast) → tesseract.js rus+eng со bbox слов → восстановление сетки таблицы; {kind:'pdf-ocr'}
- A3. AI-сервис OpenRouter — src/services/ai/: client.ts (fetch, JSON mode, таймаут, retry×1), structureAssist.ts (первые 30 строк сетки → {columns, confidence, reasoning[]}, слияние с эвристикой, source=ai+heuristic), hypotheses.ts (гипотезы по контексту расхождений на русском); деградированный режим без ключа/при ошибке → эвристики + правила, фиксация деградации в reasoning
- A4. Сборка отчёта — src/services/reportBuilder.ts: summary counts, totals (onlyOursSum/onlyPartnerSum/mismatchSum), balanceChecks (сальдо нач./кон., обороты: match/mismatch/missing), период min/max дат, finalBalance = Σ difference + направление + текстовое объяснение, гипотезы (шаблонные правила ∪ AI), aiLogic-таймлайн ReasoningStep[]
- A5. Экспорт отчёта — src/services/export/: htmlReport.ts (самодостаточный HTML, print CSS A4, цветовые секции), xlsxReport.ts (exceljs, листы Сводка/Расхождения/Only), pdfReport.ts (pdfkit + обязательный TTF-шрифт с кириллицей)
- A6. Джобы/оркестрация — src/jobs/store.ts (in-memory Map<id,Job>) + pipeline.ts: upload→parsing(∥ обе стороны)→structure(AI+эвристика)→awaiting_confirmation?→extraction→reconciliation→analysis→done; прогресс по весам стадий, ETA от размера файла, отмена флагом между стадиями, накопление reasoningLog
- A7. HTTP API — ⚠️ нет даже src/index.ts. Fastify+cors+multipart+dotenv: POST /api/upload (поля ours/partner, валидация .xlsx/.xls/.pdf и размера) → {id} • GET /api/jobs/:id/status • POST /api/jobs/:id/mapping ← ConfirmPayload • GET /api/jobs/:id/report[?format=html|xlsx|pdf] • POST /api/jobs/:id/cancel
- A8. Скрипты — scripts/generate-samples.ts (генератор пар xlsx/PDF: идеал, расхождения сумм/дат, отсутствия; опц. скан-PDF через рендер в изображение) + добавить script smoke в backend/package.json (root его уже вызывает — сейчас упадёт) + e2e smoke прогон пайплайна на примерах
Этап B. Frontend (исходников нет совсем)
- B1. Каркас — index.html, main.tsx, App.tsx (переключение экранов по JobStage), базовая CSS-тема
- B2. Экран загрузки — 2 drop-зоны «Ваш файл»/«Файл контрагента», drag-and-drop + кнопка выбора, имена файлов, валидация, кнопка «Начать сверку»
- B3. Экран обработки — polling /status ~1 c, шаги прогресса с русскими названиями стадий, ETA, кнопка отмены, авто-переходы
- B4. Уточнение структуры — превью таблицы с буквами колонок, селекты для 5 полей + выбор строки шапки, бейдж уверенности AI, блок «Объяснение» (reasoning), «Подтвердить и продолжить»
- B5. Экран отчёта — карточки сводки, цветные секции расхождений (только у нас / только у контрагента / суммы с должником / даты / сальдо), итоговый баланс крупно, гипотезы, скачивания HTML/PDF/XLSX, «Новая сверка»
- B6. «Логика AI» — вертикальный таймлайн ReasoningStep (стадия→заголовок→деталь→confidence)
- B7. API-клиент — типизированный fetch поверх shared-типов, обработка ошибок
Этап C. Финал
- C1. Верификация — typecheck + тесты всех пакетов, генерация samples, smoke e2e, ручной прогон pnpm dev end-to-end
- C2. README + деплой — запуск, .env, архитектура, Human-in-the-Loop; Render backend + Vercel frontend, CORS origin
Порядок выполнения: A1→A8 (после каждого пункта typecheck/тесты пакета) → B1→B7 → C.

---

ASSISTANT:
Начинаю с A1. Сначала освежу структуру проекта и ключевые файлы, чтобы писать в едином стиле.
</conversation_update>

</existing_memory>

<conversation_update>
USER:
продолжай

---

ASSISTANT:
Продолжаю с места остановки: проверил окружение, теперь пишу A1 (PDF-парсер). Сначала маленькое дополнение в shared-типы — флаг `needsOcr` из плана:

---

ASSISTANT:
Теперь сам парсер `backend/src/parsers/pdfParser.ts`:

---

ASSISTANT:
Уберу мусор, который оставил в коде (необъявленная переменная цикла и лишние артефакты):

---

ASSISTANT:
Теперь тест для парсера — генерируем PDF через pdfkit и проверяем восстановление сетки, мультистраничность и флаг скана:

---

ASSISTANT:
Репозиторий ещё без коммитов. Правлю обе ошибки — в парсере и существующую в shared/normalization.ts:

---

ASSISTANT:
Причина провала ясна: в тестовых PDF слишком мало текста — парсер корректно помечает их как скан (`<120` символов). Делаю тестовые таблицы объёмнее:

---

ASSISTANT:
Отладим: сброшу реальную сетку из парсера для тестового PDF.

---

ASSISTANT:
Нашёл баг: я сплющивал все строки страницы в один массив сегментов, и страница превращалась в одну строку сетки. Исправляю структуру на «страница → строки»:

---

ASSISTANT:
Парсер работает верно — ошибка была в ожиданиях теста: вторая страница начинается с повторной шапки (`No`). Правлю ассерты:

---

ASSISTANT:
A1 готов (15/15 тестов зелёные). Перехожу к A2. Сначала вынесу общую геометрию таблиц в отдельный модуль, чтобы текстовый парсер и OCR восстанавливали сетку одинаково:

---

ASSISTANT:
Теперь подключаю этот модуль в pdfParser вместо локальных реализаций:

---

ASSISTANT:
Теперь сам OCR-конвейер. Проверю API tesseract.js v6 (как достать bbox слов) и экспортирую `loadPdfjs` из парсера для переиспользования:

---

ASSISTANT:
API ясен: слова достаю через `blocks → paragraphs → lines → words`. Экспортирую загрузчик pdf.js и пишу OCR-конвейер:

---

ASSISTANT:
Рефакторинг зелёный. Пишу OCR-конвейер:

---

ASSISTANT:
Тест на восстановление сетки из слов (чистая функция, без сети):

---

ASSISTANT:
Ожидание в тесте неверное — на второй странице одна строка, всего строк 3:

---

ASSISTANT:
A2 готов. Перехожу к A3 (AI-сервис). Проверю `.env.example`:

---

ASSISTANT:
A3. Пишу клиент OpenRouter с JSON-режимом, таймаутом и одним retry:

---

ASSISTANT:
Теперь `structureAssist.ts` — AI-помощник определения структуры со слиянием эвристик и деградацией:

---

ASSISTANT:
Теперь `hypotheses.ts` — шаблонные правила + AI-гипотезы:

---

ASSISTANT:
Тесты для AI-сервиса — с заглушкой `fetch` через `vi.stubGlobal`:

---

ASSISTANT:
Логика retry опирается на текст detail — ненадёжно. Добавляю статус в ошибку:

---
