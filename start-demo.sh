#!/usr/bin/env bash
# Pornește demo-ul local izolat (SQLite, fără MySQL și fără datele cPanel) pe http://localhost:8080
# Merge din orice folder: ./start-demo.sh, bash /cale/start-demo.sh, dublu-click, symlink.
set -u
SRC="${BASH_SOURCE[0]:-$0}"
while [ -L "$SRC" ]; do T="$(readlink "$SRC")"; case "$T" in /*) SRC="$T" ;; *) SRC="$(dirname "$SRC")/$T" ;; esac; done
APP_DIR="$(cd -P "$(dirname "$SRC")" >/dev/null 2>&1 && pwd)" || { echo "Nu găsesc folderul aplicației" >&2; exit 1; }
cd "$APP_DIR" || exit 1
[ -f "$APP_DIR/router.php" ] || { echo "Lipsește router.php în $APP_DIR" >&2; exit 1; }
PHP_BIN="${PHP_BIN:-php}"
if ! command -v "$PHP_BIN" >/dev/null 2>&1; then
  for c in /opt/homebrew/bin/php /usr/local/bin/php "$HOME/bin/php"; do [ -x "$c" ] && { PHP_BIN="$c"; break; }; done
fi
command -v "$PHP_BIN" >/dev/null 2>&1 || { echo "PHP nu e instalat (pe Mac: brew install php)" >&2; exit 1; }
if ! "$PHP_BIN" -r 'exit(extension_loaded("pdo_sqlite") && extension_loaded("mbstring") ? 0 : 1);'; then
  echo "PHP are nevoie de extensiile pdo_sqlite și mbstring pentru demo." >&2; exit 1
fi
PORT="${PORT:-8080}"
mkdir -p "$APP_DIR/data/local-demo" "$APP_DIR/uploads/local-demo"
echo "Tex local: http://localhost:$PORT  (Ctrl+C pentru oprire)"
echo "Date de test: data/local-demo/ · fișiere: uploads/local-demo/ (configurația cPanel rămâne neatinsă)"
TEX_LOCAL_DEMO=1 PHP_CLI_SERVER_WORKERS="${PHP_CLI_SERVER_WORKERS:-8}" exec "$PHP_BIN" -S 127.0.0.1:"$PORT" -t "$APP_DIR" "$APP_DIR/router.php"
