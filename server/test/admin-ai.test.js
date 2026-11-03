import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminAccount } from '../src/auth.js';
import { excerptForModel, extractDocumentText } from '../src/document.js';

test('only the configured admin email is admin', () => {
  const previous = process.env.ADMIN_EMAILS;
  try {
    process.env.ADMIN_EMAILS = 'admin@example.com, boss@example.com';
    assert.equal(isAdminAccount({ email: 'admin@example.com' }), true);
    assert.equal(isAdminAccount({ email: 'ADMIN@example.com' }), true);
    assert.equal(isAdminAccount({ email: 'someone@example.com' }), false);
    assert.equal(isAdminAccount(undefined), false);
  } finally {
    if (previous === undefined) delete process.env.ADMIN_EMAILS; else process.env.ADMIN_EMAILS = previous;
  }
});
test('excerpt samples start middle and end for token efficiency', () => {
  const text = 'A'.repeat(3000) + 'B'.repeat(3000) + 'C'.repeat(3000);
  const out = excerptForModel(text, 900);
  assert.ok(out.length <= 920); assert.match(out, /A/); assert.match(out, /B/); assert.match(out, /C/);
});
test('uploads are PDF-only', async () => {
  const contentBase64 = Buffer.from('Photosynthesis is how plants convert sunlight water and carbon dioxide into food and oxygen for growth.').toString('base64');
  await assert.rejects(() => extractDocumentText({ name: 'lesson.txt', contentBase64 }), /Only PDF/);
  await assert.rejects(() => extractDocumentText({ name: 'lesson.md', contentBase64 }), /Only PDF/);
  await assert.rejects(() => extractDocumentText({ name: 'x.exe', contentBase64 }), /Only PDF/);
});
