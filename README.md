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

pnpm dev        # backend :5057 + frontend :3000 (Vite проксирует /api)
```

Открыть http://localhost:3000, загрузить два файла.

> Порт backend = **5057** (порт 5000 на macOS занят AirPlay Receiver по умолчанию).
> Если AirPlay отключён, можно переопределить: `PORT=5000 pnpm dev`.

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

## Запуск в Docker (локальная модель через Ollama)

### Вариант B — всё в одном контейнере (профиль `with-ollama`)

Docker сам поднимет контейнер Ollama; скачивать и устанавливать Ollama на хост не нужно.

```bash
# 1. Конфигурация
cp .env.example .env
#   В .env установите:
#     AI_PROVIDER=ollama
#     OLLAMA_BASE_URL=http://ollama:11434
#     OLLAMA_MODEL=qwen2.5:7b-instruct

# 2. Сборка и запуск всех сервисов (backend + frontend + ollama)
docker compose --profile with-ollama up -d --build

# 3. ОБЯЗАТЕЛЬНО: скачать модель внутрь контейнера (один раз, хранится в volume ollama-data)
docker compose exec ollama ollama pull qwen2.5:7b-instruct

# 4. Проверить, что Ollama видит модель
docker compose exec ollama ollama list

# 5. Открыть приложение
open http://localhost:5173        # macOS
xdg-open http://localhost:5173    # Linux
```

Полезные команды:

```bash
docker compose logs -f backend          # логи распознавания (видно выбор модели/fallback)
docker compose down                     # остановить
docker compose --profile with-ollama up -d   # запустить снова (модель останется в volume)
docker volume rm recon_ollama-data      # удалить скачанные модели (если надо освободить место)
```

Требования к железу: ~5 ГБ RAM на модель 7B (CPU), ~6 ГБ VRAM при NVIDIA GPU.
Без GPUcompose всё равно заработает на CPU, но медленнее. При недоступности выбранной модели
backend автоматически переключится на fallback (`OLLAMA_FALLBACK_MODELS`).

### Вариант A — Ollama уже стоит на хосте

```bash
# В .env: AI_PROVIDER=ollama, OLLAMA_BASE_URL=http://host.docker.internal:11434
docker compose up -d --build backend frontend
```

### Вариант C — самодостаточный all-in-one образ (`Dockerfile.allinone`)

Один Docker-образ содержит ВСЁ: Ollama + запечённую модель + backend + frontend.
Секретов в образе нет (режим `REQUIRE_LOCAL_ONLY=true` не использует API-ключи),
поэтому `.env` для запуска **не нужен** — достаточно Dockerfile и одной команды.
Образ можно перенести на другую машину офлайн (`docker save` / `docker load`).

```bash
# 1. Сборка (нужны интернет и ~20 ГБ свободного диска; модель ~4.7 ГБ)
docker build -f Dockerfile.allinone -t recon-ai:local .
#   или через compose:
docker compose --profile allinone up -d --build

# 2. Запуск
docker run -d -p 5173:5173 -p 5057:5057 --name recon-ai recon-ai:local

# 3. Приложение доступно БЕЗ интернета и без ollama pull:
open http://localhost:5173        # macOS
xdg-open http://localhost:5173    # Linux
```

Перенос на более мощную машину (офлайн, без реестра):

```bash
# На сборочной машине:
docker save recon-ai:local | gzip > recon-ai-local.tar.gz   # ~4-6 ГБ
# Перенесите архив (scp/флешка) и на целевой машине:
gunzip -c recon-ai-local.tar.gz | docker load
docker run -d -p 5173:5173 --name recon-ai recon-ai:local
```

GPU на целевой машине (без пересборки образа):

```bash
# Требуется NVIDIA Driver + NVIDIA Container Toolkit на хосте:
docker run -d --gpus=all -p 5173:5173 --name recon-ai recon-ai:local
```

Важно:
- Архитектура CPU: образ собирается под архитектуру хоста (`linux/amd64` или `arm64`).
  Для переноса между разными архитектурами используйте multi-arch сборку:
  `docker buildx build --platform linux/amd64,linux/arm64 -f Dockerfile.allinone -t user/recon-ai:local --push .`
- Смена модели: отредактируйте `OLLAMA_MODEL` и строку `ollama pull` в `Dockerfile.allinone`,
  пересоберите образ.
- Логи процессов внутри контейнера: `docker exec recon-ai cat /var/log/backend.log`
  (или `/var/log/ollama.log`, `/var/log/frontend.log`).
