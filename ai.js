// Quest generation + screen check. Runs in Electron's main process, so the key
// never reaches the renderer. No key -> scripted mock responses at $0.
const { callGemini } = require('./gemini.js');
const ledger = require('./ledger.js');
const { validateVerdict, questFallback } = require('./logic.js');

const QUEST_MODEL = () => process.env.GEMINI_MODEL || 'gemini-3.5-flash';
const CHECK_MODEL = () => process.env.GEMINI_CHECK_MODEL || 'gemini-3.5-flash-lite';
// Done-checks make the user wait: lite answered in ~1.3 s and correctly (n=2); flash took 10-20 s and errored twice.
const DONE_MODEL = () => process.env.GEMINI_DONE_MODEL || CHECK_MODEL();

const PERSONA = `You are Questling, a small cute screen pet who cheers the user on. English only. Warm, brief,
never scolding. pet_line is under 60 characters.`;

const QUEST_SCHEMA = {
  type: 'object',
  properties: {
    deadline_iso: { type: 'string' },
    quests: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, finish: { type: 'string' } },
        required: ['title', 'finish'],
      },
    },
  },
  required: ['deadline_iso', 'quests'],
};

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    on_task: { type: 'boolean' },
    quest_done: { type: 'boolean' },
    progress_estimate: { type: 'integer' },
    pet_line: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['on_task', 'quest_done', 'progress_estimate', 'pet_line', 'reason'],
};

// 2.5 -> thinkingBudget 0; 3.x can't turn thinking off -> thinkingLevel minimal. Never both.
const thinkingFor = (model) => ({
  thinkingConfig: /gemini-3/.test(model) ? { thinkingLevel: 'minimal' } : { thinkingBudget: 0 },
});

const DONE_SCHEMA = {
  type: 'object',
  properties: {
    quest_done: { type: 'boolean' },
    reason: { type: 'string' },
    pet_line: { type: 'string' },
  },
  required: ['quest_done', 'reason', 'pet_line'],
};

const isMock = () => !process.env.GEMINI_API_KEY || process.env.QUESTLING_MOCK === '1';

function defaultDeadline(now) {
  const base = now ? new Date(now) : new Date();
  base.setHours(base.getHours() + 1);
  return base.toISOString();
}

// One real call + one ledger line, ok or not (also on 200-with-bad-JSON).
async function real(kind, auto, args) {
  try {
    const r = await callGemini(args);
    ledger.append({ kind, auto, model: args.model, ...r.usage, ms: r.ms, ok: true, status: 200 });
    return r.data;
  } catch (e) {
    ledger.append({ kind, auto, model: args.model, ...(e.usage || {}), ms: e.ms || 0, ok: false, status: e.status || 0 });
    throw e;
  }
}

async function quests({ text, now, tzOffset }) {
  if (isMock()) return { deadline_iso: defaultDeadline(now), quests: questFallback(), mock: true };
  const model = QUEST_MODEL();
  try {
    const result = await real('quests', false, {
      model,
      systemInstruction: PERSONA,
      generationConfig: thinkingFor(model),
      contents: [{ role: 'user', parts: [{ text: `Task: "${text}". Current time: ${now}, timezone offset (minutes): ${tzOffset}.
Break this into 3 to 6 granular quests. Each finish condition must be checkable from the screen or
from the text of the user's document (e.g. "the conclusion paragraph exists", not "essay is good"). Also infer deadline_iso (ISO 8601) if the task implies one, otherwise 1 hour from now.` }] }],
      responseSchema: QUEST_SCHEMA,
    });
    if (!Array.isArray(result?.quests) || result.quests.length === 0 || !result.deadline_iso) {
      throw new Error('malformed quest response');
    }
    return { deadline_iso: result.deadline_iso, quests: result.quests.slice(0, 6) };
  } catch {
    return { deadline_iso: defaultDeadline(now), quests: questFallback(), fallback: true };
  }
}

// QUESTLING_MOCK_SCRIPT="on,off,off,done,done" -> deterministic verdicts; default cycles.
let mockN = 0;
function mockVerdict() {
  const script = (process.env.QUESTLING_MOCK_SCRIPT || '').split(',').filter(Boolean);
  const step = script.length ? script[mockN++ % script.length] : ['on', 'on', 'off'][mockN++ % 3];
  return {
    on_task: step !== 'off',
    quest_done: step === 'done',
    progress_estimate: step === 'done' ? 100 : step === 'off' ? 10 : 40,
    pet_line: step === 'off' ? 'hmm, wandering?' : step === 'done' ? 'quest done!' : 'nice, keep going',
    reason: 'mock mode: scripted verdict, no vision call made',
  };
}

// Screen-derived signals for the prompt. Built per call, never stored.
function signalLines(ctx) {
  const out = [];
  if (ctx.focus) out.push(`Since the last look the user had in front: ${ctx.focus}.`);
  if (ctx.digest) {
    const h = ctx.digest.headings.length ? `; headings: ${ctx.digest.headings.join(' / ')}` : '';
    out.push(`Their document (${ctx.source}): ${ctx.digest.words} words${h}. It currently ends: "${ctx.digest.tail}"`);
  }
  if (ctx.notYet) out.push(`The user said "not done yet" to: ${ctx.notYet}.`);
  return out.length ? out.join('\n') + '\n' : '';
}

// Last 2 reasons stay in memory only — screen-derived text never hits disk.
let lastReasons = [];
let gen = 0; // bumped on reset so an in-flight check can't write reasons into the next task
const resetMemory = () => { gen++; lastReasons = []; };

// Returns a verdict, or { error, pet_line, status, perDay, retryDelayMs } — caller keeps state.
async function check({ jpegBase64, quest, ctx = {}, auto = false }) {
  if (isMock()) return mockVerdict();
  const model = CHECK_MODEL();
  const myGen = gen;
  const questLines = (ctx.quests || []).map((q) => `${q.done ? '[x]' : '[ ]'} ${q.title}`).join('\n');
  try {
    const result = await real('check', auto, {
      model,
      systemInstruction: PERSONA,
      generationConfig: { ...thinkingFor(model), temperature: 0.2 },
      contents: [{
        role: 'user',
        parts: [
          { text: `Overall task: "${ctx.task}"\nQuests:\n${questLines}\nCurrent quest: "${quest?.title}" (finish condition: "${quest?.finish}")
${lastReasons.length ? `Previous checks said: ${lastReasons.join(' | ')}\n` : ''}${signalLines(ctx)}Look at the attached screenshot. on_task = the screen is plausibly work toward the current quest.
quest_done = the finish condition is visibly met right now. progress_estimate = integer 0-100 for this quest.` },
          { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
        ],
      }],
      responseSchema: VERDICT_SCHEMA,
    });
    if (!validateVerdict(result)) throw new Error('verdict failed schema validation');
    if (myGen === gen) lastReasons = [...lastReasons, result.reason.slice(0, 200)].slice(-2);
    return result;
  } catch (e) {
    return { error: true, pet_line: 'my eyes blurred, trying again soon', status: e.status || 0, perDay: !!e.perDay, retryDelayMs: e.retryDelayMs || 0 };
  }
}

// QUESTLING_MOCK_CLAIM="ok,no" -> deterministic done-check answers; default always agrees.
let claimN = 0;
function mockClaim() {
  const script = (process.env.QUESTLING_MOCK_CLAIM || 'ok').split(',').filter(Boolean);
  const ok = script[claimN++ % script.length] === 'ok';
  return ok
    ? { quest_done: true, reason: 'mock: looks finished', pet_line: 'yes, that looks done!' }
    : { quest_done: false, reason: 'mock: the conclusion is still missing', pet_line: 'hmm, not quite yet' };
}

// "Am I done?" — quest model, sharper frame, full linked text. Returns a verdict or { error, pet_line }.
async function doneCheck({ jpegBase64, quest, ctx = {} }) {
  if (isMock()) return mockClaim();
  const model = DONE_MODEL();
  const doc = ctx.text ? `Full text of their document (${ctx.source}):\n<<<\n${ctx.text}\n>>>\n` : '';
  try {
    const result = await real('done-check', false, {
      model,
      systemInstruction: PERSONA,
      generationConfig: { ...thinkingFor(model), temperature: 0.2 },
      contents: [{
        role: 'user',
        parts: [
          { text: `Overall task: "${ctx.task}"\nThe user says this quest is done: "${quest?.title}" (finish condition: "${quest?.finish}")
${signalLines({ focus: ctx.focus })}${doc}Judge honestly from the screenshot${ctx.text ? ' and the document text' : ''}.
quest_done = the finish condition is met. reason = under 60 characters: what is missing, or what you saw.` },
          { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
        ],
      }],
      responseSchema: DONE_SCHEMA,
    });
    if (typeof result?.quest_done !== 'boolean' || typeof result.reason !== 'string' || typeof result.pet_line !== 'string') throw new Error('bad done-check');
    return result;
  } catch (e) {
    return { error: true, pet_line: 'my eyes blurred, try again', status: e.status || 0 };
  }
}

module.exports = { doneCheck, quests, check, isMock, resetMemory, QUEST_MODEL, CHECK_MODEL, DONE_MODEL };
