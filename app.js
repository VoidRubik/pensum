// Renderer: owns all decisions (quest state, epoch, when to look, which card to show). Main only
// owns devices and the key: it streams `signal`s and answers `look` / `makeQuests` (preload.js).
// Rules are pure functions in logic.js. The model proposes; quest state changes only in click handlers.
(() => {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector('main');
  const api = window.questling;
  const L = window.QuestlingLogic;
  const STORAGE_KEY = 'questling-state-v1';
  const BUBBLE_MS = 6000;
  const HELLO = "tell me what you're working on";
  const AWAY_SEC = 300; // idle this long or locked = away: no looks, pet sleeps
  const STUCK_QUIET_MS = 240000; // no visible change this long -> offer a tiny step (never calls the model by itself)
  const OFFER_GAP_MS = 900000; // at most one offer per 15 min
  const STEP_TIMER_MS = 120000;
  const STARTER_MS = 60000;
  const IDLE_OFFER_SEC = 75; // input idle this long (but not away) -> the same free tiny-step offer
  const CHIPS = ['research', 'lecture for this', 'taking a break'];

  // state = persisted, text only. Screen-derived text (evidence, titles, documents) never lands here.
  let state = L.migrate(load(STORAGE_KEY));
  let expanded = false;
  let sessionOn = false;
  let work = null; // { id, title } the chosen window; kept across pause so resume needs no new pick
  let windowLost = false;
  let away = false;
  let epoch = 0; // bumped on pause/start/new task/quest change/checkbox; stale looks are dropped
  let sup = { suppress: {} }; // "not yet" suppression per quest
  let notYetNote = null;
  let looking = false;
  let quietLook = false; // an unsolicited look must not flash the 'thinking' pose
  let card = null; // { kind, idx, onPrimary, onQuiet }
  let celebrating = false;
  let lastSig = 0;
  let lastChangeAt = 0;
  let lastOfferAt = 0;
  let lastLookAt = 0;
  let changedSinceLook = false;
  let drift = { since: null, lastAskAt: null };
  let driftPending = false; // a drift ask is open/answered and the user has not come back to the work window yet
  let speech = { lastSpokeAt: null, dismissed: 0 }; // unsolicited-speech budget (logic.allowSpeak)
  let breakMode = false;
  let lastFgProcess = null;
  let speechCapMs = 300000; // web demo shortens it (info().speechCapMs)
  let offSince = null; // first signal of the current stretch away from the work window
  let bubbleTimer = null;
  let stepTimer = null;

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
  }
  function save() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {} }

  const doneFlags = () => state.quests.map((q) => q.done);
  const curIdx = () => {
    const i = L.currentIdx({ current: state.current, done: doneFlags() });
    return i === -1 ? state.quests.length - 1 : i;
  };
  const allDone = () => !!state && state.quests.length > 0 && state.quests.every((q) => q.done);
  const nextTitle = () => state.quests[L.currentIdx({ current: null, done: doneFlags() })]?.title;
  const activeMs = (i) => (state.activeMs && state.activeMs[i]) || 0;

  // --- pet: one base state, transient overrides. The 8 names are the DESIGN_PROMPT contract. ---
  function applyPet() {
    main.dataset.petState = L.petStep({
      celebrating, looking, quietLook, cardKind: card ? card.kind : null,
      sessionOn, hasTask: !!state, breakMode, windowLost, away,
    });
  }

  // Idle never loops identically: a random variant every 7-16 s at a slightly different speed (only while idle).
  function scheduleIdle() {
    setTimeout(() => {
      if (main.dataset.petState === 'idle') {
        main.dataset.idle = L.pickIdle(main.dataset.idle, Math.random());
        main.style.setProperty('--speed', L.idleSpeed(Math.random()).toFixed(2));
      }
      scheduleIdle();
    }, L.idleDelay(Math.random()));
  }

  function say(line) {
    $('bubble-text').textContent = line;
    $('bubble').classList.remove('hidden');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => $('bubble').classList.add('hidden'), BUBBLE_MS);
  }
  $('bubble-x').addEventListener('click', () => { clearTimeout(bubbleTimer); $('bubble').classList.add('hidden'); });

  // --- action card: one at a time, above the bar ---
  function showCard(spec) {
    clearInterval(stepTimer);
    card = spec;
    $('card').className = `ql-card ql-card--${spec.kind} solid`;
    $('card-title').textContent = spec.title;
    $('card-body').textContent = spec.body || '';
    $('card-evidence').textContent = spec.evidence || '';
    $('card-evidence').classList.toggle('hidden', !spec.evidence);
    $('card-count').classList.add('hidden');
    const chips = $('card-chips');
    chips.innerHTML = '';
    (spec.chips || []).forEach((label) => {
      const b = document.createElement('button');
      b.className = 'ql-chip';
      b.textContent = label;
      b.addEventListener('click', () => spec.onChip(label));
      chips.appendChild(b);
    });
    chips.classList.toggle('hidden', !spec.chips);
    $('card-input').value = '';
    $('card-input').classList.toggle('hidden', !spec.chips);
    if (spec.unsolicited) speech.lastSpokeAt = Date.now();
    $('card-primary').textContent = spec.primary;
    $('card-quiet').textContent = spec.quiet;
    $('card-primary').classList.remove('hidden');
    applyPet();
  }
  function hideCard() {
    clearInterval(stepTimer);
    card = null;
    $('card').classList.add('hidden');
    applyPet();
  }
  $('card-x').addEventListener('click', () => { if (card?.unsolicited) speech.dismissed++; hideCard(); });
  $('card-input').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.value.trim()) card?.onChip(e.target.value.trim()); });
  $('card-primary').addEventListener('click', () => card?.onPrimary());
  $('card-quiet').addEventListener('click', () => card?.onQuiet());

  // --- bar ---
  function updateBar() {
    $('quest-line').textContent = !state ? HELLO : allDone() ? 'all quests done!' : state.quests[curIdx()].title;
    $('done-btn').classList.toggle('hidden', !state || allDone());
    $('start-btn').classList.toggle('hidden', sessionOn);
    $('end-btn').classList.toggle('hidden', !sessionOn);
    $('stuck-btn').classList.toggle('hidden', !sessionOn || windowLost || allDone());
    $('pause-btn').classList.toggle('hidden', !state || allDone());
    $('pause-btn').textContent = sessionOn ? '❚❚' : '▶';
    $('pause-btn').title = sessionOn ? 'pause' : 'resume';
    $('company').classList.toggle('hidden', !sessionOn || windowLost);
    $('repick').classList.toggle('hidden', !(sessionOn && windowLost));
    renderDisc();
    applyPet();
  }

  // Time disc: shrinks as active time on this quest runs toward its timebox; dims while paused / away / lost.
  function renderDisc() {
    const d = $('disc');
    const q = state && !allDone() ? state.quests[curIdx()] : null;
    d.style.setProperty('--left', String(q ? L.discLeft({ activeMs: activeMs(curIdx()), minutes: q.minutes }) : 0));
    d.classList.toggle('is-paused', !sessionOn || away || windowLost || breakMode);
  }

  function renderProgress() {
    const bar = $('progress');
    bar.innerHTML = '';
    if (!state) return;
    const plan = document.createElement('span');
    plan.className = 'ql-seg is-plan';
    bar.appendChild(plan);
    const cur = allDone() ? -1 : curIdx();
    state.quests.forEach((q, i) => {
      const seg = document.createElement('span');
      seg.className = 'ql-seg' + (q.done ? ' is-done' : i === cur ? ' is-current' : '');
      if (i === cur) seg.style.setProperty('--fill', String(Math.min(1, activeMs(i) / (q.minutes * 60000))));
      bar.appendChild(seg);
    });
    const c = Math.max(0, cur);
    renderDisc();
    state.progress = L.computeProgress({
      done: state.quests.filter((q) => q.done).length,
      total: state.quests.length,
      activeMs: cur === -1 ? 0 : activeMs(c),
      minutes: state.quests[c].minutes,
      previous: state.progress || 0,
    });
  }

  // --- window size follows content; click-through everywhere except solid elements ---
  const solids = () => [...main.children].filter((el) => !el.classList.contains('hidden'));
  function fit() {
    const els = solids();
    const h = els.reduce((sum, el) => sum + el.offsetHeight, 0) + Math.max(0, els.length - 1) * 8 + 12;
    api.setSize(h);
  }
  const ro = new ResizeObserver(() => requestAnimationFrame(fit));
  ['panel', 'card', 'bubble', 'bar'].forEach((id) => ro.observe($(id)));

  let through = true;
  document.addEventListener('mousemove', (e) => {
    const solid = !!e.target.closest('.solid');
    if (solid === through) { through = !solid; api.setClickThrough(through); }
  });

  function setExpanded(on) {
    expanded = on;
    $('panel').classList.toggle('hidden', !on);
    $('toggle').textContent = on ? '▾' : '▴';
    if (on && !state) setTimeout(() => $('task-text').focus(), 50);
    if (on) refreshUsage();
  }
  $('toggle').addEventListener('click', () => setExpanded(!expanded));

  async function refreshUsage() {
    const u = await api.usage();
    $('usage-line').textContent = `today: ${u.calls} calls · ${(u.tokens / 1000).toFixed(1)}k tokens · cap ${u.cap}`;
  }

  // --- panel: onboarding, quests, window picker ---
  function showPanelPart(name) {
    $('task-card').classList.toggle('hidden', name !== 'task');
    $('quest-card').classList.toggle('hidden', name !== 'quests');
    $('windows').classList.toggle('hidden', name !== 'windows');
    $('recap').classList.toggle('hidden', name !== 'recap');
  }

  function renderQuests() {
    const list = $('quest-list');
    list.innerHTML = '';
    const cur = allDone() ? -1 : curIdx();
    state.quests.forEach((q, i) => {
      const li = document.createElement('li');
      li.className = 'ql-quest' + (q.done ? ' is-done' : '') + (i === cur ? ' is-current' : '');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!q.done;
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('change', () => toggleQuest(i, box.checked));
      const wrap = document.createElement('div');
      wrap.className = 'ql-quest__text';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ql-quest__title';
      input.value = q.title;
      input.addEventListener('change', () => { state.quests[i].title = input.value; save(); updateBar(); });
      const finish = document.createElement('small');
      finish.className = 'ql-quest__finish';
      finish.textContent = q.finish;
      wrap.append(input, finish);
      const pill = document.createElement('span');
      pill.className = 'ql-pill';
      pill.textContent = `${q.minutes} min`;
      li.append(box, wrap, pill);
      li.addEventListener('click', () => setCurrent(i));
      list.appendChild(li);
    });
    renderProgress();
    updateBar();
  }

  function setCurrent(i) {
    if (!state || state.quests[i].done || (!allDone() && curIdx() === i)) return;
    state.current = i;
    epoch++;
    save();
    renderQuests();
  }

  function toggleQuest(i, checked) {
    state.quests[i].done = checked;
    epoch++;
    sup.suppress[i] = 0;
    if (!checked) state.progress = 0; // the high-water mark would keep the bar up
    if (card && card.idx === i) hideCard();
    renderQuests();
    save();
    if (!finishIfAllDone() && checked) say(`Quest done! Next: ${nextTitle()}`);
  }

  function openQuests() {
    const d = new Date(state.deadline_iso);
    // datetime-local wants local time without zone.
    $('deadline').value = isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('link-name').textContent = state.linked ? state.linked.name : '';
    renderQuests();
    showPanelPart('quests');
  }

  function resetRules() {
    sup = { suppress: {} };
    notYetNote = null;
  }

  $('make-quests').addEventListener('click', async () => {
    const text = $('task-text').value.trim();
    if (!text) return;
    $('make-quests').disabled = true;
    say('thinking up quests...');
    try {
      const data = await api.makeQuests({ text, now: new Date().toISOString(), tzOffset: new Date().getTimezoneOffset() });
      if (!data.quests) { say(data.pet_line || "couldn't make quests, try again"); return; }
      state = L.migrate({ text, quests: data.quests.map((q) => ({ ...q, done: false })), current: null, deadline_iso: data.deadline_iso, starter: data.starter, progress: 0, activeMs: {}, startedAt: null, fired: [], linked: null });
      resetRules();
      hideCard();
      save();
      openQuests();
      say(data.fallback ? "couldn't reach my brain, here are starter quests" : `${state.quests.length} quests ready — tweak them, then start.`);
      refreshUsage();
    } catch {
      say("couldn't make quests, try again");
    } finally {
      $('make-quests').disabled = false;
    }
  });

  $('new-task').addEventListener('click', () => {
    stopSession();
    queuedLook = null;
    resetRules();
    hideCard();
    state = null;
    work = null;
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    $('task-text').value = '';
    renderProgress();
    showPanelPart('task');
    updateBar();
    say("hi! tell me what you're working on");
  });

  // --- window picker: frames only ever come from the window picked here ---
  async function openPicker() {
    setExpanded(true);
    showPanelPart('windows');
    const grid = $('window-grid');
    grid.textContent = 'looking for windows...';
    let wins = [];
    try { wins = await api.listWindows(); } catch {}
    grid.innerHTML = '';
    if (!wins.length) grid.textContent = 'No windows found. Open the document you want to work in, then go back and try again.';
    wins.forEach((w) => {
      const b = document.createElement('button');
      b.className = 'ql-window';
      const img = document.createElement('img');
      img.alt = '';
      img.src = w.thumb;
      const t = document.createElement('span');
      t.textContent = w.title;
      b.append(img, t);
      b.addEventListener('click', () => startWith(w));
      grid.appendChild(b);
    });
  }
  $('windows-cancel').addEventListener('click', () => (state ? openQuests() : showPanelPart('task')));
  $('repick').addEventListener('click', openPicker);

  $('start-btn').addEventListener('click', () => {
    const d = new Date($('deadline').value);
    if (!isNaN(d)) state.deadline_iso = d.toISOString();
    const dl = Date.parse(state.deadline_iso);
    // New window when the deadline moved (or is unusable): nudges restart against the new deadline.
    if (!state.startedAt || dl !== state.lastDeadline || !(dl > state.startedAt)) { state.startedAt = Date.now(); state.fired = []; }
    state.lastDeadline = dl;
    save();
    openPicker();
  });

  async function startWith(w) {
    const r = await api.pickWindow(w.id);
    if (!r.ok) { say("that window is gone — pick another"); openPicker(); return; }
    work = { id: w.id, title: r.title || w.title };
    const repick = sessionOn; // picking again after the window was lost is not a new session
    sessionOn = true;
    windowLost = false;
    away = false;
    epoch++;
    resetRules();
    lastSig = 0;
    lastChangeAt = Date.now();
    lastOfferAt = Date.now();
    lastLookAt = Date.now();
    changedSinceLook = false;
    drift = { since: null, lastAskAt: null };
    speech = { lastSpokeAt: null, dismissed: 0 };
    if (!repick) { state.session = { ...state.session, driftsAsked: 0, backOnTrack: 0, stuckUsed: 0 }; save(); }
    showPanelPart('quests');
    setExpanded(false);
    updateBar();
    say(`Okay, I'll sit with you in ${work.title.slice(0, 40)}.`);
    if (!repick && activeMs(curIdx()) === 0) showStarter();
  }

  function stopSession() {
    queuedLook = null;
    sessionOn = false;
    breakMode = false;
    drift = { since: null, lastAskAt: null };
    driftPending = false;
    speech = { lastSpokeAt: null, dismissed: 0 };
    windowLost = false;
    away = false;
    epoch++;
    api.stopSession();
    updateBar();
  }

  async function pause(line) {
    stopSession();
    hideCard();
    say(line || 'Paused. Tap play when you want me back.');
  }
  async function resume() {
    if (!state) return;
    if (!work) { openPicker(); return; }
    const r = await api.pickWindow(work.id);
    if (!r.ok) { openPicker(); return; }
    sessionOn = true;
    epoch++;
    lastSig = 0;
    lastChangeAt = Date.now();
    updateBar();
    runLook('reentry'); // the user pressed play: a reply to a click, so it is exempt from the speech cap
  }
  $('pause-btn').addEventListener('click', () => (sessionOn ? pause() : resume()));
  api.onPaused(() => pause());

  // --- linked work ---
  $('link-btn').addEventListener('click', async () => {
    const r = await api.linkWork();
    if (!r || !state) return;
    state.linked = { path: r.path, name: r.name };
    save();
    $('link-name').textContent = r.readable ? `${r.name} (${r.words} words) — save to update` : `${r.name} — couldn't read it`;
  });

  // --- the signal stream: raw facts from main; every decision is made here ---
  function onSignal(s) {
    if (!sessionOn || !state) return;
    const dt = lastSig ? Math.min(Math.max(0, s.ts - lastSig), 20000) : 0;
    lastSig = s.ts;
    const wasLost = windowLost;
    const wasAway = away;
    windowLost = !s.windowAlive || !s.windowVisible;
    away = !!s.locked || s.idleSec >= AWAY_SEC;
    if (s.changed) { lastChangeAt = s.ts; changedSinceLook = true; }
    if (!windowLost && !away && (s.onWork || L.allowMatches(state.session.allow, s.fgProcess)) && !allDone()) {
      const i = curIdx();
      state.activeMs = state.activeMs || {};
      state.activeMs[i] = activeMs(i) + dt;
      renderProgress();
      save();
    }
    if (wasAway && !away) { lastChangeAt = s.ts; lastOfferAt = s.ts; }
    if (windowLost !== wasLost || away !== wasAway) {
      if (windowLost && !wasLost) { hideCard(); say("I lost the window. Pick it again when you're ready."); }
      updateBar();
    }
    if (s.fgProcess) lastFgProcess = s.fgProcess;
    if (driftPending && s.onWork) { driftPending = false; state.session.backOnTrack++; save(); }
    if (breakMode && s.onWork && s.idleSec < 10 && !away && !windowLost) endBreak();

    if (!s.onWork) offSince = offSince ?? s.ts;
    const offFor = offSince ? s.ts - offSince : 0;
    if (s.onWork) offSince = null;
    const returning = L.reentryTrigger({ wasAway, away, onWork: s.onWork, offForMs: offFor });

    // One unsolicited prompt at a time, highest priority first (logic.breakpoint). Everything below is local and free.
    const d = L.driftStep(drift, s, { allow: state.session.allow, now: s.ts });
    const free = !windowLost && !away && !breakMode && !looking && !card && L.allowSpeak(speech, Date.now(), speechCapMs);
    const quiet = s.ts - lastOfferAt >= L.dur(OFFER_GAP_MS);
    const cur = curIdx();
    const bp = free ? L.breakpoint({
      timebox: !allDone() && L.timeboxDue({ activeMs: activeMs(cur), minutes: state.quests[cur].minutes, firedAt: state.timeboxFired[cur] }),
      drift: d.ask,
      stuck: quiet && s.ts - lastChangeAt >= L.dur(STUCK_QUIET_MS),
      idle: quiet && s.idleSec >= IDLE_OFFER_SEC,
    }) : null;
    drift = d.ask && bp !== 'drift' ? { ...drift, since: drift.since ?? s.ts } : d.state;
    if (bp === 'timebox') showTimebox();
    else if (bp === 'drift') askDrift(`Still on "${state.quests[curIdx()].title}"?`);
    else if (bp === 'stuck' || bp === 'idle') { lastOfferAt = s.ts; offerStep(); }
    if (returning && !card && !looking && !windowLost && !away && !breakMode && mayAuto()) runLook('reentry', {}, true);
    // Heartbeat: a change worth a look, or every 6 min. The renderer decides; main never calls the model alone.
    if (!windowLost && !away && !breakMode && !looking && !card && !allDone() && mayAuto() && L.lookDue({ now: s.ts, lastLookAt, changed: changedSinceLook })) runLook('check', {}, true);
  }

  api.onSignal(onSignal);

  function offerStep() {
    const i = curIdx();
    showCard({
      kind: 'ask', idx: i, title: 'Want a tiny next step?', body: `"${state.quests[i].title}" has been quiet for a few minutes.`,
      primary: 'Tiny step', quiet: 'Not now', unsolicited: true,
      onPrimary: () => { hideCard(); runLook('stuck'); },
      onQuiet: hideCard,
    });
  }

  // The minutes planned for this quest are used up: keep going (+10) or move on. Shown once per timebox length.
  function showTimebox() {
    const i = curIdx();
    const q = state.quests[i];
    state.timeboxFired[i] = q.minutes;
    save();
    showCard({
      kind: 'timebox', idx: i, title: `Quest ${i + 1} had its ${q.minutes} minutes.`, body: 'Keep going or move on?', unsolicited: true,
      primary: '+10 min', quiet: 'Next quest',
      onPrimary: () => { q.minutes += 10; save(); hideCard(); renderQuests(); },
      onQuiet: () => { hideCard(); const n = L.nextQuestIdx(doneFlags(), i); if (n >= 0) setCurrent(n); },
    });
  }

  // Soft drift ask. Local text only; the user answers with a chip, free text, or goes back to work.
  function askDrift(title) {
    const i = curIdx();
    state.session.driftsAsked++;
    driftPending = true;
    save();
    showCard({
      kind: 'ask', idx: i, title, body: '', unsolicited: true, chips: CHIPS,
      primary: "I'm on task", quiet: 'Back to it',
      onChip: (label) => onTaskNote(label),
      onPrimary: () => onTaskNote('on task'),
      onQuiet: () => { hideCard(); },
    });
  }
  function onTaskNote(note) {
    hideCard();
    if (note === 'taking a break') { startBreak(); return; }
    if (lastFgProcess) {
      state.session.allow = L.addAllow(state.session.allow, { process: lastFgProcess, note });
      save();
      say(`Okay, I'll treat ${lastFgProcess} as part of the task.`);
    }
    driftPending = false;
  }
  function startBreak() {
    breakMode = true;
    driftPending = false;
    applyPet();
    say("Enjoy your break. I'll be here.");
  }
  function endBreak() {
    breakMode = false;
    lastChangeAt = Date.now();
    lastOfferAt = Date.now();
    applyPet();
    if (mayAuto()) runLook('reentry', {}, true);
  }

  // --- looks: user clicks only in this step; the model proposes, the user confirms ---
  const ctxFor = (extra = {}) => ({
    task: state.text,
    quests: state.quests.map((q) => ({ title: q.title, done: q.done })),
    notYet: notYetNote && notYetNote.idx === curIdx() ? `"${notYetNote.title}" at ${notYetNote.at}` : null,
    ...extra,
  });

  // auto = unsolicited heartbeat: silent on every failure, never shows 'thinking', only ever proposes a confirm card.
  // A click made while a background look is in flight is queued (latest wins), never swallowed.
  let queuedLook = null;
  // Paid background calls only when their result could be shown: the speech cap / quiet mode gate the call, not just the card.
  const mayAuto = () => L.allowSpeak(speech, Date.now(), speechCapMs);
  async function runLook(purpose, extra = {}, auto = false) {
    if (looking) {
      if (!auto && state && !allDone()) { queuedLook = { purpose, extra }; say('One moment...'); }
      return;
    }
    await doLook(purpose, extra, auto);
    if (queuedLook && !looking) {
      const q = queuedLook;
      queuedLook = null;
      await doLook(q.purpose, q.extra, false);
    }
  }

  async function doLook(purpose, extra, auto) {
    if (!state || allDone() || looking) return;
    const i = curIdx();
    const myEpoch = epoch;
    let v = null;
    if (sessionOn && !windowLost) {
      looking = true;
      lastLookAt = Date.now();
      changedSinceLook = false;
      quietLook = auto;
      if (!auto) { $('stuck-btn').disabled = true; $('done-btn').disabled = true; }
      applyPet();
      try {
        const r = await api.look({ purpose, quest: state.quests[i], idx: i, epoch, ctx: ctxFor(extra), allow: state.session.allow, linkedPath: state.linked?.path || null });
        if (r.capped) { if (!auto) say(r.pet_line); }
        else if (!r.error) v = r;
      } catch {}
      looking = false;
      quietLook = false;
      $('stuck-btn').disabled = false;
      $('done-btn').disabled = false;
      refreshUsage();
      if (auto && !v && purpose !== 'reentry') { applyPet(); return; } // re-entry always falls back to its local template
      // Drop it only if the quest changed under us (new task, quest done/unticked, another picked, paused).
      if (epoch !== myEpoch || !state || !state.quests[i] || state.quests[i].done) { applyPet(); return; }
    }
    const r = L.applyLook({ quests: state.quests, idx: i, purpose, auto, sup, starter: state.starter, activeMs: activeMs(i) }, v);
    sup = r.sup;
    if (r.card && r.card.kind === 'step') { state.session.stuckUsed++; save(); }
    if (r.card && auto && !L.allowSpeak(speech, Date.now(), speechCapMs)) applyPet();
    else if (r.card) showStepOrConfirm(r.card, auto);
    else applyPet();
  }

  function showStepOrConfirm(c, auto = false) {
    if (c.kind === 'confirm') {
      showCard({
        ...c, unsolicited: auto, primary: 'Yes, done', quiet: 'Not yet',
        onPrimary: () => { hideCard(); if (state.quests[c.idx] && !state.quests[c.idx].done) completeQuest(c.idx); },
        onQuiet: () => {
          hideCard();
          sup = L.notYet(sup, c.idx);
          const t = new Date();
          notYetNote = { idx: c.idx, title: state.quests[c.idx].title, at: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` };
          say("Okay, I'll keep you company.");
        },
      });
    } else if (c.kind === 'reentry') {
      const fresh = activeMs(c.idx) === 0;
      showCard({ ...c, unsolicited: auto, primary: "Let's go", quiet: 'Later', onPrimary: fresh ? () => beginStarter(c.idx) : hideCard, onQuiet: hideCard });
    } else if (c.kind === 'ask') {
      if (L.allowSpeak(speech, Date.now(), speechCapMs)) askDrift(c.title);
    } else if (c.kind === 'step') {
      showCard({
        ...c, primary: 'Start 2 min', quiet: 'Another idea',
        onPrimary: () => startStepTimer(),
        onQuiet: () => { hideCard(); runLook('stuck', { avoid: c.body }); },
      });
    }
  }

  // A local countdown on the card, no model call. --left (1 -> 0) drives the ring, mmss the label.
  function runCountdown(totalMs, onDone) {
    clearInterval(stepTimer);
    const total = L.dur(totalMs);
    const end = Date.now() + total;
    $('card-count').classList.remove('hidden');
    $('card-primary').classList.add('hidden');
    const tickCount = () => {
      const left = Math.max(0, end - Date.now());
      $('card-count-text').textContent = L.mmss(left);
      $('card-count').style.setProperty('--left', String(left / total));
      if (left <= 0) { clearInterval(stepTimer); onDone(); }
    };
    tickCount();
    stepTimer = setInterval(tickCount, 250);
  }

  function startStepTimer() {
    runCountdown(STEP_TIMER_MS, () => { hideCard(); say('Time. Want another tiny step? Tap the footsteps.'); });
  }

  // First sloppy step: a 60 s countdown at session start (and from the re-entry card of an untouched quest). No model call.
  function showStarter() {
    if (!state || allDone()) return;
    const idx = curIdx();
    showCard({
      kind: 'starter', idx, title: 'Tiny start', body: state.starter, primary: 'Go', quiet: 'Not now',
      onPrimary: () => beginStarter(idx),
      onQuiet: hideCard,
    });
  }
  function beginStarter(idx) {
    $('card-title').textContent = 'Tiny start';
    $('card-quiet').textContent = 'Skip';
    runCountdown(STARTER_MS, () => askStarted(idx));
  }
  function askStarted(idx) {
    showCard({
      kind: 'starter', idx, title: 'Did it start?', body: '', primary: 'Yes', quiet: '60 more',
      onPrimary: () => { hideCard(); say('Nice. Keep going.'); },
      onQuiet: () => { showStarter(); beginStarter(idx); },
    });
  }

  $('stuck-btn').addEventListener('click', () => { hideCard(); runLook('stuck'); });
  $('done-btn').addEventListener('click', () => { hideCard(); runLook('done'); });

  function completeQuest(i) {
    state.quests[i].done = true;
    if (state.current === i) state.current = null;
    if (notYetNote?.idx === i) notYetNote = null;
    epoch++;
    renderQuests();
    save();
    if (!finishIfAllDone()) {
      celebrating = true;
      applyPet();
      setTimeout(() => { celebrating = false; applyPet(); }, L.dur(2400));
      say(`Quest done! Next: ${nextTitle()}`);
    }
  }

  // End-of-session summary in the panel (planned vs done, minutes on quest, drifts caught, back on track, stuck steps) + one praise line.
  function showRecap() {
    const r = L.recap({ quests: state.quests, activeMs: state.activeMs, session: state.session });
    $('recap-praise').textContent = r.praise;
    $('recap-list').innerHTML = '';
    r.doneTitles.forEach((t) => { const li = document.createElement('li'); li.textContent = t; $('recap-list').appendChild(li); });
    $('rs-done').textContent = `${r.done} of ${r.planned}`;
    $('rs-min').textContent = `${r.minutes} min`;
    $('rs-drifts').textContent = String(r.drifts);
    $('rs-back').textContent = String(r.backOnTrack);
    $('rs-stuck').textContent = String(r.stuck);
    showPanelPart('recap');
    setExpanded(true);
    say(r.praise);
  }
  $('end-btn').addEventListener('click', () => { hideCard(); stopSession(); showRecap(); });
  $('recap-close').addEventListener('click', () => { if (state) openQuests(); else showPanelPart('task'); });
  $('recap-new').addEventListener('click', () => $('new-task').click());

  function finishIfAllDone() {
    if (!allDone()) return false;
    hideCard();
    if (sessionOn) stopSession();
    celebrating = true;
    applyPet();
    setTimeout(() => { celebrating = false; applyPet(); }, L.dur(2400));
    showRecap();
    return true;
  }

  // --- deadline nudges: local math, $0 ---
  const NUDGE_LINES = {
    50: 'Halfway through the time. How are we doing?',
    25: 'A quarter of the time left.',
    10: 'Nearly out of time.',
    left10: '10 minutes left. You can do this.',
  };
  function tick() {
    if (!sessionOn || !state?.startedAt) return;
    const r = L.nudgeDue({ startedAt: state.startedAt, deadline: Date.parse(state.deadline_iso), now: Date.now(), progress: state.progress || 0, fired: state.fired || [] });
    if (r.fired !== state.fired) { state.fired = r.fired; save(); }
    if (r.speak) say(NUDGE_LINES[r.speak]);
  }

  api.info().then(({ mock, timeScale, speechCapMs: cap }) => {
    L.setTimeScale(timeScale);
    if (cap) speechCapMs = cap;
    $('mock-note').classList.toggle('hidden', !mock);
    setInterval(tick, L.dur(30000));
    scheduleIdle();
  });
  refreshUsage();
  updateBar();

  if (state) {
    openQuests();
    say('Welcome back. Open me and press Start to continue.');
  }
  requestAnimationFrame(fit);
})();
