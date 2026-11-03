import test from 'node:test';
import assert from 'node:assert/strict';
import { isAdminAccount } from '../src/auth.js';
import { excerptForModel, extractDocumentText } from '../src/document.js';

test('only the configured admin email is admin', () => {
  assert.equal(isAdminAccount({ email: 'dlsu@zerosum.website' }), true);
  assert.equal(isAdminAccount({ email: 'DLSU@zerosum.website' }), true);
  assert.equal(isAdminAccount({ email: 'free@zerosum.local' }), false);
  assert.equal(isAdminAccount(undefined), false);
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
