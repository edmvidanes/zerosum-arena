# Zerosum deployment runbook

Zerosum ships through five environments. A feature must pass each gate before moving on; feature flags (`ENABLE_HOST_PLAY`, `ENABLE_SOLO_BOTS`, `ENABLE_CHALLENGE_QUEUE`) can disable any new mode without a redeploy.

| Phase | Environment | Command / access | Gate |
| --- | --- | --- | --- |
| 0 | Baseline | `npm ci; npm test; npm run build` | Existing suite green on untouched code |
| 1 | Local dev (this PC) | `.\scripts\run-local.ps1` → http://localhost:3000 | One script from checkout to a playable game |
| 2 | Local Docker parity | `docker compose -f compose.local.yaml up --build` → http://localhost:8080 | Playable in containers; SQLite survives `docker compose restart`; backup/restore drill done |
| 3 | Feature slices | Flags on locally, off in production-shaped config | Per slice: tests + build + Docker parity pass; slice can be flag-disabled |
| 4 | LAN pilot | Docker host on classroom Wi-Fi, students use the LAN IP | 10+ devices finish a game; HTTP fallback verified on a restricted device |
| 5 | EC2 staging | Dedicated EC2, existing `scripts/deploy-docker.ps1`, IP only, `PUBLIC_BETA_MODE=true` | 48h soak clean, scripted 50-player load check, backup/restore drill |
| 6 | EC2 production | Elastic IP + DNS + HTTPS via `ops/` | Smoke checklist green after every release (below) |

## Secrets and data rules
- Real credentials live only in `/etc/zerosum/zerosum.env` (EC2, mode 600) or `.env.local` (workstation, git-ignored). Only `.example` templates are committed.
- One SQLite database per environment; production data is never copied to staging/local.
- Database migrations are additive-only (new columns/tables), so rolling back means redeploying the previous git tag — no data downgrade.

## Smoke checklist (staging and production, every release)
1. `curl https://zerosum.website/api/health` (or the staging IP) returns OK.
2. Host signs in, creates a Class Game, a second browser joins with the code.
3. Host-play game: host answers a question, rounds auto-start.
4. Solo Arcade: start a run, beat a bot rival, streak increments.
5. Challenge Queue: a second browser queues and is matched at the next duel boundary.

## Rollback
1. If a single feature misbehaves, set its `ENABLE_*` flag to `false` in the server env and restart the app container.
2. Otherwise redeploy the previous git tag with the same deploy script; the env file, database, backups, and TLS certs are preserved by the installer.
