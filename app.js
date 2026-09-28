// Renderer: bar + expandable panel. All AI calls and screen capture live in
// main.js behind window.questling (preload.js). Phase 2 adds interval checks.
(() => {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector('main');
  const api = window.questling;
  const STORAGE_KEY = 'questling-state-v1';

  let state = load();
  let expanded = false;
  let watching = false;

  function load() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null; } catch { return null; }
  }
  function save() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

  function say(petState, line) {
    main.dataset.petState = petState;
    if (line) $('pet-line').textContent = line;
  }

  function setExpanded(on) {
    expanded = on;
    // Grow the window first so the panel never renders squashed into the bar size.
    api.setExpanded(on);
    $('panel').classList.toggle('hidden', !on);
    $('toggle').textContent = on ? '▾' : '▴';
    if (on && !state) setTimeout(() => $('task-text').focus(), 50);
  }

  function setWatching(on) {
    watching = on;
    api.setWatching(on);
    $('watching-indicator').classList.toggle('hidden', !on);
    $('check-now').classList.toggle('hidden', !on);
    $('pause-btn').classList.toggle('hidden', !on);
    if (!on) $('thumb').classList.add('hidden');
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
    const p = window.QuestlingLogic.computeProgress({
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
      state = { text, quests: data.quests.map((q) => ({ ...q, done: false })), deadline_iso: data.deadline_iso, progress: 0, currentEstimate: 0 };
      save();
      openQuests();
      say('happy', data.fallback ? "couldn't reach my brain, here are starter quests" : `${state.quests.length} quests ready — edit, then Start`);
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

  $('new-task').addEventListener('click', () => {
    setWatching(false);
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
    save();
    setWatching(true);
    setExpanded(false);
    say('idle', 'watching — press ✓ anytime to check in');
  });

  $('pause-btn').addEventListener('click', () => {
    setWatching(false);
    say('idle', 'paused — open me and hit Start to resume');
  });
  api.onPaused(() => {
    setWatching(false);
    say('idle', 'paused — open me and hit Start to resume');
  });

  $('check-now').addEventListener('click', async () => {
    if (!watching) return;
    $('check-now').disabled = true;
    say(main.dataset.petState, 'looking...');
    try {
      const current = state.quests.find((q) => !q.done) || state.quests[state.quests.length - 1];
      const v = await api.checkNow(current);
      // Paused or task replaced while the check was in flight: drop the stale verdict.
      if (!watching || !state || !state.quests.includes(current)) return;
      if (v.thumb) {
        $('thumb').src = v.thumb;
        $('thumb').classList.remove('hidden');
      }
      if (v.error) {
        say(main.dataset.petState, v.pet_line);
        return;
      }
      state.currentEstimate = v.progress_estimate;
      if (v.quest_done && current && !current.done) {
        current.done = true;
        state.currentEstimate = 0;
        renderQuests();
      }
      renderProgress();
      if (state.quests.every((q) => q.done)) say('happy', 'all quests done! nice work');
      else say(v.on_task ? 'happy' : 'worried', v.pet_line);
    } finally {
      $('check-now').disabled = false;
    }
  });

  api.info().then(({ mock }) => $('mock-note').classList.toggle('hidden', !mock));

  if (state && state.quests?.length) {
    openQuests();
    say('idle', 'welcome back — open me and hit Start to resume');
  }
})();
