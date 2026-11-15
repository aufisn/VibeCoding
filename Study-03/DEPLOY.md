# Deploying the Quiz Game

The game is a static site: plain files, no build step, no server code. Any static host works. It must be served over **https** for offline play (service workers only run on https and on localhost).

## Before you publish

1. Bump `CACHE_VERSION` in `sw.js` if anything changed since the last release (`"v1"` → `"v2"`). Otherwise returning players keep the old cached version.
2. Run the checks from this folder:

   ```sh
   node scripts/validate-questions.mjs
   node --test
   ```

3. Work through the [launch checklist](#launch-checklist).

## GitHub Pages

1. Put the folder in a GitHub repository (it can be the repository root or a subfolder such as `Study-03/`).
2. Add an empty `.nojekyll` file at the repository root so Pages serves every file as is.
3. In the repository, go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick your branch (for example `main`) and the folder `/ (root)`, then **Save**.
4. Wait a minute or two, then open `https://<user>.github.io/<repository>/` (add `Study-03/` if the game is in that subfolder).
5. Open the page once, wait for "Offline ready" on the Start screen, and run the offline test below.

All paths in the game are relative, so it works from a subfolder with no changes.

## Any other static host

Upload the whole folder (Netlify, Cloudflare Pages, Vercel, an S3 bucket behind https, or your own web server). No build command; the publish directory is this folder. Make sure:

- `.webmanifest` is served as `application/manifest+json` (most hosts already do).
- `sw.js` isn't cached for long by the host or a CDN. Browsers recheck it regularly anyway, but a short cache time (for example `Cache-Control: max-age=0`) gets updates out faster.

## Launch checklist

- [ ] All 40 questions have `"verified": true` (you fact-checked each one).
- [ ] `node scripts/validate-questions.mjs` shows **0 errors and 0 warnings**.
- [ ] `node --test` passes.
- [ ] `CACHE_VERSION` in `sw.js` was bumped for this release ("changed questions or code, bump CACHE_VERSION").
- [ ] Manual test on at least three real phones: one iPhone and two Android. Play a full run, try Eliminate, Skip, Review mistakes, the leaderboard, Clear history and the dark mode switch.
- [ ] Keyboard-only run on a computer: A to D or 1 to 4 to answer, Enter or Space for Next, Tab and Escape in dialogs.
- [ ] Screen reader spot check (VoiceOver on iPhone or Mac, TalkBack on Android): results are announced after each answer.
- [ ] Offline test: load the site once online, wait for "Offline ready", turn on airplane mode, reload, and play a full run.
- [ ] Lighthouse (Chrome DevTools, mobile): Performance 90+ and Accessibility 95+.
