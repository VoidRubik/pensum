// look-flow.js: the main-process look pipeline with its dependencies injected, so session races are testable.
const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

// artifact.js destructures execFile at load: mock it BEFORE the first require so Word probes are countable.
const cp = require('node:child_process');
const probes = [];
const probeTimeouts = [];
mock.method(cp, 'execFile', (_f, args, o, cb) => { probes.push(args.join(' ')); probeTimeouts.push(o.timeout); cb(new Error('no word'), ''); return { kill() {} }; });
const artifact = require('../artifact.js');
const { lookFlow } = require('../look-flow.js');

const req = (o = {}) => ({ idx: 1, epoch: 3, purpose: 'stuck', quest: { title: 'T', finish: 'f' }, ctx: { task: 'x' }, allow: [], linkedPath: null, ...o });

function deps(o = {}) {
  const calls = { ai: 0, setFrame: [], gone: 0, text: [] };
  let gen = 1;
  const d = {
    calls,
    stop: () => { gen++; },
    gen: () => gen,
    work: () => ({ id: 'window:1:0', hwnd: 1, title: 'essay - Word', proc: 'WINWORD' }),
    grab: async () => ({ jpegBase64: 'FRAME', title: 'essay.docx - Word' }),
    heldFrame: () => null,
    setFrame: (f) => calls.setFrame.push(f),
    onGone: () => { calls.gone++; },
    getText: async (a) => { calls.text.push(a); return null; },
    aiLook: async () => { calls.ai++; return { onTask: true, confidence: 0.9, questDone: false, evidence: 'e', nextStep: 'n', sayLine: '' }; },
    redactTitle: (_p, t) => t,
    ...o,
  };
  return d;
}

test('lookFlow: happy path returns the look stamped with idx / epoch / purpose', async () => {
  const d = deps();
  const r = await lookFlow(req(), d);
  assert.equal(r.nextStep, 'n');
  assert.deepEqual([r.idx, r.epoch, r.purpose], [1, 3, 'stuck']);
  assert.equal(d.calls.setFrame.length, 1);
});

test('lookFlow: no chosen window -> noWindow error, nothing captured or sent', async () => {
  const d = deps({ work: () => null });
  const r = await lookFlow(req(), d);
  assert.equal(r.noWindow, true);
  assert.equal(d.calls.ai, 0);
});

test('lookFlow: pause/stop WHILE the frame is being captured -> no paid call, no frame kept', async () => {
  const d = deps();
  d.grab = async () => { d.stop(); return { jpegBase64: 'FRAME', title: 't' }; };
  const r = await lookFlow(req(), d);
  assert.equal(r.error, true);
  assert.equal(r.noWindow, true);
  assert.equal(d.calls.ai, 0, 'no Gemini call after the session ended');
  assert.equal(d.calls.setFrame.length, 0, 'the RAM frame must not be re-armed after stop');
});

test('lookFlow: stop while the document text is being read -> no paid call', async () => {
  const d = deps();
  d.getText = async () => { d.stop(); return { text: 'doc', source: 'file' }; };
  const r = await lookFlow(req(), d);
  assert.equal(r.noWindow, true);
  assert.equal(d.calls.ai, 0);
});

test('lookFlow: window gone and no held frame -> windowGone + onGone; a held frame stands in for reentry only', async () => {
  const gone = deps({ grab: async () => null });
  const r = await lookFlow(req(), gone);
  assert.equal(r.windowGone, true);
  assert.equal(gone.calls.gone, 1);
  const held = deps({ grab: async () => null, heldFrame: () => 'HELD' });
  assert.equal((await lookFlow(req({ purpose: 'stuck' }), held)).windowGone, true, 'a held frame is only for reentry');
  const re = await lookFlow(req({ purpose: 'reentry' }), held);
  assert.equal(re.onTask, true);
  assert.equal(held.calls.setFrame.length, 0);
});

test('lookFlow: the document text source is the PICKED window process, never the foreground one', async () => {
  const d = deps({ work: () => ({ id: 'w', hwnd: 1, title: 't', proc: 'chrome' }) });
  await lookFlow(req(), d);
  assert.equal(d.calls.text[0].focusProc, 'chrome');
});

test('lookFlow: done gets the full text, others a digest; title goes through redactTitle', async () => {
  let ctx;
  const d = deps({
    getText: async () => ({ text: 'word '.repeat(50), source: 'file' }),
    aiLook: async (a) => { ctx = a.ctx; return { onTask: true, confidence: 1, questDone: false, evidence: '', nextStep: '', sayLine: '' }; },
    redactTitle: (_p, t) => t.toUpperCase(),
  });
  await lookFlow(req({ purpose: 'done' }), d);
  assert.ok(ctx.text && !ctx.digest);
  assert.equal(ctx.windowTitle, 'ESSAY.DOCX - WORD');
  await lookFlow(req({ purpose: 'check' }), d);
  assert.ok(ctx.digest && !ctx.text);
});

// --- artifact.getText: Word is only probed when the picked window IS Word ---
test('artifact.getText: Word is probed only for a winword process — not for another app, not for an unknown one', async () => {
  probes.length = 0;
  assert.equal(await artifact.getText({ focusProc: 'chrome', linkedPath: null }), null);
  assert.equal(await artifact.getText({ focusProc: null, linkedPath: null }), null);
  assert.equal(await artifact.getText({ focusProc: undefined, linkedPath: null }), null);
  assert.equal(probes.length, 0, 'no PowerShell/Word probe for non-Word windows: ' + probes.join(' | ').slice(0, 80));
  await artifact.getText({ focusProc: 'WINWORD', linkedPath: null });
  assert.equal(probes.length, 1, 'one probe for the Word window');
});

test('artifact.getText: the Word probe gives up after 3 s (a cold start that misses just falls back to the linked file); .docx keeps 8 s', async () => {
  probeTimeouts.length = 0;
  await artifact.getText({ focusProc: 'winword', linkedPath: null });
  assert.deepEqual(probeTimeouts, [3000]);
  probeTimeouts.length = 0;
  await artifact.readFile('C:\nope\essay.docx');
  assert.deepEqual(probeTimeouts, [8000]);
});

test('artifact.getText: a linked file still works for any picked window', async () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const f = path.join(os.tmpdir(), 'ql-linked-test.txt');
  fs.writeFileSync(f, 'my linked essay text');
  const got = await artifact.getText({ focusProc: 'chrome', linkedPath: f });
  assert.equal(got.source, 'file');
  assert.match(got.text, /linked essay/);
});
