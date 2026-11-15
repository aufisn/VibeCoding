# My To-Do

A small personal to-do web app built with plain HTML, CSS and vanilla JavaScript — no frameworks, no npm, no build step, no external libraries.

## How to open

Double-click `index.html`, or drag it into any modern browser. No server needed.

For a full-screen desktop layout (sidebar, wide task list, settings column), open `web_version/index.html` instead. See `web_version/README.md`.

## What it does

- Add tasks with a category (Enter or **Add**); create extra categories with **+**.
- **Auto-category:** while you type a task, the category is picked from keywords (a hint says which word). Your own pick always wins. Open **Auto-category settings** to switch it on/off and edit the keyword list for each category; a category's own name always counts.
- **Theme:** System / Light / Dark (top right).
- Tick to complete; edit by double-clicking a title or pressing **Edit** (Enter saves, Esc cancels).
- Delete needs a second click within 3 seconds.
- **Today** shows every open task (older ones marked "from <date>") plus tasks finished today. Finished tasks leave Today the next day but stay in **All**, which shows everything. Nothing is copied or moved; only the view changes.
- Filter by category and status in either view. Progress (bar, "X of Y done", per-category counts, carried-over count) covers the current view before filters.
- If the page stays open past midnight, the date and Today view refresh when you come back to the window.
- Saved automatically in the browser (`localStorage`, key `todo-app:v1`). **Export backup** / **Import backup** move data between browsers.

## Files

- `index.html` — page structure and the task-row `<template>`
- `style.css` — styling (works from 360px wide, max width 640px)
- `app.js` — all behaviour
- `tests/acceptance.mjs` — automated acceptance tests

## Running the tests

Needs Node 22+ and Google Chrome (or Chromium/Edge). No packages to install.

```sh
node tests/acceptance.mjs
```

It opens a hidden Chrome with a throwaway profile (your own browser data is not touched), clicks and types through the app, and prints PASS/FAIL per check. Set `CHROME_PATH` if Chrome is installed somewhere unusual.
