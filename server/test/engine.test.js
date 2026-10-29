import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroups, difficultyFor, questionSeconds, resolveCombat, resolveRpsCombat } from '../src/engine.js';

test('fastest correct damages a slower correct player', () => {
  const result = resolveCombat({ aliveIds: ['fast', 'slow'], hp: { fast: 3, slow: 3 }, correctIndex: 1,
    answers: { fast: { optionIndex: 1, receivedAt: 100 }, slow: { optionIndex: 1, receivedAt: 150 } } });
  assert.deepEqual(result.hp, { fast: 3, slow: 2 });
});

test('the only correct player deals damage regardless of response time', () => {
  const result = resolveCombat({ aliveIds: ['wrong', 'right'], hp: { wrong: 2, right: 2 }, correctIndex: 0,
    answers: { wrong: { optionIndex: 2, receivedAt: 50 }, right: { optionIndex: 0, receivedAt: 500 } } });
  assert.deepEqual(result.hp, { wrong: 1, right: 2 });
});

test('all-wrong damages everyone and eliminates zero HP players', () => {
  const result = resolveCombat({ aliveIds: ['a', 'b'], hp: { a: 3, b: 1 }, correctIndex: 0,
    answers: { a: { optionIndex: 3, receivedAt: 100 } } });
  assert.deepEqual(result.survivors, ['a']);
  assert.deepEqual(result.hp, { a: 2, b: 0 });
});

test('two wrong answers damage both players regardless of answer speed', () => {
  const result = resolveCombat({ aliveIds: ['fast-wrong', 'slow-wrong'], hp: { 'fast-wrong': 3, 'slow-wrong': 3 }, correctIndex: 0,
    answers: { 'fast-wrong': { optionIndex: 1, receivedAt: 10 }, 'slow-wrong': { optionIndex: 2, receivedAt: 900 } } });
  assert.deepEqual(result.damagedIds, ['fast-wrong', 'slow-wrong']);
  assert.deepEqual(result.hp, { 'fast-wrong': 2, 'slow-wrong': 2 });
});

test('a three-player winner damages both opponents', () => {
  const result = resolveCombat({ aliveIds: ['a', 'b', 'c'], hp: { a: 3, b: 2, c: 1 }, correctIndex: 2,
    answers: { a: { optionIndex: 2, receivedAt: 100 }, b: { optionIndex: 2, receivedAt: 150 }, c: { optionIndex: 1, receivedAt: 90 } } });
  assert.deepEqual(result.survivors, ['a', 'b']);
  assert.deepEqual(result.hp, { a: 3, b: 1, c: 0 });
});

test('clash point guarantees a survivor', () => {
  const result = resolveCombat({ aliveIds: ['a', 'b'], hp: { a: 1, b: 1 }, correctIndex: 0, answers: {} });
  assert.equal(result.clashPoint, true);
  assert.deepEqual(result.hp, { a: 1, b: 1 });
});

test('same-millisecond correct answers share the shield', () => {
  const result = resolveCombat({ aliveIds: ['a', 'b'], hp: { a: 2, b: 2 }, correctIndex: 0,
    answers: { a: { optionIndex: 0, receivedAt: 100 }, b: { optionIndex: 0, receivedAt: 100 } } });
  assert.deepEqual(result.damagedIds, []);
});

test('rock paper scissors compares player moves instead of an answer key', () => {
  const rockWins = resolveRpsCombat({ aliveIds: ['rock', 'scissors'], hp: { rock: 3, scissors: 3 },
    answers: { rock: { optionIndex: 0 }, scissors: { optionIndex: 2 } } });
  assert.deepEqual(rockWins.damagedIds, ['scissors']);
  assert.deepEqual(rockWins.hp, { rock: 3, scissors: 2 });

  const draw = resolveRpsCombat({ aliveIds: ['a', 'b'], hp: { a: 2, b: 2 },
    answers: { a: { optionIndex: 1 }, b: { optionIndex: 1 } } });
  assert.equal(draw.draw, true);
  assert.deepEqual(draw.damagedIds, []);
  assert.deepEqual(draw.hp, { a: 2, b: 2 });
});

test('three-player rock paper scissors handles mixed moves and timeouts', () => {
  const allMoves = resolveRpsCombat({ aliveIds: ['rock', 'paper', 'scissors'], hp: { rock: 3, paper: 3, scissors: 3 },
    answers: { rock: { optionIndex: 0 }, paper: { optionIndex: 1 }, scissors: { optionIndex: 2 } } });
  assert.equal(allMoves.draw, true);
  assert.deepEqual(allMoves.damagedIds, []);

  const timeout = resolveRpsCombat({ aliveIds: ['ready', 'late'], hp: { ready: 2, late: 2 }, answers: { ready: { optionIndex: 0 } } });
  assert.deepEqual(timeout.damagedIds, ['late']);
  assert.deepEqual(timeout.hp, { ready: 2, late: 1 });
});

test('odd fields use one triple and the rest pairs', () => {
  assert.deepEqual(createGroups(['a', 'b', 'c', 'd', 'e']), [['a', 'b', 'c'], ['d', 'e']]);
});

test('difficulty and configured timer thresholds match the tournament rules', () => {
  assert.equal(difficultyFor(13), 'basic');
  assert.equal(difficultyFor(12), 'scenario');
  assert.equal(questionSeconds(undefined), 20);
  assert.equal(questionSeconds(10), 20);
  assert.equal(questionSeconds(45), 45);
  assert.equal(questionSeconds(500), 120);
});
