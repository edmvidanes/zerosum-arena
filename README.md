# ZeroSum Arena — Learning, Made Fun

**ZeroSum Arena makes learning fun for quizzes.** It turns any quiz or question pack into a live, Dragon Ball-inspired battle game: students answer questions to charge up, unleash energy skills, and damage their rival — so reviewing for a class or practicing for an exam feels like playing a fighting game, not taking a test.

A teacher (or any host) selects a challenge pack, players join with a six-character code, and each player tries to protect their three HP until only one champion remains. Students at home can also play solo against bots to practice on their own, build a win streak, and climb the leaderboard.

The current beta runs as a Dockerized monolith on one Amazon Linux EC2 instance:

```text
Browser -> Nginx -> Node.js + React -> SQLite
             |          |
             +------ WebSocket live updates
```

## Current beta

- Sign-in is available, while anonymous hosts still receive the temporary 50-player beta allowance.
- Players join without an account.
- Signed-in paid beta hosts can create and import private challenge packs; anonymous and free hosts cannot.
- Anonymous and free beta hosts cannot inspect challenge answers. Signed-in paid test hosts can view answer keys, explanations, and questions used during a tournament.
- Included packs cover AWS Cloud Practitioner, information security, security awareness, general knowledge, and Bato Bato Pick.
- A fresh server starts on HTTP so it can be verified before DNS cutover. Enable HTTPS before collecting real accounts or sensitive data.

## Main features

- **Dragon Ball-inspired battle stage (original CSS art):** fighters idle with flickering auras, charge while an answer is locked, and fire an energy skill — Scholar Beam, Mind Cannon, Exam Flash — at the rival when damage resolves; clashes and blocks are animated too.
- **Host can play:** the host may join their own tournament as a fighter. Rounds then auto-run (8-second break countdown) and answer keys stay hidden from the playing host.
- **Solo Arcade:** a no-account, Tekken-style 1v1 ladder against seeded bot rivals (Rookie → Champion tiers that get faster and more accurate, with a boss every 5th rival). Ladder length 5–50, HP resets each duel, win streaks earn a place on the server-wide Top 5 leaderboard (streaks of 2+ only, tagged with the run session code).
- **Learn / Exam feedback:** Learn mode shows the explanation after each question; Exam mode withholds answers until the run ends, then gives a full review.
- **Challenge Queue:** streak players who tick "Allow challenges" can be challenged — a queued student with the same pack takes the next rival slot at a duel boundary. Win and their streak ends; you can start your own.
- Local development and the phased rollout (local → Docker → LAN pilot → EC2 staging → production) are documented in [DEPLOYMENT.md](DEPLOYMENT.md); run locally with `scripts/run-local.ps1` or `docker compose -f compose.local.yaml up --build`.

- 1v1 matches and automatic 3-player matches for odd player counts.
- Persistent 3 HP across tournament rounds.
- Host-controlled 20–120 second turn timer and manual start for each new round.
- Quiz and player-versus-player Rock Paper Scissors modes.
- Live matches, spectator mode, tournament bracket, avatars, damage effects, music, and multiple arena tones.
- Downloadable HTML tournament report and leaderboard.
- WebSocket live updates with automatic HTTP polling fallback for restrictive classroom networks.
- Server-issued player session tokens prevent another participant from taking over a player's session.
- Automatic lobby expiration, container restart, persistent SQLite storage, and daily backups.

## Planned account model

No payment is collected during the public beta. The current product model shown to testers is:

- **Free — ₱0:** up to 10 players, 2 custom challenge packs, 50 questions per pack, and 100 custom questions total.
- **Paid subscription — price to be announced:** up to 50 players, 25 private custom challenge packs, 500 questions per pack, 5,000 custom questions total, imports, and instructor answer/review tools.

Anonymous beta access temporarily receives the 50-player allowance with included packs, but does not receive custom-pack or answer-key access. Custom packs are scoped to their owning account and cannot be listed, selected, or inspected by other accounts. These limits and the paid price can change based on beta feedback.

## Requirements

- A deployment computer with Node.js 20 or newer, npm, `tar`, `ssh`, and `scp`
- Amazon Linux 2023 EC2 with outbound internet access
- 1 GB RAM minimum; 4 GB recommended for classroom demos
- 8 GB storage minimum
- TCP 80 open to testers during initial deployment
- TCP 443 open before enabling HTTPS
- TCP 22 restricted to the administrator's IP
- Docker is installed automatically by the deployment script

## Deploy to EC2

Run the deployment command from the computer containing this repository—not from inside EC2. On a new server, first follow the **Private server configuration** section in [INSTALL.md](INSTALL.md). It creates `/etc/zerosum/zerosum.env`, which holds the two initial account credentials and beta settings. Real credentials are intentionally never included in source control.

Windows PowerShell:

```powershell
.\scripts\deploy-docker.ps1 -Ec2Host "EC2_PUBLIC_IP" -KeyPath "C:\path\to\zerosum.pem"
```

Linux or macOS:

```bash
chmod 600 ~/.ssh/zerosum.pem
chmod +x scripts/deploy-docker.sh
./scripts/deploy-docker.sh --host "EC2_PUBLIC_IP" --key ~/.ssh/zerosum.pem
```

If only the EC2 public IP changes, the application does not need to be redeployed. Open the new IP or update DNS. Use the new IP in the command only when deploying a new version.

For later releases, rerun the same deployment command. The installer preserves `/etc/zerosum/zerosum.env`, the SQLite database, backups, and TLS certificates. Do not recreate the environment file during an ordinary redeployment.

See [INSTALL.md](INSTALL.md) for the complete beta installation procedure.

## Domain and HTTPS

Use an Elastic IP before pointing a domain at EC2 so the address does not change when the instance stops.

Create these DNS records:

- `A` record: host `@` -> the EC2 Elastic IP
- `CNAME` record: host `www` -> `zerosum.website`

Allow inbound TCP 80 and 443 in the EC2 security group. After DNS resolves to the EC2 address, deploy the current version and follow the HTTPS command in [INSTALL.md](INSTALL.md). HTTP and public-IP requests redirect to `https://zerosum.website`, and the certificate renews automatically.

## Verify the deployment

Open `http://EC2_PUBLIC_IP`, then create a small tournament and join from a second browser or device.

On the server:

```bash
curl -L http://127.0.0.1/api/health
cd /opt/zerosum/current
sudo docker compose ps
sudo docker compose logs --tail=100 app nginx
```

For live logs:

```bash
cd /opt/zerosum/current
sudo docker compose logs -f app nginx
```

## Data

- Database: `/var/lib/zerosum/zerosum.sqlite`
- Backups: `/var/backups/zerosum/`
- Backups are retained for 14 days.
- Completed tournaments, player records, events, and expired login sessions are removed from the live database after 7 days; backup files retain their separate 14-day lifecycle.

## Security and traffic protection

The included Nginx configuration limits ordinary HTTP traffic, WebSocket handshake bursts, concurrent WebSocket connections, and Docker log growth. Public beta mode also limits one network to 10 tournament creations per 20 minutes and caps the server at 25 simultaneous active tournaments by default.

These controls protect against application abuse and accidental connection storms; they do not stop a large volumetric DDoS attack because that traffic reaches EC2 before Nginx can reject it. AWS Shield Standard provides basic network protection automatically. Before operating Zerosum as a public SaaS, place AWS WAF behind CloudFront or an Application Load Balancer and add rate-based and managed-rule groups there.
