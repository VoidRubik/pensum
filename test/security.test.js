// Ship-prep hardening: linked-file allow-list, child-process env scrub, Vercel headers.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../logic.js');

const root = path.join(__dirname, '..');
const wa = { x: 0, y: 0, width: 1920, height: 1080 };

test('sanitizeSettings: linked is a clean string[] of at most 20, newest last, no duplicates', () => {
  assert.deepEqual(L.sanitizeSettings({}, [wa]).linked, []);
  assert.deepEqual(L.sanitizeSettings({ linked: 'C:/a.txt' }, [wa]).linked, []);
  assert.deepEqual(L.sanitizeSettings({ linked: ['a.txt', 7, '', null, 'a.txt', 'b.txt'] }, [wa]).linked, ['a.txt', 'b.txt']);
  const many = Array.from({ length: 30 }, (_, i) => 'f' + i + '.txt');
  const got = L.sanitizeSettings({ linked: many }, [wa]).linked;
  assert.equal(got.length, 20);
  assert.equal(got[19], 'f29.txt');
  assert.equal(L.sanitizeSettings({ linked: ['x'.repeat(5000)] }, [wa]).linked.length, 0, 'absurd path dropped');
});

test('addLinked: appends, moves a repeat to the end, ignores junk, caps at 20', () => {
  assert.deepEqual(L.addLinked([], 'a'), ['a']);
  assert.deepEqual(L.addLinked(['a', 'b'], 'a'), ['b', 'a']);
  assert.deepEqual(L.addLinked(['a'], null), ['a']);
  assert.deepEqual(L.addLinked(['a'], 42), ['a']);
  const full = Array.from({ length: 20 }, (_, i) => 'f' + i);
  const next = L.addLinked(full, 'new');
  assert.equal(next.length, 20);
  assert.equal(next[19], 'new');
  assert.ok(!next.includes('f0'));
});

test('childEnv: drops GEMINI_*, PENSUM_* and anything key/token/secret/password-shaped; keeps the rest', () => {
  const env = {
    PATH: 'C:/Windows', SystemRoot: 'C:/Windows', TEMP: 'C:/t', USERPROFILE: 'C:/u',
    GEMINI_API_KEY: 'AIzaX', gemini_model: 'x', PENSUM_MOCK: '1', PENSUM_TEST: '1',
    GITHUB_TOKEN: 't', AWS_SECRET_ACCESS_KEY: 's', DB_PASSWORD: 'p', OPENAI_API_KEY: 'k', my_api_key: 'k',
  };
  const out = L.childEnv(env);
  assert.deepEqual(Object.keys(out).sort(), ['PATH', 'SystemRoot', 'TEMP', 'USERPROFILE']);
  assert.equal(out.PATH, 'C:/Windows');
  assert.deepEqual(L.childEnv(undefined), {});
  assert.equal(env.GEMINI_API_KEY, 'AIzaX', 'input not mutated');
});

test('vercel.json sets the security headers on every path', () => {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rule = (v.headers || []).find((h) => h.source === '/(.*)');
  assert.ok(rule, 'a catch-all headers rule');
  const h = Object.fromEntries(rule.headers.map((x) => [x.key, x.value]));
  assert.equal(h['X-Content-Type-Options'], 'nosniff');
  assert.equal(h['Referrer-Policy'], 'no-referrer');
  assert.equal(h['X-Frame-Options'], 'DENY');
  assert.equal(h['Content-Security-Policy'], "frame-ancestors 'none'");
});


