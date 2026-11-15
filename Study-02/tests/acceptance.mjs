// Acceptance tests for the to-do app.
// Plain Node (v22+), no npm packages. Drives a real headless Chrome through the
// DevTools protocol with real mouse/keyboard events and real page reloads.
//
// Run from the project folder:   node tests/acceptance.mjs
// Custom Chrome location:        CHROME_PATH="/path/to/chrome" node tests/acceptance.mjs

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Which edition to test: the project root (default) or e.g. APP_DIR=web_version
const APP_DIR = join(ROOT, process.env.APP_DIR || '');
const IS_DESKTOP = (process.env.APP_DIR || '').replace(/\/$/, '') === 'web_version';
const APP_URL = pathToFileURL(join(APP_DIR, 'index.html')).href;
const WORK = mkdtempSync(join(tmpdir(), 'todo-tests-'));
const DOWNLOADS = join(WORK, 'downloads');
mkdirSync(DOWNLOADS);

/* ---------- Find and launch Chrome ---------- */

const CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);
const CHROME = CANDIDATES.find((p) => existsSync(p));
if (!CHROME) { console.error('Chrome not found. Set CHROME_PATH.'); process.exit(2); }

const PORT = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${join(WORK, 'profile')}`,
  '--no-first-run', '--no-default-browser-check', '--window-size=640,900', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let page;
for (let i = 0; i < 75 && !page; i++) {
  try { page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page'); } catch { /* not up yet */ }
  if (!page) await sleep(200);
}
if (!page) { console.error('Could not connect to Chrome.'); chrome.kill(); process.exit(2); }

/* ---------- DevTools protocol plumbing ---------- */

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0;
const pending = new Map();
let consoleErrors = [];
let dialogs = [];
let acceptDialogs = true;
ws.addEventListener('message', (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'log', 'warn'].includes(msg.params.type)) consoleErrors.push(`console.${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') consoleErrors.push(msg.params.entry.text);
  if (msg.method === 'Page.javascriptDialogOpening') {
    dialogs.push(msg.params.message);
    send('Page.handleJavaScriptDialog', { accept: acceptDialogs });
  }
});
function send(method, params = {}) {
  return new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
}
async function ev(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.result.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description || 'evaluate failed: ' + expression);
  return r.result.result.value;
}

/* ---------- Real input helpers ---------- */

async function center(sel) {
  const p = await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null;
    el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
  if (!p) throw new Error('Element not found: ' + sel);
  return p;
}
async function click(sel, count = 1) {
  const { x, y } = await center(sel);
  for (let c = 1; c <= count; c++) {
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: c });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: c });
  }
  await sleep(60);
}
const type = (text) => send('Input.insertText', { text });
const KEYS = {
  Enter: { code: 'Enter', keyCode: 13, text: '\r' }, Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 }, Backspace: { code: 'Backspace', keyCode: 8 },
};
async function key(name, modifiers = 0) {
  const k = KEYS[name];
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: name, code: k.code, windowsVirtualKeyCode: k.keyCode, text: k.text, modifiers });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: k.code, windowsVirtualKeyCode: k.keyCode, modifiers });
  await sleep(60);
}
async function clearField() { await ev(`document.activeElement.select()`); await key('Backspace'); }
async function setStorage(obj) { await ev(`localStorage.setItem('todo-app:v1', ${JSON.stringify(typeof obj === 'string' ? obj : JSON.stringify(obj))})`); }
const stored = async () => JSON.parse(await ev(`localStorage.getItem('todo-app:v1')`));
const progressText = () => ev(`document.getElementById('progress-text').textContent`);
const titles = () => ev(`[...document.querySelectorAll('#task-list .task-title')].map(e => e.textContent)`);
async function open(seed) {
  await send('Page.navigate', { url: APP_URL });
  await sleep(500);
  if (seed !== undefined) {
    if (seed === null) await ev(`localStorage.clear()`); else await setStorage(seed);
    await send('Page.reload'); await sleep(500);
  }
}
async function reload() { await send('Page.reload'); await sleep(500); }
async function addViaKeyboard(title) { await click('#task-input'); await type(title); await key('Enter'); }

/* ---------- Test runner ---------- */

const results = [];
async function test(name, fn) {
  const failures = [];
  const expect = (cond, msg) => { if (!cond) failures.push(msg); };
  try { await fn(expect); } catch (e) { failures.push('threw: ' + e.message); }
  results.push({ name, failures });
}
const iso = (daysAgo, hour = 12) => { const d = new Date(); d.setDate(d.getDate() - daysAgo); d.setHours(hour, 0, 0, 0); return d.toISOString(); };
const EMPTY = { version: 1, categories: ['work', 'personal', 'study'], tasks: [] };

await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DOWNLOADS });

/* ====================== Part B: acceptance tests ====================== */

await test('1. Adding a task persists after reload', async (expect) => {
  await open(null);
  await addViaKeyboard('Buy milk');
  expect((await titles()).includes('Buy milk'), 'task not shown after add');
  expect((await stored())?.tasks.some((t) => t.title === 'Buy milk'), 'task not in localStorage');
  await reload();
  expect((await titles()).includes('Buy milk'), 'task missing after reload');
});

await test('2. Empty or spaces-only titles are rejected', async (expect) => {
  await open(EMPTY);
  await click('#task-input'); await key('Enter');
  await type('     '); await key('Enter');
  await click('#add-form .btn-primary');
  expect((await titles()).length === 0, 'a blank task was added');
  expect((await stored()).tasks.length === 0, 'a blank task was saved');
  expect(await ev(`document.activeElement.id === 'task-input'`), 'focus left the input');
});

await test('3. Editing to an empty title keeps the old title', async (expect) => {
  await open(EMPTY);
  await addViaKeyboard('Original title');
  await click('#task-list .task-edit');
  await clearField(); await key('Enter');
  expect((await titles())[0] === 'Original title', 'shown title changed: ' + (await titles())[0]);
  expect((await stored()).tasks[0].title === 'Original title', 'stored title changed');
  // also via double-click + spaces + Save button
  await click('#task-list .task-title', 2);
  await clearField(); await type('   '); await click('#task-list [data-action="save"]');
  expect((await titles())[0] === 'Original title', 'Save button accepted blank title');
});

await test('4. Deleting removes the task from storage', async (expect) => {
  await open(EMPTY);
  await addViaKeyboard('Keep'); await addViaKeyboard('Remove me');
  const id = (await stored()).tasks[1].id;
  await click('#task-list .task:nth-child(2) .task-delete');
  expect((await stored()).tasks.length === 2, 'deleted on first click (no confirmation)');
  await click('#task-list .task:nth-child(2) .task-delete');
  const s = await stored();
  expect(s.tasks.length === 1 && !s.tasks.some((t) => t.id === id), 'task still in storage');
  await reload();
  expect(!(await titles()).includes('Remove me'), 'task back after reload');
});

await test('5. Toggling updates counts and progress immediately', async (expect) => {
  await open(EMPTY);
  await addViaKeyboard('A');
  await ev(`(() => { const s = document.getElementById('task-category'); s.value = 'study'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await addViaKeyboard('B');
  expect((await progressText()) === '0 of 2 done (0%)', 'before: ' + (await progressText()));
  await click('#task-list .task:nth-child(1) .task-check');
  expect((await progressText()) === '1 of 2 done (50%)', 'after tick: ' + (await progressText()));
  expect(await ev(`document.getElementById('progress-fill').style.width === '50%'`), 'bar width not 50%');
  expect(await ev(`document.getElementById('progress-bar').getAttribute('aria-valuenow') === '50'`), 'aria-valuenow not 50');
  const chips = await ev(`[...document.querySelectorAll('.cat-count')].map(e => e.textContent)`);
  expect(chips.includes('work: 1/1') && chips.includes('study: 0/1'), 'counts: ' + chips.join(', '));
  expect((await stored()).tasks[0].done === true && !!(await stored()).tasks[0].completedAt, 'tick not saved');
  await click('#task-list .task:nth-child(1) .task-check');
  expect((await progressText()) === '0 of 2 done (0%)', 'after untick: ' + (await progressText()));
  expect((await stored()).tasks[0].completedAt === null, 'completedAt not cleared');
});

await test('6. New category via + persists and appears everywhere; duplicates/empty rejected', async (expect) => {
  await open(EMPTY);
  await click('#add-category-btn');
  expect(await ev(`!document.getElementById('category-form').hidden`), 'form did not open');
  expect(await ev(`document.activeElement.id === 'new-category-input'`), 'focus not in new category input');
  await type('Groceries'); await key('Enter');
  const inAll = async () => ({
    select: await ev(`[...document.getElementById('task-category').options].some(o => o.value === 'Groceries')`),
    filter: await ev(`[...document.getElementById('filter-category').options].some(o => o.value === 'Groceries')`),
    progress: await ev(`[...document.querySelectorAll('.cat-count')].some(e => e.textContent.startsWith('Groceries:'))`),
  });
  let where = await inAll();
  expect(where.select && where.filter && where.progress, 'missing from: ' + JSON.stringify(where));
  expect(await ev(`document.getElementById('task-category').value === 'Groceries'`), 'new category not selected');
  expect((await stored()).categories.includes('Groceries'), 'not saved');
  await reload();
  where = await inAll();
  expect(where.select && where.filter && where.progress, 'missing after reload: ' + JSON.stringify(where));

  // duplicates ignoring case, and empty
  for (const bad of ['groceries', '  WORK  ', '', '   ']) {
    await click('#add-category-btn');
    if (bad) await type(bad);
    await key('Enter');
    const err = await ev(`document.getElementById('category-error').textContent`);
    expect(err.length > 0, `"${bad}" gave no error`);
    expect(await ev(`!document.getElementById('category-form').hidden`), `form closed after "${bad}"`);
    await key('Escape');
  }
  expect((await stored()).categories.length === 4, 'categories now: ' + (await stored()).categories.join(','));
  expect(await ev(`document.getElementById('category-form').hidden`), 'Esc did not close the form');
  expect(await ev(`document.activeElement.id === 'add-category-btn'`), 'focus not back on + after Esc');

  // used by a task + filter
  await ev(`(() => { const s = document.getElementById('task-category'); s.value = 'Groceries'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await addViaKeyboard('Apples');
  await addViaKeyboard('x'); await click('#task-list .task:nth-child(2) .task-edit');
  await ev(`document.querySelector('.task-edit-select').value = 'work'`); await click('.task-edit-input'); await key('Enter');
  await ev(`(() => { const s = document.getElementById('filter-category'); s.value = 'Groceries'; s.dispatchEvent(new Event('change')); })()`);
  expect(JSON.stringify(await titles()) === '["Apples"]', 'filter shows: ' + JSON.stringify(await titles()));
  expect(await ev(`[...document.querySelectorAll('.cat-count')].some(e => e.textContent === 'Groceries: 0/1')`), 'progress chip not updated');
});

await test('7. Open task from yesterday is in Today with "from" badge; done-yesterday only in All', async (expect) => {
  await open({ version: 1, categories: ['work', 'personal', 'study'], tasks: [
    { id: 'open-y', title: 'Open from yesterday', category: 'work', done: false, createdAt: iso(1), completedAt: null },
    { id: 'done-y', title: 'Done yesterday', category: 'work', done: true, createdAt: iso(1), completedAt: iso(1, 18) },
    { id: 'today', title: 'Made today', category: 'study', done: false, createdAt: new Date().toISOString(), completedAt: null },
    { id: 'old-done-today', title: 'Old but done today', category: 'study', done: true, createdAt: iso(3), completedAt: new Date().toISOString() },
  ] });
  expect(await ev(`document.getElementById('tab-today').getAttribute('aria-selected') === 'true'`), 'Today is not the default view');
  let t = await titles();
  expect(t.includes('Open from yesterday'), 'open-yesterday missing from Today');
  expect(!t.includes('Done yesterday'), 'done-yesterday shown in Today');
  expect(t.includes('Made today') && t.includes('Old but done today'), 'today tasks missing: ' + t.join(', '));
  const badge = await ev(`(() => { const b = document.querySelector('[data-id="open-y"] .from-badge'); return b && !b.hidden ? b.textContent : null; })()`);
  expect(badge && badge.startsWith('from '), 'badge: ' + badge);
  expect(await ev(`document.querySelector('[data-id="today"] .from-badge').hidden`), 'today task has a badge');
  await click('#tab-all');
  t = await titles();
  expect(t.length === 4 && t.includes('Done yesterday'), 'All shows: ' + t.join(', '));
});

await test('8. With zero tasks progress shows "No tasks yet" with no console errors', async (expect) => {
  await open(null);
  consoleErrors = [];
  await reload();
  expect((await progressText()) === 'No tasks yet', 'progress: ' + (await progressText()));
  expect(await ev(`getComputedStyle(document.getElementById('empty-state')).display !== 'none'`), 'empty state hidden');
  expect(await ev(`document.getElementById('progress-fill').style.width === '0%'`), 'bar not 0%');
  await click('#tab-all'); await click('#tab-today');
  expect(!(await progressText()).includes('NaN'), 'NaN in progress');
  expect(consoleErrors.length === 0, 'console: ' + consoleErrors.join(' | '));
});

await test('9. A title or category name containing <script> shows as plain text', async (expect) => {
  await open(EMPTY);
  const evilTitle = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">';
  const evilCat = '<script>x</script>';
  await click('#add-category-btn'); await type(evilCat); await key('Enter');
  await addViaKeyboard(evilTitle);
  expect((await titles())[0] === evilTitle, 'title not shown literally');
  expect(await ev(`document.querySelector('#task-list .cat-label').textContent === ${JSON.stringify(evilCat)}`), 'category label not literal');
  expect(await ev(`document.querySelectorAll('#task-list script, #task-list img, .category-counts script, select script').length === 0`), 'markup was injected');
  expect(await ev(`[...document.getElementById('filter-category').options].some(o => o.textContent === ${JSON.stringify(evilCat)})`), 'filter option not literal');
  await click('#task-list .task-edit');
  expect(await ev(`document.querySelector('.task-edit-input').value === ${JSON.stringify(evilTitle)}`), 'edit box not literal');
  await key('Escape');
  await reload();
  expect((await titles())[0] === evilTitle, 'not literal after reload');
  expect(await ev(`window.__xss === undefined`), 'script ran');
});

await test('10. Corrupt localStorage does not crash the app, and a backup key is written', async (expect) => {
  consoleErrors = [];
  await open('{"version":1,"tasks":[{"id":');
  expect(await ev(`localStorage.getItem('todo-app:v1:backup') === '{"version":1,"tasks":[{"id":'`), 'backup not written');
  expect(await ev(`!!document.querySelector('.banner[data-banner="corrupt"]')`), 'no banner');
  expect((await progressText()) === 'No tasks yet', 'progress: ' + (await progressText()));
  await addViaKeyboard('Still works');
  expect((await titles()).includes('Still works'), 'app unusable after corrupt load');
  expect(consoleErrors.length === 0, 'console: ' + consoleErrors.join(' | '));
});

await test('11. Export then import restores all tasks, categories and settings exactly', async (expect) => {
  const original = { version: 1, categories: ['work', 'personal', 'study', 'Garden'], tasks: [
    { id: 't1', title: 'Water plants', category: 'Garden', done: true, createdAt: iso(2), completedAt: iso(1) },
    { id: 't2', title: 'Report "Q4" & <notes>', category: 'work', done: false, createdAt: iso(0, 9), completedAt: null },
    { id: 't3', title: 'Read', category: 'study', done: false, createdAt: iso(5), completedAt: null },
  ], settings: { theme: 'dark', autoCategory: false, keywords: {
    work: ['meeting', 'standup'], personal: ['gym'], study: [], Garden: ['plants', 'weed'] } } };
  await open(original);
  for (const f of readdirSync(DOWNLOADS)) rmSync(join(DOWNLOADS, f));
  await click('#export-btn'); await sleep(1000);
  const files = readdirSync(DOWNLOADS);
  const name = await ev(`'todo-app-backup-' + dayKey(new Date()) + '.json'`);
  expect(files.includes(name), 'download: ' + files.join(','));
  if (!files.includes(name)) return;
  const exported = JSON.parse(readFileSync(join(DOWNLOADS, name), 'utf8'));
  expect(JSON.stringify(exported) === JSON.stringify(original), 'export differs from data');

  // wipe and change things, then import
  await setStorage({ version: 1, categories: ['work'], tasks: [{ id: 'z', title: 'Other', category: 'work' }] });
  await reload();
  acceptDialogs = true; dialogs = [];
  const { result: { root } } = await send('DOM.getDocument');
  const { result: { nodeId } } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: '#import-file' });
  await send('DOM.setFileInputFiles', { nodeId, files: [join(DOWNLOADS, name)] });
  await sleep(600);
  expect(dialogs.length === 1, 'no confirmation asked');
  expect(JSON.stringify(await stored()) === JSON.stringify(original), 'storage differs after import');
  expect(JSON.stringify(await ev('serializeState()')) === JSON.stringify(original), 'state differs after import');
  await reload();
  expect(JSON.stringify(await ev('serializeState()')) === JSON.stringify(original), 'differs after reload');
});

await test('12. Category colours: defaults keep theirs, new ones follow a fixed palette (>= 8) and repeat', async (expect) => {
  const extras = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'];
  await open({ version: 1, categories: ['work', 'personal', 'study', ...extras], tasks: [] });
  // 9th and 10th custom categories added through the UI
  for (const name of ['e9', 'e10']) { await click('#add-category-btn'); await type(name); await key('Enter'); }
  const bg = await ev(`Object.fromEntries([...document.querySelectorAll('.cat-count')].map(e => [e.textContent.split(':')[0], e.style.getPropertyValue('--cat-bg')]))`);
  expect(bg.work === '#dbeafe' && bg.personal === '#dcfce7' && bg.study === '#f3e8ff', 'default colours changed: ' + JSON.stringify(bg));
  const extraColours = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8', 'e9'].map((n) => bg[n]);
  expect(new Set(extraColours).size === 9, 'first 9 custom colours not distinct: ' + extraColours.join(','));
  expect(!extraColours.some((c) => [bg.work, bg.personal, bg.study].includes(c)), 'custom colour reuses a default');
  expect(bg.e10 === bg.e1, 'palette does not repeat after exhaustion');
  expect(await ev(`document.getElementById('task-category').value === 'e10'`), 'new category not selected');
  await addViaKeyboard('t'); await click('#task-list .task-edit');
  expect(await ev(`[...document.querySelector('.task-edit-select').options].some(o => o.value === 'e10')`), 'missing from edit select');
  await key('Escape');
  // over 20 characters cannot be typed (maxlength), so a 25-char paste is cut to 20
  await click('#add-category-btn'); await type('x'.repeat(25)); await key('Enter');
  expect((await stored()).categories.includes('x'.repeat(20)), 'long name not limited to 20');
});

await test('13. Progress per view (before filters) and carried-over count', async (expect) => {
  await open({ version: 1, categories: ['work', 'personal', 'study'], tasks: [
    { id: 'old-open', title: 'Old open', category: 'work', done: false, createdAt: iso(3), completedAt: null },
    { id: 'done-today', title: 'Done today', category: 'work', done: true, createdAt: iso(2), completedAt: new Date().toISOString() },
    { id: 'done-y', title: 'Done yesterday', category: 'study', done: true, createdAt: iso(1), completedAt: iso(1) },
    { id: 'new-open', title: 'New open', category: 'study', done: false, createdAt: new Date().toISOString(), completedAt: null },
  ] });
  expect((await progressText()) === '1 of 3 done (33%)', 'Today: ' + (await progressText()));
  expect(await ev(`document.getElementById('carried-over').textContent === '1 task carried over from an earlier day' && !document.getElementById('carried-over').hidden`),
    'carried-over: ' + (await ev(`document.getElementById('carried-over').textContent`)));
  const chips = await ev(`[...document.querySelectorAll('.cat-count')].map(e => e.textContent)`);
  expect(chips.includes('work: 1/2') && chips.includes('study: 0/1'), 'Today chips: ' + chips.join(', '));
  await ev(`(() => { const s = document.getElementById('filter-category'); s.value = 'study'; s.dispatchEvent(new Event('change')); })()`);
  expect((await progressText()) === '1 of 3 done (33%)', 'filter changed progress: ' + (await progressText()));
  expect(JSON.stringify(await titles()) === '["New open"]', 'filter in Today shows: ' + JSON.stringify(await titles()));
  await click('#tab-all');
  expect((await progressText()) === '2 of 4 done (50%)', 'All: ' + (await progressText()));
  expect(JSON.stringify(await titles()) === '["Done yesterday","New open"]', 'filter in All shows: ' + JSON.stringify(await titles()));
  expect(await ev(`document.getElementById('carried-over').hidden`), 'carried-over shown in All');
  // Today with nothing to count -> "No tasks yet"
  await open({ version: 1, categories: ['work'], tasks: [
    { id: 'y', title: 'Done yesterday', category: 'work', done: true, createdAt: iso(1), completedAt: iso(1) },
  ] });
  expect((await progressText()) === 'No tasks yet', 'empty Today: ' + (await progressText()));
});

await test('14. Past midnight (checked on window focus) the date and Today view update', async (expect) => {
  await open({ version: 1, categories: ['work'], tasks: [
    { id: 'open-now', title: 'Open today', category: 'work', done: false, createdAt: new Date().toISOString(), completedAt: null },
    { id: 'done-now', title: 'Done today', category: 'work', done: true, createdAt: new Date().toISOString(), completedAt: new Date().toISOString() },
  ] });
  const dateBefore = await ev(`document.getElementById('today-date').textContent`);
  expect((await titles()).length === 2, 'setup');
  // Move the page's clock forward one day, then focus the window.
  await ev(`(() => { const Real = Date, shift = 86400000;
    window.Date = class extends Real { constructor(...a) { super(...(a.length ? a : [Real.now() + shift])); } static now() { return Real.now() + shift; } };
    window.dispatchEvent(new Event('focus')); })()`);
  await sleep(100);
  expect((await ev(`document.getElementById('today-date').textContent`)) !== dateBefore, 'header date did not change');
  expect(JSON.stringify(await titles()) === '["Open today"]', 'Today now shows: ' + JSON.stringify(await titles()));
  expect(await ev(`!document.querySelector('[data-id="open-now"] .from-badge').hidden`), 'no "from" badge on yesterday\'s open task');
  expect((await stored()).tasks.length === 2, 'tasks were changed in storage');
  await click('#tab-all');
  expect((await titles()).length === 2, 'All lost a task');
});

const categoryNow = () => ev(`document.getElementById('task-category').value`);
const hintNow = () => ev(`document.getElementById('category-hint').textContent`);
async function retype(text) { await click('#task-input'); await ev(`document.getElementById('task-input').select()`); await key('Backspace'); if (text) await type(text); }
const pick = (id, value) => ev(`(() => { const s = document.getElementById('${id}'); s.value = ${JSON.stringify(value)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);

await test('15. Keyword-based automatic category', async (expect) => {
  await open(null);
  await retype('Team meeting at 3');
  expect((await categoryNow()) === 'work', '"meeting" -> ' + (await categoryNow()));
  expect((await hintNow()).includes('"work"') && (await hintNow()).includes('"meeting"'), 'hint: ' + (await hintNow()));
  await retype('Buy milk');
  expect((await categoryNow()) === 'personal', '"buy" -> ' + (await categoryNow()));
  await retype('Finish HOMEWORK chapter 3');
  expect((await categoryNow()) === 'study', 'case-insensitive "homework" -> ' + (await categoryNow()));
  await retype('Prepare slides for meetings');
  expect((await categoryNow()) === 'work', 'plural "meetings" -> ' + (await categoryNow()));
  await retype('Examples xyz');
  expect((await categoryNow()) === 'work' && (await hintNow()) === '', 'partial word matched: ' + (await categoryNow()));

  await retype('Dentist appointment'); await key('Enter');
  expect((await stored()).tasks[0].category === 'personal', 'saved as ' + (await stored()).tasks[0].category);
  expect((await categoryNow()) === 'work' && (await hintNow()) === '', 'form did not reset after adding');

  // A manual pick wins and becomes the default for the next task
  await retype('Email the client');
  await pick('task-category', 'study');
  await type(' about the exam');
  expect((await categoryNow()) === 'study' && (await hintNow()) === '', 'manual pick overridden: ' + (await categoryNow()));
  await key('Enter');
  expect((await stored()).tasks[1].category === 'study', 'manual pick not saved');
  await retype('Pay rent');
  expect((await categoryNow()) === 'personal', 'suggestions did not resume');
  await retype('zzz');
  expect((await categoryNow()) === 'study', 'no match did not fall back to last manual pick');

  // A custom category matches its own name and beats built-in keywords
  await click('#add-category-btn'); await type('Groceries'); await key('Enter');
  await retype('x'); await key('Enter');
  await retype('buy groceries');
  expect((await categoryNow()) === 'Groceries', 'custom name -> ' + (await categoryNow()));
});

await test('16. Auto-category can be switched off and on, and the choice is saved', async (expect) => {
  await open(null);
  expect(await ev(`document.getElementById('auto-category-toggle').checked`), 'not on by default');
  await click('#auto-settings summary');
  await retype('Team meeting');
  expect((await categoryNow()) === 'work' && (await hintNow()) !== '', 'setup');
  await pick('task-category', 'personal'); // make the base category differ from the suggestion
  await retype('x'); await key('Enter');
  await retype('Team meeting');
  expect((await categoryNow()) === 'work', 'setup 2');
  await click('#auto-category-toggle');
  expect((await stored()).settings.autoCategory === false, 'off not saved');
  expect((await categoryNow()) === 'personal', 'switching off did not undo the applied suggestion: ' + (await categoryNow()));
  expect((await hintNow()) === '', 'hint still shown when off');
  expect(await ev(`!document.getElementById('auto-off-note').hidden`), 'no "off" note');
  await retype('Homework for class');
  expect((await categoryNow()) === 'personal', 'suggested while off: ' + (await categoryNow()));
  await reload();
  expect(!(await ev(`document.getElementById('auto-category-toggle').checked`)), 'off lost on reload');
  await click('#auto-settings summary');
  await retype('Homework for class');
  expect((await categoryNow()) !== 'study', 'suggested after reload while off');
  await click('#auto-category-toggle');
  expect((await categoryNow()) === 'study', 'switching on did not suggest for the typed title: ' + (await categoryNow()));
  expect((await stored()).settings.autoCategory === true, 'on not saved');
});

await test('17. Keyword lists can be edited per category (incl. custom), saved, and reset', async (expect) => {
  await open(null);
  await click('#auto-settings summary');
  const box = (c) => `.keyword-input[data-category="${c}"]`;
  expect((await ev(`document.querySelector('${box('work')}').value`)).includes('meeting'), 'default work keywords not shown');
  // Replace work's list; "Meeting" no longer matches, new words do
  await click(box('work')); await ev(`document.activeElement.select()`);
  await type('Standup,  JIRA , standup, , ' + 'x'.repeat(40));
  await key('Tab'); // leaving the box saves it
  const saved = (await stored()).settings.keywords.work;
  expect(JSON.stringify(saved) === JSON.stringify(['standup', 'jira', 'x'.repeat(30)]), 'cleaned list: ' + JSON.stringify(saved));
  expect((await ev(`document.querySelector('${box('work')}').value`)) === 'standup, jira, ' + 'x'.repeat(30), 'box not tidied');
  expect((await ev(`document.getElementById('keyword-status').textContent`)).includes('3 keywords') , 'no saved message');
  expect(await ev(`document.activeElement.matches('${box('personal')}')`), 'focus lost after saving (Tab should reach the next box)');
  await retype('Update JIRA ticket');
  expect((await categoryNow()) === 'work', 'new keyword not used: ' + (await categoryNow()));
  await retype('Team meeting');
  expect((await hintNow()) === '', 'removed keyword still used');
  // A word typed into a box but not saved is undone with Esc
  await click(box('study')); await type(', zebra'); await key('Escape');
  expect(!(await ev(`document.querySelector('${box('study')}').value`)).includes('zebra'), 'Esc did not undo');
  // Ctrl+Enter saves
  await click(box('personal')); await ev(`document.activeElement.value = 'gym'`); await key('Enter', 2 /* Ctrl */);
  expect(JSON.stringify((await stored()).settings.keywords.personal) === '["gym"]', 'Ctrl+Enter did not save');
  // A new category gets its own (empty) box; keywords can be added to it
  await click('#add-category-btn'); await type('Garden'); await key('Enter');
  expect(await ev(`!!document.querySelector('${box('Garden')}')`), 'no box for new category');
  await click(box('Garden')); await type('plants, weeding'); await key('Tab');
  await retype('x'); await key('Enter'); // clear the manual pick from adding the category
  await retype('Water the plants');
  expect((await categoryNow()) === 'Garden', 'custom keywords not used: ' + (await categoryNow()));
  // Saved across reload
  await reload();
  expect((await ev(`document.querySelector('${box('Garden')}').value`)) === 'plants, weeding', 'custom keywords lost on reload');
  expect((await ev(`document.querySelector('${box('work')}').value`)).startsWith('standup'), 'work keywords lost on reload');
  // Reset
  acceptDialogs = true; dialogs = [];
  await click('#auto-settings summary');
  await click('#reset-keywords-btn');
  expect(dialogs.length === 1, 'reset did not ask first');
  const kw = (await stored()).settings.keywords;
  expect(kw.work.includes('meeting') && kw.Garden.length === 0, 'reset result: ' + JSON.stringify(kw).slice(0, 120));
  // Keywords and names as plain text
  await click('#add-category-btn'); await type('<b>x</b>'); await key('Enter');
  expect(await ev(`document.querySelectorAll('#keyword-fields b').length === 0`), 'category name injected as HTML in settings');
});

// WCAG contrast of each element's text against its painted background.
const CONTRAST_JS = `(() => {
  const parse = (c) => { const m = c.match(/[\\d.]+/g).map(Number);
    return c.startsWith('color(') ? { r: m[0] * 255, g: m[1] * 255, b: m[2] * 255, a: m[3] ?? 1 } : { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }) => [r, g, b].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return { r: 255, g: 255, b: 255 }; };
  const sel = '.app-title, .today-date, .progress-text, .carried-over, .cat-count, .theme-picker label, .field-hint, .tab, .filter label, .btn, .task-title, .cat-label, .from-badge, .empty-state, .banner-text, .settings-summary, .toggle-row span, .keyword-label, .keyword-input';
  return [...document.querySelectorAll(sel)].filter(e => e.offsetParent !== null && e.textContent.trim() + (e.value || '')).map(e => {
    const a = lum(parse(getComputedStyle(e).color)), b = lum(bgOf(e));
    return { el: (e.className || e.tagName) + ' "' + (e.textContent.trim() || e.value).slice(0, 18) + '"', ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  }).filter(x => x.ratio < 4.5).map(x => x.el + ' ' + x.ratio.toFixed(2));
})()`;

await test('18. Dark mode: System / Light / Dark, saved, follows the OS, readable', async (expect) => {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await open('{bad'); // corrupt -> banner, so banners are checked too
  await setStorage({ version: 1, categories: ['work', 'personal', 'study', 'Garden'], tasks: [
    { id: 'o', title: 'Old open', category: 'Garden', done: false, createdAt: iso(2) },
    { id: 'd', title: 'Done', category: 'work', done: true, createdAt: iso(0), completedAt: iso(0) },
  ] });
  await send('Page.navigate', { url: APP_URL }); await sleep(500);
  await ev(`localStorage.setItem('todo-app:v1:x', '1')`);
  const theme = () => ev(`document.documentElement.dataset.theme`);
  const contrastCheck = async (label) => {
    await click('#auto-settings summary');
    await retype('meeting'); // show the hint line
    const low = await ev(CONTRAST_JS);
    expect(low.length === 0, label + ' contrast < 4.5: ' + low.join('; '));
    await click('#auto-settings summary');
  };
  expect((await ev(`document.getElementById('theme-select').value`)) === 'system', 'default is not System');
  expect((await theme()) === 'light', 'System + OS light -> ' + (await theme()));
  await contrastCheck('light');
  const lightShot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(WORK, 'light.png'), Buffer.from(lightShot.result.data, 'base64'));

  await pick('theme-select', 'dark');
  expect((await theme()) === 'dark', 'Dark not applied');
  expect((await ev(`getComputedStyle(document.body).backgroundColor`)) === 'rgb(11, 17, 32)', 'body background not dark');
  expect((await stored()).settings?.theme === 'dark', 'theme not saved');
  await contrastCheck('dark');
  await click('#auto-settings summary');
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  writeFileSync(join(WORK, 'dark.png'), Buffer.from(shot.result.data, 'base64'));

  await reload();
  expect((await theme()) === 'dark' && (await ev(`document.getElementById('theme-select').value`)) === 'dark', 'Dark lost on reload');
  await pick('theme-select', 'light');
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await sleep(100);
  expect((await theme()) === 'light', 'Light did not override OS dark');
  await pick('theme-select', 'system');
  expect((await theme()) === 'dark', 'System + OS dark -> ' + (await theme()));
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await sleep(100);
  expect((await theme()) === 'light', 'did not follow a live OS change');
  await send('Emulation.setEmulatedMedia', { features: [] });
});

/* ====================== Part A: polish checks ====================== */

await test('A1. No innerHTML, console.* or debugger in app.js', async (expect) => {
  const src = readFileSync(join(APP_DIR, 'app.js'), 'utf8').replace(/\/\/.*$/gm, '');
  expect(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(src), 'HTML-string API found');
  expect(!/console\.|debugger/.test(src), 'console/debugger found');
});

// Puts the page in a "busy" state: several tasks, one being edited, + form open.
async function busyPage() {
  await open({ version: 1, categories: ['work', 'personal', 'study', 'A very long name xx'], tasks: [
    { id: 'a', title: 'Short', category: 'work', done: false, createdAt: iso(1) },
    { id: 'b', title: 'W'.repeat(120), category: 'A very long name xx', done: true, createdAt: iso(0), completedAt: iso(0) },
    { id: 'c', title: 'Edit me', category: 'study', done: false, createdAt: iso(0) },
  ] });
  await click('[data-id="c"] .task-edit');
  await click('#add-category-btn');
}

await test('A2. Every control has an accessible name; row buttons say what they act on', async (expect) => {
  await busyPage();
  const unnamed = await ev(`[...document.querySelectorAll('input, select, button')].filter(el => {
    if (el.type === 'file' || el.closest('[hidden]')) return false;
    const name = (el.getAttribute('aria-label') || '').trim()
      || [...(el.labels || [])].map(l => l.textContent).join('').trim()
      || (el.getAttribute('aria-labelledby') || '').split(' ').map(id => document.getElementById(id)?.textContent || '').join('').trim()
      || (el.tagName === 'BUTTON' ? el.textContent.trim() : '');
    return !name;
  }).map(el => el.outerHTML.slice(0, 80))`);
  expect(unnamed.length === 0, 'unnamed: ' + unnamed.join(' | '));
  expect(await ev(`document.querySelector('[data-id="a"] .task-delete').getAttribute('aria-label') === 'Delete task: Short'`), 'delete name');
  expect(await ev(`document.querySelector('[data-id="a"] .task-edit').getAttribute('aria-label') === 'Edit task: Short'`), 'edit name');
  expect(await ev(`document.querySelector('[data-id="a"] .task-check').labels[0].textContent.replace(/\s+/g, ' ').trim() === 'Mark done: Short'`), 'checkbox name');
  expect(await ev(`document.getElementById('progress-text').getAttribute('aria-live') === 'polite'`), 'progress not aria-live');
  // colour is not the only signal: category name as text, done rows struck through, badge has text
  expect(await ev(`[...document.querySelectorAll('#task-list .cat-label')].every(e => e.textContent.trim())`), 'category label without text');
  expect(await ev(`getComputedStyle(document.querySelector('[data-id="b"] .task-title')).textDecorationLine.includes('line-through')`), 'done row not struck through');
});

await test('A3. Mobile 360px: no horizontal scroll, tap targets >= 44px, inputs >= 16px', async (expect) => {
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 2, mobile: true });
  await busyPage();
  expect(await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`),
    'scrollWidth ' + (await ev(`document.documentElement.scrollWidth`)));
  const small = await ev(`[...document.querySelectorAll('button, select, input:not([type=checkbox]):not([type=file]), .task-check-wrap')]
    .filter(el => el.offsetParent !== null)
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width < 44 || r.height < 44)
    .map(({ el, r }) => (el.id || el.className) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height))`);
  expect(small.length === 0, 'small targets: ' + small.join(', '));
  const tiny = await ev(`[...document.querySelectorAll('input, select')].filter(el => el.type !== 'checkbox' && el.type !== 'file' && parseFloat(getComputedStyle(el).fontSize) < 16).map(el => el.id || el.className)`);
  expect(tiny.length === 0, 'inputs under 16px: ' + tiny.join(', '));
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(WORK, 'mobile-360.png'), Buffer.from(shot.result.data, 'base64'));
  await send('Emulation.clearDeviceMetricsOverride');
});

await test('A4. Keyboard: Tab reaches every control in order, with a visible focus ring', async (expect) => {
  await open({ version: 1, categories: ['work', 'personal', 'study'], tasks: [
    { id: 'k', title: 'Keyboard task', category: 'work', done: false, createdAt: new Date().toISOString() },
  ] });
  // Start in the task input, then Tab until focus comes back round to it.
  await ev(`document.getElementById('task-input').focus()`);
  const order = ['task-input'];
  const noRing = [];
  for (let i = 0; i < 25; i++) {
    await key('Tab');
    const info = await ev(`(() => { const el = document.activeElement;
      if (el === document.body || el === document.documentElement) return null; // left the page (browser UI)
      const cs = getComputedStyle(el);
      return { id: el.id || el.className, ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 }; })()`);
    if (!info) continue;
    if (info.id === 'task-input') break;
    order.push(info.id);
    if (!info.ring) noRing.push(info.id);
  }
  const expected = IS_DESKTOP ? [
    // desktop: composer, filters, list, settings column, then (wrapping round) the sidebar
    'task-input', 'task-category', 'add-category-btn', 'btn btn-primary add-btn', 'filter-category', 'filter-status',
    'task-check', 'icon-btn task-edit', 'icon-btn btn-danger task-delete', 'settings-summary',
    'tab-today', 'theme-select', 'export-btn', 'import-btn'] : ['task-input', 'task-category', 'add-category-btn', 'btn btn-primary add-btn', 'settings-summary',
    'tab-today', 'filter-category', 'filter-status',
    'task-check', 'icon-btn task-edit', 'icon-btn btn-danger task-delete', 'export-btn', 'import-btn', 'theme-select'];
  expect(JSON.stringify(order) === JSON.stringify(expected), 'tab order: ' + order.join(' > '));
  expect(noRing.length === 0, 'no visible focus ring on: ' + noRing.join(', '));

  // Keyboard-only flow: add with Enter, edit with Enter, cancel with Esc.
  await click('#task-input'); await type('By keyboard'); await key('Enter');
  expect((await titles()).includes('By keyboard'), 'Enter did not add');
  await ev(`document.querySelector('[data-id="k"] .task-edit').focus()`); await key('Enter');
  expect(await ev(`document.activeElement.classList.contains('task-edit-input')`), 'Enter on Edit did not focus the edit box');
  await type(' changed'); await key('Escape');
  expect((await titles())[0] === 'Keyboard task', 'Esc did not cancel');
  expect(await ev(`document.activeElement.classList.contains('task-edit')`), 'focus not returned to Edit after Esc');
  await key('Enter'); await type('!'); await key('Enter');
  expect((await titles())[0] === 'Keyboard task!', 'Enter did not save: ' + (await titles())[0]);
});

/* ---------- Report ---------- */

ws.close();
chrome.kill();
let failed = 0;
for (const r of results) {
  if (r.failures.length) failed++;
  console.log(`${r.failures.length ? 'FAIL' : 'PASS'}  ${r.name}`);
  for (const f of r.failures) console.log(`        - ${f}`);
}
console.log(`\n${results.length - failed}/${results.length} passed (${process.env.APP_DIR || 'root'} edition)`);
console.log(`(screenshot and downloads in ${WORK})`);
process.exit(failed ? 1 : 0);
