# Reconciliation AI Agent

Веб-приложение для сверки актов сверки с контрагентами. Загружаются два файла
(«ваш» и «контрагента», XLSX или PDF), система автоматически определяет структуру
таблиц, сопоставляет документы по номеру, находит расхождения в суммах и датах,
проверяет сальдо и обороты, считает итоговое сальдо и формирует отчёты
(HTML / XLSX / PDF) с разделом «Логика AI».

## Возможности

- **Форматы**: XLSX (exceljs), текстовые PDF (pdf.js), сканы PDF (OCR tesseract rus+eng,
  включается автоматически, если на странице мало текста).
- **Определение структуры**: эвристики по заголовкам/типам данных + AI-ассистент
  (OpenRouter). Если уверенность ниже порога — **Human-in-the-Loop**: пользователь
  подтверждает или правит соответствие колонок.
- **Сопоставление**: нормализация номеров документов, сверка сумм (допуск 0.01),
  дат (±3 дня → «расхождение в дате»), проверка сальдо на начало/конец и оборотов.
- **Итоговое сальдо** = Σ(разниц сопоставленных пар) + «только у нас» − «только у контрагента».
- **Гипотезы о причинах расхождений**: правила + AI-обобщение.
- **Отчёты**: самодостаточный HTML (печать A4), XLSX с детальными листами,
  PDF (кириллический шрифт из системы).
- **Прозрачность**: каждый шаг пайплайна пишется в reasoning-лог («Как система
  выполняла сверку») — виден в UI и во всех экспортах.

## Структура монорепозитория

```
shared/    общие типы, константы, нормализация чисел/дат (@recon/shared)
backend/   Fastify API + парсеры + движок сверки + экспорты (@recon/backend)
frontend/  React + Vite SPA (@recon/frontend)
```

## Требования

- Node.js ≥ 20, pnpm ≥ 9

## Быстрый старт

```bash
pnpm install

# Ключ OpenRouter (для AI-функций; без него работает детерминированный режим)
cp .env.example backend/.env   # при необходимости отредактируйте

pnpm dev        # backend :5000 + frontend :3000 (Vite проксирует /api)
```

Открыть http://localhost:3000, загрузить два файла.

> На macOS порт 5000 может быть занят AirPlay Receiver. Тогда:
> `PORT=5057 pnpm dev` и `BACKEND_PORT=5057` для frontend (см. `frontend/vite.config.ts`).

### Проверка качества

```bash
pnpm test       # юнит-тесты всех слоёв
pnpm typecheck  # строгий TS во всех пакетах
pnpm samples    # генерация демо-пар файлов в backend/samples/
pnpm smoke      # e2e: прогон всего пайплайна на демо-парах (PASS/FAIL)
```

OCR-пайплайн тестируется опционально: `RUN_OCR_E2E=1 pnpm --filter @recon/backend test`
(первый запуск скачивает traineddata), скан-сценарий в smoke: `RUN_SCAN_SMOKE=1`.

## Переменные окружения (backend)

| Переменная | По умолчанию | Назначение |
|---|---|---|
| `OPENROUTER_API_KEY` | — | ключ OpenRouter; без него AI отключается (деградация) |
| `OPENROUTER_MODEL` | `openai/gpt-4o-mini` | модель для структуры/гипотез |
| `PORT` | `5000` | порт API |
| `MAX_FILE_MB` | `50` | лимит размера файла |
| `LOG_LEVEL` | `info` | уровень логов pino |
| `PDF_FONT_PATH` | авто-поиск | TTF с кириллицей для PDF-отчёта |

## API

| Метод | Путь | Описание |
|---|---|---|
| POST | `/api/upload` | multipart: поля `ours`, `partner` → `{ id }` |
| GET | `/api/jobs/:id/status` | стадия, прогресс, ETA, pendingConfirmation, reasoningLog |
| POST | `/api/jobs/:id/mapping` | подтверждение структуры `{ headerRowIndex, dataStartRowIndex, columns }` |
| GET | `/api/jobs/:id/report?format=json\|html\|xlsx\|pdf` | отчёт |
| POST | `/api/jobs/:id/cancel` | отмена на границе стадии |
| GET | `/api/health` | health-check |

Стадии задания: `uploaded → parsing → structure → (awaiting_confirmation ⇄) extraction →
reconciliation → analysis → done` (`failed`, `cancelled`).

## Деплой (бесплатные тарифы)

- **Backend** → Render Web Service: build `pnpm install && pnpm --filter @recon/backend... install`,
  start `pnpm --filter @recon/backend start`; переменные из таблицы выше;
  persistent disk не нужен (задания в памяти).
- **Frontend** → Vercel/Netlify (static): `pnpm --filter @recon/frontend build`,
  каталог `frontend/dist`. Настроить прокси `/api` на адрес backend
  (в Vercel — rewrites, в Netlify — redirects) либо задать CORS-домен бэкенда.
- В продакшене ограничьте CORS: в `backend/src/index.ts` замените `origin: true`
  на список доменов.

## Ограничения текущей версии

- Задания хранятся в памяти процесса (рестарт = потеря истории); БД не используется.
- OCR требует установки tesseract-совместимой среды только через JS (tesseract.js),
  tessdata скачивается при первом использовании.
