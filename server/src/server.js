import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { openDatabase } from './database.js';
import { ZerosumGame } from './game.js';
import { log } from './logger.js';
import { accountFromCookie, clearSessionCookie, googleClientId, isAdminAccount, limitsFor, login, loginWithGoogle, logout, publicAccount, sessionCookie, verifyGoogleIdToken } from './auth.js';
import { cleanupExpiredBanks, createBank, deleteBank, ensureSampleBanks, getBank, listBanks, normalizeQuestions, parseBankUpload, updateBank } from './banks.js';
import { aiEnabled, AI_MODEL, generateQuizPack, getForgeQuota, recordForgeUse } from './ai.js';
import { excerptForModel, extractDocumentText } from './document.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '../..');
const publicDir = path.resolve(process.env.PUBLIC_DIR ?? path.join(projectRoot, 'app/dist'));
const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(projectRoot, '.data'));
const starterBankPath = path.resolve(process.env.STARTER_BANK ?? path.join(projectRoot, 'data/starter-bank.json'));
const awsSampleBankPath = path.resolve(process.env.AWS_SAMPLE_BANK ?? path.join(projectRoot, 'data/aws-cloud-practitioner-bank.json'));
const rpsSampleBankPath = path.resolve(process.env.RPS_SAMPLE_BANK ?? path.join(projectRoot, 'data/bato-bato-pick-bank.json'));
const informationSecuritySampleBankPath = path.resolve(process.env.INFORMATION_SECURITY_SAMPLE_BANK ?? path.join(projectRoot, 'data/information-security-foundations-bank.json'));
const securityAwarenessSampleBankPath = path.resolve(process.env.SECURITY_AWARENESS_SAMPLE_BANK ?? path.join(projectRoot, 'data/information-security-awareness-bank.json'));
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const db = openDatabase(dataDir);
const publicBetaMode = String(process.env.PUBLIC_BETA_MODE ?? '').toLowerCase() === 'true';
// Guests (logged out) borrow the earliest host account so they can open a
// lobby with the shared default packs. Guests never get management rights:
// every write route below requires an authenticated session.
const betaAccount = publicBetaMode
  ? db.prepare(`SELECT * FROM accounts ORDER BY created_at LIMIT 1`).get()
  : undefined;
const requestIdentity = (cookieHeader = '') => {
  const authenticatedAccount = accountFromCookie(db, cookieHeader);
  return {
    account: authenticatedAccount ?? (publicBetaMode ? betaAccount : undefined),
    authenticated: Boolean(authenticatedAccount),
    canViewAnswers: Boolean(authenticatedAccount),
    canManagePacks: Boolean(authenticatedAccount),
    isAdmin: Boolean(authenticatedAccount && isAdminAccount(authenticatedAccount)),
  };
};
const browserAccount = (account, authenticated = false) => {
  const safe = publicAccount(account);
  return publicBetaMode && safe && !authenticated ? { ...safe, email: 'guest@zerosum.local', displayName: 'Guest Host' } : safe;
};
const awsSampleBank = JSON.parse(fs.readFileSync(awsSampleBankPath, 'utf8'));
// Pack library is intentionally lean: only these three included packs are seeded.
// The other sample JSON files stay in /data so packs can be restored later.
ensureSampleBanks(db, [
  JSON.parse(fs.readFileSync(rpsSampleBankPath, 'utf8')),
  JSON.parse(fs.readFileSync(securityAwarenessSampleBankPath, 'utf8')),
  { ...awsSampleBank, name: 'AWS Cloud Practitioner Practice' },
]);
const game = new ZerosumGame(db, {
  hideHostQuestions: publicBetaMode,
  maxActiveTournaments: publicBetaMode ? Number(process.env.PUBLIC_BETA_MAX_ACTIVE_TOURNAMENTS ?? 25) : undefined,
});
const loginAttempts = new Map();
const tournamentCreationAttempts = new Map();
const clientAddress = (request) => String(request.headers['x-real-ip'] ?? request.socket.remoteAddress ?? '').trim();

function allowAttempt(store, key, maximum, windowMs) {
  const now = Date.now();
  const attempt = store.get(key);
  if (!attempt || now > attempt.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (attempt.count >= maximum) return false;
  attempt.count += 1;
  return true;
}

const limiterCleanup = setInterval(() => {
  const now = Date.now();
  for (const store of [loginAttempts, tournamentCreationAttempts]) {
    for (const [key, value] of store) if (value.resetAt <= now) store.delete(key);
  }
}, 15 * 60 * 1000).unref();

function requireTournamentCreationAllowance(request) {
  if (!publicBetaMode) return;
  if (!allowAttempt(tournamentCreationAttempts, clientAddress(request), 10, 20 * 60 * 1000)) {
    throw new Error('Too many tournaments were created from this network. Try again later.');
  }
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webp': 'image/webp',
};

function securityHeaders(response) {
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Referrer-Policy', 'same-origin');
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self' https://accounts.google.com; frame-src https://accounts.google.com; connect-src 'self' https://accounts.google.com ws: wss:; img-src 'self' data: https://*.googleusercontent.com;");
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

function readJson(request, maximum = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maximum) {
        reject(new Error('Request is too large.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('Invalid JSON request.')); }
    });
    request.on('error', reject);
  });
}

function httpSocket(account, canViewAnswers = false, restrictToSampleBanks = false) {
  return {
    account, canViewAnswers, restrictToSampleBanks,
    readyState: WebSocket.OPEN,
    messages: [],
    send(value) { this.messages.push(JSON.parse(value)); },
    close() { this.readyState = WebSocket.CLOSED; },
  };
}

const server = http.createServer(async (request, response) => {
  securityHeaders(response);
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  const forwarded = request.headers['x-forwarded-proto'];
  const secure = forwarded === 'https';
  const identity = requestIdentity(request.headers.cookie);
  const { account } = identity;
  if (request.method === 'POST' && request.headers.origin) {
    try {
      if (new URL(request.headers.origin).host !== request.headers.host) return sendJson(response, 403, { error: 'Cross-origin request rejected.' });
    } catch { return sendJson(response, 403, { error: 'Invalid request origin.' }); }
  }
  if (request.method === 'GET' && url.pathname === '/api/config') {
    return sendJson(response, 200, { aiEnabled: aiEnabled(), aiModel: AI_MODEL, websocketUrl: `${secure ? 'wss' : 'ws'}://${request.headers.host}/ws`, publicBeta: publicBetaMode, googleClientId: googleClientId() || null });
  }
  if (request.method === 'GET' && url.pathname === '/api/health') {
    const activeTournaments = db.prepare(`SELECT COUNT(*) AS count FROM tournaments WHERE phase NOT IN ('COMPLETE', 'CANCELLED')`).get().count;
    return sendJson(response, 200, {
      status: 'ok', service: 'zerosum', activeTournaments,
      websocketClients: sockets.clients.size, uptimeSeconds: Math.floor(process.uptime()),
    });
  }
  if (request.method === 'GET' && url.pathname === '/api/me') return sendJson(response, 200, {
    account: browserAccount(account, identity.authenticated) ?? null,
    publicBeta: publicBetaMode, authenticated: identity.authenticated,
    canViewAnswers: identity.canViewAnswers, canManagePacks: identity.canManagePacks, isAdmin: identity.isAdmin, aiEnabled: aiEnabled() && identity.authenticated, aiModel: AI_MODEL, aiQuota: identity.authenticated && account ? getForgeQuota(db, account.id) : null,
  });
  if (request.method === 'GET' && url.pathname === '/api/solo/leaderboard') {
    const entries = db.prepare('SELECT code, name, avatar, bank_name AS bankName, streak, ladder_length AS ladderLength, result, ended_at AS endedAt FROM solo_leaderboard WHERE streak >= 2 AND result != \'FORFEIT\' ORDER BY streak DESC, ended_at DESC LIMIT 5').all();
    return sendJson(response, 200, { entries });
  }
  if (request.method === 'GET' && url.pathname === '/api/tournaments/recent-winners') {
    const entries = db.prepare('SELECT code, champion_name AS championName, champion_avatar AS championAvatar, bank_name AS bankName, player_count AS playerCount, rounds, ended_at AS endedAt FROM tournament_winners ORDER BY ended_at DESC, code DESC LIMIT 10').all();
    return sendJson(response, 200, { entries });
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/tournaments/') && url.pathname.endsWith('/history')) {
    const code = decodeURIComponent(url.pathname.split('/')[3] ?? '').trim().toUpperCase();
    const tournament = db.prepare('SELECT * FROM tournaments WHERE code=?').get(code);
    if (!tournament) return sendJson(response, 404, { error: 'Tournament not found.' });
    if (!['COMPLETE', 'CANCELLED'].includes(tournament.phase)) return sendJson(response, 403, { error: 'History is available after the tournament ends.' });
    const bank = tournament.bank_id ? db.prepare('SELECT name FROM question_banks WHERE id=?').get(tournament.bank_id) : null;
    const players = db.prepare("SELECT id, name, avatar, hp, status FROM players WHERE code=? ORDER BY (status='CHAMPION') DESC, hp DESC, joined_at ASC").all(code);
    const nameOf = new Map(players.map((player) => [player.id, player.name]));
    const matches = db.prepare('SELECT round, participant_ids AS participantIds, winner_id AS winnerId, question_number AS questionNumber FROM matches WHERE code=? ORDER BY round ASC, question_number ASC').all(code)
      .map((match) => {
        let ids = [];
        try { ids = JSON.parse(match.participantIds); } catch { ids = []; }
        return { round: match.round, questionNumber: match.questionNumber, participants: ids.map((id) => nameOf.get(id) ?? 'Unknown'), winnerName: match.winnerId ? (nameOf.get(match.winnerId) ?? null) : null };
      });
    const events = db.prepare('SELECT at, kind, message FROM events WHERE code=? ORDER BY at ASC LIMIT 200').all(code);
    const champion = players.find((player) => player.id === tournament.champion_id) ?? null;
    return sendJson(response, 200, { code, phase: tournament.phase, bankName: bank?.name ?? '', rounds: tournament.round, playerCount: tournament.player_count, champion, players, matches, events });
  }
  if (request.method === 'GET' && url.pathname === '/api/solo/open') {
    const open = db.prepare(`SELECT t.code, t.streak, t.rival_index AS rivalIndex, t.ladder_length AS ladderLength, t.bank_id AS bankId,
      b.name AS bankName, p.name AS playerName, p.avatar AS playerAvatar
      FROM tournaments t LEFT JOIN question_banks b ON b.id = t.bank_id
      LEFT JOIN players p ON p.code = t.code AND p.id = t.solo_player_id
      WHERE t.mode = 'SOLO' AND t.phase = 'IN_ROUND' AND t.allow_challenge = 1 ORDER BY t.streak DESC, t.updated_at DESC LIMIT 50`).all();
    const queue = db.prepare('SELECT bank_id AS bankId, COUNT(*) AS waiting FROM challenge_queue WHERE expires_at > ? GROUP BY bank_id').all(Date.now());
    return sendJson(response, 200, { open, queue });
  }
  if (request.method === 'GET' && url.pathname === '/api/banks') {
    if (!account) return sendJson(response, 401, { error: 'Sign in to manage challenge packs.' });
    const banks = listBanks(db, account.id, identity.isAdmin);
    return sendJson(response, 200, {
      banks: (publicBetaMode && !identity.authenticated ? banks.filter((bank) => Boolean(bank.isSample)) : banks).filter((bank) => identity.isAdmin || !bank.hidden),
      limits: limitsFor(account.plan),
    });
  }
  if (request.method === 'GET' && url.pathname.startsWith('/api/banks/')) {
    if (!identity.authenticated || !account) return sendJson(response, 401, { error: 'Sign in to view challenge packs.' });
    // Any signed-in host may preview packs they own and the shared default packs (enforced in getBank).
    try { return sendJson(response, 200, { bank: getBank(db, account.id, url.pathname.split('/').pop(), identity.isAdmin) }); }
    catch (error) { return sendJson(response, 404, { error: error.message }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/login') {
    const remote = clientAddress(request);
    const attempt = loginAttempts.get(remote) ?? { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    if (Date.now() > attempt.resetAt) Object.assign(attempt, { count: 0, resetAt: Date.now() + 15 * 60 * 1000 });
    if (attempt.count >= 10) return sendJson(response, 429, { error: 'Too many sign-in attempts. Try again later.' });
    try {
      const body = await readJson(request);
      const result = login(db, body.email, body.password);
      loginAttempts.delete(remote);
      return sendJson(response, 200, {
        account: result.account, authenticated: true, canViewAnswers: true,
        canManagePacks: true,
      }, { 'Set-Cookie': sessionCookie(result.token, secure) });
    } catch (error) {
      attempt.count += 1; loginAttempts.set(remote, attempt);
      return sendJson(response, 401, { error: error.message });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/google') {
    if (!googleClientId()) return sendJson(response, 503, { error: 'Google sign-in is not configured on this server.' });
    const remote = clientAddress(request);
    const attempt = loginAttempts.get(remote) ?? { count: 0, resetAt: Date.now() + 15 * 60 * 1000 };
    if (Date.now() > attempt.resetAt) Object.assign(attempt, { count: 0, resetAt: Date.now() + 15 * 60 * 1000 });
    if (attempt.count >= 10) return sendJson(response, 429, { error: 'Too many sign-in attempts. Try again later.' });
    try {
      const body = await readJson(request);
      const profile = await verifyGoogleIdToken(body.credential);
      const result = loginWithGoogle(db, profile);
      loginAttempts.delete(remote);
      return sendJson(response, 200, {
        account: result.account, authenticated: true, canViewAnswers: true,
        canManagePacks: true,
      }, { 'Set-Cookie': sessionCookie(result.token, secure) });
    } catch (error) {
      attempt.count += 1; loginAttempts.set(remote, attempt);
      return sendJson(response, 401, { error: error.message });
    }
  }
  if (request.method === 'POST' && url.pathname === '/api/auth/logout') {
    logout(db, request.headers.cookie);
    return sendJson(response, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie(secure) });
  }
  if (request.method === 'POST' && url.pathname === '/api/admin/packs/visibility') {
    if (!identity.authenticated || !identity.isAdmin) return sendJson(response, 403, { error: 'Admin access required.' });
    try {
      const body = await readJson(request, 4 * 1024);
      const name = String(body.name ?? '').trim(); const hidden = Boolean(body.hidden);
      if (!name) return sendJson(response, 400, { error: 'Pack name is required.' });
      if (hidden) db.prepare('INSERT OR REPLACE INTO hidden_packs (name, hidden_at) VALUES (?,?)').run(name, Date.now());
      else db.prepare('DELETE FROM hidden_packs WHERE name=?').run(name);
      return sendJson(response, 200, { ok: true, name, hidden });
    } catch (error) { return sendJson(response, 400, { error: error.message }); }
  }
  if (request.method === 'PUT' && url.pathname.startsWith('/api/banks/')) {
    if (!identity.authenticated || !account) return sendJson(response, 401, { error: 'Sign in to edit challenge packs.' });
    if (!identity.canManagePacks && !identity.isAdmin) return sendJson(response, 403, { error: 'Sign in to edit challenge packs.' });
    try {
      const body = await readJson(request, 256 * 1024);
      const bank = updateBank(db, account, identity.isAdmin, url.pathname.split('/').pop(), body);
      return sendJson(response, 200, { bank });
    } catch (error) { return sendJson(response, 400, { error: error.message }); }
  }
  if (request.method === 'DELETE' && url.pathname.startsWith('/api/banks/')) {
    if (!identity.authenticated || !account) return sendJson(response, 401, { error: 'Sign in to delete challenge packs.' });
    try {
      const bank = deleteBank(db, account, identity.isAdmin, url.pathname.split('/').pop());
      return sendJson(response, 200, { ok: true, bank });
    } catch (error) { return sendJson(response, 400, { error: error.message }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/banks/import') {
    if (!account) return sendJson(response, 401, { error: 'Sign in to import challenge packs.' });
    if (!identity.canManagePacks) return sendJson(response, 403, { error: 'Sign in to create and import challenge packs.' });
    try {
      const body = await readJson(request, 1100 * 1024);
      const bank = createBank(db, account, limitsFor(account.plan), body.content ? { ...parseBankUpload(body), retention: body.retention } : body);
      return sendJson(response, 201, { bank });
    } catch (error) { return sendJson(response, 400, { error: error.message }); }
  }
  if (request.method === 'POST' && url.pathname === '/api/ai/generate-pack') {
    if (!identity.authenticated || !account) return sendJson(response, 401, { error: 'Sign in to use AI Pack Forge.' });
    if (!allowAttempt(tournamentCreationAttempts, 'ai:' + clientAddress(request), 6, 20 * 60 * 1000)) return sendJson(response, 429, { error: 'Too many AI requests from this network. Try again in a few minutes.' });
    try {
      const body = await readJson(request, 6 * 1024 * 1024);
      cleanupExpiredBanks(db);
      const quota = getForgeQuota(db, account.id);
      if (quota.remaining <= 0) return sendJson(response, 429, { error: `AI Pack Forge weekly limit reached: ${quota.limit} packs per week. Your quota resets on ${new Date(quota.resetsAt).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`, code: 'AI_WEEKLY_LIMIT', aiQuota: quota });
      const ownedPacks = db.prepare('SELECT COUNT(*) AS count FROM question_banks WHERE owner_id=? AND is_sample=0').get(account.id).count;
      const packLimit = Math.min(limitsFor(account.plan).banks, 20);
      if (ownedPacks >= packLimit) return sendJson(response, 400, { error: `Pack limit reached: each account can keep up to ${packLimit} created packs. Delete an old pack to make room.` });
      // Uploaded PDFs are processed in memory only: the file bytes and extracted
      // text live just for this request and are never written to disk or stored.
      if (body.sourceFile?.contentBase64) {
        const extracted = await extractDocumentText(body.sourceFile);
        body.sourceText = extracted.text;
        body.sourceFile = undefined;
        if (!String(body.topic ?? '').trim()) body.topic = 'the uploaded document: ' + String(extracted.name ?? 'lesson.pdf').replace(/\.[^.]+$/, '');
      }
      // Models occasionally return one malformed question; retry once before failing.
      let generated; let questions; let lastError;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          generated = await generateQuizPack(body);
          questions = normalizeQuestions(generated.questions, 25);
          break;
        } catch (error) {
          lastError = error;
          if (error.code === 'AI_NOT_CONFIGURED' || error.code === 'AI_EXPLICIT_CONTENT') throw error;
        }
      }
      body.sourceText = ''; body.sourceFile = undefined;
      if (!generated || !questions) throw lastError ?? new Error('AI Pack Forge could not create that pack.');
      const cleanName = String(generated.name || body.topic || 'AI Quiz Pack').trim().slice(0, 80) || 'AI Quiz Pack';
      const bank = createBank(db, account, limitsFor(account.plan), {
        name: cleanName,
        description: ('AI Forge - made with Meta ' + AI_MODEL + ' and ZeroSum Sensei').slice(0, 300),
        questions,
        retention: body.retention,
      });
      return sendJson(response, 201, { bank, model: AI_MODEL, aiQuota: recordForgeUse(db, account.id) });
    } catch (error) { return sendJson(response, error.code === 'AI_NOT_CONFIGURED' ? 503 : 400, { error: error.message, code: error.code ?? 'AI_ERROR' }); }
  }
  if (request.method === 'POST' && ['/api/action', '/api/sync'].includes(url.pathname)) {
    const socket = httpSocket(account, identity.canViewAnswers, publicBetaMode && !identity.authenticated);
    try {
      const message = await readJson(request);
      if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Invalid request.');
      if (url.pathname === '/api/sync') game.httpSync(socket, message);
      else {
        if (message.action === 'createTournament') requireTournamentCreationAllowance(request);
        if (['answer', 'requestProgression', 'requestLeaderboard'].includes(message.action) && message.playerId) {
          const playerSession = game.authenticatePlayer(message.code, message.playerId, message.playerToken);
          socket.session = { role: 'PLAYER', code: playerSession.code, playerId: playerSession.playerId };
        }
        game.handle(socket, message);
      }
      game.disconnect(socket);
      return sendJson(response, 200, { messages: socket.messages });
    } catch (error) {
      game.disconnect(socket);
      const message = error instanceof Error ? error.message : 'Something went wrong.';
      log('WARN', 'HTTP_CLIENT_MESSAGE_REJECTED', { path: url.pathname, message });
      return sendJson(response, 400, { messages: [{ type: 'error', message }] });
    }
  }
  if (!['GET', 'HEAD'].includes(request.method)) return sendJson(response, 405, { error: 'Method not allowed' });
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return sendJson(response, 400, { error: 'Invalid path' }); }
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  let filePath = path.resolve(publicDir, requested);
  if (!filePath.startsWith(`${publicDir}${path.sep}`) && filePath !== path.join(publicDir, 'index.html')) return sendJson(response, 403, { error: 'Forbidden' });
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) filePath = path.join(publicDir, 'index.html');
  const extension = path.extname(filePath);
  const cache = path.basename(filePath) === 'index.html' ? 'no-cache' : 'public, max-age=31536000, immutable';
  response.writeHead(200, { 'Content-Type': contentTypes[extension] ?? 'application/octet-stream', 'Cache-Control': cache });
  if (request.method === 'HEAD') return response.end();
  fs.createReadStream(filePath).on('error', (error) => {
    log('ERROR', 'STATIC_FILE_ERROR', { message: error.message, filePath });
    if (!response.headersSent) sendJson(response, 500, { error: 'Unable to read site file' });
    else response.destroy();
  }).pipe(response);
});

const sockets = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024, perMessageDeflate: false });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
  if (url.pathname !== '/ws') return socket.destroy();
  const origin = request.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== request.headers.host) return socket.destroy(); }
    catch { return socket.destroy(); }
  }
  sockets.handleUpgrade(request, socket, head, (ws) => {
    const identity = requestIdentity(request.headers.cookie);
    ws.account = identity.account;
    ws.canViewAnswers = identity.canViewAnswers;
    ws.restrictToSampleBanks = publicBetaMode && !identity.authenticated;
    sockets.emit('connection', ws, request);
  });
});

sockets.on('connection', (ws, request) => {
  const connectedAt = Date.now();
  const remoteAddress = clientAddress(request);
  ws.rate = { startedAt: Date.now(), count: 0 };
  log('INFO', 'WEBSOCKET_CONNECTED', { remoteAddress, activeConnections: sockets.clients.size });
  ws.on('message', (raw) => {
    try {
      const now = Date.now();
      if (now - ws.rate.startedAt > 10_000) ws.rate = { startedAt: now, count: 0 };
      if (++ws.rate.count > 40) {
        game.send(ws, { type: 'error', message: 'Too many messages. Please reconnect.' });
        return ws.close(1008, 'Message rate exceeded');
      }
      const message = JSON.parse(raw.toString('utf8'));
      if (message.action === 'createTournament') requireTournamentCreationAllowance(request);
      game.handle(ws, message);
    } catch (error) {
      game.send(ws, { type: 'error', message: error instanceof Error ? error.message : 'Something went wrong.' });
      log('WARN', 'CLIENT_MESSAGE_REJECTED', { remoteAddress, message: error instanceof Error ? error.message : String(error) });
    }
  });
  ws.on('close', (code, reason) => {
    game.disconnect(ws);
    log('INFO', 'WEBSOCKET_CLOSED', {
      remoteAddress, code, reason: reason.toString(), durationMs: Date.now() - connectedAt,
      role: ws.session?.role, tournamentCode: ws.session?.code, activeConnections: sockets.clients.size,
    });
  });
  ws.on('error', (error) => log('WARN', 'WEBSOCKET_ERROR', { remoteAddress, message: error.message }));
});

const heartbeat = setInterval(() => {
  for (const ws of sockets.clients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try { ws.ping(); }
    catch (error) {
      log('WARN', 'WEBSOCKET_HEARTBEAT_ERROR', { message: error instanceof Error ? error.message : String(error) });
      ws.terminate();
    }
  }
}, 25_000);
heartbeat.unref();

server.listen(port, host, () => log('INFO', 'SERVER_STARTED', { host, port, publicDir, dataDir, node: process.version }));

function shutdown(signal) {
  log('INFO', 'SERVER_STOPPING', { signal });
  clearInterval(heartbeat);
  clearInterval(limiterCleanup);
  game.close();
  sockets.close();
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('uncaughtException', (error) => { log('ERROR', 'UNCAUGHT_EXCEPTION', { message: error.message, stack: error.stack }); shutdown('uncaughtException'); });
process.on('unhandledRejection', (error) => log('ERROR', 'UNHANDLED_REJECTION', { message: error instanceof Error ? error.message : String(error) }));
