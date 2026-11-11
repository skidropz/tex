@echo off
REM Demo izolat pe http://localhost:8080 (necesita PHP 8 cu pdo_sqlite si mbstring in PATH).
REM Pe Windows serverul PHP are un singur worker: aplicatia foloseste polling scurt.
cd /d "%~dp0"
where php >nul 2>&1 || (echo PHP nu este instalat sau nu se afla in PATH. & exit /b 1)
php -r "exit(extension_loaded('pdo_sqlite') && extension_loaded('mbstring') ? 0 : 1);"
if errorlevel 1 (echo Sunt necesare extensiile PHP pdo_sqlite si mbstring. & exit /b 1)
if not exist "data\local-demo" mkdir "data\local-demo"
if not exist "uploads\local-demo" mkdir "uploads\local-demo"
set TEX_LOCAL_DEMO=1
set PHP_CLI_SERVER_WORKERS=8
echo Tex local: http://localhost:8080  (Ctrl+C pentru oprire)
start "" http://localhost:8080
php -S 127.0.0.1:8080 -t "%~dp0." "%~dp0router.php"
