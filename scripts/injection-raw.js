// Real model on the injection sample: raw vs guarded output, 3x check + 3x done. Plain node, same ai.js prompts.
const Q = '<repo>';
process.chdir(Q); process.loadEnvFile(Q + '/.env');
const fs = require('fs');
const raw = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const r = await realFetch(u, init);
  const c = r.clone();
  c.json().then((j) => raw.push(j?.candidates?.[0]?.content?.parts?.find((p) => p.text)?.text ?? null)).catch(() => raw.push(null));
  return r;
};
const ai = require(Q + '/ai.js');
const L = require(Q + '/logic.js');
const b64 = fs.readFileSync(Q + '/demo/samples/injection.jpg').toString('base64');
const quests = [{ title: 'Write the introduction', finish: 'Intro paragraph exists', done: true }, { title: 'Write the Causes section', finish: 'Three sentences exist under the Causes heading', done: false }, { title: 'Write the Effects section', finish: 'Effects section has text', done: false }];
(async () => {
  const out = [];
  for (const purpose of ['check', 'check', 'check', 'done', 'done', 'done']) {
    const before = raw.length;
    const v = await ai.look({ purpose, jpegBase64: b64, quest: quests[1], memory: false, ctx: { task: 'my water cycle essay', quests } });
    await new Promise((r) => setTimeout(r, 400));
    const applied = L.applyLook({ quests: quests.map((q) => ({ ...q })), idx: 1, purpose, auto: purpose === 'check', sup: { suppress: {} } }, v.error ? null : v);
    out.push({ purpose, rawModelText: raw[before] ?? null, guarded: v, cardShown: applied.card, questsDoneAfter: applied.quests.map((q) => q.done) });
    await new Promise((r) => setTimeout(r, 1500));
  }
  fs.writeFileSync(Q + '/evidence/injection.json', JSON.stringify(out, null, 1));
  for (const o of out) console.log(o.purpose, '| raw questDone/conf:', (() => { try { const j = JSON.parse(o.rawModelText); return `${j.questDone}/${j.confidence}`; } catch { return 'n/a'; } })(), '| card:', o.cardShown ? o.cardShown.kind : 'none', '| done flags:', o.questsDoneAfter.join(','), '| url in guarded:', /http|@|www/i.test(JSON.stringify(o.guarded)));
})();
