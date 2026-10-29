import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/database.js';
import { ZerosumGame } from '../src/game.js';
import { BOT_TIERS, botProfile, tierIndexForRival } from '../src/bots.js';

class FakeSocket {
  readyState = 1;
  messages = [];
  send(value) { this.messages.push(JSON.parse(value)); }
  close() { this.readyState = 3; }
}
const HUMAN = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const CHALLENGER = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

function setup() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-solo-'));
  const db = openDatabase(temp);
  const here = path.dirname(fileURLToPath(import.meta.url));
  const source = JSON.parse(fs.readFileSync(path.resolve(here, '../../data/starter-bank.json'), 'utf8'));
  const questions = source.questions.map((question, index) => ({ ...question, id: `test-${index + 1}`, text: question.prompt }));
  db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES ('owner','o@test.local','Owner','PAID','s','h',?)`).run(Date.now());
  db.prepare(`INSERT INTO question_banks (id,owner_id,name,description,version,question_count,content,created_at,updated_at,is_sample) VALUES ('bank-test','owner','Starter','',1,?,?,?, ?,1)`)
    .run(questions.length, JSON.stringify(questions), Date.now(), Date.now());
  return { temp, db, game: new ZerosumGame(db), questions };
}
function cleanup({ temp, db, game }) { game.close(); db.close(); fs.rmSync(temp, { recursive: true, force: true }); }
function beatCurrentRival(game, socket, code, humanId) {
  for (let hits = 0; hits < 3; hits += 1) {
    const tournament = game.tournament(code);
    const match = game.matches(code, tournament.round)[0];
    const rivalId = match.aliveIds.find((id) => id !== humanId);
    const question = game.question(code, match.questionId);
    game.answer(socket, { code, playerId: humanId, nonce: match.nonce, optionIndex: question.correctIndex });
    game.submitAnswer(code, rivalId, (question.correctIndex + 1) % question.options.length, match.nonce);
  }
}

test('bot tiers escalate and the final rival is Champion tier', () => {
  assert.equal(BOT_TIERS[tierIndexForRival(1, 50)].name, 'Rookie');
  assert.equal(BOT_TIERS[tierIndexForRival(50, 50)].name, 'Champion');
  assert.ok(botProfile(25, 50, 0, 'seed').accuracy >= botProfile(2, 50, 0, 'seed').accuracy);
});

test('solo run starts instantly against a bot, streak advances and HP resets', () => {
  const ctx = setup();
  try {
    const socket = new FakeSocket();
    ctx.game.createSoloRun(socket, { playerId: HUMAN, name: 'Ace', avatar: 'arena-02', bankId: 'bank-test', ladderLength: 5, feedbackMode: 'LEARN', allowChallenge: false });
    const created = socket.messages.find((message) => message.type === 'soloCreated');
    assert.ok(created);
    assert.equal(ctx.game.tournament(created.code).mode, 'SOLO');
    const snapshot = socket.messages.filter((message) => message.type === 'snapshot').at(-1);
    assert.ok(snapshot.question);
    assert.equal(snapshot.players.filter((player) => player.isBot).length, 1);
    beatCurrentRival(ctx.game, socket, created.code, HUMAN);
    const after = ctx.game.tournament(created.code);
    assert.equal(after.streak, 1);
    assert.equal(after.rival_index, 2);
    assert.equal(after.phase, 'IN_ROUND');
    assert.equal(ctx.game.player(created.code, HUMAN).hp, 3);
    const live = ctx.game.snapshot(created.code, HUMAN);
    assert.equal(live.tournament.streak, 1);
    assert.equal(live.tournament.rivalIndex, 2);
  } finally { cleanup(ctx); }
});

test('exam mode withholds explanations until the run ends', () => {
  const ctx = setup();
  try {
    const socket = new FakeSocket();
    ctx.game.createSoloRun(socket, { playerId: HUMAN, name: 'Ace', bankId: 'bank-test', ladderLength: 5, feedbackMode: 'EXAM' });
    const created = socket.messages.find((message) => message.type === 'soloCreated');
    const match = ctx.game.matches(created.code, 1)[0];
    const rivalId = match.aliveIds.find((id) => id !== HUMAN);
    const question = ctx.game.question(created.code, match.questionId);
    ctx.game.answer(socket, { code: created.code, playerId: HUMAN, nonce: match.nonce, optionIndex: question.correctIndex });
    ctx.game.submitAnswer(created.code, rivalId, (question.correctIndex + 1) % question.options.length, match.nonce);
    const live = ctx.game.snapshot(created.code, HUMAN);
    assert.equal(live.combat?.explanation, undefined);
    assert.equal(live.reviewQuestions, undefined);
  } finally { cleanup(ctx); }
});

test('a queued challenger takes the first rival slot when challenges are allowed', () => {
  const ctx = setup();
  try {
    const challengerSocket = new FakeSocket();
    ctx.game.joinChallengeQueue(challengerSocket, { playerId: CHALLENGER, name: 'Rival', avatar: 'arena-06', bankId: 'bank-test' });
    assert.ok(challengerSocket.messages.find((message) => message.type === 'queued'));
    const socket = new FakeSocket();
    ctx.game.createSoloRun(socket, { playerId: HUMAN, name: 'Ace', bankId: 'bank-test', ladderLength: 5, allowChallenge: true });
    const created = socket.messages.find((message) => message.type === 'soloCreated');
    assert.ok(ctx.game.player(created.code, CHALLENGER));
    assert.ok(challengerSocket.messages.find((message) => message.type === 'challengeMatched'));
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS c FROM challenge_queue').get().c, 0);
  } finally { cleanup(ctx); }
});

test('host can join as a player and gets the fair player view', () => {
  const ctx = setup();
  try {
    const account = { id: 'account-test-paid', email: 'paid@test.local', display_name: 'Paid Host', plan: 'PAID' };
    ctx.db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(account.id, account.email, account.display_name, account.plan, 'salt', 'hash', Date.now());
    ctx.db.prepare(`INSERT INTO question_banks (id,owner_id,name,description,version,question_count,content,created_at,updated_at) VALUES ('bank-host',?,'Host Bank','',1,?,?,?,?)`)
      .run(account.id, ctx.questions?.length ?? 3, '[]', Date.now(), Date.now());
    // use the sample bank owned by nobody via host account bank instead: point host bank content at starter questions
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = JSON.parse(fs.readFileSync(path.resolve(here, '../../data/starter-bank.json'), 'utf8'));
    const questions = source.questions.map((question, index) => ({ ...question, id: `h-${index + 1}`, text: question.prompt }));
    ctx.db.prepare('UPDATE question_banks SET content=?, question_count=? WHERE id=?').run(JSON.stringify(questions), questions.length, 'bank-host');
    const host = new FakeSocket(); host.account = account;
    ctx.game.createTournament(host, { bankId: 'bank-host', hostPlay: true, hostName: 'Coach', hostAvatar: '🚀', hostPlayerId: HUMAN });
    const created = host.messages.find((message) => message.type === 'created');
    assert.ok(created.playerToken);
    const hostPlayer = ctx.game.player(created.code, HUMAN);
    assert.equal(hostPlayer.is_host_player, 1);
    const view = ctx.game.hostSnapshot(host, created.code);
    assert.equal(view.me?.id, HUMAN);
    assert.equal(view.questionBank, undefined);
  } finally { cleanup(ctx); }
});

test('forfeiting a solo run ends it, frees the player, and stays off the leaderboard', () => {
  const ctx = setup();
  try {
    const socket = new FakeSocket();
    ctx.game.createSoloRun(socket, { playerId: HUMAN, name: 'Ace', avatar: 'arena-02', bankId: 'bank-test', ladderLength: 5, feedbackMode: 'LEARN', allowChallenge: false });
    const created = socket.messages.find((message) => message.type === 'soloCreated');
    ctx.game.forfeitSoloRun(socket, { code: created.code, playerId: HUMAN });
    assert.equal(ctx.game.tournament(created.code).phase, 'COMPLETE');
    const row = ctx.db.prepare('SELECT * FROM solo_leaderboard WHERE code=?').get(created.code);
    assert.equal(row, undefined, 'forfeited runs are never recorded on the leaderboard');
    const snap = ctx.game.snapshot(created.code, HUMAN);
    assert.equal(snap.tournament.phase, 'COMPLETE');
  } finally { cleanup(ctx); }
});
