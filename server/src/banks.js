import crypto from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { assertPackContentSafe } from './content-safety.js';

export const MAX_PACKS_PER_OWNER = 20;
export const PACK_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function normalizeRetention(value) {
  return String(value ?? '').trim().toUpperCase() === 'PERMANENT' ? 'PERMANENT' : 'TEMPORARY';
}

export function cleanupExpiredBanks(db, now = Date.now()) {
  return db.prepare(`DELETE FROM question_banks
    WHERE is_sample=0 AND retention='TEMPORARY' AND expires_at IS NOT NULL AND expires_at<=?
      AND NOT EXISTS (SELECT 1 FROM tournaments WHERE tournaments.bank_id=question_banks.id AND tournaments.phase NOT IN ('COMPLETE','CANCELLED'))`).run(now).changes;
}

function cleanText(value, label, maximum) {
  const result = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!result || result.length > maximum) throw new Error(`${label} is required and must be ${maximum} characters or fewer.`);
  return result;
}

export function normalizeQuestions(input, maximum, allowDuplicates = false) {
  if (!Array.isArray(input) || input.length < 3) throw new Error('A challenge pack needs at least 3 questions.');
  if (input.length > maximum) throw new Error(`This plan allows up to ${maximum} questions per challenge pack.`);
  const seen = new Set();
  return input.map((item, index) => {
    const prompt = cleanText(item.prompt ?? item.question ?? item.q ?? item.text, `Question ${index + 1}`, 500);
    const rawOptions = item.options ?? item.o;
    if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > 6) throw new Error(`Question ${index + 1} must have 2–6 options.`);
    const options = rawOptions.map((option, optionIndex) => cleanText(option, `Question ${index + 1}, option ${optionIndex + 1}`, 200));
    const correctIndex = Number(item.correctIndex ?? (Array.isArray(item.a) ? item.a[0] : item.answer));
    if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) throw new Error(`Question ${index + 1} has an invalid correctIndex.`);
    const key = `${prompt.toLowerCase()}|${options.join('|').toLowerCase()}`;
    if (!allowDuplicates && seen.has(key)) throw new Error(`Question ${index + 1} is a duplicate. Turn on repeated questions if this is intentional.`);
    seen.add(key);
    const domain = Number(item.domain ?? item.d);
    return {
      id: String(item.id ?? '').trim().slice(0, 80) || crypto.randomUUID(), type: options.length === 2 && options.map((value) => value.toLowerCase()).sort().join('|') === 'false|true' ? 'TRUE_FALSE' : 'MULTIPLE_CHOICE',
      text: prompt, options, correctIndex,
      explanation: String(item.explanation ?? item.e ?? '').trim().slice(0, 1000),
      difficulty: ['basic', 'scenario'].includes(item.difficulty) ? item.difficulty : 'basic',
      domain: Number.isInteger(domain) && domain >= 1 && domain <= 4 ? domain : undefined,
      tags: Array.isArray(item.tags) ? item.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 10) : [],
    };
  });
}

export function parseBankUpload(input) {
  const format = String(input.format ?? 'json').toLowerCase();
  const content = String(input.content ?? '');
  if (!content || Buffer.byteLength(content, 'utf8') > 1024 * 1024) throw new Error('Upload a challenge-pack file no larger than 1 MB.');
  if (format === 'json') {
    let parsed;
    try { parsed = JSON.parse(content); } catch { throw new Error('The JSON file is not valid.'); }
    return {
      name: input.name || parsed.name,
      description: input.description || parsed.description,
      questions: Array.isArray(parsed) ? parsed : parsed.questions,
    };
  }
  if (format !== 'csv') throw new Error('Only JSON and CSV challenge packs are supported.');
  let records;
  try { records = parse(content, { columns: true, skip_empty_lines: true, trim: true, bom: true }); }
  catch (error) { throw new Error(`The CSV file is not valid: ${error.message}`); }
  return {
    name: input.name,
    description: input.description,
    questions: records.map((row) => {
      const options = [row.optionA, row.optionB, row.optionC, row.optionD, row.optionE, row.optionF].filter((value) => String(value ?? '').trim());
      return {
        prompt: row.question, options, correctIndex: Number(row.correctIndex), explanation: row.explanation,
        difficulty: row.difficulty, tags: String(row.tags ?? '').split('|').map((tag) => tag.trim()).filter(Boolean),
      };
    }),
  };
}

export function listBanks(db, accountId, isAdmin = false) {
  cleanupExpiredBanks(db);
  const select = `SELECT b.id,b.name,b.description,b.version,b.question_count AS questionCount,b.created_at AS createdAt,
    EXISTS(SELECT 1 FROM hidden_packs h WHERE h.name=b.name) AS hidden,
    b.updated_at AS updatedAt,b.is_sample AS isSample,b.game_mode AS gameMode,b.owner_id AS ownerId,
    a.email AS ownerEmail,b.retention,b.expires_at AS expiresAt
    FROM question_banks b LEFT JOIN accounts a ON a.id=b.owner_id`;
  if (isAdmin) {
    return db.prepare(`${select} WHERE b.is_sample=0 OR b.owner_id=? ORDER BY b.is_sample DESC,b.updated_at DESC`).all(accountId);
  }
  return db.prepare(`${select} WHERE b.owner_id=? ORDER BY b.is_sample DESC,b.updated_at DESC`).all(accountId);
}

export function getBank(db, accountId, bankId, anyOwner = false) {
  cleanupExpiredBanks(db);
  const row = anyOwner
    ? db.prepare('SELECT * FROM question_banks WHERE id=?').get(bankId)
    : db.prepare('SELECT * FROM question_banks WHERE id=? AND owner_id=?').get(bankId, accountId);
  if (!row) throw new Error('Challenge pack not found.');
  return { ...row, questions: JSON.parse(row.content) };
}

export function updateBank(db, account, isAdmin, bankId, input) {
  const existing = db.prepare('SELECT * FROM question_banks WHERE id=?').get(bankId);
  if (!existing) throw new Error('Challenge pack not found.');
  if (!isAdmin && existing.owner_id !== account.id) throw new Error('Challenge pack not found.');
  if (existing.game_mode === 'RPS') throw new Error('Bato Bato Pick is a game mode, not an editable quiz pack.');
  const questions = normalizeQuestions(input.questions, 500, Boolean(input.allowDuplicates));
  const name = cleanText(input.name ?? existing.name, 'Pack name', 80);
  const description = String(input.description ?? existing.description ?? '').trim().slice(0, 300);
  assertPackContentSafe({ name, description, questions });
  const now = Date.now();
  const retention = existing.is_sample ? 'PERMANENT' : (input.retention === undefined ? (existing.retention ?? 'PERMANENT') : normalizeRetention(input.retention));
  const expiresAt = retention === 'PERMANENT' ? null
    : (existing.retention === 'TEMPORARY' && existing.expires_at && existing.expires_at > now ? existing.expires_at : now + PACK_RETENTION_DAYS * DAY_MS);
  db.prepare('UPDATE question_banks SET name=?,description=?,question_count=?,content=?,updated_at=?,retention=?,expires_at=? WHERE id=?')
    .run(name, description, questions.length, JSON.stringify(questions), now, retention, expiresAt, existing.id);
  return { id: existing.id, name, description, version: existing.version, questionCount: questions.length, createdAt: existing.created_at, updatedAt: now, isSample: existing.is_sample, gameMode: existing.game_mode, ownerId: existing.owner_id, retention, expiresAt };
}

export function createBank(db, account, limits, input) {
  cleanupExpiredBanks(db);
  const packLimit = Math.min(Number(limits.banks) || MAX_PACKS_PER_OWNER, MAX_PACKS_PER_OWNER);
  const existing = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(question_count),0) AS total FROM question_banks WHERE owner_id=? AND is_sample=0').get(account.id);
  if (existing.count >= packLimit) throw new Error(`Pack limit reached: each account can keep up to ${packLimit} created packs. Delete an old pack to make room.`);
  const questions = normalizeQuestions(input.questions, limits.questionsPerBank, Boolean(input.allowDuplicates));
  if (existing.total + questions.length > limits.totalQuestions) throw new Error(`Your plan allows ${limits.totalQuestions} stored questions in total.`);
  const bank = {
    id: crypto.randomUUID(), name: cleanText(input.name, 'Pack name', 80),
    description: String(input.description ?? '').trim().slice(0, 300), questions,
  };
  assertPackContentSafe(bank);
  const retention = normalizeRetention(input.retention);
  const now = Date.now();
  const expiresAt = retention === 'PERMANENT' ? null : now + PACK_RETENTION_DAYS * DAY_MS;
  db.prepare(`INSERT INTO question_banks (id,owner_id,name,description,version,question_count,content,created_at,updated_at,game_mode,retention,expires_at)
    VALUES (?,?,?,?,1,?,?,?,?, 'QUIZ',?,?)`).run(bank.id, account.id, bank.name, bank.description, questions.length, JSON.stringify(questions), now, now, retention, expiresAt);
  return { id: bank.id, name: bank.name, description: bank.description, version: 1, questionCount: questions.length, createdAt: now, updatedAt: now, gameMode: 'QUIZ', ownerId: account.id, retention, expiresAt };
}

export function deleteBank(db, account, isAdmin, bankId) {
  const existing = db.prepare('SELECT * FROM question_banks WHERE id=?').get(bankId);
  if (!existing) throw new Error('Challenge pack not found.');
  if (!isAdmin && existing.owner_id !== account.id) throw new Error('Challenge pack not found.');
  if (existing.is_sample) throw new Error('Included packs are built into Zerosum and cannot be deleted.');
  const active = db.prepare("SELECT 1 FROM tournaments WHERE bank_id=? AND phase NOT IN ('COMPLETE','CANCELLED') LIMIT 1").get(existing.id);
  if (active) throw new Error('This pack is being used in an active game. Wait for the game to finish before deleting it.');
  db.prepare('DELETE FROM question_banks WHERE id=?').run(existing.id);
  return { id: existing.id, name: existing.name };
}

export function ensureSampleBanks(db, samples) {
  const accounts = db.prepare('SELECT * FROM accounts').all();
  for (const account of accounts) {
    for (const sample of samples) {
      const name = cleanText(sample.name ?? sample.title, 'Pack name', 80);
      const gameMode = sample.gameMode === 'RPS' ? 'RPS' : 'QUIZ';
      const existing = db.prepare('SELECT id FROM question_banks WHERE owner_id=? AND name=?').get(account.id, name);
      const eligibleQuestions = sample.questions.filter((question) => !Array.isArray(question.a) || question.a.length === 1);
      const questions = normalizeQuestions(eligibleQuestions, 1000);
      const now = Date.now();
      const description = String(sample.description ?? sample.notice ?? '').trim().slice(0, 300);
      if (existing) {
        db.prepare(`UPDATE question_banks SET description=?,question_count=?,content=?,updated_at=?,is_sample=1,game_mode=?,retention='PERMANENT',expires_at=NULL WHERE id=?`)
          .run(description, questions.length, JSON.stringify(questions), now, gameMode, existing.id);
        continue;
      }
      db.prepare(`INSERT INTO question_banks
        (id,owner_id,name,description,version,question_count,content,created_at,updated_at,is_sample,game_mode,retention,expires_at)
        VALUES (?,?,?,?,1,?,?,?,?,1,?,'PERMANENT',NULL)`)
        .run(crypto.randomUUID(), account.id, name, description, questions.length, JSON.stringify(questions), now, now, gameMode);
    }
  }
}
