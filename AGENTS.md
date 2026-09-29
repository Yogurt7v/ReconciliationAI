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
build-win.cmd     portable-сборка (только Windows)
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

`runPipeline(jobId, settings)` принимает настройки вторым аргументом — пайплайн
не читает конфиг сам.

### AI

Только локальная модель. `src/services/ai/client.ts`:

- `aiConfigFromSettings(settings)` → `{ baseUrl, model, timeoutMs }`;
- `requestJson` — один таймаут из `AI_TIMEOUT_SEC` и ровно один повтор при
  сети/таймауте/5xx/429; на 4xx повтора нет;
- `AiUnavailableError.retryable` определяет, стоит ли повторять;
- ключей API, облачных провайдеров и цепочек запасных моделей нет как класса;
- при недоступности модели вызывающий код деградирует к эвристикам, причина
  попадает в `reasoningLog`.

## Frontend

- React 19, без роутера, два режима переключаются в шапке: «Сверка»
  (полный пайплайн, `JobScreen`) и «Быстро» (`MainScreen`).
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

## Соглашения

- Пользовательские строки — по-русски.
- CI и pre-commit хуков нет.
- `pnpm-lock.yaml` коммитится, `node_modules/` и `dist/` — в `.gitignore`.
- `.gitattributes` фиксирует LF для исходников, чтобы сборка на Windows не
  ломала shebang и diff'ы.
