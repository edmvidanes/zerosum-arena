import crypto from 'node:crypto';

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const planLimits = {
  FREE: { players: 10, banks: 2, questionsPerBank: 50, totalQuestions: 100 },
  PAID: { players: 50, banks: 25, questionsPerBank: 500, totalQuestions: 5000 },
};

const tokenHash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const passwordHash = (password, salt) => crypto.scryptSync(password, salt, 64).toString('hex');

function safeEqualHex(left, right) {
  try {
    const a = Buffer.from(left, 'hex');
    const b = Buffer.from(right, 'hex');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch { return false; }
}

export function isAdminAccount(account) {
  if (!account?.email) return false;
  const admins = String(process.env.ADMIN_EMAILS ?? 'dlsu@zerosum.website').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  return admins.includes(String(account.email).toLowerCase());
}
export function publicAccount(account) {
  if (!account) return undefined;
  return {
    id: account.id, email: account.email, displayName: account.display_name,
    plan: account.plan, limits: planLimits[account.plan], isAdmin: isAdminAccount(account),
  };
}

export function ensureSeedAccounts(db) {
  const seeds = [
    { email: process.env.FREE_ACCOUNT_EMAIL ?? 'free@zerosum.local', password: process.env.FREE_ACCOUNT_PASSWORD, name: 'Free Host', plan: 'FREE' },
    { email: process.env.PAID_ACCOUNT_EMAIL ?? 'paid@zerosum.local', password: process.env.PAID_ACCOUNT_PASSWORD, name: 'Paid Host', plan: 'PAID' },
  ];
  const insert = db.prepare(`INSERT INTO accounts
    (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`);
  for (const seed of seeds) {
    if (!seed.password || seed.password.length < 12) throw new Error(`A password of at least 12 characters is required for ${seed.email}.`);
    if (db.prepare('SELECT 1 FROM accounts WHERE email=?').get(seed.email.toLowerCase())) continue;
    const salt = crypto.randomBytes(16).toString('hex');
    insert.run(crypto.randomUUID(), seed.email.toLowerCase(), seed.name, seed.plan, salt, passwordHash(seed.password, salt), Date.now());
  }
}

export function login(db, emailInput, passwordInput) {
  const email = String(emailInput ?? '').trim().toLowerCase();
  const password = String(passwordInput ?? '');
  const account = db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
  const candidate = account ? passwordHash(password, account.password_salt) : passwordHash(password, '00000000000000000000000000000000');
  if (!account || !safeEqualHex(candidate, account.password_hash)) throw new Error('Incorrect email or password.');
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)')
    .run(tokenHash(token), account.id, now + sessionLifetimeMs, now);
  return { token, account: publicAccount(account) };
}

export function accountFromCookie(db, cookieHeader = '') {
  const match = String(cookieHeader).match(/(?:^|;\s*)zerosum_session=([^;]+)/);
  if (!match) return undefined;
  const row = db.prepare(`SELECT a.* FROM sessions s JOIN accounts a ON a.id=s.account_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash(decodeURIComponent(match[1])), Date.now());
  return row;
}

export function logout(db, cookieHeader = '') {
  const match = String(cookieHeader).match(/(?:^|;\s*)zerosum_session=([^;]+)/);
  if (match) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(tokenHash(decodeURIComponent(match[1])));
}

export function sessionCookie(token, secure = false) {
  return `zerosum_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(sessionLifetimeMs / 1000)}${secure ? '; Secure' : ''}`;
}

export const clearSessionCookie = (secure = false) => `zerosum_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
export const limitsFor = (plan) => planLimits[plan] ?? planLimits.FREE;
