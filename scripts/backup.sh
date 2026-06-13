#!/usr/bin/env bash
# Back up the 9UP Games site: the SQLite DB (consistent snapshot) + all media.
# Usage: ./scripts/backup.sh [output-dir]
# The whole site state is just the DB file + the media directory, so a backup
# is simply a safe copy of both.
set -euo pipefail

cd "$(dirname "$0")/.."

# Load .env if present so DB_PATH / MEDIA_DIR match the running service.
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

DB_PATH="${DB_PATH:-./data/site.db}"
MEDIA_DIR="${MEDIA_DIR:-./media}"
OUT_DIR="${1:-./backups}"

STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"

echo "Backing up to $OUT_DIR (timestamp $STAMP)"

# 1) Consistent SQLite snapshot. Using the sqlite3 .backup command is safe even
#    while the server is running (WAL mode). Falls back to a file copy.
DB_OUT="$OUT_DIR/site-$STAMP.db"
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$DB_OUT'"
else
  echo "  (sqlite3 not found; copying DB file directly — stop the service first for full safety)"
  cp "$DB_PATH" "$DB_OUT"
fi
echo "  DB    -> $DB_OUT"

# 2) Media directory (originals + generated thumbnails).
MEDIA_OUT="$OUT_DIR/media-$STAMP.tar.gz"
tar -czf "$MEDIA_OUT" -C "$(dirname "$MEDIA_DIR")" "$(basename "$MEDIA_DIR")"
echo "  Media -> $MEDIA_OUT"

echo "Done. To restore: copy the .db back to $DB_PATH and extract the tarball over $MEDIA_DIR."
