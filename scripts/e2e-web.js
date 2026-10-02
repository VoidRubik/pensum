// Web demo e2e on a fresh browser context with every permission denied. Usage: node scripts/e2e-web.js <baseUrl> [shotsDir]
// Needs playwright-core (not a project dependency): run it from a folder where it is installed, or NODE_PATH.
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const BASE = process.argv[2] || 'http://127.0.0.1:4173';
const SHOTS = process.argv[3];
let pass = 0, fail = 0;
const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + m); };

(async () => {
  const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: [] });
  await ctx.addInitScript(() => {
    window.__devAsks = [];
    const md = navigator.mediaDevices;
    if (md) md.getDisplayMedia = (...a) => { window.__devAsks.push('getDisplayMedia'); return Promise.reject(new DOMException('denied', 'NotAllowedError')); };
    if (md) md.getUserMedia = (...a) => { window.__devAsks.push('getUserMedia'); return Promise.reject(new DOMException('denied', 'NotAllowedError')); };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', (e) => errs.push(String(e)));
  const bad = [];
  page.on('response', (r) => { if (r.status() >= 400 && !/\/api\/model/.test(r.url())) bad.push(`${r.status()} ${r.url()}`); });
  let dialogs = 0;
  page.on('dialog', (d) => { dialogs++; d.dismiss(); });
  const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } };
  const undone = () => page.$$eval('.ql-quest input[type=checkbox]', (b) => b.length > 0 && b.every((x) => !x.checked));
  const state = () => page.getAttribute('main', 'data-pet-state');

  await page.goto(BASE);
  await page.waitForSelector('#bar');
  ok(await page.evaluate(() => document.documentElement.classList.contains('web')), 'web shim active (html.web)');
  await shot('01-start');
  await page.click('#toggle');
  await page.fill('#task-text', 'my water cycle essay');
  await page.click('#make-quests');
  await page.waitForSelector('.ql-quest', { timeout: 30000 });
  const nq = (await page.$$('.ql-quest')).length;
  ok(nq >= 3 && nq <= 5, `quests generated (${nq})`);
  await shot('02-quests');
  await page.click('#start-btn');
  await page.waitForSelector('.ql-window');
  await shot('03-picker');
  await page.click('.ql-window');
  await page.waitForSelector('#stuck-btn:not(.hidden)');
  ok(await state() === 'working', 'session on -> working');
  await shot('04-working');
  // stuck on the blank page
  await page.click('text=Blank page (stuck)');
  await page.click('#stuck-btn');
  await page.waitForSelector('.ql-card--step:not(.hidden)', { timeout: 30000 });
  const step = await page.textContent('#card-body');
  ok(step.length > 5, 'stuck step: ' + step.slice(0, 70));
  ok(await state() === 'helper', 'step card -> helper');
  await shot('05-stuck-step');
  await page.click('#card-x');
  // confirm on outline-done
  await page.click('text=Outline done');
  await page.click('#done-btn');
  await page.waitForSelector('.ql-card--confirm:not(.hidden)', { timeout: 30000 });
  ok(await undone(), 'done look proposes, nothing completed');
  await shot('06-confirm');
  await page.click('#card-primary');
  ok(await page.$$eval('.ql-quest input[type=checkbox]', (b) => b[0].checked), 'Yes, done (click) completes quest 1');
  // injection
  await page.click('text=Injection test');
  await page.click('#done-btn');
  await page.waitForSelector('.ql-card--confirm:not(.hidden)', { timeout: 30000 });
  const text = await page.evaluate(() => document.body.innerText);
  ok(!/https?:|www\.|example\.com|prize/i.test(text.replace(/Injection test/g, '')), 'injection: no URL rendered');
  ok(await page.$$eval('.ql-quest input[type=checkbox]', (b) => b.filter((x) => x.checked).length === 1), 'injection: only the click-completed quest is done');
  await shot('07-injection');
  await page.click('#card-quiet');
  // window closed
  await page.click('text=Window closed');
  await page.waitForFunction(() => document.querySelector('main').dataset.petState === 'asleep', null, { timeout: 5000 });
  ok(await page.isVisible('#repick'), 'window closed -> asleep + Pick window again');
  await shot('08-asleep');
  await page.click('#repick');
  await page.click('.ql-window');
  await page.waitForFunction(() => document.querySelector('main').dataset.petState === 'working');
  ok(true, 're-pick -> working');
  // permissions / storage
  ok(await page.evaluate(() => window.__devAsks.length) === 0 && dialogs === 0, 'no device or permission requests at all');
  const dump = await page.evaluate(() => JSON.stringify(localStorage));
  ok(!/data:image|base64/.test(dump), 'localStorage: no data:image/base64');
  ok(errs.filter((e) => !/api\/model.*(429|502|503)/.test(e) && !/Failed to load resource/.test(e)).length === 0, 'no console/CSP errors ' + JSON.stringify(errs.slice(0, 3)));
  ok(bad.length === 0, 'no 4xx/5xx for static files ' + JSON.stringify(bad.slice(0, 3)));
  await browser.close();
  console.log(`\n${pass} pass, ${fail} fail`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
