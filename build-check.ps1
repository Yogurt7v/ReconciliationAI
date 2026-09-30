# Свежесть артефактов для build-win.cmd (инкрементальная сборка).
# Печатает три строки, которые парсит cmd:
#   FRONTEND=<0|1>   1 = frontend\dist актуален, vite build можно пропустить
#   BACKEND=<0|1>    1 = dist-portable\app актуален, pnpm deploy можно пропустить
#   INSTALL=<0|1>    1 = pnpm install нужен (lockfile новее node_modules)
# Примечание: оператор cmd `if file1 newer file2` здесь не работает
# («Недопустимо после: newer»), поэтому все сравнения дат — в этом скрипте.
param()

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$out = Join-Path $root 'dist-portable'
$app = Join-Path $out 'app'

function New-StampPath { param([string]$p) Join-Path $p '.build-stamp' }

function Get-Newest([string[]]$paths) {
  $newest = [datetime]::MinValue
  foreach ($p in $paths) {
    if (-not (Test-Path -LiteralPath $p)) { continue }
    $items = Get-ChildItem -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $p -PathType Leaf) { $items = @(Get-Item -LiteralPath $p) + $items }
    foreach ($i in $items) { if ($i.LastWriteTime -gt $newest) { $newest = $i.LastWriteTime } }
  }
  return $newest
}

# --- frontend ------------------------------------------------------------
$feInputs = @(
  (Join-Path $root 'frontend\src'),
  (Join-Path $root 'frontend\index.html'),
  (Join-Path $root 'frontend\vite.config.ts'),
  (Join-Path $root 'frontend\package.json')
)
$feDist = Join-Path $root 'frontend\dist\index.html'
$feAssets = Join-Path $root 'frontend\dist\assets'
$feFresh = 0
if ((Test-Path $feDist) -and (Test-Path $feAssets) -and
    (Get-Item $feDist).LastWriteTime -ge (Get-Newest $feInputs)) { $feFresh = 1 }

# --- backend -------------------------------------------------------------
$beInputs = @(
  (Join-Path $root 'backend\src'),
  (Join-Path $root 'shared\src'),
  (Join-Path $root 'backend\package.json'),
  (Join-Path $root 'shared\package.json'),
  (Join-Path $root 'pnpm-lock.yaml')
)
$stamp = New-StampPath $out
$beFresh = 0
if ((Test-Path $stamp) -and
    (Test-Path (Join-Path $app 'src\index.ts')) -and
    (Test-Path (Join-Path $app 'node_modules\tsx\dist\cli.mjs')) -and
    (Get-Item $stamp).LastWriteTime -ge (Get-Newest $beInputs)) { $beFresh = 1 }

# --- install -------------------------------------------------------------
$lock = Join-Path $root 'pnpm-lock.yaml'
$modules = Join-Path $root 'node_modules\.modules.yaml'
$needInstall = 1
if ((Test-Path $lock) -and (Test-Path $modules) -and
    (Test-Path (Join-Path $root 'node_modules\.pnpm')) -and
    (Get-Item $modules).LastWriteTime -ge (Get-Item $lock).LastWriteTime) { $needInstall = 0 }

"FRONTEND=$feFresh"
"BACKEND=$beFresh"
"INSTALL=$needInstall"
