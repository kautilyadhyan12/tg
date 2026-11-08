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
read shut from outside only because of it). Check from outside after any change:
`node tools/check-test-server.mjs` (every door, the https answers and their headers).

**Never** put the database's password, `api.env` or any key in a terminal's output, a commit or a
message. Read them on the machine when a command needs them.

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
git archive --format=tar HEAD | ssh -i ~/.ssh/kwazo_oracle ubuntu@13.237.195.91 'tar -x -C /srv/kwazo/app'
```

That leaves the settings files and `infra/web` alone (neither is in git). Then on the machine:
`$C build api && $C up -d --force-recreate caddy api live worker`. The api, worker and live share one
image. Caddy is recreated as well: it reads its two files through single-file mounts, and an update
that writes a new file (`tar`, `sed -i`) leaves the running Caddy on the old one, even after a reload.

**The console** is built on the laptop (the machine has 2 GB) and copied across:

```
VITE_API_URL=https://api.getkwazo.com corepack pnpm --filter web exec vite build --outDir <scratch>/web-dist --emptyOutDir
cd <scratch>/web-dist && tar -cf - . | ssh -i ~/.ssh/kwazo_oracle ubuntu@13.237.195.91 'rm -rf /srv/kwazo/app/infra/web && mkdir -p /srv/kwazo/app/infra/web && tar -x -C /srv/kwazo/app/infra/web'
```

## Migrations, seeds and the food table

Postgres listens on the machine's own loopback only. From `apps/api` on the laptop, through a tunnel:

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
