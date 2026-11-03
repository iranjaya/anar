# Anar on ekata-prod

Status: spec only; Round 3 decisions folded in. Round 1 inspection: 2026-11-03, source `f6a6723`. Rounds 2–3 change only this spec; no new server commands, secret reads, lead-file reads, source edits or commits.

**Verdict: yes for a small MVP, after these gates.** Round 1 found 3 CPUs, 3,819 MiB RAM, 713 MiB swap used and 32 GB disk free on x86_64. Jarvis reports Ollama is now stopped, unneeded and stays off under `unless-stopped`, with about 2 GB RAM free. Proposed Anar ceiling: 1,408 MiB. Keep the shared-load gate for remaining running containers, excluding Ollama: require 512 MiB headroom without swap growth/OOM, or defer launch pending more RAM. Dressly is not a launch dependency; other apps remain outside scope.

## Routing and TLS

`investment-nginx` owns 80/443. `/home/sishir/investment-app/nginx/nginx.production.conf` mounts at `/etc/nginx/nginx.conf`; hashes match. `/etc/letsencrypt` is also mounted. Dressly shares `docker_investment-network` (`172.18.0.0/16`): nginx currently `.4`, Dressly `.7:3000`.

**Dressly is not needed; no repair or baseline gate.** Add Anar to shared nginx without changing Dressly. For the existing proxy, require `docker exec investment-nginx nginx -t` before and after config edits, before each reload; no other-site baseline checks.

Certbot 2.9.0 uses `standalone` for Dressly/Ledger/root-domain certificates. Renewal configs and global hooks stop/start shared nginx. `certbot.timer` runs renewal; cron is the fallback. This interrupts every site. Passwordless sudo is unavailable.

**Drop production Caddy.** Shared nginx serves Anar's ACME challenge files directly; HTTPS `/api/*` → `anar-api:3001`, other app paths → `anar-web:3000`. Only API/web join the shared network with unique aliases; DB/worker use Anar's private network. No published Anar ports. Web uses `API_INTERNAL_URL=http://anar-api:3001`. Installed nginx 1.29.3 supports Docker DNS/resolving upstreams, avoiding reloads on Anar replacement. [nginx resolution](https://nginx.org/en/docs/http/ngx_http_upstream_module.html#resolve).

Preserve `/api` paths, Host, Origin and HTTPS forwarding; overwrite spoofable client forwarding headers. `TRUSTED_PROXY_CIDRS` trusts only nginx's verified `/32`, refreshed after its recreation. Carry over Caddy's `25664k` upload limit and 125-second import/dry-run/map timeouts; shared defaults are 20M/10s. Add HTTP redirect/HSTS; preserve secure cookies and no caching of authenticated responses or `/sw.js`.

Use **HTTP-01 webroot; no Cloudflare token**. Reuse the existing read-only `/etc/letsencrypt` directory mount: host Certbot writes challenges under `/etc/letsencrypt/anar-webroot/.well-known/acme-challenge`, already visible inside nginx. In Anar's port-80 vhost, use `location ^~ /.well-known/acme-challenge/` with `root /etc/letsencrypt/anar-webroot` and `try_files $uri =404`. Make only this challenge tree traversable/readable by nginx; do not loosen certificate-key permissions or expose the parent directory. Keep the HTTPS redirect inside `location /`, so it cannot intercept challenges. [Certbot webroot](https://eff-certbot.readthedocs.io/en/stable/using.html#webroot).

**No nginx container recreate is needed with that existing directory mount.** A separate `/var/www/anar-acme` bind mount would require recreating `investment-nginx`, causing a one-time short outage for every site behind it; avoid that by using the mounted challenge tree above. A graceful config reload is still needed.

Keep Anar's Certbot config/renewals at `/etc/letsencrypt/anar`, with separate work/log paths and explicit config file. Issue with `certonly --webroot -w /etc/letsencrypt/anar-webroot`; use its `live/anar.visitshankhuwasabha.com/{fullchain,privkey}.pem` for TLS. A separate timer renews only this config with `--no-directory-hooks`, no legacy stop/start hooks, and a deploy hook that tests then gracefully reloads nginx. No standalone or nginx stop for Anar issuance/renewal. Prove public HTTP challenge access and a scoped renewal dry-run. Existing sites' legacy renewal outages remain outside scope. [Certbot hooks](https://eff-certbot.readthedocs.io/en/stable/using.html#renewing-certificates).

## Runtime and new credentials

Build web/API/worker plus the one-shot migration image **on the Mac for `linux/amd64`**, push private images under `ghcr.io/sabinpokhrel76` and deploy recorded digests. Pin Postgres 17 and recovery helper images too. No server builds or mutable `:runtime` tags. [Docker build platforms](https://docs.docker.com/build/building/multi-platform/).

| Service | Hard RAM cap | Additional setting |
| --- | ---: | --- |
| web | 256 MiB | Node heap 160 MiB |
| api | 384 MiB | Node heap 256 MiB |
| worker | 256 MiB | Node heap 160 MiB |
| postgres | 512 MiB | Start with shared_buffers 128 MiB, work_mem 2 MiB |
| migrate | 256 MiB | Run before app services; then exit |

Use `mem_limit`/equal `memswap_limit`, bounded logs, restart policies and 150-second application shutdown grace. Retain DB/uploads volumes; worker gets read-only uploads. Prove max-size synthetic imports and queue load within caps. Several uncapped DB pools need aggregate connection measurement before tuning Postgres. [Compose memory settings](https://docs.docker.com/reference/compose-file/services/#mem_limit).

All credentials are **new for production**. Do not copy Mac `.env`/Keychain values: `env-init.ts` preserves them and leaves DB passwords to the operator. Store app config at `/home/sishir/anar/shared/production.env` (0600, parent 0700); operator credentials stay outside app containers. Save recovery keys off-server; print names/statuses only.

| Names | Creation |
| --- | --- |
| `POSTGRES_PASSWORD`, `APP_DATABASE_PASSWORD`, `MIGRATION_DATABASE_PASSWORD` | Three independent cryptographically random 32-byte hex passwords |
| `DATABASE_URL`, `MIGRATION_DATABASE_URL` | Derive from the new app/migration passwords and private `db:5432/anar` |
| `MAIL_ENCRYPTION_KEY`, `OTP_PEPPER` | Independent random 32-byte values, canonical base64 |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | New P-256 pair, base64url; private key goes only to worker |
| `RESEND_API_KEY` | New Resend sending-only key restricted to the verified sending domain |
| `GHCR_PUSH_TOKEN`, `GHCR_PULL_TOKEN` | Fresh, separate package credentials; push on Mac, read-only pull on server |
| Anar TLS/ACME private keys | Generated by Anar's separate Certbot configuration |

Set `PUBLIC_ORIGIN=https://anar.visitshankhuwasabha.com`, `ANAR_LOCAL_HTTP=false`, real data/auth enabled and `ANAR_ENV=production`. Push starts off pending device proof. Confirmed sender: `EMAIL_FROM`/`EMAIL_REPLY_TO=info@visitshankhuwasabha.com`; `VAPID_SUBJECT=mailto:info@visitshankhuwasabha.com`. Sishir verifies `visitshankhuwasabha.com` in Resend, adds its exact DKIM/SPF/return-path records without replacing inbound mail records, and creates the key. [Resend domains](https://resend.com/docs/dashboard/domains/introduction), [key scope](https://github.com/resend/resend-skills/blob/main/skills/resend/references/api-keys.md).

Start with a fresh empty server database. No local data moves.

## Slices and proof

First-deploy slices, in order; implementation still needs review:

1. **Append-only migrations before this deploy**, before any retained DB. Change `docs/migrations/README.md`, `scripts/check-migrations.ts` and tests; freeze initial SQL/metadata/checksums. Prove fresh/repeated migration and role bootstrap, immutable history, accepted additions and RLS/grants.
2. **Release/routing and HTTP-01:** add `compose.server.yml`, `ops/nginx/anar.conf`, `ops/release.json` (revision/digests), Anar webroot renewal timer/deploy hook. Override base Compose with required secrets, no builds/default passwords/Caddy, limits/networks/health checks. Reuse the existing nginx mount; require no Cloudflare token or container recreate. Bundle to `/home/sishir/anar/releases/<revision>`. Prove quiet validation, amd64 digests, `/api/health`/worker heartbeat, forwarded-IP handling, upload timeouts, backend replacement and HTTP challenge routing.
3. **Server-only backup/restore:** reuse existing coordinators/validators/runners. Extend `createBackupRunner` with optional `BackupConfiguration = {envFile:string; composeFiles:string[]; ingressServices:string[]; sourceRevision:string}`, keeping local defaults. Quiesce web/API/worker and resume prior state without migration. Add server backup/restore entry points, `compose.server-restore.yml` and `ops/systemd/` units; reuse `RestoreConfiguration`. Install private Node 24 for the TypeScript scripts. Prove interruption/restart/disk-full failures, corrupt/occupied-target rejection, delivery isolation, timed recovery and alerts. Keep every backup; no pruning.
4. **Approved deployment and proof:** follow the order below without a Dressly dependency; prove nginx config before/after, capacity, HTTP-01 issuance/renewal, application behavior and an on-server restore before customer use.

Later, outside the first deploy: add encrypted restic/S3 copies and an off-box recovery drill once a bucket exists. No restic, S3 credentials or off-box gate in this deployment.

Run migration/typecheck/lint/unit/integration/E2E/build/Compose gates on disposable synthetic stacks. `docs/verification/local-mvp.md` is blank: prior go-live proof is unrecorded.

## Backups and rollback

Back up Postgres 17 plus pending uploads and checksummed manifest to `/var/backups/anar/<timestamp>` (directories 0700/files 0600). Lock, quiesce only Anar web/API/worker, snapshot, verify and resume even on failure. Shared nginx stays running.

Persistent systemd timer: **02:00 Asia/Kathmandu**, plus startup catch-up; Sishir accepts the brief Anar downtime. Backups stay on this server for the first deploy. **A server loss loses the backups too.** Keep all sets, no pruning. Alert if the last successful backup exceeds 24 hours or disk falls below 10 GB. For failures with a surviving backup, target loss ≤24 hours and restore ≤60 minutes. Save recovery keys separately off-server.

Before launch, restore a verified set from `/var/backups/anar` to fresh `anar-restore-*` volumes on this server. Stop only Anar's source containers during the drill; two stacks exceed the budget. Isolate network/outbound delivery, use Mailpit/push-off and loopback/SSH access. Restore grants/RLS without table migrations; verify counts/history/scores/mail decryption, row-500 synthetic import recovery without duplicates and both screen widths. Stop target, resume source, preserve volumes. Repeat monthly and after recovery changes.

Keep previous release/digests, nginx config and a verified pre-upgrade backup. Revert images only with a compatible DB; otherwise use maintenance and restore DB/uploads together to fresh volumes with matching revision/keys. Losing later writes requires Sishir's decision. Never `down -v`. Failed first deploy: stop Anar, restore saved routing with validation/reload, preserve data/certificates.

## Deployment order, after approval

1. Check capacity with Ollama off and shared `nginx -t` before edits; do not repair or gate on Dressly. Confirm Anar A=`178.156.190.96`, DNS-only, no stale AAAA, with public port 80 reachable. Round 1 found that A and no AAAA.
2. Review/complete slices 1–3; build on Mac and push private images to `ghcr.io/sabinpokhrel76`. Sishir creates the listed credentials and types sudo himself; no Cloudflare token.
3. Install Anar release/config/private toolchain, new secrets and pinned images; validate quietly. Start a fresh empty DB → migration → API/worker/web. Sishir supplies owner name/email for the existing bootstrap CLI with matching `ANAR_ENV`/`--environment=production`. Login uses OTP; no app password is needed.
4. Save nginx config; prepare the challenge tree through its existing mount. Add an HTTP-only Anar vhost serving challenges and returning 503 elsewhere until TLS is ready. Compare host/container config, run `nginx -t`, then gracefully reload. Prove a temporary challenge file is publicly reachable, then issue Anar's webroot certificate. Add its HTTPS app routes and HTTP redirect outside the challenge location; test again before reloading. Enable the isolated renewal timer/deploy hook and prove a scoped dry-run plus Anar TLS/redirects. Atomic replacement of a bind-mounted config file may not update the container's file. No nginx recreate or Dressly repair is planned.
5. Prove synthetic walkthrough, max-upload/load and tenant isolation. Obtain Sishir's explicit test-inbox/device authorization before sending OTP/summary/Android/iPhone push; record actual receipt separately.
6. Pass the on-server restore drill, enable the 02:00 Kathmandu timer and overdue/disk alerts, and retain the first verified set; then allow customer use. Keep all backups. This task performed none of these deployment actions.

## Decisions

- Fresh DB, no local data transfer; private GHCR under `sabinpokhrel76`; sender/reply-to/VAPID contact use `info@visitshankhuwasabha.com`.
- Dressly needs no repair; check shared nginx config before/after only. HTTP-01 uses the existing mount, no Cloudflare token or nginx stop/recreate. Sishir handles sudo. Jarvis already stopped Ollama; leave it off and keep the memory gate.
- Server-only backups for now; server loss loses backups too. Accept 02:00 Kathmandu downtime, retain every set, alert below 10 GB, defer off-box storage.

## Read-only commands run

Round 1 only; no server commands ran in Rounds 2–3. The following ran through `ssh -o BatchMode=yes -o ConnectTimeout=10 ekata-prod`. Repeated reads are listed once. No full inspect/env output was requested. `sudo -n ls` failed because a password is required; the first `docker top ... -eo args` failed and was retried with PID included. Missing Anar paths were reported, not created.

```sh
hostname
uname -m
id -un
nproc
date -u
free -m
df -h /
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}'
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPerc}}\t{{.CPUPerc}}'
docker inspect investment-nginx --format '{{json .Mounts}}'
docker inspect investment-nginx --format '{{json .NetworkSettings.Networks}}'
docker inspect dressly --format '{{json .NetworkSettings.Networks}}'
docker inspect investment-nginx --format '{{json .Config.Cmd}}'
docker inspect investment-mongodb ledger-ollama ledger dressly --format '{{.Name}} memory={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} cpu={{.HostConfig.NanoCpus}} restart={{.HostConfig.RestartPolicy.Name}}'
docker inspect investment-nginx --format 'started={{.State.StartedAt}} image={{.Image}}'
docker network inspect docker_investment-network --format '{{json .IPAM.Config}}'
docker version --format '{{.Server.Version}}'
docker compose version
cat /home/sishir/investment-app/nginx/nginx.production.conf
docker exec investment-nginx cat /etc/nginx/nginx.conf
docker exec investment-nginx cat /etc/nginx/conf.d/default.conf
sha256sum /home/sishir/investment-app/nginx/nginx.production.conf
docker exec investment-nginx sha256sum /etc/nginx/nginx.conf
ls -l /home/sishir/investment-app/nginx
ls -ld /etc/letsencrypt /etc/letsencrypt/live /etc/letsencrypt/renewal /etc/letsencrypt/renewal-hooks /etc/cron.d
sudo -n ls -l /etc/letsencrypt/live /etc/letsencrypt/renewal /etc/letsencrypt/renewal-hooks/deploy
docker exec investment-nginx ls -l /etc/nginx/conf.d /etc/letsencrypt/live
docker exec investment-nginx ls -l /etc/nginx
ls -l /etc/letsencrypt/renewal /etc/letsencrypt/renewal-hooks/deploy /etc/letsencrypt/renewal-hooks/pre /etc/letsencrypt/renewal-hooks/post /etc/cron.d
cat /etc/letsencrypt/renewal-hooks/pre/stop-nginx.sh /etc/letsencrypt/renewal-hooks/post/start-nginx.sh /etc/cron.d/certbot
grep -E '^(authenticator|installer|webroot_path|pre_hook|post_hook|renew_hook|deploy_hook|server|key_type)[[:space:]]*=' /etc/letsencrypt/renewal/*.conf
systemctl list-timers --all --no-pager
systemctl show certbot.service -p ExecStart
command -v certbot
command -v node
certbot --version
node --version
docker exec investment-nginx nginx -v
docker top investment-nginx -eo args
docker top investment-nginx -eo pid,args
ls -ld /home/sishir/anar /var/lib/anar /var/backups/anar
crontab -l | python3 -c 'import sys; rows=[line.split() for line in sys.stdin if line.strip() and not line.lstrip().startswith("#")]; print("sishir crontab entries:",len(rows)); [print("schedule:", " ".join(row[:1 if row[0].startswith("@") else 5]), "certbot:",any("certbot" in part for part in row), "backup:",any("backup" in part for part in row)) for row in rows if "=" not in row[0]]'
```

Additional read-only checks ran from the Mac:

```sh
dig +short A anar.visitshankhuwasabha.com
dig +short AAAA anar.visitshankhuwasabha.com
dig +short A dressly.visitshankhuwasabha.com
curl --connect-timeout 10 --max-time 20 --resolve dressly.visitshankhuwasabha.com:443:178.156.190.96 -sS -o /dev/null -w 'dressly HTTP=%{http_code} TLS=%{ssl_verify_result}\n' https://dressly.visitshankhuwasabha.com
```
