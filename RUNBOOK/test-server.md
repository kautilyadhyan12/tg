# The test server (getkwazo.com)

ROADMAP Stage 5 item 21a-i. One AWS machine runs everything for Google's closed test, free from
AWS's credit until publishing (21e), when the paid server is chosen.

| What | Value |
|---|---|
| Machine | AWS EC2 `kwazo-test`, t4g.small (2 vCPU Arm, 2 GB, 2 GB swap), Ubuntu 24.04, 30 GB encrypted disk |
| Region | Sydney (`ap-southeast-2`): the free plan allows no other (Kd, 2026-11-09) |
| Fixed address | `13.237.195.91` (Elastic IP) |
| Names | `api.getkwazo.com` (the api) and `getkwazo.com` (the console), Cloudflare DNS, **DNS only** (grey cloud) so Caddy makes its own certificates |
| Doors | AWS security group and `ufw`: 22, 80, 443 only. SSH by key alone (`~/.ssh/kwazo_oracle` on Kd's laptop); no passwords, no root |
| Code | `/srv/kwazo/app` (a `git archive` of the branch, not a clone) |
| Settings, never in git | `/srv/kwazo/app/infra/api.env`, `db.env` (mode 600) and `.env` |
| Data | the `pgdata` and `redisdata` volumes; photos and height pieces in `/srv/kwazo/photos`, `/srv/kwazo/heights` |

**Never publish another port** in a compose file: Docker's published ports go around `ufw`, and only
AWS's security group would still stop them (measured 2026-11-09: Redis published on `0.0.0.0:6379`
read shut from outside only because of it). Check after any change:
`node tools/check-test-server.mjs --inside` (every door from outside, the https answers and their
headers, secret files, and what the machine itself listens on, read over SSH).

**Never** put the database's password, `api.env` or any key in a terminal's output, a commit or a
message. Read them on the machine when a command needs them. **Never run `$C config`** on the
machine: it prints every value of `api.env` and `db.env`.

## Signing in to the machine

```
ssh -i ~/.ssh/kwazo_oracle ubuntu@13.237.195.91
```

The compose command, from `/srv/kwazo/app`:

```
C="sudo docker compose -f infra/docker-compose.yml -f infra/docker-compose.selfhost.yml"
$C ps
$C logs --tail 100 api
```

## Putting a new version on it

From the repository on the laptop, at the commit to send:

```
git archive --format=tar HEAD | ssh -i ~/.ssh/kwazo_oracle ubuntu@13.237.195.91 'rm -rf /srv/kwazo/app.new && mkdir /srv/kwazo/app.new && tar -x -C /srv/kwazo/app.new'
ssh -i ~/.ssh/kwazo_oracle ubuntu@13.237.195.91 "echo $(git rev-parse HEAD) > /srv/kwazo/app.new/DEPLOYED"
```

A fresh folder, so a file taken out of the repository is gone from the machine too; `DEPLOYED` says
which commit runs. Then on the machine, carrying over what is not in git (the settings and the
console) and swapping the folders:

```
cd /srv/kwazo && for f in api.env db.env .env; do cp -p app/infra/$f app.new/infra/; done && cp -a app/infra/web app.new/infra/web
rm -rf app.old && mv app app.old && mv app.new app && cd app
$C build api && $C up -d --force-recreate caddy api live worker
```

The api, worker and live share one image. Caddy is recreated as well: it reads its two files through
single-file mounts, and an update that writes a new file leaves the running Caddy on the old one,
even after a reload. `app.old` is the way back until the next update.

**The console** is built on the laptop (the machine has 2 GB) and copied across. The empty settings
matter: Vite otherwise takes them from the laptop's own `apps/web/.env`, the console then calls
`localhost:8000` and `localhost:3001`, and Chrome asks every visitor to let getkwazo.com "access other
apps and services on this device" (21a-ii; the outside check now fails on it):

```
VITE_API_URL=https://api.getkwazo.com VITE_AUTH_API_URL= VITE_ML_API_URL= VITE_WS_URL= VITE_TRACE_RECORD= corepack pnpm --filter web exec vite build --outDir <scratch>/web-dist --emptyOutDir
grep -rhoE "(https?|wss?)://(localhost|127\.0\.0\.1):[0-9]+" <scratch>/web-dist   # must print nothing
cd <scratch>/web-dist && tar -cf - . | ssh -i ~/.ssh/kwazo_oracle ubuntu@13.237.195.91 'rm -rf /srv/kwazo/app/infra/web && mkdir -p /srv/kwazo/app/infra/web && tar -x -C /srv/kwazo/app/infra/web'
```

## Migrations, seeds and the food table

Postgres listens on the machine's own loopback only. From `apps/api` on the laptop, through a tunnel.
The password goes into the address as it is, so it is made of letters, digits, `-` and `_` only
(base64url, as the first one was); a new one is made the same way, never with `/`, `+`, `@` or `#`.

```
ssh -i ~/.ssh/kwazo_oracle -f -N -L 15432:127.0.0.1:5432 ubuntu@13.237.195.91
PW=$(ssh -i ~/.ssh/kwazo_oracle ubuntu@13.237.195.91 "grep ^POSTGRES_PASSWORD= /srv/kwazo/app/infra/db.env | cut -d= -f2-")
DATABASE_URL="postgres://kwazo:${PW}@localhost:15432/kwazo" corepack pnpm run migrate
DATABASE_URL="postgres://kwazo:${PW}@localhost:15432/kwazo" corepack pnpm run seed
```

`DATABASE_URL` goes on the same line every time: drizzle-kit otherwise reads `apps/api/.env`, which
is Kd's Neon data. Every statement crosses India to Sydney, so the first full migration took
minutes. Then the USDA table, `RUNBOOK/load-usda-food-table.md`, against the same tunnel address.
Close the tunnel afterwards (`taskkill` the `ssh.exe` holding port 15432).

## The phone on the online server

The copy already installed reads the server's addresses when its bundler starts:

```
$env:PHONE_SERVER='https://api.getkwazo.com'; $env:PHONE_WEBSITE='https://getkwazo.com'; corepack pnpm --filter mobile start
```

Both or neither; each must be a bare https address.

## Who is the admin

`ADMIN_USER_ID` in `api.env` is Kd's own account on THIS server (its users are not the laptop's):
after he signs in once, read his id with `psql` on the machine, add the line and `$C up -d api`.

## Errors: Sentry

`SENTRY_DSN` in `api.env` (21a-ii): Kd's free Sentry account, organization `kwazo`, project
`kwazo-server` (United States), errors only. The api and the worker send a fault nobody expected
with its request id and nothing of the request (`apps/api/src/sentry.ts`). Measured 2026-11-09 from
the machine, the real SDK and the real address: a planted sign-in code, cookie, email and name were
in none of what was sent. Kd gets an email for each new issue.

## Backups

Every night at 21:30 UTC (03:00 in India) `/etc/cron.d/kwazo-backup` (from `infra/kwazo-backup.cron`)
runs `infra/backup-selfhost.sh` as root: the database (`pg_dump -Fc`, the two packaged-food lists'
rows left out: they are public files, loaded again with `load-packaged-food-lists.md`) and the photo
folders go to the S3 bucket `kwazo-backups-8abb72` in Sydney, as `db/<day>.dump` and
`files/<day>.tar.gz`. Its log: `/var/log/kwazo-backup.log`. Each copy is made in `/srv/kwazo/backup-tmp`
(removed after every run), read back in full (`pg_restore -f /dev/null`, which refuses a copy cut short
anywhere; `-l` passed one cut in half) and only then sent, so **a night Sentry marks failed sent nothing**
and the newest name in the bucket is a whole copy (tried 2026-11-09 with a dump that fails half-way).

- **Who may do what.** The machine's role `kwazo-backup-writer` may add and read, never delete
  (measured: `s3 rm` refused, "not authorized to perform: s3:DeleteObject"). The bucket blocks public
  access, has versioning on, and its rule `keep-14-days` deletes a copy after 14 days and an earlier
  version 14 days after that, so an overwrite cannot destroy a copy. Also refused, measured 2026-11-09:
  changing versioning or the public-access block, reading the rule, deleting an earlier version. The
  privacy policy says up to 30 days (`BACKUP_MOST_DAYS`, section 10.5: S3 rounds each period up to a
  midnight and removes a little later). **The rule and `BACKUP_KEEP_DAYS` change together**: the role
  cannot read the rule, so no check can catch them apart.
- **A missed or failed night.** The script checks in with Sentry's cron monitor `kwazo-backup`
  (started, ok or error), so a failure or a night with no run emails Kd. A `SENTRY_DSN` it cannot read
  is written to the log as "no Sentry check-in". Seen by Kd on 2026-11-09: the failing test run's check-in emailed him.
- **Restore** (tried 2026-11-09: 185 tables, 2 people, 13,225 USDA foods, 228 migrations, the same as
  live). On the machine, into a throwaway database first:

```
A="sudo docker run --rm -i --network host amazon/aws-cli:2.17.0@sha256:643507c10ada7964ca6157b3d799f030b90577643da9955d319a77399ed80d73 --region ap-southeast-2"
$A s3 ls s3://kwazo-backups-8abb72/db/
sudo docker run -d --name restore-test --network none -e POSTGRES_PASSWORD=x -e POSTGRES_USER=kwazo -e POSTGRES_DB=kwazo pgvector/pgvector:pg16
$A s3 cp s3://kwazo-backups-8abb72/db/<day>.dump - > /tmp/r.dump
sudo docker exec -i restore-test pg_restore -U kwazo -d kwazo --no-owner < /tmp/r.dump
# ... compare counts with live, then leave no copy of everyone's data behind:
sudo docker rm -f restore-test && rm -f /tmp/r.dump
```

  The photos: `$A s3 cp s3://kwazo-backups-8abb72/files/<day>.tar.gz - | sudo tar -xz -C /srv/kwazo`
  (it holds `photos/` and `heights/`).

  To put it back for real, stop the api, worker and live, then `pg_restore --clean --if-exists` into the
  `postgres` service the same way, start them, and load the packaged-food lists again.
- `docker run -i` reads its input: in a script fed through `bash -s`, it swallows the rest of the
  script. Copy a script to the machine and run the file.

## Phone notifications: Firebase

`FIREBASE_SERVICE_ACCOUNT_FILE=/run/kwazo-secrets/firebase.json` in `api.env`: the file is
`/srv/kwazo/secrets/firebase.json` on the machine (folder 700, file 600, owned by `ubuntu`, which is the
image's `node` user), mounted read-only into the worker alone (the api never reads it). Kd's laptop copy is
`infra/secrets/firebase.json`, ignored by git. The worker's log says `worker.push_off` when it is missing.

## Support mail

support@getkwazo.com is forwarded to Kd's Gmail by Cloudflare Email Routing (getkwazo.com, Email).
`SUPPORT_EMAIL` in `api.env` and `LEGAL_FACTS.supportEmail` name it.
