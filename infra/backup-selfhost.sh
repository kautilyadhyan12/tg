#!/usr/bin/env bash
# The test server's nightly backup (ROADMAP Stage 5 item 21a-ii; RUNBOOK/test-server.md, "Backups").
# Runs on the machine as root from /etc/cron.d/kwazo-backup. Sends the database and the photo folders
# to the S3 bucket below, which the machine may add to and read but never delete from (its role,
# `kwazo-backup-writer`); the bucket keeps each copy 14 days. Sentry's cron monitor `kwazo-backup` is
# told when it starts and how it ended, so a night with no backup, or a failed one, reaches Kd's email.
#
# The packaged-food lists are left out (their rows, not their tables): they are public files, loaded
# again with RUNBOOK/load-packaged-food-lists.md, and would make each copy about 20 times bigger.
set -euo pipefail

BUCKET="kwazo-backups-8abb72"
REGION="ap-southeast-2"
APP="/srv/kwazo/app"
DAY="$(date -u +%Y-%m-%d)"
C=(docker compose -f "$APP/infra/docker-compose.yml" -f "$APP/infra/docker-compose.selfhost.yml")
AWS=(docker run --rm -i --network host amazon/aws-cli:2.17.0 --region "$REGION")

# Sentry's address for cron check-ins, from the api's own SENTRY_DSN: https://KEY@HOST/PROJECT.
dsn="$(grep -m1 '^SENTRY_DSN=' "$APP/infra/api.env" | cut -d= -f2- || true)"
checkin() {
  [[ "$dsn" =~ ^https://([^@]+)@([^/]+)/([0-9]+)$ ]] || return 0
  curl -fsS -m 20 -X POST -H 'Content-Type: application/json' \
    "https://${BASH_REMATCH[2]}/api/${BASH_REMATCH[3]}/cron/kwazo-backup/${BASH_REMATCH[1]}/" \
    -d "{\"status\":\"$1\",\"monitor_config\":{\"schedule\":{\"type\":\"crontab\",\"value\":\"30 21 * * *\"},\"checkin_margin\":60,\"max_runtime\":60,\"timezone\":\"UTC\"}}" \
    >/dev/null || echo "kwazo-backup: Sentry check-in '$1' not sent" >&2
}
trap 'checkin error' ERR

checkin in_progress

# -Fc is compressed and restores table by table; the user and database come from the container's own env.
"${C[@]}" exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --exclude-table-data=off_products --exclude-table-data=usda_branded_products' \
  | "${AWS[@]}" s3 cp - "s3://$BUCKET/db/$DAY.dump"

tar -czf - -C /srv/kwazo photos heights | "${AWS[@]}" s3 cp - "s3://$BUCKET/files/$DAY.tar.gz"

checkin ok
echo "kwazo-backup: $DAY sent"
