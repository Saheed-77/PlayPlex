#!/usr/bin/env bash
# Take a consistent snapshot of the event database (docs/08 §7).
#
# Run it every 30 minutes from cron or Windows Task Scheduler. It costs a second and it
# is the difference between a bad hour and a ruined event.
#
#   ./scripts/backup.sh                 # into ./backups
#   ./scripts/backup.sh /mnt/usb        # somewhere else
#
# --single-transaction is what makes this safe to run *while* reception is registering
# someone: InnoDB takes a consistent snapshot instead of locking the tables.
# --no-tablespaces because the app's database user deliberately does not have MySQL 8's
# PROCESS privilege, and without the flag mysqldump complains about that on every run.
set -euo pipefail

cd "$(dirname "$0")/.."

DIR="${1:-./backups}"
KEEP="${BACKUP_KEEP:-48}"
DB_NAME="${DB_NAME:-playplex}"
DB_USER="${DB_USER:-playplex}"
DB_PASSWORD="${DB_PASSWORD:-playplex}"

mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$DIR/playplex-$STAMP.sql.gz"

docker compose exec -T db \
  mysqldump -u "$DB_USER" -p"$DB_PASSWORD" \
            --single-transaction --routines --triggers \
            --set-gtid-purged=OFF --no-tablespaces "$DB_NAME" \
  | gzip > "$FILE"

# A dump that failed halfway still leaves a file behind, so prove it is readable and
# actually reached the end before anyone treats it as a backup.
if ! gunzip -t "$FILE" 2>/dev/null; then
    echo "FAILED: $FILE is not readable gzip" >&2
    rm -f "$FILE"
    exit 1
fi
if ! gunzip -c "$FILE" | tail -5 | grep -q 'Dump completed'; then
    echo "FAILED: $FILE is truncated — mysqldump did not finish" >&2
    rm -f "$FILE"
    exit 1
fi

# Keep the last N. Half a day of history is plenty; a full disk at 6pm is not.
ls -1t "$DIR"/playplex-*.sql.gz 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
    rm -f "$old"
done

echo "$FILE ($(du -h "$FILE" | cut -f1))"
echo "Copy today's backups to a second machine before you go home. One copy is not a backup."
