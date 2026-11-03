# ZeroSum Arena — Learning, Made Fun

**ZeroSum Arena makes learning fun for quizzes.** It turns any quiz into a live, Dragon Ball-inspired battle game: students answer questions to charge up, unleash energy skills, and damage their rival — so reviewing for class or practicing for an exam feels like a fighting game, not a test.

▶ **Play it live: [zerosum.website](https://zerosum.website)** — no downloads, works on phones.

A host picks a challenge pack, players join with a six-letter code (no student accounts), and everyone battles with three HP until one champion remains. Practicing alone? Solo Arcade pits you against bot rivals in a streak ladder.


## Demo flow (2 minutes)

1. **Solo Arcade** → pick a ready-made pack → answer questions, watch your fighter charge and blast the rival bot. Learn mode explains every answer.
2. **Host a tournament** → sign in with Google → create a game, share the 6-letter code, and watch students join from their phones in seconds.
3. **AI Pack Forge** → type a topic like *"Science for Grade 6"* (or upload a lesson PDF) → Meta Muse Spark writes a checked, playable quiz pack in under a minute.
4. Finish the tournament → crown a champion, open the progression view, and download the HTML report.

## Features

- **Battle stage** — original code-drawn fighters with auras, charge animations, energy skills (Scholar Beam, Mind Cannon, Exam Flash), clashes and blocks
- **Live tournaments** — up to 50 players per game, WebSocket updates with an HTTP fallback for restrictive school networks, spectator bracket, event log, downloadable report
- **Host can play** — join your own tournament as a fighter; rounds auto-run and answer keys stay hidden from you
- **Solo Arcade** — Tekken-style ladder against bots (Rookie → Champion), streak leaderboard, and a live Challenge Queue where students can challenge an active streak
- **Ready-made library** — Bato Bato Pick (player-vs-player rock-paper-scissors), AWS Cloud Practitioner Practice, Information Security Awareness, plus more in `data/`
- **Make your own packs** — build in the guided editor, import JSON/CSV, or forge one with AI (5 AI packs per week per host)
- **Accounts without friction** — hosts sign in with Google; players never need an account. All host accounts are equal — no tiers, no paywalls

## Quick start (run it locally)

Requirements: Node.js 20+.

```powershell
# Windows
.\scripts\run-local.ps1
```

```bash
# Any platform
npm ci
npm run build
npm start
```

Then open http://localhost:3000. The server seeds the ready-made packs automatically.

Optional features are switched on with environment variables (see `.env.example`):

| Variable | Enables |
|---|---|
| `GOOGLE_CLIENT_ID` | "Continue with Google" host sign-in (free from Google Cloud Console; no client secret needed) |
| `MODEL_API_KEY` | AI Pack Forge (Meta Model API key from dev.meta.ai) |
| `ADMIN_EMAILS` | Admin rights (pack visibility tools) for those account emails |

Deploying to your own server? Follow [INSTALL.md](INSTALL.md) — one Docker command. More background for judges is in [HACKATHON.md](HACKATHON.md).

## Tech stack

React 19 + TypeScript · Node.js WebSocket server · SQLite · Docker + Nginx · Meta Model API (Muse Spark) for AI pack generation · original SVG/CSS art and synthesized WebAudio sound — no copyrighted assets.

## License

MIT — see [LICENSE](LICENSE). Built for the Meta AI Developer Hackathon.