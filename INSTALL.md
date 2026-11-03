# ZeroSum Arena - installation

ZeroSum Arena is a self-contained web app: a Node.js server serves the built
React client, runs the real-time game engine (WebSocket with HTTP fallback),
and stores data in a single SQLite file. No external database is required.

## Run locally (development)

Requirements: Node.js 20+.

```powershell
# Windows quick start (creates .env.local from .env.example on first run)
.\scripts\run-local.ps1
```

```bash
# Any platform
npm ci
npm run build
npm start
```

Open http://localhost:3000. The server seeds the ready-made challenge packs
automatically on first start.

Local Docker option (no Node install):

```bash
cp .env.example .env.local
docker compose -f compose.local.yaml up --build   # http://localhost:8080
```

## Configuration

Copy `.env.example` to `.env.local` (local) or `.env` (Docker self-host) and
fill in only what you need. Never commit a filled-in file.

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID` | Enables "Continue with Google" host sign-in. Create an OAuth 2.0 Web Client ID in Google Cloud Console and add every origin that serves the app (for example `https://your-domain.example`, plus `http://localhost:3000` for local development) under Authorized JavaScript origins. No client secret is needed; the server verifies the ID token before creating a session. Leave empty to hide the button. |
| `MODEL_API_KEY` | Enables the AI Pack Forge. Create the key in the Meta Model API dashboard at dev.meta.ai. The Forge ("ZeroSum Sensei") uses Muse Spark (`muse-spark-1.3` by default; override with `META_MODEL`) and only generates educational quizzes. PDFs are processed in memory and never stored. Leave empty to disable the Forge. |
| `ADMIN_EMAILS` | Comma-separated account emails that receive admin tools (pack visibility). All other host accounts are equal - there are no tiers. |

After changing environment values, restart the server (or recreate the
container) so the new values take effect.

## Deploy on your own server (Docker)

Any Linux host with Docker Engine and Docker Compose v2 works:

```bash
git clone <this-repo> zerosum-arena
cd zerosum-arena
cp .env.example .env   # fill in your values
docker compose up -d --build
curl http://127.0.0.1:3000/api/health
```

Game data (accounts, packs, leaderboard history) persists in the
`zerosum_data` Docker volume. To update later:

```bash
git pull
docker compose up -d --build
```

For public use, put the app behind an HTTPS reverse proxy of your choice
(Caddy, Nginx, a cloud load balancer, ...). The proxy must forward normal
HTTP traffic and WebSocket upgrades on `/ws` to port 3000, and allow request
bodies up to 6 MB so PDF lessons can reach the Forge. Add your public origin
to the Google client's Authorized JavaScript origins.

## Data and resource notes

- Solo leaderboard keeps only the top 5 streaks (minimum streak of 2,
  forfeited runs excluded); hosted-tournament champions keep the last 10.
- Each account keeps at most 20 created packs; temporary packs auto-delete
  after 30 days.
- Uploaded lesson PDFs (max 4 MB / 60 pages) are parsed in memory; only a
  short excerpt is sent to the AI model, and files are never written to disk.
