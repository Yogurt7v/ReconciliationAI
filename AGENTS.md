# AGENTS.md — Reconciliation AI

## Назначение

Сверка актов сверки с контрагентами на локальной модели Ollama.
Переносимое Windows-приложение: один процесс, один порт, без Docker и `.env`.
UI на русском, все пользовательские строки — на русском.

## Команды

```
pnpm dev          backend (порт из settings.txt, по умолчанию 8080) + Vite :3000
pnpm test         vitest: shared + backend (фронтенд без тестов)
pnpm typecheck    tsc --noEmit во всех пакетах
pnpm samples      демо-пары файлов в backend/samples/
pnpm smoke        e2e прогон пайплайна на демо-парах
build-win.cmd     portable-сборка (только Windows), инкрементальная
build-win.cmd clean   та же сборка с полной очисткой dist-portable
```

Отдельный пакет: `pnpm --filter @recon/backend test`.

## Конфигурация

`settings.txt` в корне репозитория — единственный источник настроек.
`.env` и `process.env` для настроек не используются (исключение: `TESSDATA_DIR`).

- `backend/src/settings.ts` — парсер. Путь: `../../settings.txt` от модуля, что
  одинаково работает в разработке (корень репозитория) и в portable-сборке.
- `settings.example.txt` — шаблон, коммитится. `settings.txt` — git-ignored.
- Парсер **валидирует**: неизвестный ключ, мусорное число, URL без схемы и
  неизвестный уровень лога роняют старт с понятным сообщением.
- Тесты парсера: `backend/tests/settings.test.ts`.

Критично: относительные пути к `frontend/dist`, `reports` и `.tessdata` считаются
через `import.meta.url` от `backend/src/**`. Portable-раскладка обязана сохранять
эту глубину: код лежит в `dist-portable/app/src/`, а `settings.txt`,
`frontend/dist` и `runtime/` — на уровень выше.

## Пакеты

| Пакет | Точка входа | Роль |
|---|---|---|
| `@recon/shared` | `shared/src/index.ts` | Типы, константы, нормализация чисел и дат |
| `@recon/backend` | `backend/src/index.ts` | Fastify, парсеры (excel/pdf/ocr), пайплайн, экспорт отчётов |
| `@recon/frontend` | `frontend/src/main.tsx` | React SPA, раздаётся backend'ом из `frontend/dist` |

`@recon/shared` подключается через `workspace:*`. В portable-сборке его
копирует `pnpm deploy`.

## Backend

- `src/index.ts` — сборка Fastify, плагины, `/api/test/analyze`, `/api/compare`,
  `/api/health`, `/config.js`, раздача `frontend/dist` со SPA-fallback.
- `src/settings.ts` — загрузка настроек.
- `src/preflight.ts` — проверка Ollama и модели при старте, открытие браузера.
- `src/rateLimit.ts` — ограничивает **только** POST в `/api`. GET (статика,
  health, опрос статуса) не считаются: фронт опрашивает статус раз в ~1.2 с.
- `src/routes/jobs.ts` — HTTP-маршруты полного пайплайна.
- `src/jobs/` — хранилище заданий в памяти и оркестратор пайплайна.
- `src/parsers/` — excel, pdf, OCR, геометрия таблиц.
- `src/services/` — AI-клиент, правила сверки, отчёты (JSON/HTML).

Стадии пайплайна: `uploaded → parsing → structure → (awaiting_confirmation) →
extraction → reconciliation → analysis → done`, плюс `failed` / `cancelled`.

Детализация внутри стадии: `updateStage(job, stage, message, inner)` даёт
сообщение + дробный прогресс (`inner` 0..1), `updateMessage` меняет только
текст. Стадия `parsing` включает AI-вызов двухстороннего акта, `structure` —
определение структуры обеих таблиц. ETA не считается: вместо него во
фронтенд уходят сообщение и «прошло …».

`runPipeline(jobId, settings)` принимает настройки вторым аргументом — пайплайн
не читает конфиг сам.

### AI

Только локальная модель. `src/services/ai/client.ts`:

- `aiConfigFromSettings(settings)` → `{ baseUrl, model, timeoutMs }`;
- `requestJson(config, system, payload, { timeoutMs?, onProgress?, label? })` —
  единственный таймаут из `AI_TIMEOUT_SEC`, жёстких таймаутов на отдельных
  вызовах нет; ровно один повтор при сети/таймауте/5xx/429, на 4xx повтора нет;
- каждый вызов логируется с меткой и таймингом:
  `[AI] [метка] попытка 1/2, model=…, таймаут=… мс` / `ok за X с`;
- события `onProgress` превращаются `aiProgressText` в сообщение статуса
  джобы: «Структура таблицы: модель анализирует данные …»;
- `AiUnavailableError.retryable` определяет, стоит ли повторять;
- ключей API, облачных провайдеров и цепочек запасных моделей нет как класса;
- при недоступности модели вызывающий код деградирует к эвристикам, причина
  попадает в `reasoningLog`.

## Frontend

- React 19, без роутера, два режима переключаются в шапке: «Сверка»
  (полный пайплайн, `JobScreen`) и «Быстро» (`MainScreen`).
- `JobScreen`: степпер «Ход обработки» (parsing/structure/extraction/
  reconciliation/analysis), таймер «прошло …», сообщение стадии с анимацией
  смены и пульсация прогресс-бара, если прогресс не менялся ≥4 с. ETA нет.
- Рантайм-конфиг: `index.html` подключает `/config.js`, который backend отдаёт
  из `settings.txt`. Пустой `API_BASE_URL` → запросы на тот же origin.
- `apiUrl(path)` в `src/api.ts` — единственное место, где собирается базовый URL.
- Модель в UI не выбирается, только показывается (из `/api/health`).
- Линтера и форматтера нет — держимся существующего стиля.

## TypeScript

- Strict, `verbatimModuleSyntax` — для типов только `import type { X }`.
- Базовый конфиг — `tsconfig.base.json` в корне.
- `noUncheckedIndexedAccess: true`: индексация даёт `T | undefined`.
- `tsconfig.json` backend'а включает `tests`, поэтому `pnpm typecheck` покрывает
  и тесты.

## Тесты

- vitest, таймаут backend-тестов 120 с (парсинг PDF и пайплайн медленные).
- Сеть не используется: `fetch` подменяется через `vi.stubGlobal`.
- `Response` одноразовый: для сценариев с повторной попыткой нужен
  `mockImplementation`, а не `mockResolvedValue`, иначе вторая попытка получит
  уже прочитанный ответ.
- OCR-тесты опциональны: `RUN_OCR_E2E=1 pnpm --filter @recon/backend test`.
- Смоук со сканом: `RUN_SCAN_SMOKE=1 pnpm smoke`.

## Portable-сборка

`build-win.cmd` (только Windows, нужен Node 20+ и pnpm) собирает
`dist-portable/` из `pnpm deploy --prod --legacy` — папка самодостаточна,
внешних ссылок в `node_modules` нет. Папку нельзя распаковывать из zip:
в `node_modules` есть относительные ссылки нативных модулей.

Сборка инкрементальная (шаги `[1/9]…[9/9]`):

- `build-check.ps1` печатает `FRONTEND=`, `BACKEND=`, `INSTALL=` — по ним
  `build-win.cmd` пропускает `vite build`, `pnpm deploy` и `pnpm install`;
- штамп инкрементальности — `dist-portable\.build-stamp`, его mtime сравнивается
  с самыми свежими входами (`backend/src`, `shared/src`, `package.json`,
  `pnpm-lock.yaml`); при пропуске deploy `dist-portable` не очищается;
- полная очистка — `build-win.cmd clean`;
- перед копированием `frontend/dist` старая папка в portable удаляется, иначе
  остаются файлы с прежними хешами имён;
- каждый запуск удаляет мусорный `backend\dist-portable` — туда `pnpm --filter`
  роняет бинарники `.bin` (отсюда был `EPERM` на `xlsx`).

Ориентиры времени (SSD): 2.2 с без изменений, 4.1 с первая сборка, 5.4 с при
изменении backend'а или `clean`.

Внимание: cmd-оператор `if file1 newer file2` на этой машине падает
(«Недопустимо после: newer») — все сравнения дат живут в `build-check.ps1`.

## Соглашения

- Пользовательские строки — по-русски.
- CI и pre-commit хуков нет.
- `pnpm-lock.yaml` коммитится, `node_modules/` и `dist/` — в `.gitignore`.
- `.gitattributes` фиксирует LF для исходников, чтобы сборка на Windows не
  ломала shebang и diff'ы.

## Правила фронтенда

- Слои: `components/` — только рендер и пользовательское взаимодействие, без
  бизнес-логики; `hooks/` — вся переиспользуемая логика, сложные `useState`/
  `useEffect` внутри компонентов запрещены; `api.ts` — вызовы API и преобразование
  данных. Типы живут в `api.ts` и в `@recon/shared`, отдельной папки `types/` нет.
- Тип `any` запрещён. Strict-режим TypeScript обязателен, избегать `@ts-ignore`.
- Props описываются через `interface`; inline-типы запрещены.
- Компонент длиннее 80 строк разбивается.
- Имена файлов компонентов и сами компоненты — в PascalCase (как сейчас:
  `ComparisonCard.tsx`, `DropZone.tsx`).
- Если логика повторяется больше 2 раз — выносить в хук или утилиту.

## Режим обучения

После каждой реализации обязательно объяснять:

1. Почему выбран этот подход, а не альтернативные.
2. В чём trade-off этого решения.
3. Что легче всего расширить или изменить при изменении требований.
