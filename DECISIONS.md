# Decisions

Format: YYYY-MM-DD · decision · why

2026-10-01 · Work on master, commit per step · plan mandates, private repo, no push until step 4
2026-10-01 · Spike 0a: getSources(window) 111–432 ms with 5 windows listed (desk had few windows, not 25+) · well under 1 s, keep 15 s sampler
2026-10-01 · Spike 0a: occluded window thumbnail is non-blank and correct (diff 0 vs unoccluded); minimized and closed windows vanish from getSources (no empty thumbnail) · "windowVisible:false" = source missing from the list, not an empty image
2026-10-01 · Spike 0a: diff at 160x100 gray, |Δ|>24: idle noise 0.000% over 4 settled grabs; typed one line 4.96–6.44% · T=0.4% works with a wide margin. Focus change alone (title-bar colour) caused ~4% on the first, unsettled run, so changed() must ignore frames right after a foreground change
2026-10-01 · Spike 0a: yellow border/flicker on Win10 19045 not checked (thumbnails are never viewed; cannot observe) · unverified, listed as an open risk
2026-10-01 · Spike 0b: source id "window:<HWND>:0" embeds the same HWND focus.js reads · match on id, title match only as fallback
2026-10-01 · Spike 0c: 5 lite stuck calls on staged essay-blank.jpg: 1992/1246/2186/1558/7589 ms (4 of 5 under 2.2 s, one 7.6 s tail); 5/5 nextStep named a thing on screen ("[ write here ]", Causes heading) · keep gemini-3.5-flash-lite for looks; 8 s timeout + 1 retry stays
