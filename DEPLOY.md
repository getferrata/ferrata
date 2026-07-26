# Deploying Ferrata

Ferrata is a single Node process with a local SQLite file. A small Linux VM
(1 vCPU, 1 GB RAM) is enough; no GPU is required on the server because model
inference runs at your provider or on a machine you point it at.

## Docker (shortest path)

With Docker installed, nothing else is needed on the machine:

```bash
git clone https://github.com/getferrata/ferrata.git
cd ferrata
docker compose up -d --build
```

The app comes up on port 3000; the database and logs live on the
`ferrata-data` volume, so backing up that volume backs up everything.

Published images are available as `ghcr.io/getferrata/ferrata`, so on a
machine that already has Docker there is nothing to clone:

```bash
docker run -d --name ferrata -p 3000:3000 -v ferrata-data:/data \
  ghcr.io/getferrata/ferrata:latest
```

Published images are built for `linux/amd64`. On Apple Silicon, Docker runs
them under emulation: it works, it is just slower. Building from source with
`docker compose up -d --build` gives you a native image on any architecture.
Prefer bare metal? Keep reading.

## Offline or air-gapped machines

If the target machine cannot reach GitHub or a package registry, move a
prebuilt image to it. On a machine that does have access:

```bash
docker pull ghcr.io/getferrata/ferrata:latest
docker save ghcr.io/getferrata/ferrata:latest | gzip > ferrata-image.tar.gz
```

Copy `ferrata-image.tar.gz` across (USB, scp, whatever your policy allows),
then on the isolated machine:

```bash
gunzip -c ferrata-image.tar.gz | docker load
docker run -d --name ferrata -p 3000:3000 -v ferrata-data:/data \
  ghcr.io/getferrata/ferrata:latest
```

Without Docker, carry the sources with their dependencies already installed:
on the connected machine run `pnpm install` and `pnpm build`, then archive the
whole directory including `node_modules` and `.next`. Extract it on the target
and run `pnpm start`. Use the same operating system and architecture on both
sides: the SQLite driver ships a compiled binary, and Docker is the safer path
precisely because it removes that constraint.

One thing still has to be reachable: a model. On an isolated network that
means a local model server, for example Ollama on the same machine or on the
LAN, with `OLLAMA_BASE_URL` pointing at it. Nothing else in Ferrata needs the
internet.

## 1. Install

Requires Node 22+ and git.

```bash
git clone https://github.com/getferrata/ferrata.git /opt/ferrata
cd /opt/ferrata
corepack enable pnpm
pnpm install
pnpm build
```

## 2. Configure

Create `/opt/ferrata/.env.local`. Everything is optional; keys can also be
entered later in the in-app Settings page (stored in the database, they take
precedence over the environment).

```bash
# where the SQLite database lives (back this file up)
FERRATA_DB_PATH=/var/lib/ferrata/ferrata.db

# server logs with rotation
FERRATA_LOG_DIR=/var/log/ferrata
FERRATA_LOG_LEVEL=info        # debug | info | warn | error
FERRATA_LOG_MAX_KB=5120       # rotate above this size
FERRATA_LOG_KEEP=5            # rotated files to keep

# model access (or set it in Settings)
# ANTHROPIC_API_KEY=...
# OPENAI_API_KEY=...
# OLLAMA_BASE_URL=http://127.0.0.1:11434

# allow fetching wiki links on private addresses (self-hosted networks)
# FERRATA_ALLOW_PRIVATE_URLS=1

# encrypts provider keys and wiki tokens in the database. Any long random
# string; keep a copy, because losing it makes stored keys unreadable.
# FERRATA_SECRET_KEY=change-me-to-32-random-characters-or-more

# folders Ferrata may read when building a course from a local code repository.
# Unset means the feature is off: nothing on disk is readable by default.
# FERRATA_REPO_ROOTS=/srv/checkouts,/home/you/code

# open sign-up to anyone who can reach the server. Off by default: see below.
# FERRATA_OPEN_REGISTRATION=1
```

```bash
sudo mkdir -p /var/lib/ferrata /var/log/ferrata
sudo chown "$USER" /var/lib/ferrata /var/log/ferrata
```

## 3. Run as a service

`/etc/systemd/system/ferrata.service`:

```ini
[Unit]
Description=Ferrata
After=network.target

[Service]
Type=simple
User=ferrata
WorkingDirectory=/opt/ferrata
ExecStart=/usr/bin/env pnpm start
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

[Install]
WantedBy=multi-user.target
```

```bash
sudo useradd -r -s /usr/sbin/nologin ferrata
sudo chown -R ferrata:ferrata /opt/ferrata /var/lib/ferrata /var/log/ferrata
sudo systemctl enable --now ferrata
systemctl status ferrata
```

The app listens on port 3000. The first account registered becomes the
examiner and sign-ups close behind it, so register yours right after the first
boot, before anyone else reaches the machine.

## 4. TLS in front

Any reverse proxy works. Caddy is the shortest path:

```bash
sudo apt install caddy
```

`/etc/caddy/Caddyfile`:

```
training.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Caddy provisions and renews the certificate on its own. With nginx, proxy
`location /` to `http://127.0.0.1:3000` and use certbot for the certificate.

## 5. Accounts and spend

The install is closed by default. The first account you create becomes the
examiner who runs it; after that nobody can sign themselves up. To add someone,
go to **Users** and create an invite link. The link decides whether they arrive
as a student or as an author who can build courses, it works once, for one
person, and it stops working after 72 hours. Revoke a link you have not sent
yet from the same page.

This matters because building a course spends real money on your provider key.
Without it, anyone who could reach the server could sign up, choose the author
role for themselves, and start generating.

Set `FERRATA_OPEN_REGISTRATION=1` only for a demo or a public sandbox where
anyone signing up is the point. Even then, open sign-ups only ever get a student
account: authors come from an invite.

### Keys in the database

Provider keys and wiki tokens live in the SQLite file. Set
`FERRATA_SECRET_KEY` to a long random string and they are encrypted at rest,
so a backup, a volume snapshot or a support bundle does not hand them over.
Generate one with `openssl rand -base64 32`.

Without it they are stored in the clear and the Settings page says so. Turning
it on later is safe: keys already stored keep working, and each is encrypted
the next time it is saved. Keep a copy of the value somewhere other than the
server: lose it and the encrypted keys cannot be read back, and you will have
to paste them in again.

### Spend

Under **Settings** you can also set a spend ceiling per account. One credit is
one US cent of estimated provider cost, so 500 credits is about five dollars.
It is off by default, and it never applies to local models, which cost nothing.
Spend per account is listed on the Users page.

## 6. Logs

With `FERRATA_LOG_DIR` set, the app writes `ferrata.log` in that directory and
rotates it by size (`ferrata.log.1` ... `ferrata.log.N`). Job starts, job
completions with duration, and failures all land there. Without the variable,
logs go to stdout only, where journald captures them:

```bash
journalctl -u ferrata -f          # live tail
tail -f /var/log/ferrata/ferrata.log
```

## 7. Backup

The database is one file. Copy it while the app is running with the SQLite
backup command to get a consistent snapshot:

```bash
sqlite3 /var/lib/ferrata/ferrata.db ".backup /backups/ferrata-$(date +%F).db"
```

Restoring is copying the file back and restarting the service. Uploaded course
material lives inside the database, so the file is the whole state.

## 8. Update

```bash
cd /opt/ferrata
git pull
pnpm install
pnpm build
sudo systemctl restart ferrata
```

Database migrations run automatically on boot.

## Troubleshooting

- Port already in use: change `Environment=PORT=` in the unit file.
- Generation stuck in "queued": check the model key in Settings with the Test
  connection button, then look for job errors in the log.
- Wiki links refused with a "private address" error: that is the SSRF guard;
  set `FERRATA_ALLOW_PRIVATE_URLS=1` if the wiki genuinely lives on your LAN.
