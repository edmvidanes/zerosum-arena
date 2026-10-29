import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/database.js';
import { ZerosumGame } from '../src/game.js';

class FakeSocket {
  readyState = 1;
  messages = [];
  send(value) { this.messages.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
}

function prepareHost(db, here) {
  const account = { id: 'account-test-paid', email: 'paid@test.local', display_name: 'Paid Host', plan: 'PAID' };
  db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(account.id, account.email, account.display_name, account.plan, 'salt', 'hash', Date.now());
  const source = JSON.parse(fs.readFileSync(path.resolve(here, '../../data/starter-bank.json'), 'utf8'));
  const questions = source.questions.map((question, index) => ({ ...question, id: `test-${index + 1}`, text: question.prompt, type: question.options.length === 2 ? 'TRUE_FALSE' : 'MULTIPLE_CHOICE' }));
  db.prepare(`INSERT INTO question_banks (id,owner_id,name,description,version,question_count,content,created_at,updated_at) VALUES (?,?,?,?,1,?,?,?,?)`)
    .run('bank-test', account.id, source.name, source.description, questions.length, JSON.stringify(questions), Date.now(), Date.now());
  const host = new FakeSocket();
  host.account = account;
  return { host, bankId: 'bank-test', questions };
}

test('a three-player tournament runs from lobby to champion with a durable audit trail', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-clash-test-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db);
  try {
    const { host, bankId, questions } = prepareHost(db, here);
    assert.ok(new Set(questions.map((question) => question.correctIndex)).size > 1);
    game.createTournament(host, { flawlessBonus: true, bankId });
    const created = host.messages.find((message) => message.type === 'created');
    assert.match(created.code, /^[A-Z2-9]{6}$/);
    assert.equal(game.tournament(created.code).arena_tone, 'RESPECTFUL');
    const players = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333'];
    const sockets = players.map(() => new FakeSocket());
    players.forEach((playerId, index) => game.join(sockets[index], { code: created.code, playerId, name: `Player ${index + 1}`, avatar: index === 0 ? '🚀' : '🐼' }));
    assert.equal(game.player(created.code, players[0]).avatar, '🚀');
    game.start(host, { code: created.code, hostToken: created.hostToken });

    for (let question = 0; question < 3; question += 1) {
      const match = game.matches(created.code, 1)[0];
      const correctIndex = game.question(created.code, match.questionId).correctIndex;
      game.answer(sockets[0], { code: created.code, playerId: players[0], nonce: match.nonce, optionIndex: correctIndex });
      game.answer(sockets[1], { code: created.code, playerId: players[1], nonce: match.nonce, optionIndex: (correctIndex + 1) % 4 });
      game.answer(sockets[2], { code: created.code, playerId: players[2], nonce: match.nonce, optionIndex: (correctIndex + 1) % 4 });
    }

    const tournament = game.tournament(created.code);
    assert.equal(tournament.phase, 'COMPLETE');
    assert.equal(tournament.champion_id, players[0]);
    assert.equal(game.player(created.code, players[0]).status, 'CHAMPION');
    const eventKinds = db.prepare('SELECT kind FROM events WHERE code=?').all(created.code).map((row) => row.kind);
    assert.ok(eventKinds.includes('ROUND_STARTED'));
    assert.ok(eventKinds.includes('MATCH_COMPLETED'));
    assert.ok(eventKinds.includes('CHAMPION_CROWNED'));
    const completedHostSnapshot = host.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.equal(completedHostSnapshot.matchHistory.length, 1);
    assert.equal(completedHostSnapshot.matchHistory[0].winnerId, players[0]);
    assert.equal(completedHostSnapshot.matchHistory[0].questionIds.length, 3);
    assert.equal(completedHostSnapshot.reviewQuestions.length, 3);
    assert.equal(sockets[0].messages.filter((message) => message.type === 'snapshot').at(-1).reviewQuestions, undefined);

    game.report(host, { code: created.code, hostToken: created.hostToken });
    const report = host.messages.filter((message) => message.type === 'report').at(-1);
    assert.equal(report.matchHistory.length, 1);
    assert.equal(report.reviewQuestions.length, 3);
    assert.equal(report.events.filter((event) => event.kind === 'QUESTION_PRESENTED').length, 3);
    assert.ok(report.events.find((event) => event.kind === 'QUESTION_PRESENTED').message.includes('Question '));

    game.progression(sockets[1], { code: created.code });
    const spectatorProgression = sockets[1].messages.filter((message) => message.type === 'progression').at(-1);
    assert.equal(spectatorProgression.matchHistory.length, 1);
    assert.equal(spectatorProgression.players.length, 3);
    assert.equal(spectatorProgression.reviewQuestions, undefined);

    game.leaderboard(sockets[0], { code: created.code });
    const playerLeaderboard = sockets[0].messages.filter((message) => message.type === 'leaderboard').at(-1);
    assert.equal(playerLeaderboard.tournament.championId, players[0]);
    assert.equal(playerLeaderboard.matchHistory.length, 1);
    assert.equal(playerLeaderboard.events, undefined);

    game.createTournament(host, { flawlessBonus: false, bankId });
    const nextCreated = host.messages.filter((message) => message.type === 'created').at(-1);
    assert.notEqual(nextCreated.code, created.code);
    assert.equal(game.tournament(nextCreated.code).phase, 'LOBBY');
    assert.equal(game.hosts.get(created.code)?.has(host), false);
    assert.equal(game.hosts.get(nextCreated.code)?.has(host), true);
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('the host controls the fixed timer and starts the next round after a break', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-clash-round-break-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db);
  try {
    const { host, bankId, questions } = prepareHost(db, here);
    game.createTournament(host, { flawlessBonus: true, questionSeconds: 45, arenaTone: 'NO_MERCY', bankId });
    const created = host.messages.find((message) => message.type === 'created');
    const hostLobby = host.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.equal(hostLobby.tournament.questionSeconds, 45);
    assert.equal(hostLobby.tournament.arenaTone, 'NO_MERCY');
    assert.equal(hostLobby.questionBank.length, questions.length);

    const playerIds = [1, 2, 3, 4].map((value) => `${value}`.repeat(8) + '-1111-4111-8111-' + `${value}`.repeat(12));
    const sockets = new Map(playerIds.map((id) => [id, new FakeSocket()]));
    playerIds.forEach((playerId, index) => game.join(sockets.get(playerId), { code: created.code, playerId, name: `Player ${index + 1}` }));
    assert.equal(sockets.get(playerIds[0]).messages.at(-1).questionBank, undefined);
    game.start(host, { code: created.code, hostToken: created.hostToken });

    const firstRoundMatches = game.matches(created.code, 1);
    assert.equal(firstRoundMatches.length, 2);
    assert.equal(firstRoundMatches[0].deadline - firstRoundMatches[0].questionStartedAt, 45_000);
    for (const initialMatch of firstRoundMatches) {
      for (let hit = 0; hit < 3; hit += 1) {
        const match = game.match(created.code, initialMatch.id);
        const [winnerId, loserId] = match.aliveIds;
        const correctIndex = game.question(created.code, match.questionId).correctIndex;
        game.answer(sockets.get(winnerId), { code: created.code, playerId: winnerId, nonce: match.nonce, optionIndex: correctIndex });
        game.answer(sockets.get(loserId), { code: created.code, playerId: loserId, nonce: match.nonce, optionIndex: (correctIndex + 1) % 4 });
      }
    }

    assert.equal(game.tournament(created.code).phase, 'ROUND_BREAK');
    assert.equal(game.matches(created.code, 2).length, 0);
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM events WHERE code=? AND kind='ROUND_COMPLETED'`).get(created.code).count, 1);
    const roundBreakSnapshot = host.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.deepEqual(roundBreakSnapshot.matchHistory.map((match) => match.round), [1, 1]);
    assert.ok(roundBreakSnapshot.matchHistory.every((match) => match.winnerId));
    assert.ok(roundBreakSnapshot.matchHistory.every((match) => match.questionIds.length === 3));
    assert.ok(roundBreakSnapshot.reviewQuestions.length >= 3);

    game.start(host, { code: created.code, hostToken: created.hostToken });
    assert.equal(game.tournament(created.code).phase, 'IN_ROUND');
    assert.equal(game.tournament(created.code).round, 2);
    assert.equal(game.matches(created.code, 2).length, 1);
    const secondRoundSnapshot = host.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.deepEqual(secondRoundSnapshot.matchHistory.map((match) => match.round), [1, 1, 2]);
    assert.equal(secondRoundSnapshot.matchHistory[2].phase, 'ANSWERING');
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('five questions support a 40-player tournament and recycle only after a duel exhausts the pack', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-five-question-field-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db);
  try {
    const { host, bankId, questions } = prepareHost(db, here);
    const fiveQuestions = questions.slice(0, 5);
    db.prepare('UPDATE question_banks SET content=?, question_count=? WHERE id=?')
      .run(JSON.stringify(fiveQuestions), fiveQuestions.length, bankId);
    game.createTournament(host, { bankId });
    const created = host.messages.find((message) => message.type === 'created');
    const playerIds = Array.from({ length: 40 }, (_, index) => {
      const number = String(index + 1);
      return `${number.padStart(8, '0')}-1111-4111-8111-${number.padStart(12, '0')}`;
    });
    const sockets = new Map(playerIds.map((id) => [id, new FakeSocket()]));
    playerIds.forEach((playerId, index) => game.join(sockets.get(playerId), {
      code: created.code, playerId, name: `Player ${index + 1}`,
    }));

    game.start(host, { code: created.code, hostToken: created.hostToken });
    const matches = game.matches(created.code, 1);
    assert.equal(matches.length, 20);
    assert.ok(matches.every((match) => fiveQuestions.some((question) => question.id === match.questionId)));
    assert.ok(matches.every((match) => match.usedQuestions.length === 1));
    assert.ok(fiveQuestions.some((question) => question.id === game.selectQuestion(
      created.code, 40, fiveQuestions.map((question) => question.id), 'all-five-used',
    ).id));
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('Bato Bato Pick resolves secret player choices and reports the reveal', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-rps-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db);
  try {
    const { host, bankId } = prepareHost(db, here);
    const rps = JSON.parse(fs.readFileSync(path.resolve(here, '../../data/bato-bato-pick-bank.json'), 'utf8'));
    const questions = rps.questions.map((question) => ({ ...question, text: question.prompt, type: 'MULTIPLE_CHOICE' }));
    db.prepare('UPDATE question_banks SET name=?,content=?,question_count=?,game_mode=? WHERE id=?')
      .run(rps.name, JSON.stringify(questions), questions.length, 'RPS', bankId);
    game.createTournament(host, { bankId });
    const created = host.messages.find((message) => message.type === 'created');
    const players = ['aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb'];
    const sockets = players.map(() => new FakeSocket());
    players.forEach((playerId, index) => game.join(sockets[index], { code: created.code, playerId, name: index ? 'Scissors' : 'Rock' }));
    game.start(host, { code: created.code, hostToken: created.hostToken });

    let match = game.matches(created.code, 1)[0];
    game.answer(sockets[0], { code: created.code, playerId: players[0], nonce: match.nonce, optionIndex: 0 });
    game.answer(sockets[1], { code: created.code, playerId: players[1], nonce: match.nonce, optionIndex: 0 });
    match = game.matches(created.code, 1)[0];
    assert.deepEqual(match.hp, { [players[0]]: 3, [players[1]]: 3 });
    assert.match(match.notice, /draw/i);

    for (let hit = 0; hit < 3; hit += 1) {
      match = game.matches(created.code, 1)[0];
      game.answer(sockets[0], { code: created.code, playerId: players[0], nonce: match.nonce, optionIndex: 0 });
      game.answer(sockets[1], { code: created.code, playerId: players[1], nonce: match.nonce, optionIndex: 2 });
    }
    assert.equal(game.tournament(created.code).champion_id, players[0]);
    assert.match(sockets[0].messages.filter((message) => message.type === 'snapshot').at(-1).notice, /Rock crushes Scissors/i);
    const lastMatchEvent = db.prepare("SELECT details FROM events WHERE code=? AND kind='MATCH_COMPLETED' ORDER BY at DESC LIMIT 1").get(created.code);
    assert.equal(JSON.parse(lastMatchEvent.details).choices[players[1]], 'Scissors ✂️');
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('an odd Bato Bato Pick field uses a three-way match, transitions to 1v1, and crowns a champion', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-rps-odd-field-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db);
  try {
    const { host, bankId } = prepareHost(db, here);
    const rps = JSON.parse(fs.readFileSync(path.resolve(here, '../../data/bato-bato-pick-bank.json'), 'utf8'));
    const questions = rps.questions.map((question) => ({ ...question, text: question.prompt, type: 'MULTIPLE_CHOICE' }));
    db.prepare('UPDATE question_banks SET name=?,content=?,question_count=?,game_mode=? WHERE id=?')
      .run(rps.name, JSON.stringify(questions), questions.length, 'RPS', bankId);
    game.createTournament(host, { bankId });
    const created = host.messages.find((message) => message.type === 'created');
    const playerIds = Array.from({ length: 5 }, (_, index) => `${index + 1}`.repeat(8) + '-1111-4111-8111-' + `${index + 1}`.repeat(12));
    const sockets = new Map(playerIds.map((id) => [id, new FakeSocket()]));
    playerIds.forEach((playerId, index) => game.join(sockets.get(playerId), {
      code: created.code, playerId, name: `Player ${index + 1}`,
    }));
    game.start(host, { code: created.code, hostToken: created.hostToken });

    const firstRound = game.matches(created.code, 1);
    assert.deepEqual(firstRound.map((match) => match.aliveIds.length), [3, 2]);
    const tripleId = firstRound[0].id;
    const pairId = firstRound[1].id;
    const [rockOne, rockTwo, scissors] = firstRound[0].aliveIds;

    for (let hit = 0; hit < 3; hit += 1) {
      const match = game.match(created.code, tripleId);
      game.answer(sockets.get(rockOne), { code: created.code, playerId: rockOne, nonce: match.nonce, optionIndex: 0 });
      game.answer(sockets.get(rockTwo), { code: created.code, playerId: rockTwo, nonce: match.nonce, optionIndex: 0 });
      game.answer(sockets.get(scissors), { code: created.code, playerId: scissors, nonce: match.nonce, optionIndex: 2 });
    }
    assert.deepEqual(game.match(created.code, tripleId).aliveIds, [rockOne, rockTwo]);
    assert.equal(game.player(created.code, scissors).status, 'ELIMINATED');

    for (let hit = 0; hit < 3; hit += 1) {
      const match = game.match(created.code, tripleId);
      game.answer(sockets.get(rockOne), { code: created.code, playerId: rockOne, nonce: match.nonce, optionIndex: 1 });
      game.answer(sockets.get(rockTwo), { code: created.code, playerId: rockTwo, nonce: match.nonce, optionIndex: 0 });
    }
    const [pairWinner, pairLoser] = firstRound[1].aliveIds;
    for (let hit = 0; hit < 3; hit += 1) {
      const match = game.match(created.code, pairId);
      game.answer(sockets.get(pairWinner), { code: created.code, playerId: pairWinner, nonce: match.nonce, optionIndex: 0 });
      game.answer(sockets.get(pairLoser), { code: created.code, playerId: pairLoser, nonce: match.nonce, optionIndex: 2 });
    }
    assert.equal(game.tournament(created.code).phase, 'ROUND_BREAK');
    assert.deepEqual(
      game.players(created.code).filter((player) => player.status === 'WAITING').map((player) => player.id).sort(),
      [rockOne, pairWinner].sort(),
    );

    game.start(host, { code: created.code, hostToken: created.hostToken });
    for (let hit = 0; hit < 3; hit += 1) {
      const match = game.matches(created.code, 2)[0];
      game.answer(sockets.get(rockOne), { code: created.code, playerId: rockOne, nonce: match.nonce, optionIndex: 0 });
      game.answer(sockets.get(pairWinner), { code: created.code, playerId: pairWinner, nonce: match.nonce, optionIndex: 2 });
    }
    assert.equal(game.tournament(created.code).phase, 'COMPLETE');
    assert.equal(game.tournament(created.code).champion_id, rockOne);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM events WHERE code=? AND kind='MATCH_COMPLETED'").get(created.code).count, 3);
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('an instructor can cancel an unstarted lobby and every lobby has a 20-minute expiry', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloud-clash-cancel-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db);
  try {
    const { host, bankId } = prepareHost(db, here);
    game.createTournament(host, { flawlessBonus: true, questionSeconds: 20, bankId });
    const created = host.messages.find((message) => message.type === 'created');
    const lobby = host.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.equal(lobby.tournament.phase, 'LOBBY');
    assert.ok(lobby.tournament.lobbyExpiresAt - lobby.serverNow > 19 * 60 * 1000);
    assert.ok(lobby.tournament.lobbyExpiresAt - lobby.serverNow <= 20 * 60 * 1000);

    game.cancel(host, { code: created.code, hostToken: created.hostToken });
    assert.equal(game.tournament(created.code).phase, 'CANCELLED');
    assert.equal(host.messages.filter((message) => message.type === 'snapshot').at(-1).tournament.phase, 'CANCELLED');
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM events WHERE code=? AND kind='TOURNAMENT_CANCELLED'`).get(created.code).count, 1);
    assert.throws(() => game.join(new FakeSocket(), {
      code: created.code, name: 'Late Player', avatar: '🐲', playerId: '99999999-9999-4999-8999-999999999999',
    }), /cancelled or its lobby expired/i);
    assert.throws(() => game.start(host, { code: created.code, hostToken: created.hostToken }), /cannot be started/i);

    const autoHost = new FakeSocket(); autoHost.account = host.account;
    game.createTournament(autoHost, { bankId });
    const autoCreated = autoHost.messages.find((message) => message.type === 'created');
    assert.equal(game.endLobby(autoCreated.code, 'LOBBY_EXPIRED', 'Lobby expired after 20 minutes without starting.'), true);
    assert.equal(game.tournament(autoCreated.code).phase, 'CANCELLED');
    assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM events WHERE code=? AND kind='LOBBY_EXPIRED'`).get(autoCreated.code).count, 1);
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('player reconnects require a server-issued secret token', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-player-token-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db);
  try {
    const { host, bankId } = prepareHost(db, here);
    game.createTournament(host, { bankId });
    const created = host.messages.find((message) => message.type === 'created');
    const playerId = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
    const original = new FakeSocket();
    game.join(original, { code: created.code, playerId, name: 'Original Player' });
    const joined = original.messages.find((message) => message.type === 'joined');
    assert.equal(joined.playerId, playerId);
    assert.ok(joined.playerToken.length >= 32);
    assert.notEqual(game.player(created.code, playerId).player_token_hash, joined.playerToken);
    assert.equal(JSON.stringify(original.messages.filter((message) => message.type === 'snapshot')).includes(joined.playerToken), false);

    assert.throws(() => game.join(new FakeSocket(), {
      code: created.code, playerId, name: 'Impostor', playerToken: 'wrong-token-that-is-long-enough-1234',
    }), /belongs to another browser/i);
    assert.throws(() => game.httpSync(new FakeSocket(), { code: created.code, playerId }), /session is not valid/i);

    const resumed = new FakeSocket();
    game.join(resumed, { code: created.code, playerId, name: 'Original Player', playerToken: joined.playerToken });
    assert.equal(original.readyState, 3);
    const fallback = new FakeSocket();
    game.httpSync(fallback, { code: created.code, playerId, playerToken: joined.playerToken });
    assert.equal(fallback.messages.at(-1).me.id, playerId);
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('public beta hides answers anonymously and reveals them only to an authenticated paid host', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-beta-redaction-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db, { hideHostQuestions: true, maxActiveTournaments: 1 });
  try {
    const { host, bankId } = prepareHost(db, here);
    game.createTournament(host, { bankId });
    const created = host.messages.find((message) => message.type === 'created');
    const lobby = host.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.equal(lobby.questionBank, undefined);
    assert.equal(lobby.questionBankInfo, undefined);
    assert.equal(lobby.reviewQuestions, undefined);
    assert.throws(() => game.createTournament(host, { bankId }), /arena is currently full/i);

    const paidHost = new FakeSocket();
    paidHost.account = host.account;
    paidHost.canViewAnswers = true;
    game.hostResume(paidHost, created.code, created.hostToken);
    const paidLobby = paidHost.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.ok(paidLobby.questionBank.length > 0);
    assert.ok(Number.isInteger(paidLobby.questionBank[0].correctIndex));

    const first = new FakeSocket();
    const second = new FakeSocket();
    game.join(first, { code: created.code, playerId: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', name: 'First' });
    game.join(second, { code: created.code, playerId: 'cccccccc-1111-4111-8111-cccccccccccc', name: 'Second' });
    game.start(host, { code: created.code, hostToken: created.hostToken });
    const questionEvent = db.prepare("SELECT message FROM events WHERE code=? AND kind='QUESTION_PRESENTED'").get(created.code);
    assert.match(questionEvent.message, /^Question [^:]+ presented\.$/);
    game.report(host, { code: created.code, hostToken: created.hostToken });
    assert.deepEqual(host.messages.filter((message) => message.type === 'report').at(-1).reviewQuestions, []);
    const paidRound = paidHost.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.ok(paidRound.reviewQuestions.length > 0);
    game.report(paidHost, { code: created.code, hostToken: created.hostToken });
    assert.ok(paidHost.messages.filter((message) => message.type === 'report').at(-1).reviewQuestions.length > 0);
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('anonymous beta hosts cannot select an account custom pack', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-beta-pack-scope-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const game = new ZerosumGame(db, { hideHostQuestions: true });
  try {
    const { host, bankId } = prepareHost(db, here);
    host.restrictToSampleBanks = true;
    assert.throws(() => game.createTournament(host, { bankId }), /included challenge packs only/i);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tournaments').get().count, 0);
  } finally {
    game.close();
    db.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
