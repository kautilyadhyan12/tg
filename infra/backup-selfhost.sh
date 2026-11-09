#!/usr/bin/env bash
# The test server's nightly backup (ROADMAP Stage 5 item 21a-ii; RUNBOOK/test-server.md, "Backups").
# Runs on the machine as root from /etc/cron.d/kwazo-backup. Sends the database and the photo folders
# to the S3 bucket below, which the machine may add to and read but never delete from (its role,
# `kwazo-backup-writer`); the bucket keeps each copy 14 days. Sentry's cron monitor `kwazo-backup` is
# told when it starts and how it ended, so a night with no backup, or a failed one, reaches Kd's email.
#
# Each copy is made in a file on the machine and checked before it is sent, so the bucket never holds
# a broken copy under a day's name: a night Sentry marks failed sent nothing.
#
# The packaged-food lists are left out (their rows, not their tables): they are public files, loaded
# again with RUNBOOK/load-packaged-food-lists.md, and would make each copy about 20 times bigger.
set -euo pipefail

BUCKET="kwazo-backups-8abb72"
REGION="ap-southeast-2"
APP="/srv/kwazo/app"
DAY="$(date -u +%Y-%m-%d)"
WORK="/srv/kwazo/backup-tmp"
C=(docker compose -f "$APP/infra/docker-compose.yml" -f "$APP/infra/docker-compose.selfhost.yml")
# By digest: this image runs as root with the machine's AWS rights.
AWS=(docker run --rm --network host -v "$WORK:/work:ro" amazon/aws-cli:2.17.0@sha256:643507c10ada7964ca6157b3d799f030b90577643da9955d319a77399ed80d73 --region "$REGION")

# Sentry's address for cron check-ins, from the api's own SENTRY_DSN: https://KEY@HOST/PROJECT.
dsn="$(grep -m1 '^SENTRY_DSN=' "$APP/infra/api.env" | cut -d= -f2- | tr -d '\r' || true)"
checkin() {
  if [[ ! "$dsn" =~ ^https://([^@]+)@([^/]+)/([0-9]+)$ ]]; then
    echo "kwazo-backup: no Sentry check-in '$1': SENTRY_DSN missing or not understood" >&2
    return 0
  fi
  curl -fsS -m 20 -X POST -H 'Content-Type: application/json' \
    "https://${BASH_REMATCH[2]}/api/${BASH_REMATCH[3]}/cron/kwazo-backup/${BASH_REMATCH[1]}/" \
    -d "{\"status\":\"$1\",\"monitor_config\":{\"schedule\":{\"type\":\"crontab\",\"value\":\"30 21 * * *\"},\"checkin_margin\":60,\"max_runtime\":60,\"timezone\":\"UTC\"}}" \
    >/dev/null || echo "kwazo-backup: Sentry check-in '$1' not sent" >&2
}
trap 'checkin error' ERR
# The copies hold everyone's data: nothing of them stays on the machine after the run.
trap 'rm -rf "$WORK"' EXIT

checkin in_progress
rm -rf "$WORK" && install -d -m 700 "$WORK"

# -Fc is compressed and restores table by table; the user and database come from the container's own env.
"${C[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --exclude-table-data=off_products --exclude-table-data=usda_branded_products' > "$WORK/db.dump"
# Read the whole copy back: a dump cut short anywhere is refused (`-l` alone reads only its table of
# contents, which comes first, and passed a copy cut in half).
"${C[@]}" exec -T postgres pg_restore -f /dev/null < "$WORK/db.dump"

# GNU tar exits 1 when a photo changes while it is read (a member adding one): the copy is still whole.
tar --warning=no-file-changed -czf "$WORK/files.tar.gz" -C /srv/kwazo photos heights || [ $? -eq 1 ]
gzip -t "$WORK/files.tar.gz"

"${AWS[@]}" s3 cp /work/db.dump "s3://$BUCKET/db/$DAY.dump" --only-show-errors
"${AWS[@]}" s3 cp /work/files.tar.gz "s3://$BUCKET/files/$DAY.tar.gz" --only-show-errors

checkin ok
echo "kwazo-backup: $DAY sent ($(stat -c %s "$WORK/db.dump") bytes of database)"
