// Personal To-Do app — plain JavaScript, no libraries.
// All user text is inserted with textContent / new Option(); innerHTML is never used.

/* ==================== Constants ==================== */

const DEFAULT_CATEGORIES = ['work', 'personal', 'study'];
const MAX_TITLE = 120;
const MAX_CATEGORY = 20;
const DELETE_CONFIRM_MS = 3000;

const STORAGE_KEY = 'todo-app:v1';
const BACKUP_KEY = 'todo-app:v1:backup';
const STORAGE_VERSION = 1;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

// [background tint, text, accent]. Text on its tint is >= 7:1.
const CATEGORY_COLORS = {
  work:     ['#dbeafe', '#1e3a8a', '#2563eb'],
  personal: ['#dcfce7', '#14532d', '#16a34a'],
  study:    ['#f3e8ff', '#581c87', '#9333ea'],
};
// Fixed palette for categories added with "+", used in order and repeated when exhausted.
const EXTRA_COLORS = [
  ['#ffedd5', '#7c2d12', '#ea580c'], // orange
  ['#fce7f3', '#831843', '#db2777'], // pink
  ['#ccfbf1', '#134e4a', '#0d9488'], // teal
  ['#e0e7ff', '#312e81', '#4f46e5'], // indigo
  ['#fef9c3', '#713f12', '#ca8a04'], // yellow
  ['#fee2e2', '#7f1d1d', '#dc2626'], // red
  ['#cffafe', '#164e63', '#0891b2'], // cyan
  ['#ecfccb', '#365314', '#65a30d'], // lime
  ['#e2e8f0', '#1e293b', '#475569'], // slate
];

const THEMES = ['system', 'light', 'dark'];

// Keyword-based category suggestion. Matching is case-insensitive, on whole
// words (a trailing "s"/"es" is allowed, so "meetings" matches "meeting").
// Every category, including ones added with "+", also matches its own name.
// These are the starting lists; the user edits their own copy in
// state.settings.keywords (the "Auto-category settings" panel).
const MAX_KEYWORD = 30;    // characters per keyword
const MAX_KEYWORDS = 100;  // keywords per category
const DEFAULT_KEYWORDS = {
  work: [
    'work', 'meeting', 'email', 'report', 'client', 'customer', 'project', 'deadline',
    'presentation', 'slides', 'office', 'boss', 'manager', 'colleague', 'invoice',
    'interview', 'standup', 'sprint', 'proposal', 'contract', 'budget', 'review',
  ],
  personal: [
    'buy', 'groceries', 'grocery', 'shopping', 'gym', 'workout', 'run', 'doctor', 'dentist',
    'birthday', 'gift', 'mom', 'dad', 'family', 'friend', 'clean', 'laundry', 'cook',
    'dinner', 'lunch', 'pay', 'bill', 'rent', 'bank', 'haircut', 'vacation', 'trip',
  ],
  study: [
    'study', 'homework', 'exam', 'quiz', 'lecture', 'class', 'course', 'assignment',
    'essay', 'chapter', 'textbook', 'read', 'revise', 'revision', 'notes', 'learn',
    'practice', 'thesis', 'research', 'tutorial', 'flashcard', 'seminar',
  ],
};

/* ==================== State ====================
   `state` is the saved data (exactly what goes into localStorage).
   `ui` holds on-screen settings that are never saved. */

// Keyword lists keyed by category name. A prototype-free object, so a category
// called "__proto__" or "constructor" is just an ordinary key.
function makeKeywordMap(categories, saved = null) {
  const map = Object.create(null);
  for (const c of categories) {
    const list = saved && Object.prototype.hasOwnProperty.call(saved, c) ? cleanKeywordList(saved[c]) : null;
    map[c] = list || [...(DEFAULT_KEYWORDS[c] || [])];
  }
  return map;
}

const state = {
  tasks: [],
  categories: [...DEFAULT_CATEGORIES],
  settings: {
    theme: 'system',      // 'system' | 'light' | 'dark'
    autoCategory: true,   // suggest a category from keywords while typing
    keywords: makeKeywordMap(DEFAULT_CATEGORIES),
  },
};

const ui = {
  view: 'today',          // 'today' | 'all'
  filterCategory: 'all',
  filterStatus: 'all',    // 'all' | 'open' | 'done'
  editingId: null,        // task being edited inline
  focusEditInput: false,  // move focus into the edit box on the next render
  armedDeleteId: null,    // task whose Delete is waiting for a second click
  armedTimer: null,
  categoryFormOpen: false,
  categoryError: '',
  baseCategory: DEFAULT_CATEGORIES[0], // add-form category when no keyword matches (last manual pick)
  categoryTouched: false,  // user picked the category for this task: stop suggesting
  suggestion: null,        // { category, keyword } currently applied to the add form
  renderedDay: '',        // local day ('YYYY-MM-DD') the screen was last drawn for
  keywordFieldsKey: '',   // what the keyword boxes were last built from (avoid rebuilding while typing)
  keywordStatus: '',      // "Saved …" message in the settings panel
};

const $ = (id) => document.getElementById(id);

/* ==================== Helpers ==================== */

function makeId() {
  if (window.crypto && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID(); } catch (e) { /* file:// may refuse: fall through */ }
  }
  return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

function cleanTitle(raw) {
  return String(raw).trim().slice(0, MAX_TITLE);
}

function cleanCategoryName(raw) {
  return String(raw).trim().replace(/\s+/g, ' ').slice(0, MAX_CATEGORY);
}

// Local calendar day as 'YYYY-MM-DD' (sorts correctly as a string).
function dayKey(dateOrIso) {
  const d = new Date(dateOrIso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shortDate(iso) {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function categoryColors(category) {
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category];
  const extras = state.categories.filter((c) => !CATEGORY_COLORS[c]);
  const index = Math.max(0, extras.indexOf(category));
  return EXTRA_COLORS[index % EXTRA_COLORS.length];
}

function applyCategoryColors(el, category) {
  const [bg, fg, accent] = categoryColors(category);
  el.style.setProperty('--cat-bg', bg);
  el.style.setProperty('--cat-fg', fg);
  el.style.setProperty('--cat-accent', accent);
}

// Keywords: strings only, trimmed, lower-case, no duplicates, limited in length and count.
// Returns null if `list` is not an array.
function cleanKeywordList(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const k of list) {
    if (typeof k !== 'string') continue;
    const word = k.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, MAX_KEYWORD);
    if (!word || seen.has(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

// Text typed in a keyword box: words separated by commas or new lines.
function parseKeywordText(text) {
  return cleanKeywordList(String(text).split(/[,\n]/));
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsKeyword(text, keyword) {
  const word = escapeRegExp(keyword.toLowerCase());
  return new RegExp(`(^|[^\\p{L}\\p{N}])${word}(e?s)?(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
}

// Best category for a title. A match on a category's own name beats any
// keyword-only match (so a custom "Groceries" category wins over the built-in
// "groceries" keyword of "personal"); otherwise the most keyword hits win, and
// ties go to the category listed first. Returns { category, keyword } or null.
function suggestCategory(title) {
  const text = title.toLowerCase();
  let best = null;
  for (const category of state.categories) {
    const nameHit = containsKeyword(text, category);
    const keywordHits = (state.settings.keywords[category] || []).filter((k) => containsKeyword(text, k));
    const score = (nameHit ? 1000 : 0) + keywordHits.length;
    if (score > 0 && (!best || score > best.score)) {
      best = { category, keyword: nameHit ? category : keywordHits[0], score };
    }
  }
  return best && { category: best.category, keyword: best.keyword };
}

/* ==================== Validation (stored data and imports) ==================== */

function toIsoOrNull(value) {
  if (typeof value !== 'string') return null;
  const time = Date.parse(value);
  return isNaN(time) ? null : new Date(time).toISOString();
}

// Returns { ok: true, data, dropped } or { ok: false, reason }.
function validateData(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, reason: 'not a JSON object' };
  if (obj.version !== STORAGE_VERSION) return { ok: false, reason: `unsupported version (${obj.version})` };
  if (!Array.isArray(obj.categories)) return { ok: false, reason: 'categories list missing' };
  if (!Array.isArray(obj.tasks)) return { ok: false, reason: 'tasks list missing' };

  // Categories: strings, trimmed, unique ignoring case, "all" is reserved for the filter.
  const categories = [];
  const seenNames = new Set(['all']);
  for (const c of obj.categories) {
    if (typeof c !== 'string') continue;
    const name = cleanCategoryName(c);
    if (!name || seenNames.has(name.toLowerCase())) continue;
    seenNames.add(name.toLowerCase());
    categories.push(name);
  }
  if (categories.length === 0) categories.push(...DEFAULT_CATEGORIES);

  const tasks = [];
  const seenIds = new Set();
  let dropped = 0;

  for (const t of obj.tasks) {
    // Drop entries without a string id and title (also empty titles and duplicate ids).
    const valid = t && typeof t === 'object' && typeof t.id === 'string' && t.id
      && typeof t.title === 'string' && cleanTitle(t.title) && !seenIds.has(t.id);
    if (!valid) { dropped++; continue; }
    seenIds.add(t.id);

    const done = t.done === true;
    tasks.push({
      id: t.id,
      title: cleanTitle(t.title),
      // Unknown category falls back to the first one in the list.
      category: categories.includes(t.category) ? t.category : categories[0],
      done,
      createdAt: toIsoOrNull(t.createdAt) || new Date().toISOString(),
      completedAt: done ? toIsoOrNull(t.completedAt) : null,
    });
  }

  // Settings are optional (older saves and backups have none): fill in defaults.
  const s = obj.settings && typeof obj.settings === 'object' && !Array.isArray(obj.settings) ? obj.settings : {};
  const savedKeywords = s.keywords && typeof s.keywords === 'object' && !Array.isArray(s.keywords) ? s.keywords : null;
  const settings = {
    theme: THEMES.includes(s.theme) ? s.theme : 'system',
    autoCategory: s.autoCategory !== false,
    keywords: makeKeywordMap(categories, savedKeywords),
  };

  return { ok: true, data: { version: STORAGE_VERSION, categories, tasks, settings }, dropped };
}

function serializeState() {
  return { version: STORAGE_VERSION, categories: state.categories, tasks: state.tasks, settings: state.settings };
}

/* ==================== Storage ====================
   loadState() and saveState() are the ONLY functions that touch localStorage. */

function loadState() {
  let raw;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    showStorageProblem();
    return;
  }
  if (raw === null) return; // first visit: keep the empty default state

  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { parsed = undefined; }
  const result = parsed === undefined ? { ok: false } : validateData(parsed);

  if (result.ok) {
    state.categories = result.data.categories;
    state.tasks = result.data.tasks;
    state.settings = result.data.settings;
    return;
  }

  // Corrupt or wrong shape: keep the raw text as a backup and start empty.
  let backedUp = false;
  try {
    localStorage.setItem(BACKUP_KEY, raw);
    backedUp = true;
  } catch (e) {
    showStorageProblem();
  }
  showBanner('corrupt', backedUp
    ? `Your saved tasks could not be read, so the app started empty. A copy of the old data was kept in this browser under "${BACKUP_KEY}".`
    : 'Your saved tasks could not be read, so the app started empty. A backup copy could not be kept.',
  { kind: 'warning', dismissible: true });
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState()));
    hideBanner('storage');
    return true;
  } catch (e) {
    showStorageProblem();
    return false;
  }
}

/* ==================== Banners ==================== */

function showBanner(key, message, { kind = 'warning', dismissible = false } = {}) {
  let banner = document.querySelector(`.banner[data-banner="${key}"]`);
  if (!banner) {
    banner = document.createElement('div');
    banner.dataset.banner = key;
    banner.setAttribute('role', kind === 'success' ? 'status' : 'alert');
    const text = document.createElement('p');
    text.className = 'banner-text';
    banner.appendChild(text);
    if (dismissible) {
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'banner-close';
      close.dataset.dismiss = key;
      close.setAttribute('aria-label', 'Dismiss message');
      close.textContent = '×';
      banner.appendChild(close);
    }
    $('banners').appendChild(banner);
  }
  banner.className = `banner banner-${kind}`;
  banner.querySelector('.banner-text').textContent = message;
}

function hideBanner(key) {
  const banner = document.querySelector(`.banner[data-banner="${key}"]`);
  if (banner) banner.remove();
}

function showStorageProblem() {
  showBanner('storage', 'Your changes cannot be saved in this browser.', { kind: 'error' });
}

/* ==================== Export / Import ==================== */

function exportData() {
  const json = JSON.stringify(serializeState(), null, 2);
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `todo-app-backup-${dayKey(new Date())}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function importFile(file) {
  hideBanner('import');
  if (file.size > MAX_IMPORT_BYTES) {
    showBanner('import', 'That file is too large to be a to-do backup. Nothing was changed.', { kind: 'error', dismissible: true });
    return;
  }

  let result;
  try {
    result = validateData(JSON.parse(await file.text()));
  } catch (e) {
    result = { ok: false, reason: 'not valid JSON' };
  }
  if (!result.ok) {
    showBanner('import', `"${file.name}" is not a valid to-do backup (${result.reason}). Nothing was changed.`, { kind: 'error', dismissible: true });
    return;
  }

  const n = result.data.tasks.length;
  const skipped = result.dropped ? ` ${result.dropped} invalid entr${result.dropped === 1 ? 'y' : 'ies'} will be skipped.` : '';
  const ok = confirm(
    `Replace your current ${state.tasks.length} task(s) with ${n} task(s) from "${file.name}"?${skipped}\n\nThis cannot be undone.`
  );
  if (!ok) return;

  state.categories = result.data.categories;
  state.tasks = result.data.tasks;
  state.settings = result.data.settings;
  ui.editingId = null;
  ui.filterCategory = 'all';
  disarmDelete();
  hideBanner('corrupt');
  const saved = saveState();
  render();
  showBanner('import',
    `Imported ${n} task(s).` + (saved ? '' : ' They will be lost when you close this page.'),
    { kind: 'success', dismissible: true });
}

/* ==================== Actions (change state, save, render) ==================== */

function addTask(title, category) {
  state.tasks.push({
    id: makeId(),
    title,
    category: state.categories.includes(category) ? category : state.categories[0],
    done: false,
    createdAt: new Date().toISOString(),
    completedAt: null,
  });
  saveState();
  render();
}

function updateTask(id, changes) {
  const task = state.tasks.find((t) => t.id === id);
  if (task) {
    if (typeof changes.title === 'string' && changes.title) task.title = changes.title;
    if (state.categories.includes(changes.category)) task.category = changes.category;
  }
  ui.editingId = null;
  saveState();
  render();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((t) => t.id !== id);
  if (ui.editingId === id) ui.editingId = null;
  disarmDelete();
  saveState();
  render();
}

function toggleTask(id) {
  const task = state.tasks.find((t) => t.id === id);
  if (task) {
    task.done = !task.done;
    task.completedAt = task.done ? new Date().toISOString() : null;
  }
  saveState();
  render();
}

// Returns an error message, or '' on success.
function addCategory(rawName) {
  const name = cleanCategoryName(rawName);
  if (!name) return 'Please enter a category name.';
  if (name.toLowerCase() === 'all') return '"all" is reserved. Please choose another name.';
  const existing = state.categories.find((c) => c.toLowerCase() === name.toLowerCase());
  if (existing) return `"${existing}" already exists.`;

  state.categories.push(name);
  state.settings.keywords[name] = [];
  ui.categoryFormOpen = false;
  ui.categoryError = '';
  saveState();
  render();
  return '';
}

function setTheme(theme) {
  state.settings.theme = THEMES.includes(theme) ? theme : 'system';
  saveState();
  render();
}

function setAutoCategory(enabled) {
  state.settings.autoCategory = enabled;
  if (!enabled && ui.suggestion && !ui.categoryTouched) {
    // Undo a suggestion that is currently applied to the add form.
    $('task-category').value = ui.baseCategory;
  }
  ui.suggestion = null;
  saveState();
  render();
  if (enabled) handleTitleInput(); // suggest for whatever is already typed
}

function setKeywords(category, keywords) {
  if (!state.categories.includes(category)) return;
  state.settings.keywords[category] = keywords;
  const n = keywords.length;
  ui.keywordStatus = `Saved ${n} keyword${n === 1 ? '' : 's'} for "${category}".`;
  saveState();
  render();
  handleTitleInput(); // re-check the title being typed with the new words
}

function resetKeywords() {
  state.settings.keywords = makeKeywordMap(state.categories);
  ui.keywordStatus = 'Keywords reset to the built-in lists.';
  saveState();
  render();
  handleTitleInput();
}

/* ==================== UI-only changes (render, never save) ==================== */

function startEdit(id) {
  ui.editingId = id;
  ui.focusEditInput = true;
  disarmDelete();
  render();
}

function cancelEdit() {
  const id = ui.editingId;
  ui.editingId = null;
  render();
  // Return focus to that row's Edit button (not the Delete button that replaced Cancel).
  const editBtn = document.querySelector(`#task-list .task[data-id="${CSS.escape(id)}"] .task-edit`);
  if (editBtn) editBtn.focus();
}

function armDelete(id) {
  disarmDelete();
  ui.armedDeleteId = id;
  ui.armedTimer = setTimeout(() => {
    ui.armedDeleteId = null;
    ui.armedTimer = null;
    render();
  }, DELETE_CONFIRM_MS);
  render();
}

function disarmDelete() {
  clearTimeout(ui.armedTimer);
  ui.armedDeleteId = null;
  ui.armedTimer = null;
}

function setView(view) {
  ui.view = view;
  render();
}

function openCategoryForm() {
  ui.categoryFormOpen = true;
  ui.categoryError = '';
  render();
  $('new-category-input').value = '';
  $('new-category-input').focus();
}

function closeCategoryForm() {
  ui.categoryFormOpen = false;
  ui.categoryError = '';
  render();
  $('add-category-btn').focus();
}

/* ==================== Derived data ==================== */

// Today = every open task (whenever it was created) + tasks completed today (local date).
function isInToday(task, today) {
  if (!task.done) return true;
  return !!task.completedAt && dayKey(task.completedAt) === today;
}

function isCarriedOver(task, today) {
  return !task.done && dayKey(task.createdAt) < today;
}

function tasksInView() {
  if (ui.view === 'all') return state.tasks;
  const today = dayKey(new Date());
  return state.tasks.filter((t) => isInToday(t, today));
}

function visibleTasks() {
  return tasksInView().filter((t) => {
    if (ui.filterCategory !== 'all' && t.category !== ui.filterCategory) return false;
    if (ui.filterStatus === 'open' && t.done) return false;
    if (ui.filterStatus === 'done' && !t.done) return false;
    return true;
  });
}

/* ==================== Render ====================
   render() rebuilds everything that depends on state/ui. */

// Replace a <select>'s options only when the list changed; keep the chosen value.
function fillSelect(select, values, wanted) {
  const current = [...select.options].map((o) => o.value);
  if (current.join('\n') !== values.join('\n')) {
    select.replaceChildren(...values.map((v) => new Option(v, v)));
  }
  select.value = values.includes(wanted) ? wanted : values[0];
}

// Resolve "system" with the OS setting and tag <html> so the CSS can switch tokens.
const darkQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function renderTheme() {
  const pref = state.settings.theme;
  const dark = pref === 'dark' || (pref === 'system' && !!darkQuery && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('theme-select').value = pref;
}

function renderSuggestion() {
  const s = ui.categoryTouched || !state.settings.autoCategory ? null : ui.suggestion;
  const text = s ? `Category set to "${s.category}" because of the word "${s.keyword}". You can change it.` : '';
  // Only touch the live region when the text changes, so it is announced once.
  if ($('category-hint').textContent !== text) $('category-hint').textContent = text;
}

// Auto-category settings: the on/off switch, one keyword box per category,
// and a status line. The boxes are rebuilt only when categories or keyword
// lists change from elsewhere, so typing in a box is never interrupted.
function renderKeywordSettings() {
  $('auto-category-toggle').checked = state.settings.autoCategory;
  $('auto-off-note').hidden = state.settings.autoCategory;

  const key = JSON.stringify([state.categories, state.categories.map((c) => state.settings.keywords[c] || [])]);
  if (key !== ui.keywordFieldsKey) {
    ui.keywordFieldsKey = key;
    $('keyword-fields').replaceChildren(...state.categories.map((category, i) => {
      const field = document.createElement('div');
      field.className = 'keyword-field';
      applyCategoryColors(field, category);

      const label = document.createElement('label');
      label.htmlFor = `keywords-${i}`;
      label.className = 'keyword-label';
      const chip = document.createElement('span');
      chip.className = 'cat-label';
      chip.textContent = category;
      applyCategoryColors(chip, category);
      label.append('Keywords for ', chip);

      const box = document.createElement('textarea');
      box.id = `keywords-${i}`;
      box.className = 'keyword-input';
      box.rows = 2;
      box.dataset.category = category;
      box.setAttribute('aria-describedby', 'keyword-help');
      box.value = (state.settings.keywords[category] || []).join(', ');
      box.placeholder = 'e.g. word, another word';

      field.append(label, box);
      return field;
    }));
    fitKeywordBoxes();
  }

  if ($('keyword-status').textContent !== ui.keywordStatus) $('keyword-status').textContent = ui.keywordStatus;
}

// Grow each keyword box to show all its words (only measurable while the panel is open).
function fitKeywordBoxes() {
  if (!$('auto-settings').open) return;
  document.querySelectorAll('.keyword-input').forEach(fitBox);
}
function fitBox(box) {
  box.style.height = 'auto';
  box.style.height = box.scrollHeight + 2 + 'px';
}

function renderSelects() {
  if (ui.filterCategory !== 'all' && !state.categories.includes(ui.filterCategory)) ui.filterCategory = 'all';
  if (!state.categories.includes(ui.baseCategory)) ui.baseCategory = state.categories[0];
  fillSelect($('task-category'), state.categories, $('task-category').value);
  fillSelect($('filter-category'), ['all', ...state.categories], ui.filterCategory);
  $('filter-status').value = ui.filterStatus;
}

function renderCategoryForm() {
  const open = ui.categoryFormOpen;
  $('category-form').hidden = !open;
  $('add-category-btn').setAttribute('aria-expanded', String(open));
  $('category-error').textContent = ui.categoryError;
  $('new-category-input').setAttribute('aria-invalid', String(!!ui.categoryError));
}

function renderTabs() {
  document.querySelectorAll('.tab').forEach((tab) => {
    const selected = tab.dataset.view === ui.view;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected) $('tasks-panel').setAttribute('aria-labelledby', tab.id);
  });
}

function buildRow(task, today) {
  const li = $('task-template').content.firstElementChild.cloneNode(true);
  li.className = 'task' + (task.done ? ' is-done' : '');
  li.dataset.id = task.id;
  applyCategoryColors(li, task.category);

  li.querySelector('.task-check').checked = task.done;
  li.querySelector('.task-check-text').textContent =
    (task.done ? 'Mark not done: ' : 'Mark done: ') + task.title;

  const title = li.querySelector('.task-title');
  const badge = li.querySelector('.from-badge');
  const catLabel = li.querySelector('.cat-label');
  const editBtn = li.querySelector('.task-edit');
  const deleteBtn = li.querySelector('.task-delete');

  catLabel.textContent = task.category;

  if (ui.view === 'today' && isCarriedOver(task, today)) {
    badge.hidden = false;
    badge.textContent = 'from ' + shortDate(task.createdAt);
  }

  if (ui.editingId === task.id) {
    // Swap the title for an input + category select.
    const fields = document.createElement('div');
    fields.className = 'task-edit-fields';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.maxLength = MAX_TITLE;
    input.value = task.title;
    input.setAttribute('aria-label', 'Task title');

    const select = document.createElement('select');
    select.className = 'task-edit-select';
    select.setAttribute('aria-label', 'Task category');
    state.categories.forEach((c) => select.add(new Option(c, c)));
    select.value = task.category;

    fields.append(input, select);
    title.replaceWith(fields);
    badge.remove();
    catLabel.remove();

    editBtn.textContent = 'Save';
    editBtn.dataset.action = 'save';
    editBtn.setAttribute('aria-label', 'Save task');
    deleteBtn.textContent = 'Cancel';
    deleteBtn.dataset.action = 'cancel';
    deleteBtn.setAttribute('aria-label', 'Cancel editing');
    deleteBtn.classList.remove('btn-danger');
  } else {
    title.textContent = task.title;
    editBtn.setAttribute('aria-label', `Edit task: ${task.title}`);
    if (ui.armedDeleteId === task.id) {
      deleteBtn.textContent = 'Confirm?';
      deleteBtn.classList.add('is-armed');
      deleteBtn.setAttribute('aria-label', `Confirm delete task: ${task.title}`);
    } else {
      deleteBtn.setAttribute('aria-label', `Delete task: ${task.title}`);
    }
  }

  return li;
}

function renderList() {
  const today = dayKey(new Date());
  const tasks = visibleTasks();
  $('task-list').replaceChildren(...tasks.map((t) => buildRow(t, today)));

  const empty = $('empty-state');
  empty.hidden = tasks.length > 0;
  if (tasks.length === 0) {
    if (state.tasks.length === 0) empty.textContent = 'No tasks yet. Add one above.';
    else if (tasksInView().length === 0) empty.textContent = 'Nothing open and nothing finished today. Switch to "All" to see older tasks.';
    else empty.textContent = 'No tasks match these filters.';
  }
}

function renderProgress() {
  const tasks = tasksInView();
  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  $('progress-fill').style.width = pct + '%';
  $('progress-bar').setAttribute('aria-valuenow', String(pct));

  // Today: completed today / (completed today + open). All: done / total.
  // Both are done / total over tasksInView(), before category/status filters.
  const text = total === 0 ? 'No tasks yet' : `${done} of ${total} done (${pct}%)`;
  // Only touch the live region when the text really changes, so it is announced once.
  if ($('progress-text').textContent !== text) $('progress-text').textContent = text;

  $('category-counts').replaceChildren(...state.categories.map((c) => {
    const inCat = tasks.filter((t) => t.category === c);
    const li = document.createElement('li');
    li.className = 'cat-count';
    li.textContent = `${c}: ${inCat.filter((t) => t.done).length}/${inCat.length}`;
    applyCategoryColors(li, c);
    return li;
  }));

  // Open tasks created before today (shown in the Today view).
  const today = dayKey(new Date());
  const carried = state.tasks.filter((t) => isCarriedOver(t, today)).length;
  const carriedEl = $('carried-over');
  carriedEl.hidden = ui.view !== 'today' || carried === 0;
  carriedEl.textContent = carried === 1
    ? '1 task carried over from an earlier day'
    : `${carried} tasks carried over from earlier days`;
}

// Header date; also remembers which day the screen was drawn for.
function renderDate() {
  const now = new Date();
  ui.renderedDay = dayKey(now);
  const el = $('today-date');
  el.textContent = now.toLocaleDateString(undefined, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });
  el.dateTime = ui.renderedDay;
}

function render() {
  // Remember which row control had focus so keyboard users keep their place.
  const active = document.activeElement;
  const activeRow = active && active.closest ? active.closest('#task-list .task') : null;
  const focusId = activeRow ? activeRow.dataset.id : null;
  const focusClass = activeRow ? [...active.classList].find((c) => c.startsWith('task-')) : null;

  renderTheme();
  renderDate();
  renderSelects();
  renderCategoryForm();
  renderSuggestion();
  renderKeywordSettings();
  renderTabs();
  renderProgress();
  renderList();

  // Restore focus: into a just-opened edit box, else the same control in the same row.
  const list = $('task-list');
  const editInput = list.querySelector('.task-edit-input');
  if (editInput && ui.focusEditInput) {
    ui.focusEditInput = false;
    editInput.focus();
    editInput.setSelectionRange(editInput.value.length, editInput.value.length);
  } else if (focusId) {
    const row = list.querySelector(`.task[data-id="${CSS.escape(focusId)}"]`);
    const target = row && (row.querySelector('.' + focusClass) || row.querySelector('.task-edit'));
    if (target) target.focus();
    else $('task-input').focus(); // row was deleted or filtered out
  }
}

/* ==================== Events ==================== */

function handleAddSubmit(event) {
  event.preventDefault();
  const input = $('task-input');
  const title = cleanTitle(input.value);
  if (!title) {
    input.value = '';
    input.focus();
    input.reportValidity(); // browser's "Please fill out this field"
    return;
  }
  addTask(title, $('task-category').value);
  input.value = '';
  resetSuggestion();
  input.focus();
}

// While typing a title, pick the category from keywords unless the user chose one.
function handleTitleInput() {
  if (ui.categoryTouched || !state.settings.autoCategory) return;
  ui.suggestion = suggestCategory($('task-input').value);
  $('task-category').value = ui.suggestion ? ui.suggestion.category : ui.baseCategory;
  renderSuggestion();
}

// The user picked a category themselves: keep it, and use it as the default next time.
function handleCategoryPicked(category) {
  ui.categoryTouched = true;
  ui.baseCategory = category;
  ui.suggestion = null;
  renderSuggestion();
}

// After adding a task: suggestions resume, select goes back to the default.
function resetSuggestion() {
  ui.categoryTouched = false;
  ui.suggestion = null;
  $('task-category').value = ui.baseCategory;
  renderSuggestion();
}

function commitKeywordBox(box) {
  const category = box.dataset.category;
  const keywords = parseKeywordText(box.value);
  const current = state.settings.keywords[category] || [];
  box.value = keywords.join(', '); // show the cleaned list
  fitBox(box);
  if (keywords.join('\n') === current.join('\n')) return; // nothing changed
  // Keep the boxes as they are (focus may already be in the next one).
  ui.keywordFieldsKey = JSON.stringify([state.categories, state.categories.map((c) => (c === category ? keywords : state.settings.keywords[c] || []))]);
  setKeywords(category, keywords);
}

function saveEdit(row) {
  const title = cleanTitle(row.querySelector('.task-edit-input').value);
  const category = row.querySelector('.task-edit-select').value;
  // An empty title is rejected: the old title is kept; a category change still applies.
  updateTask(row.dataset.id, { title: title || undefined, category });
}

function submitCategory() {
  const input = $('new-category-input');
  const name = cleanCategoryName(input.value);
  const error = addCategory(input.value);
  if (error) {
    ui.categoryError = error;
    renderCategoryForm();
    input.focus();
    return;
  }
  $('task-category').value = name;
  handleCategoryPicked(name);
  $('task-category').focus();
}

function handleListAction(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const row = target.closest('.task');
  if (!row) return;
  const id = row.dataset.id;
  const action = target.dataset.action;

  if (event.type === 'change') {
    if (action === 'toggle') toggleTask(id);
    return;
  }

  if (action === 'edit') startEdit(id);
  else if (action === 'save') saveEdit(row);
  else if (action === 'cancel') cancelEdit();
  else if (action === 'delete') {
    if (ui.armedDeleteId === id) deleteTask(id);
    else armDelete(id);
  }
}

function bindEvents() {
  $('add-form').addEventListener('submit', handleAddSubmit);

  // "+" new category: Enter adds, Esc cancels.
  $('add-category-btn').addEventListener('click', () => {
    if (ui.categoryFormOpen) closeCategoryForm();
    else openCategoryForm();
  });
  $('save-category-btn').addEventListener('click', submitCategory);
  $('cancel-category-btn').addEventListener('click', closeCategoryForm);
  $('category-form').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeCategoryForm(); }
    else if (e.key === 'Enter' && e.target.id === 'new-category-input') {
      e.preventDefault(); // don't submit the add-task form
      submitCategory();
    }
  });

  // Tabs: click, or Left/Right/Home/End when a tab has focus.
  const tabs = [...document.querySelectorAll('.tab')];
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
    tab.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowRight') next = tabs[(i + 1) % tabs.length];
      else if (e.key === 'ArrowLeft') next = tabs[(i - 1 + tabs.length) % tabs.length];
      else if (e.key === 'Home') next = tabs[0];
      else if (e.key === 'End') next = tabs[tabs.length - 1];
      if (!next) return;
      e.preventDefault();
      setView(next.dataset.view);
      next.focus();
    });
  });

  $('filter-category').addEventListener('change', (e) => { ui.filterCategory = e.target.value; render(); });
  $('filter-status').addEventListener('change', (e) => { ui.filterStatus = e.target.value; render(); });

  // Keyword category suggestion ('change' only fires for the user's own picks).
  $('task-input').addEventListener('input', handleTitleInput);
  $('task-category').addEventListener('change', (e) => handleCategoryPicked(e.target.value));

  // Theme: the user's choice, and live OS changes while on "System".
  $('theme-select').addEventListener('change', (e) => setTheme(e.target.value));

  // Auto-category settings. A keyword box saves when it loses focus ('change')
  // or on Ctrl/Cmd+Enter; Esc puts back the saved words.
  $('auto-category-toggle').addEventListener('change', (e) => setAutoCategory(e.target.checked));
  $('auto-settings').addEventListener('toggle', fitKeywordBoxes);
  window.addEventListener('resize', fitKeywordBoxes);
  $('keyword-fields').addEventListener('input', (e) => {
    if (e.target.matches('.keyword-input')) fitBox(e.target);
  });
  $('keyword-fields').addEventListener('change', (e) => {
    if (e.target.matches('.keyword-input')) commitKeywordBox(e.target);
  });
  $('keyword-fields').addEventListener('keydown', (e) => {
    if (!e.target.matches('.keyword-input')) return;
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commitKeywordBox(e.target);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.target.value = (state.settings.keywords[e.target.dataset.category] || []).join(', ');
      fitBox(e.target);
    }
  });
  $('reset-keywords-btn').addEventListener('click', () => {
    if (confirm('Replace all keyword lists with the built-in ones? Your own keywords will be removed.')) resetKeywords();
  });
  if (darkQuery) {
    const onSystemChange = () => { if (state.settings.theme === 'system') render(); };
    if (darkQuery.addEventListener) darkQuery.addEventListener('change', onSystemChange);
    else if (darkQuery.addListener) darkQuery.addListener(onSystemChange);
  }

  // Task list: delegated handlers for every row.
  const list = $('task-list');
  list.addEventListener('click', handleListAction);
  list.addEventListener('change', handleListAction);
  list.addEventListener('dblclick', (e) => {
    const title = e.target.closest('.task-title');
    if (title) startEdit(title.closest('.task').dataset.id);
  });
  list.addEventListener('keydown', (e) => {
    const row = e.target.closest('.task');
    if (!row || ui.editingId !== row.dataset.id) return;
    // Enter in the fields saves; Enter on Save/Cancel is left to their own click.
    if (e.key === 'Enter' && e.target.matches('.task-edit-input, .task-edit-select')) {
      e.preventDefault();
      saveEdit(row);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    }
  });

  $('banners').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-dismiss]');
    if (btn) hideBanner(btn.dataset.dismiss);
  });

  window.addEventListener('focus', checkForNewDay);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkForNewDay();
  });

  $('export-btn').addEventListener('click', exportData);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = ''; // allow choosing the same file again
    if (file) importFile(file);
  });
}

/* ==================== Start ==================== */

// If the page stayed open past midnight, redraw: new date, Today view and badges.
function checkForNewDay() {
  if (dayKey(new Date()) !== ui.renderedDay) render();
}

function init() {
  loadState();
  bindEvents();
  render();
}

document.addEventListener('DOMContentLoaded', init);
