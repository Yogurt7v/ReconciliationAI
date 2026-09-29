@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

rem ============================================================================
rem  Сборка переносимой версии для Windows.
rem
rem  Запускать на Windows из корня репозитория, где есть node, pnpm и исходники.
rem  На выходе — папка dist-portable, которую достаточно скопировать целиком:
rem
rem    dist-portable\
rem      start.cmd          <- двойной клик для запуска
rem      settings.txt       <- единственный файл конфигурации
rem      runtime\node.exe   <- встроенный Node, ставить на машине пользователя не нужно
rem      frontend\dist\     <- собранный интерфейс (его раздаёт backend)
rem      app\               <- backend: исходники, зависимости, .tessdata, logs, reports
rem
rem  Требуется: Node.js 20+ (LTS 22) и pnpm 9+ в PATH.
rem ============================================================================

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "OUT=%ROOT%\dist-portable"
set "APP=%OUT%\app"

echo.
echo  ============================================================
echo    Reconciliation AI - сборка portable-версии (Windows)
echo  ============================================================
echo.

rem ---------------------------- 1. Окружение ----------------------------

where node >nul 2>nul
if errorlevel 1 (
  echo  [ОШИБКА] Node.js не найден. Установите Node.js 20 или новее LTS: https://nodejs.org
  goto :fail
)
for /f "delims=" %%v in ('node --version') do set "NODE_VERSION=%%v"
echo  [1/8] Node: !NODE_VERSION!

where pnpm >nul 2>nul
if errorlevel 1 (
  echo  [ОШИБКА] pnpm не найден. Установите: npm install -g pnpm
  goto :fail
)
for /f "delims=" %%v in ('pnpm --version') do set "PNPM_VERSION=%%v"
echo        pnpm: !PNPM_VERSION!

rem Путь к node.exe понадобится для runtime\node.exe
set "NODE_EXE="
for /f "delims=" %%i in ('where node') do if not defined NODE_EXE set "NODE_EXE=%%i"
if not defined NODE_EXE (
  echo  [ОШИБКА] Не удалось определить путь к node.exe
  goto :fail
)

rem ------------------------- 2. Чистая сборка --------------------------

echo  [2/8] Установка зависимостей (может занять несколько минут)...
set "CI=true"
call pnpm install --frozen-lockfile
if errorlevel 1 (
  echo        --frozen-lockfile не прошёл, пробуем обычную установку...
  call pnpm install
  if errorlevel 1 (
    echo  [ОШИБКА] pnpm install завершился с ошибкой
    goto :fail
  )
)

rem --------------------------- 3. Фронтенд -----------------------------

echo  [3/8] Сборка интерфейса...
call pnpm --filter @recon/frontend build
if errorlevel 1 (
  echo  [ОШИБКА] Сборка интерфейса не удалась
  goto :fail
)
if not exist "%ROOT%\frontend\dist\index.html" (
  echo  [ОШИБКА] frontend\dist\index.html не создан
  goto :fail
)

rem ------------------- 4. Развёртывание backend'а -----------------------
rem  pnpm deploy собирает самодостаточную папку с зависимостями: все ссылки
rem  внутри node_modules ведут в .pnpm рядом, наружу ничего не торчит.

echo  [4/8] Развёртывание backend и зависимостей...
if exist "%OUT%" rmdir /s /q "%OUT%"
call pnpm --filter @recon/backend deploy --prod --legacy "%APP%"
if errorlevel 1 (
  echo  [ОШИБКА] pnpm deploy завершился с ошибкой
  goto :fail
)

rem Хвосты от деплоя, которые пользователю не нужны
if exist "%APP%\tests" rmdir /s /q "%APP%\tests"
if exist "%APP%\samples" rmdir /s /q "%APP%\samples"
if exist "%APP%\reports" rmdir /s /q "%APP%\reports"
if exist "%APP%\vitest.config.ts" del /q "%APP%\vitest.config.ts"

rem --------------------------- 5. Файлы приложения ----------------------

echo  [5/8] Раскладка файлов...
if not exist "%APP%\logs" mkdir "%APP%\logs"
if not exist "%OUT%\frontend" mkdir "%OUT%\frontend"
xcopy /E /I /Y /Q "%ROOT%\frontend\dist" "%OUT%\frontend\dist" >nul
if errorlevel 1 (
  echo  [ОШИБКА] Не удалось скопировать frontend\dist
  goto :fail
)

rem settings.txt: если в репозитории есть свой - берём его, иначе шаблон
if exist "%ROOT%\settings.txt" (
  copy /Y "%ROOT%\settings.txt" "%OUT%\settings.txt" >nul
  echo        settings.txt: ваш рабочий файл
) else (
  copy /Y "%ROOT%\settings.example.txt" "%OUT%\settings.txt" >nul
  echo        settings.txt: создан из settings.example.txt
)

rem Краткая инструкция для пользователя portable-сборки
copy /Y "%ROOT%\README.md" "%OUT%\README.txt" >nul

rem start.cmd - launcher, double-click to run portable build
if not exist "%ROOT%\start.cmd" (
  echo  [ОШИБКА] start.cmd не найден в корне репозитория
  goto :fail
)
copy /Y "%ROOT%\start.cmd" "%OUT%\start.cmd" >nul
if errorlevel 1 (
  echo  [ОШИБКА] Не удалось скопировать start.cmd
  goto :fail
)

rem --------------------------- 6. Встроенный Node -----------------------

echo  [6/8] Встроенный Node...
if not exist "%OUT%\runtime" mkdir "%OUT%\runtime"
copy /Y "!NODE_EXE!" "%OUT%\runtime\node.exe" >nul
if errorlevel 1 (
  echo  [ОШИБКА] Не удалось скопировать node.exe в runtime\
  goto :fail
)

rem --------------------------- 7. Данные для OCR ------------------------

echo  [7/8] Данные OCR (tessdata)...
if exist "%ROOT%\backend\.tessdata" (
  xcopy /E /I /Y /Q "%ROOT%\backend\.tessdata" "%APP%\.tessdata" >nul
  echo        скопировано из backend\.tessdata
) else (
  echo        загружаем через prepare-ocr...
  call pnpm --filter @recon/backend prepare-ocr
  if exist "%ROOT%\backend\.tessdata" (
    xcopy /E /I /Y /Q "%ROOT%\backend\.tessdata" "%APP%\.tessdata" >nul
  ) else (
    echo  [ВНИМАНИЕ] traineddata не получены: OCR сканов будет недоступен
    echo             до запуска "pnpm --filter @recon/backend prepare-ocr"
  )
)

rem --------------------------- 8. Проверка ------------------------------

echo  [8/8] Проверка сборки...
set "MISSING="
if not exist "%APP%\src\index.ts" set "MISSING=!MISSING! app\src\index.ts"
if not exist "%APP%\node_modules\tsx\dist\cli.mjs" set "MISSING=!MISSING! tsx"
if not exist "%OUT%\runtime\node.exe" set "MISSING=!MISSING! runtime\node.exe"
if not exist "%OUT%\settings.txt" set "MISSING=!MISSING! settings.txt"
if not exist "%OUT%\start.cmd" set "MISSING=!MISSING! start.cmd"
if not exist "%OUT%\frontend\dist\index.html" set "MISSING=!MISSING! frontend\dist\index.html"
if defined MISSING (
  echo  [ОШИБКА] Не хватает файлов:!MISSING!
  goto :fail
)

echo.
echo  ============================================================
echo    Готово: %OUT%
echo  ============================================================
echo.
echo    Скопируйте папку dist-portable целиком на целевой компьютер
echo    и запустите start.cmd двойным кликом. Интерфейс откроется сам.
echo.
echo    Перед передачей проверьте settings.txt:
echo      APP_PORT        - порт приложения ^(по умолчанию 8080^)
echo      OLLAMA_BASE_URL - адрес Ollama
echo      OLLAMA_MODEL    - модель: скачана ли она "ollama pull ^<имя^>"
echo.
goto :end

:fail
echo.
echo  ============================================================
echo    СБОРКА НЕ ЗАВЕРШЕНА
echo  ============================================================
echo.
exit /b 1

:end
endlocal
