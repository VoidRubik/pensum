// Phase 1: task -> quests -> check-me-now -> verdict. No build step, no
// framework. Automatic interval checks, nudges and the 2-in-a-row rule are
// Phase 2 (see brainstorms/brief-20260927-183530-questling.md, Slices).
(() => {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector('main');

  const STORAGE_KEY = 'questling-state-v1';
  const LOCK_KEY = 'questling-lock';
  const SESSION_ID = crypto.randomUUID();

  // Duplicate-tab guard (adversarial review #7): claim the lock; if another
  // tab already holds a fresh one, warn instead of silently double-firing.
  function claimLock() {
    const now = Date.now();
    const existing = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null');
    if (existing && existing.id !== SESSION_ID && now - existing.at < 4000) {
      return false;
    }
    localStorage.setItem(LOCK_KEY, JSON.stringify({ id: SESSION_ID, at: now }));
    return true;
  }
  setInterval(() => localStorage.setItem(LOCK_KEY, JSON.stringify({ id: SESSION_ID, at: Date.now() })), 2000);
  if (!claimLock()) {
    main.innerHTML = '<div class="card"><p>Questling is already open in another tab. Use that one — running two copies burns the shared free quota twice as fast.</p></div>';
    return;
  }

  let state = loadState();

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || null;
    } catch {
      return null;
    }
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function setPetState(name, line) {
    main.dataset.petState = name;
    if (line) $('pet-line').textContent = line;
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
      input.addEventListener('change', () => { state.quests[i].title = input.value; saveState(); });
      li.appendChild(input);
      list.appendChild(li);
    });
  }

  function renderProgress() {
    const done = state.quests.filter((q) => q.done).length;
    const p = window.QuestlingLogic.computeProgress({
      questsDone: done,
      total: state.quests.length,
      currentEstimate: state.currentEstimate || 0,
      previous: state.progress || 0,
    });
    state.progress = p;
    $('progress-fill').style.transform = `scaleX(${p})`;
    saveState();
  }

  // --- Step 1: task -> quests ---
  $('make-quests').addEventListener('click', async () => {
    const text = $('task-text').value.trim();
    if (!text) return;
    $('make-quests').disabled = true;
    try {
      const res = await fetch('/api/quests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': SESSION_ID },
        body: JSON.stringify({ text, now: new Date().toISOString(), tzOffset: new Date().getTimezoneOffset() }),
      });
      const data = await res.json();
      state = {
        text,
        quests: data.quests.map((q) => ({ ...q, done: false })),
        deadline_iso: data.deadline_iso,
        progress: 0,
        currentEstimate: 0,
      };
      $('deadline').value = data.deadline_iso ? data.deadline_iso.slice(0, 16) : '';
      renderQuests();
      $('task-card').classList.add('hidden');
      $('quest-card').classList.remove('hidden');
      saveState();
    } finally {
      $('make-quests').disabled = false;
    }
  });

  // --- Step 2: start (screen share) ---
  let stream = null;
  $('start-btn').addEventListener('click', async () => {
    state.deadline_iso = new Date($('deadline').value).toISOString();
    saveState();
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: 'monitor' },
        selfBrowserSurface: 'exclude',
      });
      const track = stream.getVideoTracks()[0];
      track.addEventListener('ended', () => {
        setPetState('idle', 'sharing stopped — hit Start to resume');
        $('watching-indicator').classList.add('hidden');
      });
    } catch (e) {
      setPetState('worried', "couldn't get screen access — try Start again");
      return;
    }
    $('quest-card').classList.add('hidden');
    $('run-card').classList.remove('hidden');
    $('watching-indicator').classList.remove('hidden');
    renderProgress();
    setPetState('idle', 'watching — hit "check me now" anytime');
  });

  // --- Step 3: manual check ---
  async function grabFrame() {
    const track = stream.getVideoTracks()[0];
    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    await video.play().catch(() => {});
    await new Promise((r) => setTimeout(r, 150));

    let width = video.videoWidth || 1024;
    let height = video.videoHeight || 768;
    const maxSide = 1024;
    if (Math.max(width, height) > maxSide) {
      const scale = maxSide / Math.max(width, height);
      width = Math.round(width * scale);
      height = Math.round(height * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    if ('ImageCapture' in window) {
      try {
        const capture = new ImageCapture(track);
        const bitmap = await capture.grabFrame();
        ctx.drawImage(bitmap, 0, 0, width, height);
      } catch {
        ctx.drawImage(video, 0, 0, width, height);
      }
    } else {
      ctx.drawImage(video, 0, 0, width, height);
    }

    const thumbCanvas = document.createElement('canvas');
    thumbCanvas.width = 160;
    thumbCanvas.height = Math.round(160 * (height / width));
    thumbCanvas.getContext('2d').drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
    $('thumb').src = thumbCanvas.toDataURL('image/jpeg', 0.6);
    $('thumb').classList.remove('hidden');

    const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
    return dataUrl.split(',')[1]; // strip the data: prefix — jpegBase64 only
  }

  $('check-now').addEventListener('click', async () => {
    if (!stream) return;
    $('check-now').disabled = true;
    setPetState(main.dataset.petState, 'checking in...');
    try {
      const jpegBase64 = await grabFrame();
      const currentQuest = state.quests.find((q) => !q.done) || state.quests[state.quests.length - 1];
      const res = await fetch('/api/check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Session-Id': SESSION_ID },
        body: JSON.stringify({ jpegBase64, quest: currentQuest }),
      });
      const verdict = await res.json();
      if (!res.ok) {
        setPetState(main.dataset.petState, verdict.pet_line || 'my eyes blurred, trying again soon');
        return;
      }
      state.currentEstimate = verdict.progress_estimate;
      if (verdict.quest_done && currentQuest) {
        currentQuest.done = true;
        renderQuests();
        state.currentEstimate = 0;
      }
      renderProgress();
      setPetState(verdict.on_task ? 'happy' : 'worried', verdict.pet_line);
      if (state.quests.every((q) => q.done)) {
        setPetState('happy', 'all quests done! nice work');
      }
    } finally {
      $('check-now').disabled = false;
    }
  });

  $('pause-btn').addEventListener('click', () => {
    if (stream) stream.getTracks().forEach((t) => t.stop());
    stream = null;
    $('watching-indicator').classList.add('hidden');
    $('thumb').classList.add('hidden');
    setPetState('idle', 'paused — hit Start to resume');
  });
})();
