import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { limitsFor } from '../src/auth.js';
import { createBank, getBank, updateBank } from '../src/banks.js';

test('owners and admins can adjust pack contents; strangers cannot', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-edit-'));
  const db = openDatabase(directory);
  try {
    const mk = (id, email) => { db.prepare('INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)').run(id, email, email, 'HOST', 's', 'h', Date.now()); return { id, plan: 'HOST' }; };
    const owner = mk('owner-1', 'owner@test.local'); const other = mk('other-1', 'other@test.local');
    const qs = (n) => Array.from({ length: 3 }, (_, i) => ({ prompt: `Q${n}-${i}?`, options: ['a', 'b', 'c'], correctIndex: i % 3, explanation: 'because learning matters here' }));
    const bank = createBank(db, owner, limitsFor(), { name: 'Draft Pack', questions: qs(1) });
    const updated = updateBank(db, owner, false, bank.id, { name: 'Polished Pack', description: 'Edited', questions: qs(2) });
    assert.equal(updated.name, 'Polished Pack'); assert.equal(updated.questionCount, 3);
    assert.equal(getBank(db, owner.id, bank.id).questions[0].text, 'Q2-0?');
    assert.throws(() => updateBank(db, other, false, bank.id, { name: 'Hijack', questions: qs(3) }), /not found/i);
    assert.equal(updateBank(db, other, true, bank.id, { name: 'Admin Fix', questions: qs(4) }).name, 'Admin Fix');
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});
