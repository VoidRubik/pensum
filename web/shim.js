// Web demo shim: defines the same window.questling surface as preload.js, with no device access at all.
// A fake 1280x800 desktop shows a staged sample; the scene bar scripts the signals the Electron main
// process would send. look/makeQuests go to the rate-limited /api/model; on any non-200 the recorded
// real answers (demo/recorded.json) are used and a tiny "(recorded)" tag is shown.
// When the Electron preload already defined window.questling, this file does nothing.
(() => {
  if (window.questling) return;

  const root = document.documentElement;
  root.classList.add('web');
  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'web/web.css';
  document.head.appendChild(css);

  const DESK_TITLE = 'Docs - Water Cycle essay';
  let sample = 'essay-midway';
  let alive = true;
  let visible = true;
  let onSignalFn = () => {};
  let recorded = null;

  const setSample = (name) => {
    sample = name;
    // custom properties resolve url() against the stylesheet, so hand CSS an absolute URL
    root.style.setProperty('--desk', `url(${new URL(`demo/samples/${name}.jpg`, location.href).href})`);
  };
  setSample(sample);

  const tag = document.createElement('div');
  tag.className = 'ql-demo-tag hidden';
  tag.textContent = '(recorded)';
  const hint = document.createElement('div');
  hint.className = 'ql-demo-hint';
  const setHint = (t) => { hint.textContent = t; };
  const markRecorded = (on) => tag.classList.toggle('hidden', !on);

  async function loadRecorded() {
    if (!recorded) recorded = await (await fetch('demo/recorded.json')).json();
    return recorded;
  }

  async function post(body) {
    const r = await fetch('/api/model', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw Object.assign(new Error(`http ${r.status}`), { status: r.status });
    return r.json();
  }

  const emit = (o = {}) => onSignalFn({
    ts: Date.now(), changed: false, fgHwnd: 111, fgProcess: 'winword', onWork: true, windowAlive: alive, windowVisible: visible,
    idleSec: 0, locked: false, ...o,
  });

  window.questling = {
    async makeQuests(req) {
      try {
        const q = await post({ kind: 'quests', task: String(req.text || '').slice(0, 300) });
        markRecorded(false);
        return q;
      } catch {
        markRecorded(true);
        return { ...(await loadRecorded()).quests };
      }
    },
    async look(req) {
      const stamp = { idx: req.idx, epoch: req.epoch, purpose: req.purpose };
      try {
        const v = await post({
          kind: 'look', purpose: req.purpose, sample,
          task: String(req.ctx?.task || '').slice(0, 300),
          quest: { title: String(req.quest?.title || '').slice(0, 300), finish: String(req.quest?.finish || '').slice(0, 300) },
        });
        markRecorded(false);
        return { ...v, ...stamp };
      } catch {
        markRecorded(true);
        return { ...(await loadRecorded()).looks[sample][req.purpose], ...stamp };
      }
    },
    async listWindows() {
      return [{ id: 'window:111:0', hwnd: 111, title: DESK_TITLE, thumb: `demo/samples/${sample}.jpg` }];
    },
    async pickWindow() {
      alive = true;
      visible = true;
      setTimeout(() => emit(), 50);
      return { ok: true, title: DESK_TITLE };
    },
    stopSession() {},
    onSignal(fn) { onSignalFn = fn; },
    async linkWork() { return null; },
    async usage() { return { calls: 0, checks: 0, tokens: 0, cap: 300 }; },
    async info() { return { mock: false, test: false, timeScale: 1, web: true }; },
    setSize() {},
    setClickThrough() {},
    onPaused() {},
  };

  // Drift needs 2 minutes off the work window. The scene sends two signals 121 s apart in signal time
  // (the engine only reads signal timestamps for this rule), so the demo does not wait. lastDriftTs keeps
  // repeated clicks ahead of the 10 min ask gap.
  let lastDriftTs = 0;
  function driftScene() {
    setSample('video-site');
    const t0 = Math.max(Date.now(), lastDriftTs + 11 * 60000);
    const off = { fgHwnd: 222, fgProcess: 'chrome', onWork: false };
    emit({ ...off, ts: t0 });
    emit({ ...off, ts: t0 + 121000 });
    lastDriftTs = t0 + 121000;
  }

  // --- scene bar: scripted signals instead of a real desktop ---
  const SCENES = [
    ['Writing', 'The doc has text. Press ✓ when you think the quest is done.', () => { setSample('essay-midway'); emit({ changed: true }); }],
    ['Blank page (stuck)', 'Empty section. Press the footsteps button for a tiny next step.', () => { setSample('essay-blank'); emit({ changed: true }); }],
    ['Drift', 'You wandered to a video site for 2 minutes. The pet asks, it never scolds: tap a chip.', driftScene],
    ['Outline done', 'The outline is finished. Press ✓ and the pet will ask you to confirm.', () => { setSample('outline-done'); emit({ changed: true }); }],
    ['Injection test', 'This doc tries to hijack the pet. Press ✓: it can only ask you, nothing completes by itself.', () => { setSample('injection'); emit({ changed: true }); }],
    ['Window closed', 'The window vanished. The pet falls asleep and offers "Pick window again".', () => { alive = false; visible = false; emit(); }],
  ];
  const bar = document.createElement('div');
  bar.className = 'ql-demo-scenes';
  SCENES.forEach(([label, text, run]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', () => { setHint(text); run(); });
    bar.appendChild(b);
  });
  setHint('Pick a scene, then use the pet at the bottom. Real Gemini answers (recorded ones if the demo is busy).');
  document.body.append(bar, hint, tag); // this script is loaded at the end of <body>
})();
