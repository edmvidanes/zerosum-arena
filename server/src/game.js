import crypto from 'node:crypto';
import { WebSocket } from 'ws';
import { createGroups, difficultyFor, questionSeconds, resolveCombat, resolveRpsCombat } from './engine.js';
import { hydrateMatch, parseJson } from './database.js';
import { log } from './logger.js';
import { limitsFor } from './auth.js';
import { BOT_TIERS, botAnswerDelayMs, botChoosesCorrect, botProfile } from './bots.js';

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (value) => JSON.stringify(value);
const lobbyTimeoutMs = 20 * 60 * 1000;
const rpsMoves = ['Rock 🪨', 'Paper 📄', 'Scissors ✂️'];
const arenaTones = new Set(['RESPECTFUL', 'FRIENDLY', 'COMPETITIVE', 'RAGEBAIT', 'NO_MERCY']);
const arenaTone = (value) => arenaTones.has(String(value ?? '').toUpperCase()) ? String(value).toUpperCase() : 'RESPECTFUL';
const playerAvatars = new Set([
  '☁️', '🤖', '🦊', '🐼', '🐯', '🦄', '👾', '🚀', '🐲', '🐸',
  '🐵', '🦁', '🐨', '🐙', '🦋', '🦖', '🐧', '🦉', '🐺', '🐝',
  '🦈', '🐬', '🐢', '🦀', '🐳', '🐰', '🐻', '🐶', '🐱', '🦝',
  '🦥', '🦦', '🦅', '🦇', '🐔', '🐴', '🐮', '🐷', '🐹', '🐭',
  '🐥', '🦆', '🦜', '🦚', '🐍', '🦎', '🦂', '🕷️', '🐞', '🐌',
]);

export class ZerosumGame {
  constructor(db, options = {}) {
    this.db = db;
    this.hideHostQuestions = Boolean(options.hideHostQuestions);
    this.maxActiveTournaments = Number.isInteger(options.maxActiveTournaments) && options.maxActiveTournaments > 0
      ? options.maxActiveTournaments : Number.POSITIVE_INFINITY;
    this.hosts = new Map();
    this.playerSockets = new Map();
    this.deadlineTimers = new Map();
    this.lobbyTimers = new Map();
    this.botTimers = new Map();
    this.autoTimers = new Map();
    this.queueSockets = new Map();
    this.restoreDeadlines();
    this.restoreLobbyTimers();
    this.cleanupTimer = setInterval(() => this.cleanupOldEvents(), 60 * 60 * 1000).unref();
    log('INFO', 'GAME_ENGINE_READY', { restoredMatches: this.deadlineTimers.size });
  }

  close() {
    clearInterval(this.cleanupTimer);
    for (const timer of this.deadlineTimers.values()) clearTimeout(timer);
    for (const timer of this.lobbyTimers.values()) clearTimeout(timer);
    for (const timer of this.botTimers.values()) clearTimeout(timer);
    for (const timer of this.autoTimers.values()) clearTimeout(timer);
  }

  cleanCode(input) {
    const code = String(input ?? '').trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('Enter a valid six-character tournament code.');
    return code;
  }

  cleanName(input) {
    const name = String(input ?? '').trim().replace(/\s+/g, ' ');
    if (name.length < 1 || name.length > 24) throw new Error('Display names must be 1–24 characters.');
    return name;
  }

  cleanAvatar(input) {
    const avatar = String(input ?? '☁️');
    return playerAvatars.has(avatar) ? avatar : '☁️';
  }

  validPlayerToken(player, token) {
    if (!player?.player_token_hash || typeof token !== 'string' || token.length < 32 || token.length > 128) return false;
    const expected = Buffer.from(player.player_token_hash, 'hex');
    const received = Buffer.from(hash(token), 'hex');
    return expected.length === received.length && crypto.timingSafeEqual(expected, received);
  }

  authenticatePlayer(codeInput, playerIdInput, playerToken) {
    const code = this.cleanCode(codeInput);
    const playerId = String(playerIdInput ?? '');
    const player = this.player(code, playerId);
    if (!player || !this.validPlayerToken(player, playerToken)) throw new Error('Your player session is not valid. Reload and join again.');
    return { code, playerId, player };
  }

  tournament(code) {
    const row = this.db.prepare('SELECT * FROM tournaments WHERE code = ?').get(code);
    if (!row) throw new Error('Tournament not found. Check the game code.');
    return row;
  }

  bankForTournament(code) {
    const tournament = this.tournament(code);
    const bank = this.db.prepare('SELECT * FROM question_banks WHERE id=?').get(tournament.bank_id);
    if (!bank) throw new Error('The selected challenge pack is unavailable.');
    return { ...bank, questions: parseJson(bank.content, []) };
  }

  question(code, id) { return this.bankForTournament(code).questions.find((question) => question.id === id); }

  questionPresentedMessage(question) {
    return this.hideHostQuestions ? `Question ${question.id} presented.` : `Question ${question.id}: ${question.text}`;
  }

  hostCanViewQuestions(ws, tournament = this.tournament(ws.session?.code)) {
    if (!this.hideHostQuestions) return true;
    return Boolean(ws.canViewAnswers && ws.account?.plan === 'PAID' && ws.account.id === tournament.owner_id);
  }

  hostSnapshot(ws, code) {
    const tournament = this.tournament(code);
    if (tournament.host_play) {
      const hostPlayer = this.players(code).find((player) => player.is_host_player);
      if (hostPlayer) return this.snapshot(code, hostPlayer.id);
    }
    return this.snapshot(code, undefined, true, this.hostCanViewQuestions(ws, tournament));
  }

  players(code) { return this.db.prepare('SELECT * FROM players WHERE code = ? ORDER BY joined_at').all(code); }
  player(code, id) { return this.db.prepare('SELECT * FROM players WHERE code = ? AND id = ?').get(code, id); }
  matches(code, round) { return this.db.prepare('SELECT * FROM matches WHERE code = ? AND round = ? ORDER BY id').all(code, round).map(hydrateMatch); }
  allMatches(code) { return this.db.prepare('SELECT * FROM matches WHERE code = ? ORDER BY round, id').all(code).map(hydrateMatch); }
  match(code, id) { return hydrateMatch(this.db.prepare('SELECT * FROM matches WHERE code = ? AND id = ?').get(code, id)); }

  recordEvent(code, kind, message, details = {}) {
    const event = { id: crypto.randomUUID(), at: Date.now(), kind, message, details };
    this.db.prepare('INSERT INTO events (id, code, at, kind, message, details) VALUES (?, ?, ?, ?, ?, ?)')
      .run(event.id, code, event.at, kind, message, json(details));
    log('INFO', kind, { tournamentCode: code, message, details });
    return event;
  }

  cleanupOldEvents() {
    const before = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const result = this.db.transaction(() => ({
      events: this.db.prepare('DELETE FROM events WHERE at < ?').run(before).changes,
      tournaments: this.db.prepare("DELETE FROM tournaments WHERE phase IN ('COMPLETE','CANCELLED') AND updated_at < ?").run(before).changes,
      sessions: this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now()).changes,
    }))();
    if (result.events || result.tournaments || result.sessions) log('INFO', 'DATA_RETENTION_CLEANUP', { deleted: result });
  }

  restoreLobbyTimers() {
    const lobbies = this.db.prepare("SELECT code, created_at FROM tournaments WHERE phase='LOBBY'").all();
    for (const lobby of lobbies) this.scheduleLobbyExpiry(lobby.code, lobby.created_at);
  }

  scheduleLobbyExpiry(code, createdAt) {
    clearTimeout(this.lobbyTimers.get(code));
    const remaining = Math.max(0, createdAt + lobbyTimeoutMs - Date.now());
    const timer = setTimeout(() => this.endLobby(code, 'LOBBY_EXPIRED', 'Lobby expired after 20 minutes without starting.'), remaining);
    timer.unref();
    this.lobbyTimers.set(code, timer);
  }

  endLobby(code, kind, message) {
    const result = this.db.prepare("UPDATE tournaments SET phase='CANCELLED', updated_at=? WHERE code=? AND phase='LOBBY'").run(Date.now(), code);
    if (!result.changes) return false;
    clearTimeout(this.lobbyTimers.get(code));
    this.lobbyTimers.delete(code);
    this.recordEvent(code, kind, message);
    this.broadcast(code);
    return true;
  }

  createTournament(ws, settings = {}) {
    if (!ws.account) throw new Error('Sign in as a host before creating a tournament.');
    const activeTournaments = this.db.prepare("SELECT COUNT(*) AS count FROM tournaments WHERE phase NOT IN ('COMPLETE','CANCELLED')").get().count;
    if (activeTournaments >= this.maxActiveTournaments) throw new Error('The beta arena is currently full. Try again after an active tournament finishes.');
    const flawlessBonus = typeof settings === 'object' ? settings.flawlessBonus !== false : settings !== false;
    const configuredSeconds = questionSeconds(typeof settings === 'object' ? settings.questionSeconds : 20);
    const configuredTone = arenaTone(typeof settings === 'object' ? settings.arenaTone : undefined);
    const bankId = String(settings.bankId ?? '');
    const bank = this.db.prepare('SELECT * FROM question_banks WHERE id=? AND owner_id=?').get(bankId, ws.account.id);
    if (!bank) throw new Error('Select one of your challenge packs.');
    if (ws.restrictToSampleBanks && !bank.is_sample) throw new Error('Anonymous beta hosts can use included challenge packs only.');
    const maxPlayers = limitsFor(ws.account.plan).players;
    const hostPlay = Boolean(settings.hostPlay);
    if (hostPlay && process.env.ENABLE_HOST_PLAY === 'false') throw new Error('Host play is not enabled on this server.');
    let code;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      code = crypto.randomBytes(5).toString('base64url').toUpperCase().replace(/[01IO_-]/g, 'A').slice(0, 6).padEnd(6, 'X');
      if (!this.db.prepare('SELECT 1 FROM tournaments WHERE code = ?').get(code)) break;
    }
    const hostToken = crypto.randomBytes(24).toString('base64url');
    const now = Date.now();
    this.db.prepare(`INSERT INTO tournaments
      (code, phase, round, player_count, active_count, max_hp, flawless_bonus, question_seconds, arena_tone, host_token_hash, created_at, updated_at, owner_id, bank_id, max_players)
      VALUES (?, 'LOBBY', 0, 0, 0, 3, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(code, flawlessBonus ? 1 : 0, configuredSeconds, configuredTone, hash(hostToken), now, now, ws.account.id, bank.id, maxPlayers);
    if (hostPlay) this.db.prepare('UPDATE tournaments SET host_play=1 WHERE code=?').run(code);
    this.attachHost(code, ws);
    let hostPlayer;
    if (hostPlay) {
      const playerId = String(settings.hostPlayerId ?? '');
      if (!/^[a-f0-9-]{20,50}$/i.test(playerId)) throw new Error('Your player session is invalid. Reload and try again.');
      const playerToken = crypto.randomBytes(32).toString('base64url');
      this.db.transaction(() => {
        this.db.prepare(`INSERT INTO players (code, id, name, avatar, hp, status, player_token_hash, joined_at, is_host_player) VALUES (?, ?, ?, ?, 3, 'LOBBY', ?, ?, 1)`)
          .run(code, playerId, this.cleanName(settings.hostName || ws.account.display_name || 'Host'), this.cleanAvatar(settings.hostAvatar), hash(playerToken), Date.now());
        this.db.prepare('UPDATE tournaments SET player_count = player_count + 1, active_count = active_count + 1, updated_at = ? WHERE code = ?').run(Date.now(), code);
      })();
      hostPlayer = { playerId, playerToken };
      if (!this.playerSockets.has(code)) this.playerSockets.set(code, new Map());
      this.playerSockets.get(code).set(playerId, ws);
      ws.session = { role: 'PLAYER', code, playerId };
      this.recordEvent(code, 'HOST_JOINED_AS_PLAYER', 'The host joined the tournament as a player. Rounds will auto-run.', { playerId });
    }
    this.recordEvent(code, 'TOURNAMENT_CREATED', 'Host created the tournament.', { flawlessBonus, questionSeconds: configuredSeconds, arenaTone: configuredTone, bankId: bank.id, bankName: bank.name, maxPlayers });
    this.scheduleLobbyExpiry(code, now);
    this.send(ws, { type: 'created', code, hostToken, ...(hostPlayer ?? {}) });
    this.send(ws, this.hostSnapshot(ws, code));
  }

  hostResume(ws, codeInput, hostToken) {
    const code = this.cleanCode(codeInput);
    const tournament = this.tournament(code);
    if (!ws.account || ws.account.id !== tournament.owner_id) throw new Error('Sign in with the account that created this tournament.');
    if (!hostToken || hash(hostToken) !== tournament.host_token_hash) throw new Error('The instructor session is not valid.');
    this.attachHost(code, ws);
    this.send(ws, this.hostSnapshot(ws, code));
  }

  attachHost(code, ws) {
    if (ws.session?.role === 'HOST' && ws.session.code !== code) this.hosts.get(ws.session.code)?.delete(ws);
    ws.session = { role: 'HOST', code };
    if (!this.hosts.has(code)) this.hosts.set(code, new Set());
    this.hosts.get(code).add(ws);
  }

  join(ws, message) {
    const code = this.cleanCode(message.code);
    const name = this.cleanName(message.name);
    const avatar = this.cleanAvatar(message.avatar);
    const playerId = String(message.playerId ?? '');
    if (!/^[a-f0-9-]{20,50}$/i.test(playerId)) throw new Error('Your player session is invalid. Reload and try again.');
    const tournament = this.tournament(code);
    const existing = this.player(code, playerId);
    let playerToken;
    if (tournament.phase === 'CANCELLED') throw new Error('This tournament was cancelled or its lobby expired. Ask the instructor for a new code.');
    if (!existing) {
      if (tournament.phase !== 'LOBBY') throw new Error('This tournament has already started.');
      if (tournament.player_count >= tournament.max_players) throw new Error(`This tournament is full at ${tournament.max_players} players.`);
      playerToken = crypto.randomBytes(32).toString('base64url');
      this.db.transaction(() => {
        this.db.prepare(`INSERT INTO players (code, id, name, avatar, hp, status, player_token_hash, joined_at) VALUES (?, ?, ?, ?, 3, 'LOBBY', ?, ?)`)
          .run(code, playerId, name, avatar, hash(playerToken), Date.now());
        this.db.prepare('UPDATE tournaments SET player_count = player_count + 1, active_count = active_count + 1, updated_at = ? WHERE code = ?').run(Date.now(), code);
      })();
      this.recordEvent(code, 'PLAYER_JOINED', `${name} joined the lobby.`, { playerId, avatar });
    } else if (!this.validPlayerToken(existing, message.playerToken)) {
      throw new Error('That player session belongs to another browser. Join with a different name or return to your original device.');
    }
    ws.session = { role: 'PLAYER', code, playerId };
    if (!this.playerSockets.has(code)) this.playerSockets.set(code, new Map());
    const previous = this.playerSockets.get(code).get(playerId);
    if (previous && previous !== ws && previous.readyState === WebSocket.OPEN) previous.close(4001, 'Session opened elsewhere');
    this.playerSockets.get(code).set(playerId, ws);
    if (playerToken) this.send(ws, { type: 'joined', code, playerId, playerToken });
    this.broadcast(code);
  }

  start(ws, message) {
    const code = this.cleanCode(message.code);
    const tournament = this.tournament(code);
    if (!ws.account || ws.account.id !== tournament.owner_id) throw new Error('Sign in with the account that created this tournament.');
    if (!message.hostToken || hash(message.hostToken) !== tournament.host_token_hash) throw new Error('Only the instructor can start this tournament.');
    if (!['LOBBY', 'ROUND_BREAK'].includes(tournament.phase)) throw new Error('The next round cannot be started right now.');
    const firstRound = tournament.phase === 'LOBBY';
    const contenders = firstRound
      ? this.players(code)
      : this.db.prepare(`SELECT * FROM players WHERE code=? AND status='WAITING' ORDER BY joined_at`).all(code);
    if (contenders.length < 2) throw new Error('At least two players are required.');
    if (firstRound) {
      clearTimeout(this.lobbyTimers.get(code));
      this.lobbyTimers.delete(code);
    }
    this.buildRound(code, firstRound ? 1 : tournament.round + 1, contenders, tournament.phase);
    this.broadcast(code);
  }

  cancel(ws, message) {
    const code = this.cleanCode(message.code);
    const tournament = this.tournament(code);
    if (!ws.account || ws.account.id !== tournament.owner_id) throw new Error('Sign in with the account that created this tournament.');
    if (!message.hostToken || hash(message.hostToken) !== tournament.host_token_hash) throw new Error('Only the instructor can cancel this tournament.');
    if (tournament.phase !== 'LOBBY') throw new Error('Only a tournament that has not started can be cancelled.');
    this.endLobby(code, 'TOURNAMENT_CANCELLED', 'Instructor cancelled the tournament before it started.');
  }

  shuffled(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const selected = crypto.randomInt(index + 1);
      [result[index], result[selected]] = [result[selected], result[index]];
    }
    return result;
  }

  selectQuestion(code, activeCount, used, salt) {
    const questions = this.bankForTournament(code).questions;
    const preferred = questions.filter((question) => question.difficulty === difficultyFor(activeCount) && !used.includes(question.id));
    const unused = preferred.length ? preferred : questions.filter((question) => !used.includes(question.id));
    const pool = unused.length ? unused : questions;
    const index = crypto.createHash('sha256').update(salt).digest().readUInt32BE(0) % pool.length;
    return pool[index];
  }

  buildRound(code, round, players, expectedPhase) {
    const groups = createGroups(this.shuffled(players.map((player) => player.id)));
    const tournament = this.tournament(code);
    const now = Date.now();
    const matches = groups.map((ids, index) => {
      const id = `r${round}-${String(index + 1).padStart(2, '0')}-${crypto.randomUUID().slice(0, 4)}`;
      const question = this.selectQuestion(code, players.length, [], `${code}:${id}:1`);
      const seconds = questionSeconds(tournament.question_seconds);
      return {
        code, id, round, participantIds: ids, aliveIds: ids,
        hp: Object.fromEntries(ids.map((id) => [id, players.find((player) => player.id === id).hp])),
        damageTaken: Object.fromEntries(ids.map((id) => [id, 0])), answers: {}, phase: 'ANSWERING',
        questionId: question.id, questionNumber: 1, nonce: crypto.randomUUID(), questionStartedAt: now,
        deadline: now + seconds * 1000, usedQuestions: [question.id],
      };
    });
    this.db.transaction(() => {
      const result = this.db.prepare(`UPDATE tournaments SET phase = 'IN_ROUND', round = ?, active_count = ?, updated_at = ? WHERE code = ? AND phase = ?`)
        .run(round, players.length, now, code, expectedPhase);
      if (!result.changes) throw new Error('Tournament phase changed before the round could start.');
      const insertMatch = this.db.prepare(`INSERT INTO matches
        (code,id,round,participant_ids,alive_ids,hp,damage_taken,answers,phase,question_id,question_number,nonce,question_started_at,deadline,used_questions)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
      const updatePlayer = this.db.prepare(`UPDATE players SET status = 'PLAYING', match_id = ? WHERE code = ? AND id = ?`);
      for (const match of matches) {
        insertMatch.run(code, match.id, round, json(match.participantIds), json(match.aliveIds), json(match.hp), json(match.damageTaken), '{}', match.phase,
          match.questionId, 1, match.nonce, now, match.deadline, json(match.usedQuestions));
        for (const playerId of match.participantIds) updatePlayer.run(match.id, code, playerId);
      }
    })();
    this.recordEvent(code, 'ROUND_STARTED', `Round ${round} started with ${players.length} players.`, {
      round, activePlayers: players.length, matches: matches.map((match) => ({ id: match.id, playerIds: match.participantIds, questionId: match.questionId })),
    });
    for (const match of matches) {
      const question = this.question(code, match.questionId);
      this.recordEvent(code, 'QUESTION_PRESENTED', this.questionPresentedMessage(question), {
        round, matchId: match.id, questionId: question.id, questionNumber: 1,
      });
      this.schedule(match);
      this.scheduleBots(code, match);
    }
  }

  answer(ws, message) {
    const code = this.cleanCode(message.code);
    const playerId = String(message.playerId ?? '');
    const optionIndex = Number(message.optionIndex);
    if (!Number.isInteger(optionIndex) || optionIndex < 0 || optionIndex > 7) throw new Error('Choose a valid answer.');
    const player = this.player(code, playerId);
    if (!player || ws.session?.playerId !== playerId || player.status !== 'PLAYING' || !player.match_id) throw new Error('You are not active in this match.');
    return this.submitAnswer(code, playerId, optionIndex, message.nonce);
  }

  submitAnswer(code, playerId, optionIndex, nonce) {
    const player = this.player(code, playerId);
    if (!player) throw new Error('Player not found.');
    const match = this.match(code, player.match_id);
    if (!match || match.phase !== 'ANSWERING' || match.nonce !== nonce || !match.aliveIds.includes(playerId)) throw new Error('This question has ended.');
    const receivedAt = Date.now();
    if (receivedAt > match.deadline) throw new Error('Time is up for this question.');
    if (match.answers[playerId]) throw new Error('Your answer is already locked.');
    match.answers[playerId] = { optionIndex, receivedAt };
    this.db.prepare('UPDATE matches SET answers = ? WHERE code = ? AND id = ? AND phase = ? AND nonce = ?')
      .run(json(match.answers), code, match.id, 'ANSWERING', match.nonce);
    this.recordEvent(code, 'ANSWER_RECEIVED', `${player.name} locked an answer.`, {
      playerId, matchId: match.id, questionId: match.questionId, questionNumber: match.questionNumber,
      responseMs: Math.max(0, receivedAt - match.questionStartedAt), optionIndex,
    });
    if (match.aliveIds.every((id) => Boolean(match.answers[id]))) this.resolveMatch(code, match.id, match.nonce);
    else this.broadcast(code);
  }

  scheduleBots(code, match) {
    const bank = this.bankForTournament(code);
    for (const botId of match.aliveIds) {
      const bot = this.player(code, botId);
      if (!bot?.is_bot) continue;
      const tier = BOT_TIERS.find((item) => item.name === bot.bot_tier) ?? BOT_TIERS[0];
      const profile = { ...tier, tier: tier.name };
      const key = `${code}:${match.id}:${botId}:${match.nonce}`;
      if (this.botTimers.has(key)) continue;
      const delay = botAnswerDelayMs(profile, `${code}:${match.id}:${match.questionNumber}:${botId}`, match.deadline - Date.now());
      if (!Number.isFinite(delay)) continue;
      const timer = setTimeout(() => {
        this.botTimers.delete(key);
        try {
          const fresh = this.match(code, match.id);
          if (!fresh || fresh.phase !== 'ANSWERING' || fresh.nonce !== match.nonce || fresh.answers[botId]) return;
          const question = bank.questions.find((candidate) => candidate.id === fresh.questionId);
          if (!question) return;
          let optionIndex;
          if (bank.game_mode === 'RPS') optionIndex = Math.floor(botAnswerDelayMs(profile, `${key}:move`, 1000) % 3);
          else if (botChoosesCorrect(profile, `${key}:roll`)) optionIndex = question.correctIndex;
          else {
            const wrong = question.options.map((_, index) => index).filter((index) => index !== question.correctIndex);
            optionIndex = wrong[Math.floor(botAnswerDelayMs(profile, `${key}:wrong`, 1000) % wrong.length)] ?? question.correctIndex;
          }
          this.submitAnswer(code, botId, optionIndex, fresh.nonce);
        } catch { /* match already resolved */ }
      }, delay);
      timer.unref();
      this.botTimers.set(key, timer);
    }
  }

  spawnRival(code, tournament, rivalIndex) {
    if (tournament.allow_challenge) {
      const queued = this.db.prepare('SELECT * FROM challenge_queue WHERE bank_id=? AND expires_at>? ORDER BY created_at LIMIT 1').get(tournament.bank_id, Date.now());
      if (queued) {
        this.db.prepare('DELETE FROM challenge_queue WHERE player_id=?').run(queued.player_id);
        this.db.prepare(`INSERT INTO players (code, id, name, avatar, hp, status, player_token_hash, joined_at) VALUES (?, ?, ?, ?, 3, 'WAITING', ?, ?)`)
          .run(code, queued.player_id, queued.name, queued.avatar, queued.token_hash, Date.now());
        const ws = this.queueSockets.get(queued.player_id);
        if (ws) {
          ws.session = { role: 'PLAYER', code, playerId: queued.player_id };
          if (!this.playerSockets.has(code)) this.playerSockets.set(code, new Map());
          this.playerSockets.get(code).set(queued.player_id, ws);
          this.send(ws, { type: 'challengeMatched', code, playerId: queued.player_id });
        }
        this.recordEvent(code, 'CHALLENGER_MATCHED', `${queued.name} answered the challenge call!`, { rivalIndex, playerId: queued.player_id });
        return queued.player_id;
      }
    }
    const profile = botProfile(rivalIndex, tournament.ladder_length, tournament.difficulty_shift ?? 0, `${code}:${rivalIndex}`);
    const botId = `bot-${rivalIndex}-${crypto.randomUUID().slice(0, 8)}`;
    const avatars = [...playerAvatars];
    this.db.prepare(`INSERT INTO players (code, id, name, avatar, hp, status, joined_at, is_bot, bot_tier) VALUES (?, ?, ?, ?, 3, 'WAITING', ?, 1, ?)`)
      .run(code, botId, profile.name, avatars[rivalIndex % avatars.length], Date.now(), profile.tier);
    return botId;
  }

  advanceSolo(code, match) {
    const tournament = this.tournament(code);
    const humanId = tournament.solo_player_id;
    const winnerId = match.winnerId;
    if (winnerId !== humanId) {
      this.db.transaction(() => {
        this.db.prepare(`UPDATE tournaments SET phase='COMPLETE', champion_id=?, streak=?, updated_at=? WHERE code=?`).run(winnerId, tournament.streak, Date.now(), code);
        this.db.prepare(`UPDATE players SET status='CHAMPION' WHERE code=? AND id=?`).run(code, winnerId);
      })();
      this.recordEvent(code, 'STREAK_ENDED', `The streak ended at ${tournament.streak}.`, { winnerId, streak: tournament.streak });
      this.broadcast(code);
      return;
    }
    const streak = (tournament.streak ?? 0) + 1;
    if (streak >= tournament.ladder_length) {
      this.db.transaction(() => {
        this.db.prepare(`UPDATE tournaments SET phase='COMPLETE', champion_id=?, streak=?, updated_at=? WHERE code=?`).run(humanId, streak, Date.now(), code);
        this.db.prepare(`UPDATE players SET status='CHAMPION' WHERE code=? AND id=?`).run(code, humanId);
      })();
      this.recordEvent(code, 'LADDER_CLEARED', 'Ladder cleared!', { streak });
      this.broadcast(code);
      return;
    }
    const rivalIndex = streak + 1;
    const freshTournament = { ...tournament, streak, rival_index: rivalIndex };
    const rivalId = this.spawnRival(code, freshTournament, rivalIndex);
    this.db.transaction(() => {
      this.db.prepare('UPDATE tournaments SET streak=?, rival_index=?, updated_at=? WHERE code=?').run(streak, rivalIndex, Date.now(), code);
      this.db.prepare(`UPDATE players SET hp=3, status='WAITING' WHERE code=? AND id IN (?,?)`).run(code, humanId, rivalId);
    })();
    this.recordEvent(code, 'RIVAL_STARTED', `Rival ${rivalIndex} of ${tournament.ladder_length} steps up. Streak: ${streak}.`, { rivalIndex, streak });
    const contenders = [this.player(code, humanId), this.player(code, rivalId)];
    this.buildRound(code, rivalIndex, contenders, 'IN_ROUND');
    this.broadcast(code);
  }

  createSoloRun(ws, message) {
    if (process.env.ENABLE_SOLO_BOTS === 'false') throw new Error('Solo Arcade is not enabled on this server.');
    const playerId = String(message.playerId ?? '');
    if (!/^[a-f0-9-]{20,50}$/i.test(playerId)) throw new Error('Your player session is invalid. Reload and try again.');
    const name = this.cleanName(message.name);
    const avatar = this.cleanAvatar(message.avatar);
    const bank = this.db.prepare('SELECT * FROM question_banks WHERE id=? AND (is_sample=1 OR owner_id=?)').get(String(message.bankId ?? ''), ws.account?.id ?? '');
    if (!bank) throw new Error('Select one of the available challenge packs.');
    const ladderLength = Math.min(50, Math.max(5, Number(message.ladderLength) || 10));
    const feedbackMode = message.feedbackMode === 'EXAM' ? 'EXAM' : 'LEARN';
    const allowChallenge = Boolean(message.allowChallenge) && process.env.ENABLE_CHALLENGE_QUEUE !== 'false';
    const shift = message.startingDifficulty === 'ROOKIE' ? -1 : message.startingDifficulty === 'EXPERT' ? 1 : 0;
    const configuredSeconds = questionSeconds(message.questionSeconds);
    let code;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      code = crypto.randomBytes(5).toString('base64url').toUpperCase().replace(/[01IO_-]/g, 'A').slice(0, 6).padEnd(6, 'X');
      if (!this.db.prepare('SELECT 1 FROM tournaments WHERE code = ?').get(code)) break;
    }
    const hostToken = crypto.randomBytes(24).toString('base64url');
    const playerToken = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.prepare(`INSERT INTO tournaments
      (code, phase, round, player_count, active_count, max_hp, flawless_bonus, question_seconds, arena_tone, host_token_hash, created_at, updated_at, owner_id, bank_id, max_players, mode, feedback_mode, allow_challenge, ladder_length, streak, rival_index, difficulty_shift, solo_player_id)
      VALUES (?, 'LOBBY', 0, 2, 2, 3, 1, ?, 'COMPETITIVE', ?, ?, ?, ?, ?, 2, 'SOLO', ?, ?, ?, 0, 1, ?, ?)`)
      .run(code, configuredSeconds, hash(hostToken), now, now, ws.account?.id ?? bank.owner_id, bank.id, feedbackMode, allowChallenge ? 1 : 0, ladderLength, shift, playerId);
    this.db.prepare(`INSERT INTO players (code, id, name, avatar, hp, status, player_token_hash, joined_at) VALUES (?, ?, ?, ?, 3, 'WAITING', ?, ?)`)
      .run(code, playerId, name, avatar, hash(playerToken), now);
    const tournament = this.tournament(code);
    const rivalId = this.spawnRival(code, tournament, 1);
    ws.session = { role: 'PLAYER', code, playerId };
    if (!this.playerSockets.has(code)) this.playerSockets.set(code, new Map());
    this.playerSockets.get(code).set(playerId, ws);
    this.recordEvent(code, 'SOLO_RUN_CREATED', `${name} started a Solo Arcade run.`, { bankId: bank.id, ladderLength, feedbackMode, allowChallenge });
    this.buildRound(code, 1, [this.player(code, playerId), this.player(code, rivalId)], 'LOBBY');
    this.send(ws, { type: 'soloCreated', code, playerId, playerToken });
    this.send(ws, this.snapshot(code, playerId));
  }

  joinChallengeQueue(ws, message) {
    if (process.env.ENABLE_CHALLENGE_QUEUE === 'false') throw new Error('Challenge Queue is not enabled on this server.');
    const playerId = String(message.playerId ?? '');
    if (!/^[a-f0-9-]{20,50}$/i.test(playerId)) throw new Error('Your player session is invalid. Reload and try again.');
    const bank = this.db.prepare('SELECT * FROM question_banks WHERE id=? AND (is_sample=1 OR owner_id=?)').get(String(message.bankId ?? ''), ws.account?.id ?? '');
    if (!bank) throw new Error('Select one of the available challenge packs.');
    const queueToken = crypto.randomBytes(32).toString('base64url');
    const now = Date.now();
    this.db.prepare(`INSERT INTO challenge_queue (player_id, bank_id, name, avatar, token_hash, created_at, expires_at) VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(player_id) DO UPDATE SET bank_id=excluded.bank_id, name=excluded.name, avatar=excluded.avatar, token_hash=excluded.token_hash, created_at=excluded.created_at, expires_at=excluded.expires_at`)
      .run(playerId, bank.id, this.cleanName(message.name), this.cleanAvatar(message.avatar), hash(queueToken), now, now + 2 * 60 * 1000);
    this.queueSockets.set(playerId, ws);
    const ahead = this.db.prepare('SELECT COUNT(*) AS count FROM challenge_queue WHERE bank_id=? AND created_at<?').get(bank.id, now).count;
    this.send(ws, { type: 'queued', bankId: bank.id, queueToken, position: ahead + 1 });
  }

  leaveChallengeQueue(ws, message) {
    this.db.prepare('DELETE FROM challenge_queue WHERE player_id=?').run(String(message.playerId ?? ''));
    this.queueSockets.delete(String(message.playerId ?? ''));
    this.send(ws, { type: 'queueLeft' });
  }

  challengeStatus(ws, message) {
    const playerId = String(message.playerId ?? '');
    const row = this.db.prepare('SELECT * FROM challenge_queue WHERE player_id=?').get(playerId);
    if (row) {
      if (!this.validPlayerToken({ player_token_hash: row.token_hash }, message.queueToken)) throw new Error('Your queue session is not valid.');
      this.queueSockets.set(playerId, ws);
      const ahead = this.db.prepare('SELECT COUNT(*) AS count FROM challenge_queue WHERE bank_id=? AND created_at<?').get(row.bank_id, row.created_at).count;
      return this.send(ws, { type: 'queueStatus', status: 'WAITING', position: ahead + 1 });
    }
    const matched = this.db.prepare(`SELECT p.code FROM players p JOIN tournaments t ON t.code=p.code WHERE p.id=? AND t.mode='SOLO' AND t.phase='IN_ROUND'`).get(playerId);
    if (matched) return this.send(ws, { type: 'queueStatus', status: 'MATCHED', code: matched.code });
    return this.send(ws, { type: 'queueStatus', status: 'EXPIRED' });
  }

  schedule(match) {
    const key = `${match.code}:${match.id}`;
    clearTimeout(this.deadlineTimers.get(key));
    const timer = setTimeout(() => this.resolveMatch(match.code, match.id, match.nonce), Math.max(0, match.deadline - Date.now()));
    timer.unref();
    this.deadlineTimers.set(key, timer);
  }

  restoreDeadlines() {
    const rows = this.db.prepare(`SELECT * FROM matches WHERE phase = 'ANSWERING'`).all().map(hydrateMatch);
    for (const match of rows) { this.schedule(match); this.scheduleBots(match.code, match); }
  }

  persistMatch(match) {
    this.db.prepare(`UPDATE matches SET alive_ids=?, hp=?, damage_taken=?, answers=?, phase=?, question_id=?, question_number=?, nonce=?,
      question_started_at=?, deadline=?, used_questions=?, winner_id=?, notice=? WHERE code=? AND id=?`)
      .run(json(match.aliveIds), json(match.hp), json(match.damageTaken), json(match.answers), match.phase, match.questionId, match.questionNumber,
        match.nonce, match.questionStartedAt, match.deadline, json(match.usedQuestions), match.winnerId ?? null, match.notice ?? null, match.code, match.id);
  }

  rpsNotice(code, match, resolution) {
    const names = (ids) => ids.map((id) => this.player(code, id)?.name ?? id).join(' & ');
    const moves = match.aliveIds.map((id) => match.answers[id]?.optionIndex).filter(Number.isInteger);
    if (resolution.timedOutIds.length === match.aliveIds.length) return 'No moves locked — everyone loses 1 HP.';
    if (resolution.timedOutIds.length) return `${names(resolution.timedOutIds)} did not pick — 1 HP lost.`;
    if (resolution.draw) {
      const labels = [...new Set(moves)].map((move) => rpsMoves[move]);
      return `${labels.join(' vs ')} — draw! No damage.`;
    }
    const winningMove = match.answers[resolution.winnerIds[0]]?.optionIndex;
    const losingMove = match.answers[resolution.damagedIds[0]]?.optionIndex;
    const phrases = { '1-0': 'Paper covers Rock', '2-1': 'Scissors cuts Paper', '0-2': 'Rock crushes Scissors' };
    return `${phrases[`${winningMove}-${losingMove}`] ?? `${rpsMoves[winningMove]} beats ${rpsMoves[losingMove]}`} — ${names(resolution.winnerIds)} win${resolution.winnerIds.length === 1 ? 's' : ''}!`;
  }

  resolveMatch(code, matchId, nonce) {
    const match = this.match(code, matchId);
    if (!match || match.phase !== 'ANSWERING' || match.nonce !== nonce) return;
    match.phase = 'RESOLVING';
    this.db.prepare(`UPDATE matches SET phase = 'RESOLVING' WHERE code = ? AND id = ? AND phase = 'ANSWERING' AND nonce = ?`).run(code, matchId, nonce);
    const tournament = this.tournament(code);
    const bank = this.bankForTournament(code);
    const question = bank.questions.find((candidate) => candidate.id === match.questionId);
    const isRps = bank.game_mode === 'RPS';
    const correctPlayerIds = isRps ? [] : match.aliveIds.filter((id) => match.answers[id]?.optionIndex === question.correctIndex);
    const resolution = isRps
      ? resolveRpsCombat({ aliveIds: match.aliveIds, hp: match.hp, answers: match.answers })
      : resolveCombat({ aliveIds: match.aliveIds, hp: match.hp, answers: match.answers, correctIndex: question.correctIndex });
    const choices = isRps ? Object.fromEntries(match.aliveIds.map((id) => [id, Number.isInteger(match.answers[id]?.optionIndex) ? rpsMoves[match.answers[id].optionIndex] : 'Timeout'])) : undefined;
    const rpsRoundNotice = isRps ? this.rpsNotice(code, match, resolution) : undefined;
    const newlyDead = match.aliveIds.filter((id) => !resolution.survivors.includes(id));
    for (const id of resolution.damagedIds) match.damageTaken[id] = (match.damageTaken[id] ?? 0) + 1;
    const timedOutPlayerIds = match.aliveIds.filter((id) => !match.answers[id]);
    const key = `${code}:${match.id}`;
    clearTimeout(this.deadlineTimers.get(key));
    this.deadlineTimers.delete(key);

    if (resolution.survivors.length === 1) {
      const winnerId = resolution.survivors[0];
      resolution.hp[winnerId] = tournament.flawless_bonus && match.damageTaken[winnerId] === 0
        ? Math.min(tournament.max_hp, resolution.hp[winnerId] + 1) : resolution.hp[winnerId];
      match.hp = resolution.hp; match.aliveIds = resolution.survivors; match.phase = 'COMPLETE'; match.winnerId = winnerId;
      match.notice = isRps ? `${rpsRoundNotice} ${this.player(code, winnerId)?.name ?? winnerId} advances!` : 'Match complete';
      this.db.transaction(() => {
        this.persistMatch(match);
        for (const id of match.aliveIds) this.db.prepare(`UPDATE players SET hp=?, status='WAITING' WHERE code=? AND id=?`).run(match.hp[id], code, id);
        for (const id of newlyDead) this.db.prepare(`UPDATE players SET hp=0, status='ELIMINATED' WHERE code=? AND id=?`).run(code, id);
        if (newlyDead.length) this.db.prepare('UPDATE tournaments SET active_count=active_count-?, updated_at=? WHERE code=?').run(newlyDead.length, Date.now(), code);
      })();
      this.recordEvent(code, 'MATCH_COMPLETED', `Match ${match.id} was won by ${this.player(code, winnerId)?.name ?? winnerId}.`, {
        round: match.round, matchId: match.id, winnerId, eliminatedPlayerIds: newlyDead, questionId: match.questionId,
        questionNumber: match.questionNumber, fastestCorrectId: resolution.fastestCorrectId, damagedPlayerIds: resolution.damagedIds,
        hp: resolution.hp, timedOutPlayerIds, gameMode: bank.game_mode, choices, result: rpsRoundNotice,
      });
      if (tournament.mode === 'SOLO') this.advanceSolo(code, match);
      else this.advanceIfReady(code, match.round);
      return;
    }

    const nextActive = tournament.active_count - newlyDead.length;
    const nextNumber = match.questionNumber + 1;
    const nextQuestion = this.selectQuestion(code, nextActive, match.usedQuestions, `${code}:${match.id}:${nextNumber}`);
    const seconds = questionSeconds(tournament.question_seconds);
    match.hp = resolution.hp; match.aliveIds = resolution.survivors; match.answers = {}; match.phase = 'ANSWERING';
    match.questionId = nextQuestion.id; match.questionNumber = nextNumber; match.nonce = crypto.randomUUID();
    match.questionStartedAt = Date.now(); match.deadline = match.questionStartedAt + seconds * 1000; match.usedQuestions.push(nextQuestion.id);
    match.notice = resolution.clashPoint
      ? 'Double knockout! Clash Point resets everyone to 1 HP.'
      : isRps
        ? rpsRoundNotice
      : newlyDead.length
        ? 'Skirmish eliminated one player. Final duel begins!'
        : correctPlayerIds.length === 0
          ? 'No correct answer — everyone loses 1 HP.'
          : 'Damage resolved.';
    this.db.transaction(() => {
      this.persistMatch(match);
      for (const id of match.aliveIds) this.db.prepare(`UPDATE players SET hp=?, status='PLAYING' WHERE code=? AND id=?`).run(match.hp[id], code, id);
      for (const id of newlyDead) this.db.prepare(`UPDATE players SET hp=0, status='ELIMINATED' WHERE code=? AND id=?`).run(code, id);
      if (newlyDead.length) this.db.prepare('UPDATE tournaments SET active_count=active_count-?, updated_at=? WHERE code=?').run(newlyDead.length, Date.now(), code);
    })();
    this.recordEvent(code, 'QUESTION_RESOLVED', match.notice, {
      round: match.round, matchId: match.id, questionId: question.id, questionNumber: nextNumber - 1,
      fastestCorrectId: resolution.fastestCorrectId, damagedPlayerIds: resolution.damagedIds,
      eliminatedPlayerIds: newlyDead, hp: resolution.hp, timedOutPlayerIds, gameMode: bank.game_mode, choices, result: rpsRoundNotice,
    });
    this.recordEvent(code, 'QUESTION_PRESENTED', this.questionPresentedMessage(nextQuestion), {
      round: match.round, matchId: match.id, questionId: nextQuestion.id, questionNumber: nextNumber,
    });
    this.schedule(match);
    this.scheduleBots(code, match);
    this.broadcast(code);
  }

  advanceIfReady(code, round) {
    const tournament = this.tournament(code);
    const matches = this.matches(code, round);
    if (!matches.length || matches.some((match) => match.phase !== 'COMPLETE')) {
      this.broadcast(code);
      return;
    }
    const transition = this.db.prepare(`UPDATE tournaments SET phase='ROUND_BREAK', updated_at=? WHERE code=? AND phase='IN_ROUND' AND round=?`).run(Date.now(), code, round);
    if (!transition.changes) return;
    const winners = this.db.prepare(`SELECT * FROM players WHERE code=? AND status='WAITING' ORDER BY joined_at`).all(code);
    if (winners.length === 1) {
      const winner = winners[0];
      this.db.transaction(() => {
        this.db.prepare(`UPDATE tournaments SET phase='COMPLETE', champion_id=?, active_count=1, updated_at=? WHERE code=?`).run(winner.id, Date.now(), code);
        this.db.prepare(`UPDATE players SET status='CHAMPION' WHERE code=? AND id=?`).run(code, winner.id);
      })();
      this.recordEvent(code, 'CHAMPION_CROWNED', `${winner.name} won the tournament!`, { playerId: winner.id, hp: winner.hp, round });
    } else {
      this.recordEvent(code, 'ROUND_COMPLETED', `Round ${round} finished. Waiting for the instructor to start Round ${round + 1}.`, {
        round, nextRound: round + 1, survivingPlayerIds: winners.map((winner) => winner.id),
      });
      if (tournament.host_play) {
        clearTimeout(this.autoTimers.get(code));
        const timer = setTimeout(() => {
          this.autoTimers.delete(code);
          const current = this.tournament(code);
          if (current.phase !== 'ROUND_BREAK') return;
          const contenders = this.db.prepare(`SELECT * FROM players WHERE code=? AND status='WAITING' ORDER BY joined_at`).all(code);
          if (contenders.length < 2) return;
          this.buildRound(code, current.round + 1, contenders, 'ROUND_BREAK');
          this.broadcast(code);
        }, 8000);
        timer.unref();
        this.autoTimers.set(code, timer);
      }
    }
    this.broadcast(code);
  }

  snapshot(code, playerId, includeHostData = false, revealHostQuestions = includeHostData && !this.hideHostQuestions) {
    const tournament = this.tournament(code);
    const players = this.players(code);
    const matches = this.matches(code, tournament.round);
    const matchHistory = includeHostData ? this.allMatches(code) : [];
    const includeQuestionData = includeHostData && revealHostQuestions;
    const usedQuestionIds = includeQuestionData ? [...new Set(matchHistory.flatMap((item) => item.usedQuestions))] : [];
    const me = playerId ? players.find((player) => player.id === playerId) : undefined;
    const match = me?.match_id ? matches.find((candidate) => candidate.id === me.match_id) : undefined;
    const bank = this.bankForTournament(code);
    const questionById = new Map(bank.questions.map((question) => [question.id, question]));
    const loadedQuestion = me?.status === 'PLAYING' && match?.phase === 'ANSWERING' ? questionById.get(match.questionId) : undefined;
    const events = !playerId ? this.db.prepare('SELECT * FROM events WHERE code=? ORDER BY at DESC LIMIT 100').all(code) : [];
    let combat;
    if (playerId && me?.match_id) {
      const recent = this.db.prepare(`SELECT * FROM events WHERE code=? AND kind IN ('QUESTION_RESOLVED','MATCH_COMPLETED') ORDER BY at DESC LIMIT 20`).all(code);
      const event = recent.find((candidate) => parseJson(candidate.details, {}).matchId === me.match_id);
      if (event) {
        const details = parseJson(event.details, {});
        combat = {
          key: event.id, at: event.at, questionNumber: details.questionNumber ?? 0,
          fastestCorrectId: details.fastestCorrectId, winnerId: details.winnerId,
          damagedIds: details.damagedPlayerIds ?? [], eliminatedIds: details.eliminatedPlayerIds ?? [],
        };
        const resolvedQuestion = details.questionId ? questionById.get(details.questionId) : undefined;
        if (resolvedQuestion && ((tournament.feedback_mode ?? 'LEARN') === 'LEARN' || tournament.phase === 'COMPLETE')) {
          combat.correctIndex = resolvedQuestion.correctIndex;
          combat.explanation = resolvedQuestion.explanation;
          combat.myCorrect = me ? details.fastestCorrectId === me.id || !(details.damagedPlayerIds ?? []).includes(me.id) && (details.fastestCorrectId !== undefined) : undefined;
        }
      }
    }
    return {
      type: 'snapshot',
      tournament: {
        code, phase: tournament.phase,
        round: tournament.round, playerCount: tournament.player_count, activeCount: tournament.active_count,
        championId: tournament.champion_id ?? undefined, flawlessBonus: Boolean(tournament.flawless_bonus),
        questionSeconds: tournament.question_seconds, arenaTone: arenaTone(tournament.arena_tone),
        maxPlayers: tournament.max_players, bankId: tournament.bank_id, bankName: bank.name, gameMode: bank.game_mode,
        mode: tournament.mode ?? 'CLASS', hostPlay: Boolean(tournament.host_play), feedbackMode: tournament.feedback_mode ?? 'LEARN',
        allowChallenge: Boolean(tournament.allow_challenge), ladderLength: tournament.ladder_length ?? 0,
        streak: tournament.streak ?? 0, rivalIndex: tournament.rival_index ?? 0,
        lobbyExpiresAt: tournament.phase === 'LOBBY' ? tournament.created_at + lobbyTimeoutMs : undefined,
      },
      players: players.map((player) => ({ id: player.id, name: player.name, avatar: player.avatar, hp: player.hp, status: player.status, matchId: player.match_id ?? undefined, isBot: Boolean(player.is_bot), botTier: player.bot_tier ?? undefined, isHostPlayer: Boolean(player.is_host_player) })),
      matches: matches.map((item) => ({ id: item.id, participantIds: item.participantIds, aliveIds: item.aliveIds, phase: item.phase, questionNumber: item.questionNumber, winnerId: item.winnerId })),
      matchHistory: includeHostData ? matchHistory.map((item) => ({
        id: item.id, round: item.round, participantIds: item.participantIds, aliveIds: item.aliveIds,
        phase: item.phase, questionNumber: item.questionNumber, winnerId: item.winnerId, hp: item.hp, questionIds: item.usedQuestions,
      })) : undefined,
      reviewQuestions: includeQuestionData ? usedQuestionIds.map((id) => questionById.get(id)).filter(Boolean)
        : (playerId && tournament.mode === 'SOLO' && tournament.phase === 'COMPLETE'
          ? [...new Set(this.allMatches(code).flatMap((item) => item.usedQuestions))].map((id) => questionById.get(id)).filter(Boolean) : undefined),
      me: me && { id: me.id, name: me.name, avatar: me.avatar, hp: me.hp, status: me.status, matchId: me.match_id ?? undefined, isBot: Boolean(me.is_bot), botTier: me.bot_tier ?? undefined, isHostPlayer: Boolean(me.is_host_player) },
      combat,
      question: loadedQuestion && { id: loadedQuestion.id, text: loadedQuestion.text, options: loadedQuestion.options, domain: loadedQuestion.domain, nonce: match.nonce, deadline: match.deadline, number: match.questionNumber },
      questionBank: includeQuestionData && tournament.phase === 'LOBBY' ? bank.questions.map((question) => ({
        id: question.id, domain: question.domain, text: question.text, options: question.options,
        correctIndex: question.correctIndex, explanation: question.explanation, difficulty: question.difficulty,
      })) : undefined,
      questionBankInfo: includeQuestionData && tournament.phase === 'LOBBY' ? { title: bank.name, version: bank.version, eligibleQuestions: bank.question_count, totalQuestions: bank.question_count, excludedMultiSelect: 0 } : undefined,
      events: playerId ? undefined : events.map((event) => ({ id: event.id, at: event.at, kind: event.kind, message: event.message, details: parseJson(event.details, {}) })),
      serverNow: Date.now(), notice: match?.notice,
    };
  }

  send(ws, payload) {
    if (ws.readyState === WebSocket.OPEN) ws.send(json(payload));
  }

  broadcast(code) {
    for (const ws of this.hosts.get(code) ?? []) this.send(ws, this.hostSnapshot(ws, code));
    for (const [playerId, ws] of this.playerSockets.get(code) ?? []) this.send(ws, this.snapshot(code, playerId));
  }

  disconnect(ws) {
    const session = ws.session;
    if (!session) return;
    if (session.role === 'HOST') this.hosts.get(session.code)?.delete(ws);
    if (session.role === 'PLAYER' && this.playerSockets.get(session.code)?.get(session.playerId) === ws) this.playerSockets.get(session.code).delete(session.playerId);
  }

  report(ws, message) {
    const code = this.cleanCode(message.code);
    const tournament = this.tournament(code);
    if (!ws.account || ws.account.id !== tournament.owner_id) throw new Error('Sign in with the account that created this tournament.');
    if (!message.hostToken || hash(message.hostToken) !== tournament.host_token_hash) throw new Error('Only the instructor can export this tournament.');
    const snapshot = this.hostSnapshot(ws, code);
    const events = this.db.prepare('SELECT * FROM events WHERE code=? ORDER BY at').all(code)
      .map((event) => ({ id: event.id, at: event.at, kind: event.kind, message: event.message, details: parseJson(event.details, {}) }));
    this.send(ws, {
      type: 'report', tournament: snapshot.tournament, players: snapshot.players,
      matchHistory: snapshot.matchHistory, reviewQuestions: snapshot.reviewQuestions ?? [], events,
    });
  }

  authorizeTournamentViewer(ws, code, message) {
    const tournament = this.tournament(code);
    if (message.hostToken) {
      if (!ws.account || ws.account.id !== tournament.owner_id) throw new Error('Sign in with the account that created this tournament.');
      if (hash(message.hostToken) !== tournament.host_token_hash) throw new Error('Only the instructor can view this tournament.');
      return tournament;
    }
    if (ws.session?.role !== 'PLAYER' || ws.session.code !== code || !this.player(code, ws.session.playerId)) {
      throw new Error('Join this tournament before opening its spectator view.');
    }
    return tournament;
  }

  progression(ws, message) {
    const code = this.cleanCode(message.code);
    this.authorizeTournamentViewer(ws, code, message);
    const snapshot = this.snapshot(code, undefined, true);
    this.send(ws, {
      type: 'progression', tournament: snapshot.tournament,
      players: snapshot.players, matchHistory: snapshot.matchHistory,
    });
  }

  leaderboard(ws, message) {
    const code = this.cleanCode(message.code);
    const tournament = this.authorizeTournamentViewer(ws, code, message);
    if (tournament.phase !== 'COMPLETE') throw new Error('The leaderboard is available after the tournament ends.');
    const snapshot = this.snapshot(code, undefined, true);
    this.send(ws, {
      type: 'leaderboard', tournament: snapshot.tournament,
      players: snapshot.players, matchHistory: snapshot.matchHistory,
    });
  }

  httpSync(ws, message) {
    const code = this.cleanCode(message.code);
    const tournament = this.tournament(code);
    if (message.hostToken) {
      if (!ws.account || ws.account.id !== tournament.owner_id) throw new Error('Sign in with the account that created this tournament.');
      if (hash(message.hostToken) !== tournament.host_token_hash) throw new Error('The instructor session is not valid.');
      return this.send(ws, this.hostSnapshot(ws, code));
    }
    const { playerId } = this.authenticatePlayer(code, message.playerId, message.playerToken);
    ws.session = { role: 'PLAYER', code, playerId };
    return this.send(ws, this.snapshot(code, playerId));
  }

  handle(ws, message) {
    switch (message.action) {
      case 'createTournament': return this.createTournament(ws, { flawlessBonus: message.flawlessBonus, questionSeconds: message.questionSeconds, arenaTone: message.arenaTone, bankId: message.bankId, hostPlay: message.hostPlay, hostName: message.hostName, hostAvatar: message.hostAvatar, hostPlayerId: message.hostPlayerId });
      case 'createSoloRun': return this.createSoloRun(ws, message);
      case 'joinChallengeQueue': return this.joinChallengeQueue(ws, message);
      case 'leaveChallengeQueue': return this.leaveChallengeQueue(ws, message);
      case 'challengeStatus': return this.challengeStatus(ws, message);
      case 'hostResume': return this.hostResume(ws, message.code, message.hostToken);
      case 'join': return this.join(ws, message);
      case 'startTournament': return this.start(ws, message);
      case 'cancelTournament': return this.cancel(ws, message);
      case 'requestReport': return this.report(ws, message);
      case 'requestProgression': return this.progression(ws, message);
      case 'requestLeaderboard': return this.leaderboard(ws, message);
      case 'answer': return this.answer(ws, message);
      case 'sync': {
        if (ws.session?.role === 'HOST') return this.send(ws, this.hostSnapshot(ws, ws.session.code));
        if (ws.session?.role === 'PLAYER') return this.send(ws, this.snapshot(ws.session.code, ws.session.playerId));
        throw new Error('Join or host a tournament before syncing.');
      }
      default: throw new Error('Unknown action.');
    }
  }
}
