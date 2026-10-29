import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';

test('recent hosted champions retain only the latest 10 summaries', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-db-'));
  let db;
  try {
    db = openDatabase(directory);
    const insert = db.prepare(`INSERT INTO tournament_winners (code, champion_name, champion_avatar, bank_name, player_count, rounds, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (let index = 1; index <= 12; index += 1) {
      insert.run(`CODE${String(index).padStart(2, '0')}`, `Champion ${index}`, 'arena-01', 'Test Pack', 2, 1, 1000 + index);
    }
    db.close();

    db = openDatabase(directory);
    const rows = db.prepare('SELECT code FROM tournament_winners ORDER BY ended_at DESC').all();
    assert.equal(rows.length, 10);
    assert.equal(rows[0].code, 'CODE12');
    assert.equal(rows.at(-1).code, 'CODE03');
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
