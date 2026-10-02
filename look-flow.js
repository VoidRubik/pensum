// The main-process look pipeline, with its dependencies injected so session races are testable:
// capture the CHOSEN window -> read document text -> one model call. Every await re-checks the session,
// so a pause / End session mid-look sends nothing further and re-arms no frame.
const L = require('./logic.js');

const MAX_SIDE = { done: 2048, other: 1600 };

async function lookFlow(req, d) {
  const stamp = { idx: req.idx, epoch: req.epoch, purpose: req.purpose };
  const gen = d.gen();
  const w = d.work();
  if (!w) return { error: true, noWindow: true, ...stamp };
  const ended = () => d.gen() !== gen;

  const done = req.purpose === 'done';
  const frame = await d.grab(w.id, done ? MAX_SIDE.done : MAX_SIDE.other, done ? 85 : 70).catch(() => null);
  if (ended()) return { error: true, noWindow: true, ...stamp };
  if (frame) d.setFrame(frame);
  // Coming back after the window was minimized or closed: the held frame still shows where the user left off.
  const held = !frame && req.purpose === 'reentry' ? d.heldFrame() : null;
  if (!frame && !held) {
    d.onGone();
    return { error: true, windowGone: true, ...stamp };
  }

  // Document text comes from the PICKED window's process only (Word live text) or a file the user linked.
  const got = await d.getText({ focusProc: w.proc, linkedPath: req.linkedPath });
  if (ended()) return { error: true, noWindow: true, ...stamp };

  const ctx = {
    ...req.ctx,
    allow: req.allow,
    windowTitle: frame ? d.redactTitle(null, frame.title) : null, // the chosen window's title only
    source: got?.source || null,
    digest: got && !done ? L.artifactDigest(got.text) : null,
    text: got && done ? L.capMiddle(got.text, 40000) : null,
  };
  const v = await d.aiLook({ purpose: req.purpose, jpegBase64: frame ? frame.jpegBase64 : held, quest: req.quest, ctx });
  return { ...v, ...stamp };
}

module.exports = { lookFlow };
