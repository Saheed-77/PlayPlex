#!/usr/bin/env bash
# Put a backup back (docs/08 §7). An untested backup is a rumour — rehearse this before
# the event, on a copy, so that under pressure it is muscle memory and not a decision.
#
#   ./scripts/restore.sh ./backups/playplex-20260914-1530.sql.gz
#   ./scripts/restore.sh latest
#
# Restoring into a database that still has rows *merges* rather than replaces, which
# quietly leaves yesterday's sessions in today's reports. So this drops and recreates the
# schema first, which is also why it asks before doing anything.
set -euo pipefail

cd "$(dirname "$0")/.."

DB_NAME="${DB_NAME:-playplex}"
DB_USER="${DB_USER:-playplex}"
DB_PASSWORD="${DB_PASSWORD:-playplex}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-rootpw}"

FILE="${1:-latest}"
if [ "$FILE" = "latest" ]; then
    FILE="$(ls -1t ./backups/playplex-*.sql.gz 2>/dev/null | head -1 || true)"
    [ -n "$FILE" ] || { echo "No backups in ./backups" >&2; exit 1; }
fi
[ -f "$FILE" ] || { echo "No such backup: $FILE" >&2; exit 1; }
gunzip -t "$FILE" 2>/dev/null || { echo "$FILE is not readable gzip" >&2; exit 1; }

echo "About to REPLACE the '$DB_NAME' database with:"
echo "  $FILE  ($(du -h "$FILE" | cut -f1), taken $(date -r "$FILE" '+%Y-%m-%d %H:%M' 2>/dev/null || echo 'unknown'))"
echo "Everything currently in it will be lost."
if [ "${FORCE:-}" != "1" ]; then
    printf 'Type the database name to confirm: '
    read -r answer
    [ "$answer" = "$DB_NAME" ] || { echo "Aborted."; exit 1; }
fi

# Stop the API first: a restore under a live connection pool gives Hibernate a schema
# that changes underneath it, and Flyway will not thank you either.
docker compose stop api 2>/dev/null || true

docker compose exec -T db mysql -u root -p"$DB_ROOT_PASSWORD" -e \
    "DROP DATABASE IF EXISTS \`$DB_NAME\`;
     CREATE DATABASE \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
     GRANT ALL ON \`$DB_NAME\`.* TO '$DB_USER'@'%';"

gunzip -c "$FILE" | docker compose exec -T db mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME"

# Prove it landed rather than assuming it did.
echo
echo "Restored. What came back:"
docker compose exec -T db mysql -u "$DB_USER" -p"$DB_PASSWORD" "$DB_NAME" -e \
    "SELECT (SELECT COUNT(*) FROM ticket)       AS tickets,
            (SELECT COUNT(*) FROM play_session) AS sessions,
            (SELECT COUNT(*) FROM payment)      AS payments,
            (SELECT COALESCE(SUM(amount_paise), 0) FROM payment) AS total_paise,
            (SELECT next_val FROM seq_counter WHERE name = 'ticket_no') AS next_ticket_no;"

docker compose start api 2>/dev/null || true
echo "Check the numbers above against what you remember before carrying on."
