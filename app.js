// Renderer: bar, speech bubble, proposal slot, expandable panel. All AI calls, screen capture and the
// auto-check timer live in main.js behind window.questling (preload.js). Rules (epoch, off-task,
// proposals, nudges) are pure functions in logic.js.
(() => {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector('main');
  const api = window.questling;
  const L = window.QuestlingLogic;
  const STORAGE_KEY = 'questling-state-v1';
  const PREFS_KEY = 'questling-prefs-v1';
  const BUBBLE_MS = 6000;
  const PROPOSAL_MS = 10000;
  const HELLO = "tell me what you're working on";

  // state = persisted, text only. Screen-derived text (verdict reasons, titles, documents) never lands here.
  let state = load(STORAGE_KEY);
  let prefs = load(PREFS_KEY) || { titles: true };
  let expanded = false;
  let watching = false;
  let epoch = 0; // bumped on pause/start/new task/quest change/override/checkbox; stale verdicts dropped
  let off = { off: 0, suppress: false };
  let sup = { suppress: {} }; // "not yet" suppression per quest
  let notYetNote = null; // { idx, title, at } goes into the next prompts for that quest
  let proposal = null; // { idx, timer } — one slot, own element, nothing else writes to it
  let errStreak = 0;
  let checking = false;
  let doneChecking = false;
  let bubbleTimer = null;

  function load(key) {
    try { return JSON.parse(localStorage.getItem(key)) || null; } catch { return null; }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function savePrefs() { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); }

  // --- pet + bubble ---
  function say(petState, line) {
    main.dataset.petState = petState;
    if (!line) return;
    $('bubble-text').textContent = line;
    $('bubble').classList.remove('hidden');
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(() => $('bubble').classList.add('hidden'), BUBBLE_MS);
  }
  const petState = () => main.dataset.petState;

  const doneFlags = () => state.quests.map((q) => q.done);
  // Current quest index; when everything is done, the last one (callers check allDone()).
  const curIdx = () => {
    const i = L.currentIdx({ current: state.current, done: doneFlags() });
    return i === -1 ? state.quests.length - 1 : i;
  };
  const allDone = () => !!state && state.quests.length > 0 && state.quests.every((q) => q.done);
  const nextTitle = () => state.quests[L.currentIdx({ current: null, done: doneFlags() })]?.title;

  function updateBar() {
    $('quest-line').textContent = !state ? HELLO : allDone() ? 'all quests done!' : state.quests[curIdx()].title;
    $('done-btn').classList.toggle('hidden', !state || allDone());
    $('start-row').classList.toggle('hidden', watching);
    $('overrides').classList.toggle('hidden', !watching);
    $('check-now').classList.toggle('hidden', !watching);
    $('pause-btn').classList.toggle('hidden', !watching);
    $('watching-indicator').classList.toggle('hidden', !watching);
    $('panel-head').classList.toggle('hidden', !watching || $('thumb').getAttribute('src') === null);
  }

  // --- window size follows content; click-through everywhere except solid elements ---
  const solids = () => [...main.children].filter((el) => !el.classList.contains('hidden'));
  function fit() {
    const els = solids();
    const h = els.reduce((sum, el) => sum + el.offsetHeight, 0) + Math.max(0, els.length - 1) * 8 + 12;
    api.setSize(h);
  }
  const ro = new ResizeObserver(() => requestAnimationFrame(fit));
  ['panel', 'proposal', 'bubble', 'bar'].forEach((id) => ro.observe($(id)));

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

  function setWatching(on) {
    watching = on;
    epoch++;
    api.setWatching(on);
    if (!on) { $('thumb').removeAttribute('src'); }
    updateBar();
  }

  async function refreshUsage() {
    const u = await api.usage();
    $('usage-line').textContent = `today: ${u.checks} looks · ${(u.tokens / 1000).toFixed(1)}k tokens · cap ${u.cap}`;
  }

  // --- quests panel ---
  function markCurrent() {
    const cur = state && !allDone() ? curIdx() : -1;
    [...$('quest-list').children].forEach((li, i) => li.classList.toggle('current', i === cur));
  }

  function renderQuests() {
    const list = $('quest-list');
    list.innerHTML = '';
    state.quests.forEach((q, i) => {
      const li = document.createElement('li');
      li.className = 'quest-item' + (q.done ? ' done' : '');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!q.done;
      box.addEventListener('click', (e) => e.stopPropagation());
      box.addEventListener('change', () => toggleQuest(i, box.checked));
      const wrap = document.createElement('div');
      wrap.className = 'qtext';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = q.title;
      input.addEventListener('change', () => { state.quests[i].title = input.value; save(); updateBar(); });
      const finish = document.createElement('small');
      finish.textContent = q.finish;
      wrap.append(input, finish);
      li.append(box, wrap);
      li.addEventListener('click', () => setCurrent(i));
      list.appendChild(li);
    });
    markCurrent();
    updateBar();
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

  function setCurrent(i) {
    if (!state || state.quests[i].done || (!allDone() && curIdx() === i)) return;
    state.current = i;
    state.currentEstimate = 0;
    off = { off: 0, suppress: false };
    epoch++;
    save();
    markCurrent();
    updateBar();
  }

  function toggleQuest(i, checked) {
    state.quests[i].done = checked;
    epoch++;
    state.currentEstimate = 0; // the new current quest must not inherit the old one's percentage
    sup.suppress[i] = 0;
    if (!checked) state.progress = 0; // high-water mark would keep the bar up
    if (proposal && proposal.idx === i) hideProposal();
    renderQuests();
    renderProgress();
    if (!finishIfAllDone() && checked) say('happy', `Quest done! Next: ${nextTitle()}`);
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
      state = { text, quests: data.quests.map((q) => ({ ...q, done: false })), current: null, deadline_iso: data.deadline_iso, progress: 0, currentEstimate: 0, startedAt: null, fired: [], linked: null };
      resetRules();
      hideProposal();
      save();
      openQuests();
      say('happy', data.fallback ? "couldn't reach my brain, here are starter quests" : `${state.quests.length} quests ready — edit, then Start`);
      refreshUsage();
    } catch {
      say('idle', "couldn't make quests, try again");
    } finally {
      $('make-quests').disabled = false;
    }
  });

  function openQuests() {
    const d = new Date(state.deadline_iso);
    // datetime-local wants local time without zone.
    $('deadline').value = isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('link-name').textContent = state.linked ? state.linked.name : '';
    $('titles-toggle').checked = prefs.titles;
    renderQuests();
    renderProgress();
    showCard('quests');
  }

  function resetRules() {
    off = { off: 0, suppress: false };
    sup = { suppress: {} };
    notYetNote = null;
    errStreak = 0;
  }

  $('new-task').addEventListener('click', () => {
    setWatching(false);
    resetRules();
    hideProposal();
    state = null;
    localStorage.removeItem(STORAGE_KEY);
    $('task-text').value = '';
    $('progress-fill').style.transform = 'scaleX(0)';
    showCard('task');
    updateBar();
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
    off = { off: 0, suppress: false }; // "not yet" (sup / notYetNote) survives a pause
    errStreak = 0;
    say('sleepy', line || 'paused — open me and hit Start to resume');
  }
  $('pause-btn').addEventListener('click', () => pause());
  api.onPaused(() => pause());

  // --- linked work + prefs ---
  $('link-btn').addEventListener('click', async () => {
    const r = await api.linkWork();
    if (!r || !state) return;
    state.linked = { path: r.path, name: r.name };
    save();
    $('link-name').textContent = r.readable ? `${r.name} (${r.words} words) — save to update` : `${r.name} — couldn't read it`;
  });
  $('titles-toggle').addEventListener('change', (e) => { prefs.titles = e.target.checked; savePrefs(); });

  // --- proposals: the pet asks, Bruno confirms ---
  function showProposal(idx, text) {
    clearTimeout(proposal?.timer);
    proposal = { idx, text, timer: setTimeout(collapseProposal, PROPOSAL_MS) };
    $('proposal-text').textContent = text;
    $('proposal').classList.remove('hidden');
    $('proposal-chip').classList.add('hidden');
    say('happy');
  }
  function collapseProposal() {
    if (!proposal) return;
    $('proposal').classList.add('hidden');
    $('proposal-chip').classList.remove('hidden');
  }
  function hideProposal() {
    clearTimeout(proposal?.timer);
    proposal = null;
    $('proposal').classList.add('hidden');
    $('proposal-chip').classList.add('hidden');
  }
  $('proposal-chip').addEventListener('click', () => proposal && showProposal(proposal.idx, proposal.text));

  function completeQuest(i) {
    state.quests[i].done = true;
    state.currentEstimate = 0;
    if (state.current === i) state.current = null;
    if (notYetNote?.idx === i) notYetNote = null;
    epoch++;
    renderQuests();
    renderProgress();
    if (!finishIfAllDone()) say('happy', `Quest done! Next: ${nextTitle()}`);
  }

  $('proposal-yes').addEventListener('click', () => {
    if (!proposal || !state) return;
    const i = proposal.idx;
    hideProposal();
    if (!state.quests[i].done) completeQuest(i);
  });
  $('proposal-no').addEventListener('click', () => {
    if (!proposal || !state) return;
    const i = proposal.idx;
    hideProposal();
    sup = L.notYet(sup, i);
    const t = new Date();
    notYetNote = { idx: i, title: state.quests[i].title, at: `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}` };
    say('watching', "ok, I'll keep looking");
  });

  function finishIfAllDone() {
    if (!allDone()) return false;
    hideProposal();
    if (watching) setWatching(false); // stops main's timer; no more calls
    say('party', 'All quests done! Nice work');
    return true;
  }

  // --- verdicts ---
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
    if (v.thumb) { $('thumb').src = v.thumb; updateBar(); }
    const i = curIdx();
    state.currentEstimate = v.progress_estimate;

    // Only automatic checks feed the 2-in-a-row worried rule; two quick manual clicks must not fake one.
    const o = auto ? L.offTaskStep(off, v.on_task) : { worried: false, state: off };
    off = o.state;
    const p = L.proposeStep(sup, { idx: i, questDone: v.quest_done, auto });
    sup = p.state;
    renderProgress();
    if (p.propose && !proposal) {
      showProposal(i, `Looks like "${state.quests[i].title}" is done!`);
    } else {
      say(o.worried ? 'worried' : v.on_task ? 'happy' : 'watching', v.pet_line);
    }
    if (petState() === 'happy') setTimeout(() => { if (watching && petState() === 'happy') say('watching'); }, 8000);
    refreshUsage();
  }

  const ctxFor = () => ({
    task: state.text,
    quests: state.quests.map((q) => ({ title: q.title, done: q.done })),
    notYet: notYetNote && notYetNote.idx === curIdx() ? `"${notYetNote.title}" at ${notYetNote.at}` : null,
  });
  const signalsFor = () => ({ titles: prefs.titles, linkedPath: state.linked?.path || null });

  async function runCheck(auto) {
    if (!watching || !state || checking) return;
    checking = true;
    $('check-now').disabled = true;
    if (!auto) say(petState(), 'looking...');
    const i = curIdx();
    try {
      const v = await api.check({ quest: state.quests[i], idx: i, epoch, auto, ctx: ctxFor(), ...signalsFor() });
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

  // ✓ = "I'm done with this quest": its own channel, works while paused or while an auto check is in flight.
  $('done-btn').addEventListener('click', async () => {
    if (!state || allDone() || doneChecking) return;
    doneChecking = true;
    $('done-btn').disabled = true;
    const i = curIdx();
    say(petState(), 'looking...');
    try {
      const v = await api.doneCheck({ quest: state.quests[i], idx: i, epoch, ctx: ctxFor(), ...signalsFor() });
      // Only drop it if that quest changed under us (new task, quest done/unticked, another quest picked).
      if (!state || !state.quests[i] || state.quests[i].done || curIdx() !== i) return;
      if (v.error) { say(petState(), v.pet_line); }
      else if (v.quest_done) { completeQuest(i); }
      else { showProposal(i, `Hmm, ${v.reason.slice(0, 60)}. Mark done anyway?`); }
    } catch {
      say(petState(), 'my eyes blurred, try again');
    } finally {
      doneChecking = false;
      $('done-btn').disabled = false;
      refreshUsage();
    }
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
  updateBar();

  if (state && state.quests?.length) {
    openQuests();
    say('idle', 'welcome back — open me and hit Start to resume');
  }
  requestAnimationFrame(fit);
})();
