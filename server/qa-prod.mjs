import WebSocket from 'ws';
const BASE = 'https://zerosum.website';
const results = [];
const check = (name, ok, extra = '') => { results.push([ok ? 'PASS' : 'FAIL', name, extra]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const uuid = () => crypto.randomUUID();
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://zerosum.website/ws');
    ws.messages = [];
    ws.waiters = [];
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      ws.messages.push(msg);
      ws.waiters = ws.waiters.filter((w) => { if (w.pred(msg)) { w.resolve(msg); return false; } return true; });
    });
    ws.waitFor = (pred, ms = 20000, label = 'message') => new Promise((res, rej) => {
      const hit = ws.messages.find(pred);
      if (hit) return res(hit);
      const timer = setTimeout(() => rej(new Error('timeout waiting for ' + label)), ms);
      ws.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); res(m); } });
    });
    ws.sendAction = (action, payload = {}) => ws.send(JSON.stringify({ action, ...payload }));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const banksRes = await fetch(BASE + '/api/banks');
const { banks } = await banksRes.json();
const bank = banks.find((b) => b.gameMode !== 'RPS') ?? banks[0];
check('GET /api/banks returns packs', Boolean(bank), bank ? `${banks.length} packs, using "${bank.name}"` : 'none');

// ---------- HOST A TOURNAMENT ----------
const host = await connect();
const hostId = uuid();
host.sendAction('createTournament', { bankId: bank.id, hostPlay: true, hostName: 'QA Host', hostAvatar: 'arena-v2t07', hostPlayerId: hostId, flawlessBonus: true, questionSeconds: 5, arenaTone: 'COMPETITIVE' });
const created = await host.waitFor((m) => m.type === 'created', 20000, 'created').catch(() => null);
check('Host creates tournament (hostPlay on)', Boolean(created?.code), created ? `code ${created.code}` : JSON.stringify(host.messages.at(-1)));
const code = created.code;

const guest = await connect();
const guestId = uuid();
guest.sendAction('join', { code, playerId: guestId, name: 'QA Guest', avatar: 'arena-v4t12' });
const joined = await guest.waitFor((m) => m.type === 'joined', 20000, 'joined').catch(() => null);
check('Guest joins lobby with variant avatar', Boolean(joined?.playerToken));

const lobbySnap = await host.waitFor((m) => m.type === 'snapshot' && m.players?.length >= 2, 20000, 'lobby snapshot').catch(() => null);
check('Lobby shows host-as-player + guest', Boolean(lobbySnap), lobbySnap ? `${lobbySnap.players.length} players, avatars: ${lobbySnap.players.map((p) => p.avatar).join(', ')}` : '');

host.sendAction('startTournament', { code, hostToken: created.hostToken });
const roundSnap = await host.waitFor((m) => m.type === 'snapshot' && m.question?.nonce, 25000, 'round snapshot').catch(() => null);
check('Tournament starts, question dealt', Boolean(roundSnap?.question), roundSnap ? `phase ${roundSnap.tournament.phase}, Q: "${(roundSnap.question.text ?? '').slice(0, 40)}..."` : '');

if (roundSnap?.question) {
  host.sendAction('answer', { code, playerId: hostId, playerToken: created.playerToken, nonce: roundSnap.question.nonce, optionIndex: 0 });
  guest.sendAction('answer', { code, playerId: guestId, playerToken: joined.playerToken, nonce: roundSnap.question.nonce, optionIndex: 1 });
  const after = await host.waitFor((m) => m.type === 'snapshot' && (m.combat || (m.question && m.question.nonce !== roundSnap.question.nonce)), 30000, 'combat/next question').catch(() => null);
  check('Answers resolve into combat / next round', Boolean(after), after?.combat ? `combat: damaged=[${after.combat.damagedIds.length}] skill round ${after.combat.questionNumber}` : 'advanced to next question');
}
host.sendAction('cancelTournament', { code, hostToken: created.hostToken });
const cancelled = await host.waitFor((m) => m.type === 'snapshot' && m.tournament.phase === 'CANCELLED', 15000, 'cancelled').catch(() => null);
check('Host cancels tournament cleanly', Boolean(cancelled));
host.close(); guest.close();

// ---------- SOLO ARCADE ----------
const solo = await connect();
const soloId = uuid();
solo.sendAction('createSoloRun', { playerId: soloId, name: 'QA Solo', avatar: 'arena-v1t03', bankId: bank.id, ladderLength: 5, feedbackMode: 'LEARN', allowChallenge: true, questionSeconds: 5 });
const soloCreated = await solo.waitFor((m) => m.type === 'soloCreated', 20000, 'soloCreated').catch(() => null);
check('Solo Arcade run created vs bot', Boolean(soloCreated?.code), soloCreated ? `code ${soloCreated.code}` : JSON.stringify(solo.messages.at(-1)));
const soloCode = soloCreated.code;

const openRes = await fetch(BASE + '/api/solo/open');
const open = await openRes.json();
const listed = (open.entries ?? open.open ?? []).some((e) => e.code === soloCode) || JSON.stringify(open).includes(soloCode);
check('Live challenges list shows the open solo run', listed);

const s1 = await solo.waitFor((m) => m.type === 'snapshot' && m.question?.nonce, 25000, 'solo question').catch(() => null);
check('Solo first question dealt (bot rival present)', Boolean(s1?.question), s1 ? `players: ${s1.players.map((p) => `${p.name}${p.is_bot ? ' (bot)' : ''}`).join(' vs ')}` : '');
if (s1?.question) {
  solo.sendAction('answer', { code: soloCode, playerId: soloId, playerToken: soloCreated.playerToken, nonce: s1.question.nonce, optionIndex: 0 });
  const s2 = await solo.waitFor((m) => m.type === 'snapshot' && (m.combat || (m.question && m.question.nonce !== s1.question.nonce)), 30000, 'solo combat/next').catch(() => null);
  check('Solo answer resolves (bot answers, combat fires)', Boolean(s2), s2?.combat ? `damaged=[${s2.combat.damagedIds.length}]` : 'next question dealt');
}
solo.sendAction('forfeitSoloRun', { code: soloCode, playerId: soloId });
const ended = await solo.waitFor((m) => m.type === 'snapshot' && m.tournament.phase === 'COMPLETE', 15000, 'solo complete').catch(() => null);
check('Solo forfeit ends the run (phase COMPLETE)', Boolean(ended));
solo.close();

const lbRes = await fetch(BASE + '/api/solo/leaderboard');
const lb = await lbRes.json();
const entries = lb.entries ?? [];
check('Leaderboard API capped at top 5, streak>=2, no forfeits', entries.length <= 5 && entries.every((e) => e.streak >= 2 && e.result !== 'FORFEIT') && !entries.some((e) => e.code === soloCode), `${entries.length} entries`);
const health = await (await fetch(BASE + '/api/health')).json();
check('Server healthy after QA, no stuck tournaments', health.status === 'ok' && health.activeTournaments === 0, `active=${health.activeTournaments}`);

const failed = results.filter((r) => r[0] === 'FAIL');
console.log(`\nQA RESULT: ${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
