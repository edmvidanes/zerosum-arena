import crypto from 'node:crypto';

const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
// Every host account is equal - there are no tiers or plans. These limits
// exist only to keep a single account from overwhelming the server.
export const accountLimits = { players: 50, banks: 20, questionsPerBank: 500, totalQuestions: 5000 };

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
  const admins = String(process.env.ADMIN_EMAILS ?? '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  return admins.includes(String(account.email).toLowerCase());
}
export function publicAccount(account) {
  if (!account) return undefined;
  return {
    id: account.id, email: account.email, displayName: account.display_name,
    limits: accountLimits, isAdmin: isAdminAccount(account),
  };
}

function createSession(db, account) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash,account_id,expires_at,created_at) VALUES (?,?,?,?)')
    .run(tokenHash(token), account.id, now + sessionLifetimeMs, now);
  return { token, account: publicAccount(account) };
}

export function login(db, emailInput, passwordInput) {
  const email = String(emailInput ?? '').trim().toLowerCase();
  const password = String(passwordInput ?? '');
  const account = db.prepare('SELECT * FROM accounts WHERE email=?').get(email);
  const candidate = account ? passwordHash(password, account.password_salt) : passwordHash(password, '00000000000000000000000000000000');
  if (!account || !safeEqualHex(candidate, account.password_hash)) throw new Error('Incorrect email or password.');
  return createSession(db, account);
}

export const googleClientId = () => String(process.env.GOOGLE_CLIENT_ID ?? '').trim();

// Verifies a Google Identity Services ID token with Google, then enforces the
// checks that make it safe to trust: audience (this app), issuer, expiry and a
// verified email. Never trust the decoded payload without this step.
export async function verifyGoogleIdToken(credential, { clientId = googleClientId(), fetchImpl = fetch } = {}) {
  if (!clientId) throw new Error('Google sign-in is not configured.');
  if (!credential || typeof credential !== 'string') throw new Error('Missing Google credential.');
  const response = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!response.ok) throw new Error('Google sign-in failed. Try again.');
  const claims = await response.json();
  const issuers = ['accounts.google.com', 'https://accounts.google.com'];
  if (claims.aud !== clientId || !issuers.includes(claims.iss) || Number(claims.exp) * 1000 <= Date.now()
    || !(claims.email_verified === true || claims.email_verified === 'true') || !claims.sub || !claims.email) {
    throw new Error('Google sign-in failed. Try again.');
  }
  const email = String(claims.email).trim().toLowerCase();
  return { sub: String(claims.sub), email, displayName: String(claims.name ?? '').trim() || email.split('@')[0] };
}

// Finds the account for a verified Google profile, linking by verified email
// on first use, or creates a host account. Google-only accounts get a
// random unusable password hash so password login can never match them.
export function loginWithGoogle(db, profile) {
  let account = db.prepare('SELECT * FROM accounts WHERE google_sub=?').get(profile.sub)
    ?? db.prepare('SELECT * FROM accounts WHERE email=?').get(profile.email);
  if (account) {
    if (account.google_sub !== profile.sub) db.prepare('UPDATE accounts SET google_sub=? WHERE id=?').run(profile.sub, account.id);
  } else {
    const salt = crypto.randomBytes(16).toString('hex');
    account = {
      id: crypto.randomUUID(), email: profile.email, display_name: profile.displayName, plan: 'HOST',
      password_salt: salt, password_hash: passwordHash(crypto.randomBytes(32).toString('hex'), salt),
      google_sub: profile.sub, created_at: Date.now(),
    };
    db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,google_sub,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(account.id, account.email, account.display_name, account.plan, account.password_salt, account.password_hash, account.google_sub, account.created_at);
  }
  return createSession(db, account);
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
export const limitsFor = () => accountLimits;
