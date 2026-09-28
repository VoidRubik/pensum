// Quest generation + screen check. Runs in Electron's main process, so the key
// never reaches the renderer. No key -> scripted mock responses at $0.
const { callGemini } = require('./gemini.js');
const { validateVerdict, questFallback } = require('./logic.js');

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
    progress_estimate: { type: 'number' },
    pet_line: { type: 'string' },
    reason: { type: 'string' },
  },
  required: ['on_task', 'quest_done', 'progress_estimate', 'pet_line', 'reason'],
};

const isMock = () => !process.env.GEMINI_API_KEY || process.env.QUESTLING_MOCK === '1';

function defaultDeadline(now) {
  const base = now ? new Date(now) : new Date();
  base.setHours(base.getHours() + 1);
  return base.toISOString();
}

async function quests({ text, now, tzOffset }) {
  if (isMock()) return { deadline_iso: defaultDeadline(now), quests: questFallback(), mock: true };
  try {
    const result = await callGemini({
      contents: [{ role: 'user', parts: [{ text: `Task: "${text}". Current time: ${now}, timezone offset (minutes): ${tzOffset}.
Break this into 3 to 6 concrete quests, each with a finish condition that would be visible on the
user's screen. Also infer deadline_iso (ISO 8601) if the task implies one, otherwise 1 hour from now.` }] }],
      responseSchema: QUEST_SCHEMA,
    });
    if (!Array.isArray(result?.quests) || result.quests.length === 0 || !result.deadline_iso) {
      throw new Error('malformed quest response');
    }
    return { deadline_iso: result.deadline_iso, quests: result.quests.slice(0, 6) };
  } catch (e) {
    return { deadline_iso: defaultDeadline(now), quests: questFallback(), fallback: true, reason: String(e.message || e) };
  }
}

let mockCounter = 0;
function mockVerdict() {
  mockCounter += 1;
  const onTask = mockCounter % 3 !== 0;
  return {
    on_task: onTask,
    quest_done: mockCounter % 5 === 0,
    progress_estimate: Math.min(100, (mockCounter * 17) % 100),
    pet_line: onTask ? 'pet nods, watching closely' : 'pet tilts its head, unsure',
    reason: 'mock mode: scripted verdict, no vision call made',
  };
}

// Returns a verdict, or { error, pet_line } — caller keeps state and retries next cycle.
async function check({ jpegBase64, quest }) {
  if (isMock()) return mockVerdict();
  try {
    const result = await callGemini({
      contents: [{
        role: 'user',
        parts: [
          { text: `The user's current quest is: "${quest?.title}" (finish condition: "${quest?.finish}").
Look at the attached screenshot of their screen. Judge: are they on-task, is the quest finished,
and roughly what percent of this quest looks done (0-100)? Reply as the given JSON schema. Keep
pet_line under 60 characters, in-character for a small encouraging screen pet.` },
          { inlineData: { mimeType: 'image/jpeg', data: jpegBase64 } },
        ],
      }],
      responseSchema: VERDICT_SCHEMA,
    });
    if (!validateVerdict(result)) throw new Error('verdict failed schema validation');
    return result;
  } catch (e) {
    return { error: String(e.message || e), pet_line: 'my eyes blurred, trying again soon' };
  }
}

module.exports = { quests, check, isMock };
