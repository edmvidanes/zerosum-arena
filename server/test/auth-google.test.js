import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../src/database.js';
import { accountFromCookie, login, loginWithGoogle, verifyGoogleIdToken } from '../src/auth.js';

function temporaryDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zerosum-google-'));
  return { directory, db: openDatabase(directory) };
}

const claims = (overrides = {}) => ({
  aud: 'test-client-id', iss: 'https://accounts.google.com',
  exp: Math.floor(Date.now() / 1000) + 3600, email_verified: 'true',
  sub: 'google-sub-1', email: 'Teacher@Example.com', name: 'Teacher One', ...overrides,
});
const fetchReturning = (payload, ok = true) => async () => ({ ok, json: async () => payload });

test('Google ID tokens are rejected unless audience, issuer, expiry and verified email check out', async () => {
  const options = { clientId: 'test-client-id' };
  const profile = await verifyGoogleIdToken('token', { ...options, fetchImpl: fetchReturning(claims()) });
  assert.deepEqual(profile, { sub: 'google-sub-1', email: 'teacher@example.com', displayName: 'Teacher One' });
  await assert.rejects(() => verifyGoogleIdToken('token', { ...options, fetchImpl: fetchReturning(claims({ aud: 'other-app' })) }), /Google sign-in failed/);
  await assert.rejects(() => verifyGoogleIdToken('token', { ...options, fetchImpl: fetchReturning(claims({ iss: 'https://evil.example' })) }), /Google sign-in failed/);
  await assert.rejects(() => verifyGoogleIdToken('token', { ...options, fetchImpl: fetchReturning(claims({ exp: 1 })) }), /Google sign-in failed/);
  await assert.rejects(() => verifyGoogleIdToken('token', { ...options, fetchImpl: fetchReturning(claims({ email_verified: 'false' })) }), /Google sign-in failed/);
  await assert.rejects(() => verifyGoogleIdToken('token', { ...options, fetchImpl: fetchReturning(claims(), false) }), /Google sign-in failed/);
  await assert.rejects(() => verifyGoogleIdToken('token', { clientId: '', fetchImpl: fetchReturning(claims()) }), /not configured/);
});

test('first Google sign-in creates a host account and later sign-ins reuse it', () => {
  const { directory, db } = temporaryDatabase();
  try {
    const profile = { sub: 'google-sub-1', email: 'teacher@example.com', displayName: 'Teacher One' };
    const first = loginWithGoogle(db, profile);
    assert.equal(first.account.plan, undefined);
    assert.equal(first.account.limits.players, 50);
    assert.equal(first.account.email, 'teacher@example.com');
    assert.equal(accountFromCookie(db, `zerosum_session=${first.token}`).google_sub, 'google-sub-1');
    const second = loginWithGoogle(db, profile);
    assert.equal(second.account.id, first.account.id);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
    // Google-only accounts have an unusable random password.
    assert.throws(() => login(db, 'teacher@example.com', 'any-password-attempt'), /incorrect/i);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});

test('Google sign-in links to an existing password account with the same email', () => {
  const { directory, db } = temporaryDatabase();
  try {
    db.prepare(`INSERT INTO accounts (id,email,display_name,plan,password_salt,password_hash,created_at) VALUES (?,?,?,?,?,?,?)`)
      .run('existing-id', 'teacher@example.com', 'Existing Host', 'HOST', 'salt', 'hash', Date.now());
    const result = loginWithGoogle(db, { sub: 'google-sub-9', email: 'teacher@example.com', displayName: 'Teacher One' });
    assert.equal(result.account.id, 'existing-id');
    assert.equal(result.account.limits.banks, 20);
    assert.equal(db.prepare('SELECT google_sub FROM accounts WHERE id=?').get('existing-id').google_sub, 'google-sub-9');
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
  } finally { db.close(); fs.rmSync(directory, { recursive: true, force: true }); }
});