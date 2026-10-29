import WebSocket from 'ws';
const BASE = 'https://zerosum.website';
const results = [];
const check = (name, ok, extra = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };
const uuid = () => crypto.randomUUID();
function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://zerosum.website/ws');
    ws.messages = []; ws.waiters = [];
    ws.on('message', (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      ws.messages.push(msg);
      ws.waiters = ws.waiters.filter((w) => { if (w.pred(msg)) { w.resolve(msg); return false; } return true; });
    });
    ws.waitFor = (pred, ms = 30000, label = 'message') => new Promise((res, rej) => {
      const hit = ws.messages.find(pred);
      if (hit) return res(hit);
      const timer = setTimeout(() => rej(new Error('timeout: ' + label)), ms);
      ws.waiters.push({ pred, resolve: (m) => { clearTimeout(timer); res(m); } });
    });
    ws.sendAction = (action, payload = {}) => ws.send(JSON.stringify({ action, ...payload }));
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

const { banks } = await (await fetch(BASE + '/api/banks')).json();
const bank = banks.find((b) => b.gameMode !== 'RPS') ?? banks[0];

const host = await connect();
host.sendAction('createTournament', { bankId: bank.id, hostPlay: false, flawlessBonus: true, questionSeconds: 5, arenaTone: 'COMPETITIVE' });
const created = await host.waitFor((m) => m.type === 'created', 20000, 'created');
check('Host creates tournament', Boolean(created?.code), `code ${created?.code}`);
const code = created.code;

const mk = async (name, avatar) => {
  const ws = await connect();
  const playerId = uuid();
  ws.sendAction('join', { code, playerId, name, avatar });
  const joined = await ws.waitFor((m) => m.type === 'joined', 20000, 'joined');
  return { ws, playerId, token: joined.playerToken, name };
};
const g1 = await mk('QA Champion-1', 'arena-v2t05');
const g2 = await mk('QA Champion-2', 'arena-v5t19');
check('Two guests join the lobby', Boolean(g1.token && g2.token));

host.sendAction('startTournament', { code, hostToken: created.hostToken });

// Answer every question as it appears until the tournament completes.
let answeredNonce = '';
let questionsAnswered = 0;
const deadline = Date.now() + 240000;
let finalSnap = null;
while (Date.now() < deadline) {
  const snap = [...g1.ws.messages].reverse().find((m) => m.type === 'snapshot');
  if (snap?.tournament?.phase === 'COMPLETE') { finalSnap = snap; break; }
  const q = snap?.question;
  if (q?.nonce && q.nonce !== answeredNonce) {
    answeredNonce = q.nonce;
    questionsAnswered += 1;
    g1.ws.sendAction('answer', { code, playerId: g1.playerId, playerToken: g1.token, nonce: q.nonce, optionIndex: questionsAnswered % 2 });
    g2.ws.sendAction('answer', { code, playerId: g2.playerId, playerToken: g2.token, nonce: q.nonce, optionIndex: (questionsAnswered + 1) % 3 });
  }
  await new Promise((r) => setTimeout(r, 250));
  const done = await g1.ws.waitFor((m) => m.type === 'snapshot' && m.tournament.phase === 'COMPLETE', 400, 'complete').catch(() => null);
  if (done) { finalSnap = done; break; }
}
check('Hosted tournament plays to completion', Boolean(finalSnap), `${questionsAnswered} questions answered`);
const championId = finalSnap?.tournament?.championId;
const champion = finalSnap?.players?.find((p) => p.id === championId);
check('A champion is crowned', Boolean(champion), champion ? `${champion.name} (${champion.avatar})` : 'none');

const winners = await (await fetch(BASE + '/api/tournaments/recent-winners')).json();
const entry = (winners.entries ?? []).find((e) => e.code === code);
check('Recent-winners API lists this champion (top 5)', Boolean(entry) && entry.championName === champion?.name && (winners.entries?.length ?? 99) <= 5, entry ? `${entry.championName} · ${entry.bankName} · ${entry.playerCount} players · ${entry.rounds} rounds` : JSON.stringify(winners).slice(0, 160));

const histRes = await fetch(`${BASE}/api/tournaments/${code}/history`);
const hist = await histRes.json();
check('History API returns the finished tournament', histRes.ok && hist.champion?.name === champion?.name, histRes.ok ? `champion ${hist.champion?.name}` : JSON.stringify(hist).slice(0, 120));
check('History has standings, matches and timeline', hist.players?.length === 2 && hist.matches?.length >= 1 && hist.events?.length >= 5, `players=${hist.players?.length} matches=${hist.matches?.length} events=${hist.events?.length}`);
check('History match rows name a winner', hist.matches?.some((m) => m.winnerName), hist.matches?.map((m) => `R${m.round}Q${m.questionNumber}:${m.winnerName ?? '-'}`).slice(0, 6).join(' ') ?? '');
const bogus = await fetch(`${BASE}/api/tournaments/ZZZZZZ/history`);
check('History for unknown code returns 404', bogus.status === 404, `status ${bogus.status}`);

const health = await (await fetch(BASE + '/api/health')).json();
check('Server healthy after QA', health.status === 'ok', `active=${health.activeTournaments} (includes any live user sessions)`);
host.close(); g1.ws.close(); g2.ws.close();
console.log(`\nQA RESULT: ${results.filter(Boolean).length}/${results.length} passed`);
process.exit(results.every(Boolean) ? 0 : 1);
