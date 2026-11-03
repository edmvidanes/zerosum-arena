import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { ensureSampleBanks, getBank, listBanks } from '../src/banks.js';
import { AI_FORGE_WEEKLY_LIMIT, forgeWeekWindow, getForgeQuota, recordForgeUse } from '../src/ai.js';

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-packs-'));
  return { directory, db: openDatabase(directory) };
}
function addAccount(db, id, email) {
  db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
    .run(id, email, 'Host', 'HOST', 'salt', 'hash', Date.now());
}
const sample = (name, gameMode = 'QUIZ') => ({
  name, gameMode, description: `${name} description`,
  questions: [1, 2, 3].map((n) => ({ q: `${name} question ${n}?`, o: ['A', 'B'], a: [0], e: 'A' })),
});

test('default packs are visible to accounts created after startup (e.g. Google sign-ins)', () => {
  const { directory, db } = temporaryDatabase();
  try {
    addAccount(db, 'seed-owner', 'seed@test.local');
    ensureSampleBanks(db, [sample('Bato Bato Pick', 'RPS'), sample('AWS Cloud Practitioner Practice')]);
    // This account is created after ensureSampleBanks ran, so it has no copies.
    addAccount(db, 'google-user', 'google@test.local');
    const banks = listBanks(db, 'google-user');
    assert.deepEqual(banks.map((bank) => bank.name).sort(), ['AWS Cloud Practitioner Practice', 'Bato Bato Pick']);
    assert.equal(banks.filter((bank) => bank.name === 'Bato Bato Pick').length, 1);
    assert.equal(banks.find((bank) => bank.name === 'Bato Bato Pick').gameMode, 'RPS');
    const bato = banks.find((bank) => bank.name === 'Bato Bato Pick');
    assert.equal(getBank(db, 'google-user', bato.id).name, 'Bato Bato Pick');
    addAccount(db, 'other', 'other@test.local');
    db.prepare(`INSERT INTO question_banks (id,owner_id,name,description,version,question_count,content,created_at,updated_at,is_sample,game_mode,retention,expires_at) VALUES (?,?,?,?,1,3,'[]',?,?,0,'QUIZ','PERMANENT',NULL)`)
      .run('private-1', 'other', 'Private Pack', '', Date.now(), Date.now());
    assert.throws(() => getBank(db, 'google-user', 'private-1'), /not found/i);
    assert.equal(listBanks(db, 'google-user').some((bank) => bank.id === 'private-1'), false);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('forge quota is a hard 5 packs per account per week, resetting Monday', () => {
  const { directory, db } = temporaryDatabase();
  try {
    addAccount(db, 'forger', 'forger@test.local');
    addAccount(db, 'other-forger', 'other-forger@test.local');
    const now = new Date('2026-11-04T12:00:00'); // a Wednesday
    const { startAt, resetsAt } = forgeWeekWindow(now.getTime());
    assert.equal(new Date(startAt).getDay(), 1); // Monday
    assert.equal(new Date(resetsAt).getDay(), 1); // next Monday
    assert.equal(getForgeQuota(db, 'forger', now.getTime()).remaining, AI_FORGE_WEEKLY_LIMIT);
    for (let i = 0; i < AI_FORGE_WEEKLY_LIMIT; i += 1) recordForgeUse(db, 'forger', now.getTime());
    const quota = getForgeQuota(db, 'forger', now.getTime());
    assert.deepEqual({ used: quota.used, remaining: quota.remaining }, { used: 5, remaining: 0 });
    assert.equal(getForgeQuota(db, 'other-forger', now.getTime()).remaining, 5);
    assert.equal(getForgeQuota(db, 'forger', resetsAt).remaining, 5);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});