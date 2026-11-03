import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { accountFromCookie, ensureSeedAccounts, limitsFor, login } from '../src/auth.js';
import { cleanupExpiredBanks, createBank, deleteBank, ensureSampleBanks, getBank, listBanks, normalizeQuestions, parseBankUpload } from '../src/banks.js';

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-auth-'));
  return { directory, db: openDatabase(directory) };
}

test('seeded accounts authenticate with hashed passwords and sessions', () => {
  const { directory, db } = temporaryDatabase();
  const previousFree = process.env.FREE_ACCOUNT_PASSWORD;
  const previousPaid = process.env.PAID_ACCOUNT_PASSWORD;
  try {
    process.env.FREE_ACCOUNT_PASSWORD = 'free-test-password-123';
    process.env.PAID_ACCOUNT_PASSWORD = 'paid-test-password-123';
    ensureSeedAccounts(db);
    const result = login(db, 'paid@zerosum.local', 'paid-test-password-123');
    assert.equal(result.account.plan, 'PAID');
    assert.equal(accountFromCookie(db, `zerosum_session=${result.token}`).email, 'paid@zerosum.local');
    assert.throws(() => login(db, 'paid@zerosum.local', 'wrong-password'), /incorrect/i);
    assert.notEqual(db.prepare('SELECT password_hash FROM accounts WHERE email=?').get('paid@zerosum.local').password_hash, 'paid-test-password-123');
  } finally {
    if (previousFree === undefined) delete process.env.FREE_ACCOUNT_PASSWORD; else process.env.FREE_ACCOUNT_PASSWORD = previousFree;
    if (previousPaid === undefined) delete process.env.PAID_ACCOUNT_PASSWORD; else process.env.PAID_ACCOUNT_PASSWORD = previousPaid;
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('challenge packs enforce plan limits and parse CSV safely', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const account = { id: 'free-owner', plan: 'FREE' };
    db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(account.id, 'free@test.local', 'Free Host', account.plan, 'salt', 'hash', Date.now());
    const upload = parseBankUpload({ name: 'CSV Pack', format: 'csv', content: 'question,optionA,optionB,correctIndex,explanation\n"Sky is blue",True,False,0,"Usually true"\n"Two plus two",3,4,1,"Basic math"\n"Water is dry",True,False,1,"Water is wet"' });
    const bank = createBank(db, account, limitsFor(account.plan), upload);
    assert.equal(bank.questionCount, 3);
    assert.equal(listBanks(db, account.id).length, 1);
    assert.equal(normalizeQuestions(upload.questions, 50)[0].type, 'TRUE_FALSE');
    const other = { id: 'other-owner', plan: 'PAID' };
    db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(other.id, 'other@test.local', 'Other Host', other.plan, 'salt', 'hash', Date.now());
    assert.equal(listBanks(db, other.id).some((candidate) => candidate.id === bank.id), false);
    assert.throws(() => getBank(db, other.id, bank.id), /not found/i);
  } finally {
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('identical questions require explicit duplicate permission', () => {
  const repeated = Array.from({ length: 3 }, () => ({
    prompt: 'What beats Rock?', options: ['Rock', 'Paper', 'Scissors'], correctIndex: 1,
  }));
  assert.throws(() => normalizeQuestions(repeated, 50), /duplicate/i);
  assert.equal(normalizeQuestions(repeated, 50, true).length, 3);
});

test('included samples preserve AWS domains and do not consume custom pack limits', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const account = { id: 'sample-owner', plan: 'FREE' };
    db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(account.id, 'samples@test.local', 'Sample Host', account.plan, 'salt', 'hash', Date.now());
    ensureSampleBanks(db, [{
      name: 'AWS Sample', questions: [
        { id: 'AWS-1', d: 1, q: 'Question one?', o: ['A', 'B'], a: [0], e: 'A' },
        { id: 'AWS-2', d: 2, q: 'Question two?', o: ['A', 'B'], a: [1], e: 'B' },
        { id: 'AWS-3', d: 3, q: 'Question three?', o: ['A', 'B'], a: [0], e: 'A' },
        { id: 'AWS-4', d: 4, q: 'Choose two.', o: ['A', 'B', 'C'], a: [0, 1], e: 'A and B' },
      ],
    }]);
    const sample = listBanks(db, account.id)[0];
    assert.equal(sample.isSample, 1);
    assert.equal(sample.questionCount, 3);
    assert.equal(JSON.parse(db.prepare('SELECT content FROM question_banks WHERE id=?').get(sample.id).content)[0].domain, 1);

    createBank(db, account, limitsFor(account.plan), {
      name: 'Custom Pack', questions: [
        { prompt: 'One?', options: ['A', 'B'], correctIndex: 0 },
        { prompt: 'Two?', options: ['A', 'B'], correctIndex: 0 },
        { prompt: 'Three?', options: ['A', 'B'], correctIndex: 0 },
      ],
    });
    assert.equal(listBanks(db, account.id).filter((bank) => !bank.isSample).length, 1);
  } finally {
    db.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('created packs are capped at 20 per owner even on higher plan limits', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const account = { id: 'cap-owner', plan: 'PAID' };
    db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(account.id, 'cap@test.local', 'Cap Host', account.plan, 'salt', 'hash', Date.now());
    assert.equal(limitsFor('PAID').banks, 20);
    const limits = { banks: 25, questionsPerBank: 50, totalQuestions: 5000 };
    const questions = (n) => [1, 2, 3].map((i) => ({ prompt: `Cap ${n} question ${i}?`, options: ['a', 'b'], correctIndex: 0, explanation: 'cap check' }));
    for (let index = 0; index < 20; index += 1) createBank(db, account, limits, { name: `Cap Pack ${index}`, questions: questions(index), retention: 'PERMANENT' });
    assert.throws(() => createBank(db, account, limits, { name: 'One Too Many', questions: questions(99) }), /up to 20 created packs/);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('temporary packs expire after 30 days and owners or admins can delete packs', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const mk = (id, email) => { db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`).run(id, email, email, 'PAID', 's', 'h', Date.now()); return { id, plan: 'PAID' }; };
    const owner = mk('ret-owner', 'ret@test.local'); const other = mk('ret-other', 'other2@test.local');
    const questions = (n) => [1, 2, 3].map((i) => ({ prompt: `Retention ${n} question ${i}?`, options: ['a', 'b'], correctIndex: 0, explanation: 'retention check' }));
    const temp = createBank(db, owner, limitsFor('PAID'), { name: 'Temp Pack', questions: questions(1), retention: 'TEMPORARY' });
    assert.equal(temp.retention, 'TEMPORARY');
    assert.ok(temp.expiresAt > Date.now() + 29 * 24 * 60 * 60 * 1000);
    assert.ok(temp.expiresAt < Date.now() + 31 * 24 * 60 * 60 * 1000);
    const permanent = createBank(db, owner, limitsFor('PAID'), { name: 'Keep Pack', questions: questions(2), retention: 'PERMANENT' });
    assert.equal(permanent.expiresAt, null);
    db.prepare('UPDATE question_banks SET expires_at=? WHERE id=?').run(Date.now() - 1000, temp.id);
    assert.equal(cleanupExpiredBanks(db), 1);
    assert.throws(() => getBank(db, owner.id, temp.id), /not found/i);
    assert.throws(() => deleteBank(db, other, false, permanent.id), /not found/i);
    assert.equal(deleteBank(db, other, true, permanent.id).name, 'Keep Pack');
    const own = createBank(db, owner, limitsFor('PAID'), { name: 'Own Delete', questions: questions(3) });
    assert.equal(deleteBank(db, owner, false, own.id).id, own.id);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('explicit pack content is rejected', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const account = { id: 'safe-owner', plan: 'PAID' };
    db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run(account.id, 'safe@test.local', 'Safe Host', account.plan, 'salt', 'hash', Date.now());
    assert.throws(() => createBank(db, account, limitsFor('PAID'), {
      name: 'Bad Pack',
      questions: [1, 2, 3].map((i) => ({ prompt: `erotic question ${i}?`, options: ['a', 'b'], correctIndex: 0, explanation: 'no' })),
    }), (error) => error.code === 'AI_EXPLICIT_CONTENT');
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
