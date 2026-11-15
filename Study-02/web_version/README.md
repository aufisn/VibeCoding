# My To-Do — desktop edition

The same to-do app as the folder above, laid out for a full desktop browser window.

## How to open

Double-click `index.html` in this folder (or drag it into a browser). No server or install needed.

## Layout

- **Left sidebar:** views (Today / All tasks, with counts), progress for the current view with per-category breakdown, theme picker, Export / Import backup.
- **Main area:** large page heading with today's date, a one-line composer (task, category, +, Add task), filters, and the task list.
- **Right column:** Auto-category settings (on/off switch and keyword lists).

Responsive: below 1180px wide the settings move under the task list; below 820px the sidebar becomes a top section, so it still works on tablets and phones.

## Shared data

Both editions use the same browser storage key (`todo-app:v1`) and the same file format, so tasks, categories, keywords and the theme carry over between them in the same browser. Note that in some browsers (e.g. Firefox) each local file has its own storage; use **Export backup / Import backup** to move data there.

## Files

- `index.html` — desktop layout
- `style.css` — same design system as `../style.css`, with a desktop app-shell layout
- `app.js` — same logic as `../app.js`, plus the page heading, view counts and Up/Down keys for the vertical view tabs

## Tests

From the project folder: `APP_DIR=web_version node tests/acceptance.mjs`
