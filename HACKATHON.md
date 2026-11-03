# ZeroSum Arena - Meta AI Developer Hackathon Submission Notes

## One-liner
ZeroSum Arena makes learning fun for quizzes: it turns any quiz into a Dragon Ball-inspired battle game, and its AI Pack Forge uses Meta's Muse Spark to turn a teacher's topic or lesson notes into a playable, explanation-rich quiz pack in under a minute.

## Hackathon alignment (Meta Global AI Developer Hackathon, Cerebral Valley)
- Theme: Build for Your World - education. Built by a teacher-adjacent indie developer for real classrooms, exam reviewers, and self-study learners in the Philippines and beyond.
- Track: Indie developer. Judged on creativity, technical ambition, and whether it works - it is live in production today.
- Meta models used: Muse Spark (muse-spark-1.3) via the Meta Model API (api.meta.ai, OpenAI-compatible Chat Completions) powers AI Pack Forge. Structured JSON output is parsed and validated server-side before a pack becomes playable.
- Why it is not a wrapper demo: the AI output feeds a real-time multiplayer engine (WebSocket tournaments for up to 50 players, solo bot ladders, live challenge queue, capped leaderboards) already deployed and playable at https://zerosum.website.

## Who it helps
- Teachers: paste lesson notes -> instant class tournament (up to 50 players, 6-letter join code, no student accounts, downloadable report, instructor review).
- Learners: Solo Arcade practice in Learn mode (explanation after every question) or Exam mode (full review at the end), win-streak leaderboard, challenge live streaks.
- Everyone: ready-made packs on money, jobs, science, history, English, math, cybersecurity, and AWS - learning that feels like a game night.

## Try it (2 minutes)
1. Open https://zerosum.website
2. Solo Arcade -> pick "Science Explorers" -> Start streak run (no account).
3. Host a tournament -> Manage challenge packs -> AI Pack Forge -> topic "Photosynthesis for Grade 6" -> Forge -> start, join from a phone with the code.
4. Check Recent champions and the live challenger board on the homepage.

## Tech
React 19 + TypeScript, Node WebSocket server, SQLite, Docker behind an Nginx reverse proxy, original code-drawn SVG fighters (no copyrighted assets), synthesized WebAudio SFX, Meta Model API for AI generation. DB and storage are deliberately lean: solo leaderboard keeps top 5, hosted champions keep last 10, each account keeps at most 20 created packs, temporary packs auto-delete after 30 days, uploaded PDFs are processed in memory and never stored, and container/app logs are size-rotated.

## Accounts and admin
- The AI has a fixed identity - **ZeroSum Sensei**, a quiz-and-learning specialist. Its system prompt restricts it to educational quiz generation only; out-of-scope requests return a refusal instead of content.
- All host accounts are equal (no tiers): anyone signs up with Google and gets the same limits. Admin rights (pack visibility tools) go to the account emails listed in ADMIN_EMAILS (comma-separated).
- AI Pack Forge is available to every signed-in host, limited to 5 generated packs per account per week (resets every Monday). Guests see the ready-made library instead.
- The admin can hide/show any pack by name (Pack Manager -> Admin - pack visibility); hidden packs disappear for everyone except the admin.
- Forge accepts a custom topic or an uploaded PDF (up to 4 MB / 60 pages; PDF-only by design). Explicit topics are refused before any model call. Text extraction runs locally for free; only an evenly-sampled 8,000-character excerpt is sent to Muse Spark to keep token cost low.
- Signing in lands on the normal homepage (not the pack manager).

## Setup for judges / self-hosting
See README.md and INSTALL.md. To activate AI Pack Forge: get a key at dev.meta.ai, set MODEL_API_KEY in your server environment (see .env.example), and restart the app. Optional: META_MODEL (default muse-spark-1.3). Never commit a real key.
