// Meta Model API integration (Muse Spark) - dev.meta.ai/docs
import { excerptForModel } from './document.js';
const API_URL = process.env.META_MODEL_API_URL || 'https://api.meta.ai/v1/chat/completions';
export const AI_MODEL = process.env.META_MODEL || 'muse-spark-1.3';
export function aiEnabled() { return Boolean(process.env.MODEL_API_KEY || process.env.META_MODEL_API_KEY); }
function apiKey() { return String(process.env.MODEL_API_KEY || process.env.META_MODEL_API_KEY || '').trim().replace(/\\[rn]$/, '').trim(); }
export const AI_IDENTITY = 'ZeroSum Sensei - the quiz and learning specialist inside ZeroSum Arena, powered by Meta Muse Spark. It only creates educational quizzes that help people learn; it refuses anything outside quizzes and learning.';
export function parseAiPack(text) {
  const raw = String(text ?? '');
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Meta AI did not return a quiz pack. Try again.');
  let parsed;
  try { parsed = JSON.parse(raw.slice(start, end + 1)); } catch { throw new Error('Meta AI returned an unreadable quiz pack. Try again.'); }
  if (parsed && typeof parsed === 'object' && typeof parsed.error === 'string') { const e = new Error(parsed.error); e.code = 'AI_OUT_OF_SCOPE'; throw e; }
  const questions = Array.isArray(parsed) ? parsed : parsed.questions;
  if (!Array.isArray(questions) || questions.length < 1) throw new Error('Meta AI returned too few questions. Try again.');
  return { name: String(parsed.name ?? '').trim(), questions };
}
export async function generateQuizPack(input) {
  const topic = String(input.topic ?? '').trim();
  const audience = String(input.audience ?? 'Everyone').trim() || 'Everyone';
  if (!aiEnabled()) { const e = new Error('AI Pack Forge is not configured yet. Add a Meta Model API key (MODEL_API_KEY) on the server. Get one at dev.meta.ai.'); e.code = 'AI_NOT_CONFIGURED'; throw e; }
  if (topic.length < 3) throw new Error('Tell the AI what topic to teach.');
  const wanted = Math.min(20, Math.max(5, Number(input.count) || 12));
  const system = 'You are ZeroSum Sensei, the quiz and learning specialist inside ZeroSum Arena. Your one and only job is turning learning material into fun, educational quiz packs for students, teachers, and self-learners. IDENTITY AND SCOPE RULES: (1) You only ever output a quiz pack, or the refusal object in rule 2 - never essays, code, advice, roleplay, or anything else. (2) If the topic or material is not genuinely about learning something (for example entertainment gossip, instructions for wrongdoing, spam, or a request that is not a quiz topic at all), return ONLY {"error":"ZeroSum Sensei only builds quizzes for learning topics. Give me a subject, lesson, or PDF to teach!"}. (3) Stay factual and safe for classrooms. You are an expert teacher and quiz designer. Return ONLY valid JSON, no markdown fences. Schema: {"name":"short pack title","questions":[{"prompt":"question","options":["A","B","C","D"],"correctIndex":0,"explanation":"one friendly sentence teaching why","difficulty":"basic"}]}. Rules: exactly the requested number of questions; 4 options each; exactly one correct answer; vary correctIndex; age-appropriate, factual, no trick questions; every question MUST have a teaching explanation; mix recall and simple scenario questions.';
  let user = 'Topic: ' + topic + '\nAudience: ' + audience + '\nQuestions: ' + wanted;
  user += input.sourceText ? '\nBase the questions ONLY on this lesson material:\n' + excerptForModel(input.sourceText, 8000) : '\nUse widely accepted curriculum knowledge for this topic.';
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const res = await fetch(API_URL, { method: 'POST', signal: controller.signal, headers: { Authorization: 'Bearer ' + apiKey(), 'Content-Type': 'application/json' }, body: JSON.stringify({ model: AI_MODEL, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.6 }) });
    if (!res.ok) { const body = await res.text().catch(() => ''); const e = new Error('Meta Model API error (' + res.status + '). Check the MODEL_API_KEY on the server.'); e.code = 'AI_UPSTREAM'; e.detail = body.slice(0, 200); throw e; }
    const data = await res.json();
    return parseAiPack(data?.choices?.[0]?.message?.content ?? '');
  } finally { clearTimeout(timer); }
}
