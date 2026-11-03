# Local MVP stack

## Secrets

Copy `.env.example` to the gitignored root `.env`, or run `pnpm env:init` after Sishir authorizes it. The initializer preserves every set value, generates the mail key, OTP pepper, and VAPID pair, and reads the Resend key from the named macOS Keychain item only when its entry is empty. It prints names and statuses only. This implementation has not initialized the real `.env`.

Fill `POSTGRES_PASSWORD`, `APP_DATABASE_PASSWORD`, and `MIGRATION_DATABASE_PASSWORD` yourself. Set `DATABASE_URL` to the `anar_app` role using the app password and `MIGRATION_DATABASE_URL` to `anar_migrate` using the migration password, both at `db:5432` with the chosen database name. Keep every value on one line. Set `ANAR_LAN_BIND_ADDRESS` to the Mac's LAN IP and `ANAR_SITE_ADDRESS` to the stable hostname used by `PUBLIC_ORIGIN`. Point that hostname to the LAN IP on the test devices. `pnpm local:up` reports missing names only.

Local `.env` values are temporary. Rotate every secret—Resend key, `MAIL_ENCRYPTION_KEY`, `OTP_PEPPER`, the VAPID pair, and all database passwords—before the first server deploy.

## Start and stop

Run `pnpm local:up` to build and start the named local Compose project, or `pnpm local:up --project anar-local` to name it explicitly. It starts DB, applies migration, then starts API, worker, web, and Caddy. Run `pnpm local:down` with the same project name to stop it while retaining DB, uploads, and Caddy certificate volumes. Do not use `down --volumes` on retained data.

The local Caddy configuration issues an internal TLS certificate for `ANAR_SITE_ADDRESS`. Export its local root CA from the `caddy_data` volume and install trust on the two test devices before testing native push. Only Caddy binds the chosen LAN address; DB and API remain inside the Compose network. Keep the Mac awake and online while scheduled work is needed.

## Backups

`local:up` installs a per-project macOS LaunchAgent. It checks for a missed backup when the agent loads and runs daily at 02:00 in the Mac's timezone. A completed backup goes under `~/Library/Application Support/Anar/backups/<project>`; the last-success record holds only its timestamp. `pnpm local:backup:status` reports current or overdue after 24 hours. `pnpm local:backup:tick` checks the schedule manually. Retention reports candidates after a verified backup and keeps every set. `local:down` stops the LaunchAgent without removing backup sets or Compose volumes.
