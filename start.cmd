@echo off
chcp 65001 >nul
setlocal

rem ============================================================================
rem  Запуск Reconciliation AI.
rem
rem  Всё настраивается в settings.txt рядом с этим файлом.
rem  У пользователя должен быть установлен и запущен Ollama с нужной моделью:
rem    ollama pull qwen2.5:7b-instruct
rem ============================================================================

set "HOME_DIR=%~dp0"
if "%HOME_DIR:~-1%"=="\" set "HOME_DIR=%HOME_DIR:~0,-1%"

set "NODE_EXE=%HOME_DIR%\runtime\node.exe"
if not exist "%NODE_EXE%" (
  echo  [ОШИБКА] Не найден встроенный Node: %NODE_EXE%
  echo          Папка portable-сборки повреждена или неполна.
  pause
  exit /b 1
)

if not exist "%HOME_DIR%\app\node_modules\tsx\dist\cli.mjs" (
  echo  [ОШИБКА] Не найден tsx в app\node_modules
  echo          Папка portable-сборки повреждена: скопируйте её целиком,
  echo          вместе со всей папкой app.
  pause
  exit /b 1
)

rem Каталог app обязателен: от него считаются logs\ и reports\ в settings.txt
cd /d "%HOME_DIR%\app"

"%NODE_EXE%" "node_modules\tsx\dist\cli.mjs" "src\index.ts"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo  Приложение завершилось с кодом %EXIT_CODE%.
  echo  Подробности - в settings.txt, ключ LOG_FILE ^(например logs\app.log^).
  pause
)

exit /b %EXIT_CODE%
