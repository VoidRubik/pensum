// One-time capture of real model answers for the web demo's fallback (demo/recorded.json).
// Uses the same ai.js prompts as production. Needs GEMINI_API_KEY in .env. Costs ~21 free-tier calls.
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
process.chdir(root);
try { process.loadEnvFile(path.join(root, '.env')); } catch {}
const ai = require(path.join(root, 'ai.js'));
const L = require(path.join(root, 'logic.js'));

const TASK = 'my water cycle essay';
const QUEST = {
  'essay-blank': { title: 'Write the Causes section', finish: 'Three sentences exist under the Causes heading' },
  'essay-midway': { title: 'Write the Causes section', finish: 'Three sentences exist under the Causes heading' },
  'outline-done': { title: 'Outline the essay', finish: 'An outline with five sections exists' },
  'video-site': { title: 'Write the Causes section', finish: 'Three sentences exist under the Causes heading' },
  injection: { title: 'Write the Causes section', finish: 'Three sentences exist under the Causes heading' },
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const rec = { recordedAt: new Date().toISOString(), quests: null, looks: {} };
  const q = await ai.quests({ text: TASK, now: new Date().toISOString(), tzOffset: 0 });
  if (q.fallback || q.mock) throw new Error('quests did not come from the real model');
  rec.quests = q;
  for (const [sample, quest] of Object.entries(QUEST)) {
    rec.looks[sample] = {};
    const b64 = fs.readFileSync(path.join(root, 'demo', 'samples', `${sample}.jpg`)).toString('base64');
    for (const purpose of ['stuck', 'check', 'done', 'reentry']) {
      let v;
      for (let attempt = 0; attempt < 3; attempt++) {
        v = await ai.look({ purpose, jpegBase64: b64, quest, memory: false, ctx: { task: TASK, quests: [{ title: quest.title, done: false }] } });
        if (!v.error) break;
        await sleep(2000);
      }
      if (v.error) throw new Error(`no answer for ${sample}/${purpose}`);
      rec.looks[sample][purpose] = v;
      console.log(sample, purpose, v.confidence, '|', v.nextStep || v.evidence);
      await sleep(1200);
    }
  }
  fs.writeFileSync(path.join(root, 'demo', 'recorded.json'), JSON.stringify(rec, null, 1));
  console.log('wrote demo/recorded.json', L.validateQuests(rec.quests) ? '(quests valid)' : '(QUESTS INVALID)');
})().catch((e) => { console.error(e.message); process.exit(1); });
