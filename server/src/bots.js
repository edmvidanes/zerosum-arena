// Deterministic bot rivals for Solo Arcade. Bots are server-side only and
// never receive the correct answer through a client snapshot; the engine
// rolls accuracy/speed from a seeded profile when it schedules an answer.
export const BOT_TIERS = [
  { name: 'Rookie', accuracy: 0.45, medianMs: 9000, timeoutChance: 0.08 },
  { name: 'Contender', accuracy: 0.60, medianMs: 7500, timeoutChance: 0.05 },
  { name: 'Elite', accuracy: 0.72, medianMs: 6000, timeoutChance: 0.03 },
  { name: 'Master', accuracy: 0.84, medianMs: 4500, timeoutChance: 0.01 },
  { name: 'Champion', accuracy: 0.93, medianMs: 3200, timeoutChance: 0 },
];
const FIRST = ['Blaze','Nova','Pixel','Turbo','Echo','Juno','Kaito','Mira','Orbit','Rex','Sable','Taro','Vega','Wren','Yuna','Zed','Astra','Bolt','Comet','Drift'];
const SECOND = ['Scholar','Striker','Sensei','Bandit','Wizard','Ronin','Pilot','Genius','Falcon','Tiger','Monk','Racer','Sage','Viper','Knight','Fox'];
export function seededRandom(seedText) {
  let seed = 2166136261;
  for (const char of String(seedText)) { seed ^= char.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  return () => { seed = Math.imul(seed ^ (seed >>> 15), 2246822507); seed = Math.imul(seed ^ (seed >>> 13), 3266489909); return ((seed ^= seed >>> 16) >>> 0) / 4294967296; };
}
export function tierIndexForRival(rivalIndex, ladderLength, shift = 0) {
  const total = Math.max(1, ladderLength);
  const ratio = (Math.max(1, rivalIndex) - 1) / total;
  let base = ratio < 0.25 ? 0 : ratio < 0.5 ? 1 : ratio < 0.7 ? 2 : ratio < 0.9 ? 3 : 4;
  if (rivalIndex % 5 === 0) base += 1; // boss every 5th rival
  if (rivalIndex >= total) base = 4; // final rival is always Champion tier
  return Math.min(4, Math.max(0, base + shift));
}
export function botProfile(rivalIndex, ladderLength, shift = 0, seedText = '') {
  const tierIndex = tierIndexForRival(rivalIndex, ladderLength, shift);
  const tier = BOT_TIERS[tierIndex];
  const random = seededRandom(seedText || `bot-${rivalIndex}`);
  const name = `${FIRST[Math.floor(random() * FIRST.length)]} ${SECOND[Math.floor(random() * SECOND.length)]}`;
  return { tierIndex, tier: tier.name, accuracy: tier.accuracy, medianMs: tier.medianMs, timeoutChance: tier.timeoutChance, name };
}
export function botAnswerDelayMs(profile, seedText, deadlineMs) {
  const random = seededRandom(seedText);
  if (random() < profile.timeoutChance) return Number.POSITIVE_INFINITY; // never answers; deadline damages the bot
  const jitter = 0.55 + random() * 0.9;
  return Math.min(Math.max(600, profile.medianMs * jitter), Math.max(700, deadlineMs - 400));
}
export function botChoosesCorrect(profile, seedText) { return seededRandom(seedText)() < profile.accuracy; }
