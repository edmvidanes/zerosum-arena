// ZeroSum Arena is a classroom-safe learning product. Explicit sexual content
// is prohibited in topics, lesson material, and generated or uploaded packs.
const EXPLICIT_PATTERNS = [
  /\bporn(?:ography|ographic)?\b/i,
  /\berotic\b/i,
  /\bexplicit\s+(?:sex|sexual\s+content)\b/i,
  /\bsexual\s+(?:content|acts?|intercourse)\b/i,
  /\b(?:oral|anal|group)\s+sex\b/i,
  /\bmasturbat\w*\b/i,
  /\borgasm\w*\b/i,
  /\bejaculat\w*\b/i,
  /\bsex\s+(?:stories|story|chat|tape|video|videos)\b/i,
  /\bsext(?:ing|s)?\b/i,
  /\bnude\s+(?:photos?|images?|pictures?|pics?)\b/i,
];

export function findExplicitContent(value) {
  const text = String(value ?? '');
  return EXPLICIT_PATTERNS.find((pattern) => pattern.test(text)) ? 'explicit sexual content' : null;
}

export function assertNoExplicitContent(value, label = 'Content') {
  if (!findExplicitContent(value)) return;
  const error = new Error('Explicit topics are prohibited in ZeroSum Arena. Choose a classroom-safe learning topic instead.');
  error.code = 'AI_EXPLICIT_CONTENT';
  throw error;
}

export function assertPackContentSafe(pack) {
  assertNoExplicitContent(pack?.name ?? '', 'Pack name');
  assertNoExplicitContent(pack?.description ?? '', 'Pack description');
  for (const question of pack?.questions ?? []) {
    assertNoExplicitContent(question?.prompt ?? question?.text ?? '', 'Question');
    assertNoExplicitContent((question?.options ?? []).join(' '), 'Answer choices');
    assertNoExplicitContent(question?.explanation ?? '', 'Explanation');
  }
}
