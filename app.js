// Renderer: bar + expandable panel. All AI calls, screen capture and the auto-check timer live in
// main.js behind window.questling (preload.js). Rules (epoch, off-task, done, nudges) are pure
// functions in logic.js.
(() => {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector('main');
  const api = window.questling;
  const L = window.QuestlingLogic;
  const STORAGE_KEY = 'questling-state-v1';
  const UNDO_MS = 30000;

  // state = persisted, text only. Screen-derived text (verdict reasons) never lands here.
  let state = load();
  let expanded = false;
  let watching = false;
  let epoch = 0; // bumped on pause/start/new task/quest change/undo/override; stale verdicts dropped
  let off = { off: 0, suppress: false };
  let done = { idx: null, n: 0 };
  let locked = new Set(); // quest indexes the user undid: no auto-complete until "that's done"
  let errStreak = 0;
  let checking = false;
  let undoTimer = null;
  let undoIdx = null;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  function say(petState, line) {
    main.dataset.petState = petState;
    if (line) $('pet-line').textContent = line;
  }
  const petState = () => main.dataset.petState;

  const curIdx = () => {
    const i = state.quests.findIndex((q) => !q.done);
    return i === -1 ? state.quests.length - 1 : i;
  };

  function setExpanded(on) {
    expanded = on;
    // Grow the window first so the panel never renders squashed into the bar size.
    api.setExpanded(on);
    $('panel').classList.toggle('hidden', !on);
    $('toggle').textContent = on ? '▾' : '▴';
    if (on && !state) setTimeout(() => $('task-text').focus(), 50);
    if (on) refreshUsage();
  }

  function setWatching(on) {
    watching = on;
    epoch++;
    api.setWatching(on);
    $('watching-indicator').classList.toggle('hidden', !on);
    $('check-now').classList.toggle('hidden', !on);
    $('pause-btn').classList.toggle('hidden', !on);
    $('overrides').classList.toggle('hidden', !on);
    if (!on) $('thumb').classList.add('hidden');
  }

  async function refreshUsage() {
    const u = await api.usage();
    $('usage-line').textContent = `today: ${u.checks} looks · ${(u.tokens / 1000).toFixed(1)}k tokens · cap ${u.cap}`;
  }

  function renderQuests() {
    const list = $('quest-list');
    list.innerHTML = '';
    state.quests.forEach((q, i) => {
      const li = document.createElement('li');
      li.className = 'quest-item' + (q.done ? ' done' : '');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = q.title;
      input.addEventListener('change', () => { state.quests[i].title = input.value; save(); });
      const finish = document.createElement('small');
      finish.textContent = q.finish;
      li.append(input, finish);
      list.appendChild(li);
    });
  }

  function renderProgress() {
    const p = L.computeProgress({
      questsDone: state.quests.filter((q) => q.done).length,
      total: state.quests.length,
      currentEstimate: state.currentEstimate || 0,
      previous: state.progress || 0,
    });
    state.progress = p;
    $('progress-fill').style.transform = `scaleX(${p})`;
    save();
  }

  function showCard(name) {
    $('task-card').classList.toggle('hidden', name !== 'task');
    $('quest-card').classList.toggle('hidden', name !== 'quests');
  }

  $('toggle').addEventListener('click', () => setExpanded(!expanded));

  $('make-quests').addEventListener('click', async () => {
    const text = $('task-text').value.trim();
    if (!text) return;
    $('make-quests').disabled = true;
    say('idle', 'thinking up quests...');
    try {
      const data = await api.makeQuests({ text, now: new Date().toISOString(), tzOffset: new Date().getTimezoneOffset() });
      state = { text, quests: data.quests.map((q) => ({ ...q, done: false })), deadline_iso: data.deadline_iso, progress: 0, currentEstimate: 0, startedAt: null, fired: [] };
      save();
      openQuests();
      say('happy', data.fallback ? "couldn't reach my brain, here are starter quests" : `${state.quests.length} quests ready — edit, then Start`);
      refreshUsage();
    } finally {
      $('make-quests').disabled = false;
    }
  });

  function openQuests() {
    const d = new Date(state.deadline_iso);
    // datetime-local wants local time without zone.
    $('deadline').value = isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    renderQuests();
    renderProgress();
    showCard('quests');
  }

  function resetRules() {
    off = { off: 0, suppress: false };
    done = { idx: null, n: 0 };
    errStreak = 0;
    hideUndo();
  }

  $('new-task').addEventListener('click', () => {
    setWatching(false);
    resetRules();
    locked = new Set();
    state = null;
    localStorage.removeItem(STORAGE_KEY);
    $('task-text').value = '';
    $('progress-fill').style.transform = 'scaleX(0)';
    showCard('task');
    say('idle', "hi! tell me what you're working on");
  });

  $('start-btn').addEventListener('click', () => {
    const d = new Date($('deadline').value);
    if (!isNaN(d)) state.deadline_iso = d.toISOString();
    const dl = Date.parse(state.deadline_iso);
    // New window when the deadline moved (or is unusable): nudges restart against the new deadline.
    if (!state.startedAt || dl !== state.lastDeadline || !(dl > state.startedAt)) { state.startedAt = Date.now(); state.fired = []; }
    state.lastDeadline = dl;
    save();
    resetRules();
    setWatching(true);
    setExpanded(false);
    say('watching', "watching — I'll peek every few minutes");
  });

  function pause(line) {
    setWatching(false);
    resetRules();
    say('sleepy', line || 'paused — open me and hit Start to resume');
  }
  $('pause-btn').addEventListener('click', () => pause());
  api.onPaused(() => pause());

  // --- verdicts ---
  function completeQuest(i, { withUndo }) {
    state.quests[i].done = true;
    state.currentEstimate = 0;
    done = { idx: null, n: 0 };
    epoch++;
    renderQuests();
    if (withUndo) showUndo(i);
  }

  function showUndo(i) {
    undoIdx = i;
    $('undo-chip').classList.remove('hidden');
    clearTimeout(undoTimer);
    undoTimer = setTimeout(hideUndo, UNDO_MS);
  }
  function hideUndo() {
    clearTimeout(undoTimer);
    undoIdx = null;
    $('undo-chip').classList.add('hidden');
  }
  $('undo-chip').addEventListener('click', () => {
    const i = undoIdx;
    hideUndo();
    if (i === null || !state) return;
    state.quests[i].done = false;
    locked.add(i);
    epoch++;
    state.progress = 0; // high-water mark would otherwise keep the bar at the undone value
    renderQuests();
    renderProgress();
    if (!watching) { setWatching(true); resetRules(); }
    say('watching', 'ok, undone — still on this one');
  });

  function finishIfAllDone() {
    if (!state.quests.every((q) => q.done)) return false;
    setWatching(false); // stops main's timer; no more calls
    say('party', 'all quests done! nice work');
    return true;
  }

  function applyVerdict(v, auto) {
    if (!watching || !state || v.paused) return;
    if (L.isStale(v, { idx: curIdx(), epoch })) return;
    if (v.capped) { say('sleepy', v.pet_line); refreshUsage(); return; }
    if (v.error) {
      errStreak++;
      say(errStreak >= 3 ? 'sleepy' : petState(), v.pet_line);
      refreshUsage();
      return;
    }
    errStreak = 0;
    if (v.thumb) { $('thumb').src = v.thumb; $('thumb').classList.remove('hidden'); }
    const i = curIdx();
    state.currentEstimate = v.progress_estimate;

    // Only automatic checks feed the 2-in-a-row streaks; two quick manual clicks must not fake one.
    const o = auto ? L.offTaskStep(off, v.on_task) : { worried: false, state: off };
    off = o.state;
    const d = auto ? L.doneStep(done, i, v.quest_done, locked.has(i)) : { complete: false, state: done };
    done = d.state;
    if (d.complete) {
      completeQuest(i, { withUndo: true });
      renderProgress();
      if (finishIfAllDone()) { refreshUsage(); return; }
      say('happy', v.pet_line);
    } else {
      renderProgress();
      say(o.worried ? 'worried' : v.on_task ? 'happy' : 'watching', v.pet_line);
    }
    if (petState() === 'happy') setTimeout(() => { if (watching && petState() === 'happy') say('watching'); }, 8000);
    refreshUsage();
  }

  async function runCheck(auto) {
    if (!watching || !state || checking) return;
    checking = true;
    $('check-now').disabled = true;
    if (!auto) say(petState(), 'looking...');
    const i = curIdx();
    try {
      const v = await api.check({
        quest: state.quests[i],
        idx: i,
        epoch,
        auto,
        ctx: { task: state.text, quests: state.quests.map((q) => ({ title: q.title, done: q.done })) },
      });
      applyVerdict(v, auto);
    } catch {
      say(petState(), 'my eyes blurred, trying again soon');
    } finally {
      checking = false;
      $('check-now').disabled = false;
    }
  }
  $('check-now').addEventListener('click', () => runCheck(false));
  api.onAutoCheck(() => runCheck(true));

  // --- overrides ---
  $('override-done').addEventListener('click', () => {
    if (!watching || !state) return;
    const i = curIdx();
    locked.delete(i);
    completeQuest(i, { withUndo: false });
    renderProgress();
    if (!finishIfAllDone()) say('happy', 'marked done — onward!');
  });
  $('override-working').addEventListener('click', () => {
    if (!watching) return;
    off = { off: 0, suppress: true };
    epoch++;
    say('watching', "ok, I'll trust you");
  });

  // --- deadline nudges: local math, $0 ---
  const NUDGE_LINES = {
    50: 'halfway through the time — how are we doing?',
    25: 'a quarter of the time left',
    10: 'nearly out of time!',
    left10: '10 minutes left — you got this',
  };
  function tick() {
    if (!watching || !state?.startedAt) return;
    const r = L.nudgeDue({ startedAt: state.startedAt, deadline: Date.parse(state.deadline_iso), now: Date.now(), progress: state.progress || 0, fired: state.fired || [] });
    if (r.fired !== state.fired) { state.fired = r.fired; save(); }
    if (r.speak) say('worried', NUDGE_LINES[r.speak]);
  }

  api.info().then(({ mock, tickMs }) => {
    $('mock-note').classList.toggle('hidden', !mock);
    setInterval(tick, tickMs || 30000);
  });
  refreshUsage();

  if (state && state.quests?.length) {
    openQuests();
    say('idle', 'welcome back — open me and hit Start to resume');
  }
})();
