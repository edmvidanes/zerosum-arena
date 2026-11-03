// AI Pack Forge parsing + ready-made library validation
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AI_IDENTITY, parseAiPack } from '../src/ai.js';
import { normalizeQuestions } from '../src/banks.js';

test('parseAiPack extracts JSON from model text', () => {
  const pack = parseAiPack('Here you go: {"name":"Bio Basics","questions":[{"prompt":"Q?","options":["a","b","c","d"],"correctIndex":1,"explanation":"why"}]} done');
  assert.equal(pack.name, 'Bio Basics');
  assert.equal(pack.questions.length, 1);
});
test('parseAiPack rejects non-JSON', () => { assert.throws(() => parseAiPack('no json here')); });
test('ZeroSum Sensei identity is quiz-and-learning only', () => { assert.match(AI_IDENTITY, /quiz and learning specialist/); });
test('out-of-scope topics are refused by the model contract', () => {
  assert.throws(() => parseAiPack('{"error":"ZeroSum Sensei only builds quizzes for learning topics."}'), (err) => err.code === 'AI_OUT_OF_SCOPE');
});

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../data');
for (const file of ['math-foundations-bank.json','english-grammar-bank.json','science-explorers-bank.json','philippine-history-bank.json','money-smart-bank.json','job-ready-bank.json']) {
  test('ready-made pack validates: ' + file, () => {
    const raw = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    const questions = normalizeQuestions(raw.questions, 1000);
    assert.ok(questions.length >= 12, 'at least 12 questions');
    assert.ok(questions.every((q) => q.explanation.length > 10), 'every question teaches');
  });
}
