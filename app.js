// Renderer: owns all decisions (quest state, epoch, when to look, which card to show). Main only
// owns devices and the key: it streams `signal`s and answers `look` / `makeQuests` (preload.js).
// Rules are pure functions in logic.js. The model proposes; quest state changes only in click handlers.
(() => {
  const $ = (id) => document.getElementById(id);
  const main = document.querySelector('main');
  const api = window.pensum;
  const L = window.PensumLogic;
  const STORAGE_KEY = 'pensum-state-v1';
  const BUBBLE_MS = 6000;
  const HELLO = "tell me what you're working on";
  const ASK = 'What do you want to finish today?';
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
  let offWork = false; // foreground is a known process that is neither the work window nor on the allow-list: the pet glances over
  let away = false;
  let pickGen = 0; // bumped by stopSession: a window pick that answers after a pause / New task is stale
  let epoch = 0; // bumped on pause/start/new task/quest change/checkbox; stale looks are dropped
  let sup = { suppress: {} }; // "not yet" suppression per quest
  let notYetNote = null;
  let looking = false;
  let quietLook = false; // an unsolicited look must not flash the 'thinking' pose
  let card = null; // { kind, idx, onPrimary, onQuiet }
  let celebrating = false;
  let busy = false; // the quests are being made (screen 02)
  let powerTimer = null; // the power-up (celebrate) in progress
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
  let speechCapMs = 300000; // info().speechCapMs can shorten it
  let planGen = 0; // bumped by resetAll: a make-quests reply that lands after a reset is dropped
  let aiMode = 'mock'; // from info(): 'mock' | 'own-key' | 'live'
  const setMock = (on) => $('mock-badge').classList.toggle('hidden', !on);
  let lookTimeoutMs = 13000; // raw ms (not L.dur: e2e runs at time scale 600); main's own call gives up at 8 s, this is the backstop
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

  // --- pet: one base state, transient overrides. The 8 names are the design contract (see test/design-prompt.test.js). ---
  function applyPet() {
    main.dataset.petState = L.petStep({
      celebrating, looking, quietLook, cardKind: card ? card.kind : null,
      sessionOn, hasTask: !!state, breakMode, windowLost, away, busy, offWork,
    });
    $('bar').classList.toggle('is-powered', celebrating); // the bar's own aura rides the same 3.6 s
  }

  // Two pets, one on screen: the active <svg class="pet"> lives in the slot, the other in <template id="pet-<name>"> (not rendered,
  // not styled). Switching swaps them; the choice is remembered in localStorage['ql.pet'].
  const PET_KEY = 'ql.pet';
  function setPet(name) {
    const slot = document.querySelector('.ql-pet-slot');
    const cur = slot.querySelector('svg.pet');
    const tpl = $('pet-' + name);
    if (cur.dataset.pet !== name && tpl) {
      const next = tpl.content.firstElementChild;
      const park = document.createElement('template');
      park.id = 'pet-' + cur.dataset.pet;
      tpl.replaceWith(park);
      park.content.appendChild(cur);
      slot.prepend(next);
    }
    document.querySelectorAll('#pet-switch [data-pet]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.pet === name)));
  }
  document.querySelectorAll('#pet-switch [data-pet]').forEach((b) => b.addEventListener('click', () => {
    setPet(b.dataset.pet);
    try { localStorage.setItem(PET_KEY, b.dataset.pet); } catch {}
  }));
  try { const saved = localStorage.getItem(PET_KEY); if (saved === 'tuck' || saved === 'kip') setPet(saved); } catch {}

  // Size S/M/L lives in main (native zoom + window bounds); the switch only reflects it. Electron only.
  function showPrefs(p) {
    document.querySelectorAll('#size-switch [data-size]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.size === p.size)));
    document.querySelectorAll('#theme-switch [data-theme]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.theme === p.theme)));
  }
  document.querySelectorAll('#size-switch [data-size]').forEach((b) => b.addEventListener('click', () => api.setPref({ size: b.dataset.size })));
  document.querySelectorAll('#theme-switch [data-theme]').forEach((b) => b.addEventListener('click', () => api.setPref({ theme: b.dataset.theme })));
  api.onPrefs(showPrefs);

  // Shadows Soft/Flat: renderer-only, remembered like the pet. Flat is the escape hatch for slow GPUs (ui.css main[data-shadows]).
  const SHADOWS_KEY = 'ql.shadows';
  function setShadows(v) {
    if (v === 'flat') main.dataset.shadows = 'flat'; else delete main.dataset.shadows;
    document.querySelectorAll('#shadows-switch [data-shadows]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.shadows === (v === 'flat' ? 'flat' : 'soft'))));
  }
  document.querySelectorAll('#shadows-switch [data-shadows]').forEach((b) => b.addEventListener('click', () => {
    setShadows(b.dataset.shadows);
    try { localStorage.setItem(SHADOWS_KEY, b.dataset.shadows); } catch {}
  }));
  try { setShadows(localStorage.getItem(SHADOWS_KEY)); } catch {}

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

  // Power-up on every confirmed quest (all-done too). A second quest inside 3.6 s restarts it: drop `celebrating` for two
  // frames so the CSS animation starts over, never cut short by the first timer.
  function powerUp() {
    clearTimeout(powerTimer);
    const restart = celebrating;
    const go = () => {
      celebrating = true;
      applyPet();
      powerTimer = setTimeout(() => { celebrating = false; applyPet(); }, L.dur(3600));
    };
    if (!restart) return go();
    celebrating = false;
    applyPet();
    requestAnimationFrame(() => requestAnimationFrame(go));
  }

  // --- action card: one at a time, above the bar ---
  // Only the starter ("Tiny start") and drift ("Quick check") cards carry a tag. A title equal to its tag is hidden, not removed (tests read textContent).
  function setTag(tag) {
    $('card-tag').textContent = tag || '';
    $('card-tag').classList.toggle('hidden', !tag);
    $('card-title').classList.toggle('hidden', !!tag && tag === $('card-title').textContent);
  }
  function showCard(spec) {
    clearInterval(stepTimer);
    card = spec;
    $('card').className = `ql-card ql-card--${spec.kind} solid`;
    $('card-title').textContent = spec.title;
    setTag(spec.tag);
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
    $('quest-line').textContent = busy ? 'Making quests…' : !state ? HELLO : allDone() ? 'all quests done!' : state.quests[curIdx()].title;
    $('done-btn').classList.toggle('hidden', !state || allDone());
    $('start-btn').classList.toggle('hidden', sessionOn);
    $('end-btn').classList.toggle('hidden', !sessionOn);
    $('stuck-btn').classList.toggle('hidden', !sessionOn || windowLost || allDone());
    $('pause-btn').classList.toggle('hidden', !state || allDone());
    $('pause-btn').dataset.state = sessionOn ? 'on' : 'off';
    $('pause-btn').title = sessionOn ? 'pause' : 'resume';
    $('pause-btn').setAttribute('aria-label', sessionOn ? 'Pause' : 'Resume');
    $('company').classList.toggle('hidden', !sessionOn || windowLost);
    $('repick').classList.toggle('hidden', !(sessionOn && windowLost));
    $('bar').classList.toggle('is-complete', allDone());
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
      if (i === cur) {
        seg.style.setProperty('--fill', String(Math.min(1, activeMs(i) / (q.minutes * 60000))));
        seg.innerHTML = '<i class="ql-seg__fill"><i class="ql-seg__glint"></i></i>';
      }
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
  let winMax = 780; // main.js MAX_H, work-area clamped; info() refines it
  let lastH = 0;
  // One setBounds per real size change (each is a resize of a transparent topmost window). Padding and gaps come from
  // the computed style, not constants; the panel scrolls (--panel-max) instead of pushing the bar off the window.
  function fit() {
    const els = solids();
    const cs = getComputedStyle(main);
    const chrome = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + Math.max(0, els.length - 1) * (parseFloat(cs.rowGap) || 0);
    const panel = $('panel');
    const others = els.filter((el) => el !== panel).reduce((sum, el) => sum + el.offsetHeight, 0);
    main.style.setProperty('--panel-max', Math.max(160, winMax - chrome - others) + 'px');
    const h = els.reduce((sum, el) => sum + el.offsetHeight, 0) + chrome;
    if (h !== lastH) { lastH = h; api.setSize(h); }
  }
  const ro = new ResizeObserver(() => requestAnimationFrame(fit));
  ['panel', 'card', 'bubble', 'bar'].forEach((id) => ro.observe($(id)));

  let through = true;
  // Drag: the pet and the quest title move the overlay. Main follows the cursor (window is click-through, so no OS drag region).
  // Under 4 px of travel it stays a plain click.
  let drag = null; // { x, y, id, el, started }
  function dragEnd(cancel) {
    if (!drag) return;
    const was = drag;
    drag = null;
    main.classList.remove('is-dragging');
    if (was.started) api.dragEnd(cancel === true);
  }
  [document.querySelector('.ql-pet-slot'), document.querySelector('.ql-bar__mid')].forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || drag) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId, el, started: false };
      try { el.setPointerCapture(e.pointerId); } catch {}
    });
    el.addEventListener('pointermove', (e) => {
      if (!drag || drag.started || Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) return;
      drag.started = true;
      through = false;
      main.classList.add('is-dragging');
      api.dragStart();
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((ev) => el.addEventListener(ev, () => dragEnd()));
  });
  window.addEventListener('blur', () => dragEnd());
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') dragEnd(true); }); // Escape cancels: the overlay goes back

  document.addEventListener('mousemove', (e) => {
    if (drag?.started) return;
    const solid = !!e.target.closest('.solid');
    if (solid === through) { through = !solid; api.setClickThrough(through); }
  });

  function setExpanded(on) {
    expanded = on;
    if (!on && part === 'questdone') showPanelPart('quests'); // never reopen on a stale quest-done screen
    $('panel').classList.toggle('hidden', !on);
    $('toggle').dataset.state = on ? 'on' : 'off';
    $('toggle').setAttribute('aria-label', on ? 'Close' : 'Open');
    $('toggle').setAttribute('aria-expanded', String(on));
    if (on && !state) setTimeout(() => $('task-text').focus(), 50);
    if (on) refreshUsage();
  }
  $('toggle').addEventListener('click', () => setExpanded(!expanded));

  async function refreshUsage() {
    const u = await api.usage();
    $('usage-line').textContent = `${u.calls} / ${u.cap} looks today`;
  }

  // --- panel: onboarding, quests, window picker ---
  let part = 'task';
  function showPanelPart(name) {
    part = name;
    $('task-card').classList.toggle('hidden', name !== 'task');
    $('quest-card').classList.toggle('hidden', name !== 'quests');
    $('windows').classList.toggle('hidden', name !== 'windows');
    $('recap').classList.toggle('hidden', name !== 'recap');
    $('quest-done').classList.toggle('hidden', name !== 'questdone');
    $('privacy').classList.toggle('hidden', name !== 'task' && name !== 'windows'); // the capture notice sits where capture is introduced
  }

  // Review screen: deadline + fit meter, from the pure L.fitSummary. Recomputed on every render and on deadline edits.
  function updateFit() {
    const fromInput = new Date($('deadline').value).getTime();
    const f = L.fitSummary(state.quests, Number.isFinite(fromInput) ? fromInput : Date.parse(state.deadline_iso), Date.now());
    $('time-left').textContent = f.leftMin == null ? '' : f.leftMin === 0 ? 'past due' : `${L.fmtMin(f.leftMin)} left`;
    $('fit-work').textContent = L.fmtMin(f.workMin);
    $('fit-spare').textContent = f.spareMin == null ? '' : f.short ? `short by ${L.fmtMin(-f.spareMin)}` : `${L.fmtMin(f.spareMin)} spare`;
    const bar = $('fit-fill').parentElement;
    bar.style.setProperty('--fit', String(f.ratio));
    bar.classList.toggle('is-short', f.short);
  }
  $('deadline').addEventListener('input', () => state && updateFit());
  $('deadline').closest('label').querySelector('.ql-ic').addEventListener('click', () => $('deadline').showPicker?.());

  function renderQuests() {
    const list = $('quest-list');
    list.innerHTML = '';
    $('quest-count').textContent = `${state.quests.length} ${state.quests.length === 1 ? 'quest' : 'quests'}`;
    $('quest-task').textContent = state.text;
    const cur = allDone() ? -1 : curIdx();
    state.quests.forEach((q, i) => {
      const li = document.createElement('li');
      li.className = 'ql-quest' + (q.done ? ' is-done' : '') + (i === cur ? ' is-current' : '');
      li.style.setProperty('--i', String(i));
      // the number circle IS the checkbox (a real input, so it stays keyboard/AT reachable)
      const num = document.createElement('label');
      num.className = 'ql-num';
      num.addEventListener('click', (e) => e.stopPropagation());
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = !!q.done;
      box.setAttribute('aria-label', `Done: ${q.title}`);
      box.addEventListener('change', () => toggleQuest(i, box.checked));
      const n = document.createElement('span');
      n.className = 'ql-num__n';
      n.textContent = String(i + 1);
      num.append(box, n);
      num.insertAdjacentHTML('beforeend', '<svg class="ql-ic ql-num__ok" aria-hidden="true"><use href="#i-check"/></svg>');
      const wrap = document.createElement('div');
      wrap.className = 'ql-quest__text';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'ql-quest__title';
      input.value = q.title;
      input.setAttribute('aria-label', `Quest ${i + 1} title`);
      input.addEventListener('change', () => { state.quests[i].title = input.value; save(); updateBar(); });
      const finish = document.createElement('small');
      finish.className = 'ql-quest__finish';
      finish.textContent = q.finish;
      wrap.append(input, finish);
      const pill = document.createElement('span');
      pill.className = 'ql-pill';
      pill.textContent = `${q.minutes}m`;
      li.append(num, wrap, pill);
      li.addEventListener('click', () => setCurrent(i));
      list.appendChild(li);
    });
    updateFit();
    renderProgress();
    updateBar();
  }

  $('add-quest').addEventListener('click', () => {
    state.quests.push({ title: 'New quest', finish: '', minutes: 15, done: false });
    save();
    renderQuests();
    const last = [...$('quest-list').querySelectorAll('.ql-quest__title')].pop();
    last.focus();
    last.select();
  });

  function setCurrent(i) {
    if (!state || state.quests[i].done || (!allDone() && curIdx() === i)) return;
    if (card && card.idx !== i) { hideCard(); driftPending = false; } // the old quest's card (and a pending "back on track") no longer apply
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
    if (!finishIfAllDone() && checked) { powerUp(); say(`Quest done! Next: ${nextTitle()}`); }
  }

  function openQuests() {
    const d = new Date(state.deadline_iso);
    // datetime-local wants local time without zone.
    $('deadline').value = isNaN(d) ? '' : new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    $('link-name').textContent = state.linked ? state.linked.name : '';
    const list = $('quest-list');
    list.classList.add('is-in'); // rows rise in once, 40 ms apart
    setTimeout(() => list.classList.remove('is-in'), 700);
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
    busy = true;
    $('task-title').textContent = text;
    $('task-card').classList.add('is-busy');
    updateBar();
    const myPlan = planGen;
    try {
      const data = await api.makeQuests({ text, now: new Date().toISOString(), tzOffset: new Date().getTimezoneOffset() });
      if (myPlan !== planGen) return;
      setMock(data.mock === true);
      if (!data.quests) { say(data.pet_line || "couldn't make quests, try again"); return; }
      state = L.migrate({ text, quests: data.quests.map((q) => ({ ...q, done: false })), current: null, deadline_iso: data.deadline_iso, starter: data.starter, progress: 0, activeMs: {}, startedAt: null, fired: [], linked: null });
      resetRules();
      hideCard();
      save();
      openQuests();
      if (data.fallback) say("couldn't reach my brain, here are starter quests"); // the review screen says the rest
      refreshUsage();
    } catch {
      say("couldn't make quests, try again");
    } finally {
      busy = false;
      $('task-card').classList.remove('is-busy');
      $('task-title').textContent = ASK;
      $('make-quests').disabled = false;
      updateBar();
    }
  });

  function resetAll() {
    planGen++;
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
  }
  $('new-task').addEventListener('click', resetAll);

  // Settings sheet, reset (inline confirm: a native dialog can land behind this always-on-top window) and own-key form.
  $('reset-btn').addEventListener('click', () => { $('reset-confirm').classList.remove('hidden'); fit(); });
  $('reset-no').addEventListener('click', () => { $('reset-confirm').classList.add('hidden'); fit(); });
  $('reset-yes').addEventListener('click', () => { $('reset-confirm').classList.add('hidden'); resetAll(); api.resetPosition?.(); });
  $('gear-btn').addEventListener('click', () => {
    const open = $('settings').classList.toggle('hidden') === false;
    $('gear-btn').setAttribute('aria-expanded', String(open));
    fit();
  });
  async function refreshKey() {
    const i = await api.info();
    aiMode = i.aiMode || aiMode;
    $('key-clear').classList.toggle('hidden', !i.hasKey);
    $('key-state').textContent = i.hasKey ? 'Using your key' : 'Using Pensum server';
    if (i.aiMode === 'mock') setMock(true);
  }
  $('key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const r = await api.setKey($('key-input').value);
    $('key-input').value = '';
    await refreshKey();
    $('key-state').textContent = r.ok ? 'Saved' : 'That does not look like a key';
  });
  $('key-clear').addEventListener('click', async () => { await api.clearKey(); refreshKey(); });

  // --- window picker: frames only ever come from the window picked here ---
  let picked = null;
  async function openPicker() {
    setExpanded(true);
    showPanelPart('windows');
    picked = null;
    $('windows-start').classList.add('hidden');
    const grid = $('window-grid');
    const note = (t) => { const p = document.createElement('p'); p.className = 'ql-sub'; p.textContent = t; grid.replaceChildren(p); };
    note('looking for windows...');
    let wins = [];
    try { wins = await api.listWindows(); } catch {}
    if (!wins.length) { note('No windows found. Open the document you want to work in, then go back and try again.'); return; }
    grid.replaceChildren();
    wins.forEach((w) => {
      const lab = L.windowLabel(w.title);
      const b = document.createElement('button');
      b.className = 'ql-window';
      b.setAttribute('aria-pressed', 'false');
      const img = document.createElement('img');
      img.className = 'ql-window__thumb';
      img.alt = '';
      img.src = w.thumb;
      const text = document.createElement('span');
      text.className = 'ql-window__text';
      const app = document.createElement('span');
      app.className = 'ql-window__app';
      app.textContent = lab.app;
      const sub = document.createElement('span');
      sub.className = 'ql-window__sub';
      sub.textContent = lab.title;
      text.append(app, sub);
      b.append(img, text);
      b.insertAdjacentHTML('beforeend', '<span class="ql-window__check"><svg class="ql-ic" aria-hidden="true"><use href="#i-check"/></svg></span>');
      b.addEventListener('click', () => {
        picked = w;
        grid.querySelectorAll('.ql-window').forEach((x) => { x.classList.toggle('is-selected', x === b); x.setAttribute('aria-pressed', String(x === b)); });
        $('windows-start').textContent = `Start in ${lab.app.slice(0, 24)}`;
        $('windows-start').classList.remove('hidden');
      });
      grid.appendChild(b);
    });
  }
  $('windows-start').addEventListener('click', () => picked && startWith(picked));
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
    const s = state, g = pickGen;
    const r = await api.pickWindow(w.id);
    if (state !== s || pickGen !== g) { api.stopSession(); return; } // New task / Pause while the picker answered: main just started a session for nothing
    if (!r.ok) { say("that window is gone — pick another"); openPicker(); return; }
    work = { id: w.id, title: r.title || w.title };
    const repick = sessionOn; // picking again after the window was lost is not a new session
    sessionOn = true;
    windowLost = false;
    away = false;
    offWork = false;
    epoch++;
    resetRules();
    lastSig = 0;
    lastChangeAt = Date.now();
    lastOfferAt = Date.now();
    lastLookAt = Date.now();
    changedSinceLook = false;
    drift = { since: null, lastAskAt: null };
    offSince = null;
    if (!repick) speech = { lastSpokeAt: null, dismissed: 0 }; // "two X silence the session": a re-pick is the same session
    if (!repick) { state.session = { ...state.session, driftsAsked: 0, backOnTrack: 0, stuckUsed: 0 }; state.questStats = {}; save(); }
    showPanelPart('quests');
    setExpanded(false);
    updateBar();
    say(`Okay, I'll sit with you in ${work.title.slice(0, 40)}.`);
    if (!repick && activeMs(curIdx()) === 0) showStarter();
  }

  function stopSession() {
    queuedLook = null;
    pickGen++;
    sessionOn = false;
    breakMode = false;
    drift = { since: null, lastAskAt: null };
    driftPending = false;
    offSince = null;
    windowLost = false;
    away = false;
    offWork = false;
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
    const s = state, g = pickGen;
    const r = await api.pickWindow(work.id);
    if (state !== s || pickGen !== g) { api.stopSession(); return; }
    if (!r.ok) { openPicker(); return; }
    sessionOn = true;
    offWork = false;
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

  $('privacy-toggle').addEventListener('click', () => {
    const open = $('privacy-note').classList.toggle('hidden') === false;
    $('privacy-toggle').setAttribute('aria-expanded', String(open));
    $('privacy-toggle').textContent = open ? 'Hide' : 'Details';
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
    // !!fgProcess: right after Start the focus ring is empty (fgProcess null, onWork false) and the pet would glance at nothing.
    const wasOff = offWork;
    offWork = !s.onWork && !!s.fgProcess && !L.allowMatches(state.session.allow, s.fgProcess);
    if (offWork !== wasOff) applyPet();
    if (driftPending && s.onWork) { driftPending = false; state.session.backOnTrack++; state.questStats = L.bumpStat(state.questStats, curIdx(), 'back'); save(); }
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
    else if (bp === 'drift') askDrift();
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
  // Primary = back to work (what we hope for); "It's on task" teaches the allow-list. From the window title we only ever see the process name.
  const lowerFirst = (t) => t.charAt(0).toLowerCase() + t.slice(1);
  const friendly = (p) => { const n = String(p || '').replace(/\.exe$/i, ''); return n && n === n.toLowerCase() ? n.charAt(0).toUpperCase() + n.slice(1) : n; };
  function driftLine(inWindow) {
    const t = lowerFirst(state.quests[curIdx()].title);
    if (inWindow || !lastFgProcess) return `That doesn't look like ${t}. Back to it?`;
    return `This looks like ${friendly(lastFgProcess)}. Back to ${t}?`;
  }
  function askDrift(inWindow = false) {
    const i = curIdx();
    state.session.driftsAsked++;
    state.questStats = L.bumpStat(state.questStats, i, 'drifts');
    driftPending = true;
    save();
    showCard({
      kind: 'ask', idx: i, tag: 'Quick check', title: driftLine(inWindow), body: '', unsolicited: true, chips: CHIPS,
      primary: 'Back on track', quiet: "It's on task",
      onChip: (label) => onTaskNote(label),
      onPrimary: () => { hideCard(); },
      onQuiet: () => onTaskNote('on task'),
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
      let timer;
      try {
        // A slow answer must not freeze the buttons: past the backstop it counts as no answer (the local fallbacks run); a late reply is ignored.
        const r = await Promise.race([
          api.look({ purpose, quest: state.quests[i], idx: i, epoch, ctx: ctxFor(extra), allow: state.session.allow, linkedPath: state.linked?.path || null }),
          new Promise((res) => { timer = setTimeout(() => res({ error: true, backstop: true }), lookTimeoutMs); }),
        ]);
        if (r.capped) { if (!auto) say(r.pet_line); }
        else if (!r.error) { v = r; setMock(r.mock === true); }
        else if (r.backstop && aiMode === 'live') setMock(true); // a slow proxy never shows an unlabeled template answer
      } catch {}
      clearTimeout(timer);
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
    if (r.card && r.card.kind === 'step') { state.session.stuckUsed++; state.questStats = L.bumpStat(state.questStats, i, 'stuck'); save(); }
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
      if (L.allowSpeak(speech, Date.now(), speechCapMs)) askDrift(true);
    } else if (c.kind === 'step') {
      showCard({
        ...c, primary: 'Start 2 min', quiet: 'Another idea',
        onPrimary: () => startStepTimer(),
        onQuiet: () => { hideCard(); runLook('stuck', { avoid: c.body }); },
      });
    }
  }

  // A local countdown on the card, no model call. --left (1 -> 0) drives the ring, mmss the label.
  function runCountdown(totalMs, onDone, keepPrimary = false) {
    clearInterval(stepTimer);
    const total = L.dur(totalMs);
    const end = Date.now() + total;
    $('card-count').classList.remove('hidden');
    $('card-primary').classList.toggle('hidden', !keepPrimary);
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
      kind: 'starter', idx, tag: 'Tiny start', title: 'Tiny start', body: state.starter, primary: 'Go', quiet: 'Not now',
      onPrimary: () => beginStarter(idx),
      onQuiet: hideCard,
    });
  }
  function beginStarter(idx) {
    $('card-title').textContent = 'Tiny start';
    setTag('Tiny start');
    $('card-quiet').textContent = 'Skip';
    $('card-primary').textContent = 'Did it'; // finished early: the same exit as "Yes" below
    card.onPrimary = () => { hideCard(); say('Nice. Keep going.'); };
    runCountdown(STARTER_MS, () => askStarted(idx), true);
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
    if (finishIfAllDone()) return;
    powerUp();
    const e = epoch;
    setTimeout(() => { if (epoch === e && state) showQuestDone(i); }, L.dur(1200)); // the card opens after lift-off, not over the lifting pet

  }

  // Screen 07: this quest's numbers (counters are per quest), what is up next, and two ways on.
  function showQuestDone(i) {
    const st = L.statsFor(state.questStats, i);
    const n = curIdx(); // the quest the bar now shows
    $('qd-tag').textContent = `Quest ${i + 1} of ${state.quests.length} done`;
    $('qd-title').textContent = state.quests[i].title;
    $('qd-min').textContent = L.fmtActive(activeMs(i));
    $('qd-drifts').textContent = String(st.drifts);
    $('qd-back').textContent = String(st.back);
    $('qd-stuck').textContent = String(st.stuck);
    $('qd-next').textContent = state.quests[n].title;
    $('qd-next-min').textContent = `${state.quests[n].minutes}m`;
    showPanelPart('questdone');
    setExpanded(true);
  }
  $('qd-start').addEventListener('click', () => { setExpanded(false); if (!sessionOn) resume(); });
  $('qd-break').addEventListener('click', () => { setExpanded(false); startBreak(); });

  // End-of-session summary in the panel (planned vs done, minutes on quest, drifts caught, back on track, stuck steps) + one praise line.
  function showRecap() {
    const r = L.recap({ quests: state.quests, activeMs: state.activeMs, session: state.session, questStats: state.questStats });
    $('recap-praise').textContent = r.praise;
    $('recap-tag').textContent = r.done === r.planned ? `All ${r.planned} quests done` : '';
    $('recap-tag').classList.toggle('hidden', r.done !== r.planned);
    $('recap-list').innerHTML = '';
    r.doneTitles.forEach((t) => {
      const li = document.createElement('li');
      li.insertAdjacentHTML('afterbegin', '<span class="ql-check"><svg class="ql-ic" aria-hidden="true"><use href="#i-check"/></svg></span>');
      const span = document.createElement('span');
      span.textContent = t;
      li.appendChild(span);
      $('recap-list').appendChild(li);
    });
    $('rs-done').textContent = `${r.done} of ${r.planned}`;
    $('rs-min').textContent = `${r.minutes} min`;
    $('rs-drifts').textContent = String(r.drifts);
    $('rs-back').textContent = String(r.backOnTrack);
    $('rs-stuck').textContent = String(r.stuck);
    showPanelPart('recap');
    setExpanded(true);
  }
  $('end-btn').addEventListener('click', () => { hideCard(); stopSession(); showRecap(); });
  $('recap-close').addEventListener('click', () => { if (state) openQuests(); else showPanelPart('task'); });
  $('recap-new').addEventListener('click', () => $('new-task').click());

  function finishIfAllDone() {
    if (!allDone()) return false;
    hideCard();
    if (sessionOn) stopSession();
    powerUp();
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

  // Main owns placement: it pushes the dock edge and the tallest window that fits the work area (CSS px) after every place.
  function applyGeom(g) {
    if (!g) return;
    main.dataset.dock = g.dock;
    winMax = g.maxH;
    requestAnimationFrame(fit);
  }
  api.onGeom(applyGeom);

  api.info().then(({ mock, timeScale, speechCapMs: cap, lookTimeoutMs: lt, maxH, dock, size, theme, aiMode: am }) => {
    if (am) aiMode = am;
    applyGeom({ dock, maxH });
    showPrefs({ size, theme });
    requestAnimationFrame(fit);
    L.setTimeScale(timeScale);
    if (cap) speechCapMs = cap;
    if (lt) lookTimeoutMs = lt;
    setMock(mock);
    refreshKey();
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
