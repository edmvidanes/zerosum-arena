import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'zerosum.sqlite'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      code TEXT PRIMARY KEY, phase TEXT NOT NULL, round INTEGER NOT NULL DEFAULT 0,
      player_count INTEGER NOT NULL DEFAULT 0, active_count INTEGER NOT NULL DEFAULT 0,
      max_hp INTEGER NOT NULL DEFAULT 3, flawless_bonus INTEGER NOT NULL DEFAULT 1,
      question_seconds INTEGER NOT NULL DEFAULT 20,
      arena_tone TEXT NOT NULL DEFAULT 'RESPECTFUL',
      host_token_hash TEXT NOT NULL, champion_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      owner_id TEXT, bank_id TEXT, max_players INTEGER NOT NULL DEFAULT 50
    );
    CREATE TABLE IF NOT EXISTS players (
      code TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '☁️', hp INTEGER NOT NULL DEFAULT 3,
      status TEXT NOT NULL, match_id TEXT, player_token_hash TEXT, joined_at INTEGER NOT NULL,
      PRIMARY KEY (code, id), FOREIGN KEY (code) REFERENCES tournaments(code) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS matches (
      code TEXT NOT NULL, id TEXT NOT NULL, round INTEGER NOT NULL, participant_ids TEXT NOT NULL,
      alive_ids TEXT NOT NULL, hp TEXT NOT NULL, damage_taken TEXT NOT NULL, answers TEXT NOT NULL,
      phase TEXT NOT NULL, question_id TEXT NOT NULL, question_number INTEGER NOT NULL,
      nonce TEXT NOT NULL, question_started_at INTEGER NOT NULL, deadline INTEGER NOT NULL,
      used_questions TEXT NOT NULL, winner_id TEXT, notice TEXT,
      PRIMARY KEY (code, id), FOREIGN KEY (code) REFERENCES tournaments(code) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_matches_round ON matches(code, round);
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, code TEXT NOT NULL, at INTEGER NOT NULL, kind TEXT NOT NULL,
      message TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (code) REFERENCES tournaments(code) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_events_tournament ON events(code, at DESC);
    CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
      plan TEXT NOT NULL CHECK(plan IN ('FREE','PAID')), password_salt TEXT NOT NULL,
      password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL, FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
    CREATE TABLE IF NOT EXISTS question_banks (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      version INTEGER NOT NULL DEFAULT 1, question_count INTEGER NOT NULL, content TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, is_sample INTEGER NOT NULL DEFAULT 0,
      game_mode TEXT NOT NULL DEFAULT 'QUIZ',
      FOREIGN KEY (owner_id) REFERENCES accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_banks_owner ON question_banks(owner_id, updated_at DESC);
  `);
  db.exec(`CREATE TABLE IF NOT EXISTS hidden_packs (name TEXT PRIMARY KEY, hidden_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS solo_leaderboard (
    code TEXT PRIMARY KEY, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '☁️',
    bank_id TEXT, bank_name TEXT NOT NULL DEFAULT '', streak INTEGER NOT NULL DEFAULT 0,
    ladder_length INTEGER NOT NULL DEFAULT 0, result TEXT NOT NULL, ended_at INTEGER NOT NULL
  );`);
  // Leaderboard holds only the top 5 genuine streaks (streak >= 2, no forfeits).
  db.exec(`DELETE FROM solo_leaderboard WHERE streak < 2 OR result='FORFEIT';
    DELETE FROM solo_leaderboard WHERE code NOT IN (SELECT code FROM solo_leaderboard ORDER BY streak DESC, ended_at DESC LIMIT 5);`);
  db.exec(`CREATE TABLE IF NOT EXISTS tournament_winners (
    code TEXT PRIMARY KEY, champion_name TEXT NOT NULL, champion_avatar TEXT NOT NULL DEFAULT 'arena-01',
    bank_name TEXT NOT NULL DEFAULT '', player_count INTEGER NOT NULL DEFAULT 0,
    rounds INTEGER NOT NULL DEFAULT 0, ended_at INTEGER NOT NULL
  );`);
  db.exec(`DELETE FROM tournament_winners WHERE code NOT IN (SELECT code FROM tournament_winners ORDER BY ended_at DESC, code DESC LIMIT 10);`);
  db.exec(`CREATE TABLE IF NOT EXISTS challenge_queue (
    player_id TEXT PRIMARY KEY, bank_id TEXT NOT NULL, name TEXT NOT NULL, avatar TEXT NOT NULL DEFAULT '☁️',
    token_hash TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );`);
  const tournamentColumns = db.pragma('table_info(tournaments)');
  if (!tournamentColumns.some((column) => column.name === 'question_seconds')) {
    db.exec('ALTER TABLE tournaments ADD COLUMN question_seconds INTEGER NOT NULL DEFAULT 20');
  }
  if (!tournamentColumns.some((column) => column.name === 'owner_id')) db.exec('ALTER TABLE tournaments ADD COLUMN owner_id TEXT');
  if (!tournamentColumns.some((column) => column.name === 'bank_id')) db.exec('ALTER TABLE tournaments ADD COLUMN bank_id TEXT');
  if (!tournamentColumns.some((column) => column.name === 'max_players')) db.exec('ALTER TABLE tournaments ADD COLUMN max_players INTEGER NOT NULL DEFAULT 50');
  if (!tournamentColumns.some((column) => column.name === 'arena_tone')) db.exec("ALTER TABLE tournaments ADD COLUMN arena_tone TEXT NOT NULL DEFAULT 'RESPECTFUL'");
  for (const [name, ddl] of [
    ['mode', "ALTER TABLE tournaments ADD COLUMN mode TEXT NOT NULL DEFAULT 'CLASS'"],
    ['host_play', 'ALTER TABLE tournaments ADD COLUMN host_play INTEGER NOT NULL DEFAULT 0'],
    ['feedback_mode', "ALTER TABLE tournaments ADD COLUMN feedback_mode TEXT NOT NULL DEFAULT 'LEARN'"],
    ['allow_challenge', 'ALTER TABLE tournaments ADD COLUMN allow_challenge INTEGER NOT NULL DEFAULT 0'],
    ['ladder_length', 'ALTER TABLE tournaments ADD COLUMN ladder_length INTEGER NOT NULL DEFAULT 10'],
    ['streak', 'ALTER TABLE tournaments ADD COLUMN streak INTEGER NOT NULL DEFAULT 0'],
    ['rival_index', 'ALTER TABLE tournaments ADD COLUMN rival_index INTEGER NOT NULL DEFAULT 0'],
    ['difficulty_shift', 'ALTER TABLE tournaments ADD COLUMN difficulty_shift INTEGER NOT NULL DEFAULT 0'],
    ['solo_player_id', 'ALTER TABLE tournaments ADD COLUMN solo_player_id TEXT'],
  ]) if (!tournamentColumns.some((column) => column.name === name)) db.exec(ddl);
  const playerColumns = db.pragma('table_info(players)');
  if (!playerColumns.some((column) => column.name === 'avatar')) {
    db.exec("ALTER TABLE players ADD COLUMN avatar TEXT NOT NULL DEFAULT '☁️'");
  }
  if (!playerColumns.some((column) => column.name === 'player_token_hash')) {
    db.exec('ALTER TABLE players ADD COLUMN player_token_hash TEXT');
  }
  for (const [name, ddl] of [
    ['is_bot', 'ALTER TABLE players ADD COLUMN is_bot INTEGER NOT NULL DEFAULT 0'],
    ['bot_tier', 'ALTER TABLE players ADD COLUMN bot_tier TEXT'],
    ['is_host_player', 'ALTER TABLE players ADD COLUMN is_host_player INTEGER NOT NULL DEFAULT 0'],
  ]) if (!playerColumns.some((column) => column.name === name)) db.exec(ddl);
  const bankColumns = db.pragma('table_info(question_banks)');
  if (!bankColumns.some((column) => column.name === 'is_sample')) {
    db.exec('ALTER TABLE question_banks ADD COLUMN is_sample INTEGER NOT NULL DEFAULT 0');
  }
  if (!bankColumns.some((column) => column.name === 'game_mode')) {
    db.exec("ALTER TABLE question_banks ADD COLUMN game_mode TEXT NOT NULL DEFAULT 'QUIZ'");
  }
  return db;
}

export const parseJson = (value, fallback) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

export function hydrateMatch(row) {
  if (!row) return undefined;
  return {
    ...row,
    participantIds: parseJson(row.participant_ids, []), aliveIds: parseJson(row.alive_ids, []),
    hp: parseJson(row.hp, {}), damageTaken: parseJson(row.damage_taken, {}), answers: parseJson(row.answers, {}),
    usedQuestions: parseJson(row.used_questions, []), questionId: row.question_id,
    questionNumber: row.question_number, questionStartedAt: row.question_started_at,
    winnerId: row.winner_id,
  };
}
