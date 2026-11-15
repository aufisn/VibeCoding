# CLAUDE.md — web_version

This file guides Claude Code when working in `web_version/`. Read the root `../CLAUDE.md` first: it describes the shared recognizer, models and preprocessing.

## Purpose

The browser version of the handwriting recognizer. Users draw a single character (0-9, A-Z, a-z) on a canvas and see the top predictions. It grows out of the root `app.py`, which is the prototype.

## Status

Ported from the root `app.py` and working: `server.py` plus `static/`. It adds a pen cursor, pen color swatches (and a custom color picker) and a tip-thickness slider (6-36px, default 18). Leave the root `app.py` and `Digit Recognizer.command` working until this version replaces them.

## Shared code: do not copy it

- Recognition lives in the root `predict.py` (`Recognizer`, `preprocess`). Import it; don't copy it in here. Both versions must give the same results for the same drawing.
- The model files (`digit_model.joblib`, `char_model.joblib`) stay in the project root. `Recognizer` finds them relative to `predict.py`, so they need no path changes.
- Add the root to the import path at the top of the server entry point:
  ```python
  sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
  from predict import Recognizer, MODES
  ```
- If recognition needs to change, change `predict.py` and check that the desktop version still works.

## Commands

Run from the project root, using the venv interpreter:

```sh
.venv/bin/python web_version/server.py     # serves http://localhost:8000
```

## Design

- **Server:** Python stdlib `http.server`, as in the prototype. Don't add a web framework (Flask, FastAPI) without asking. Bind to `localhost` only.
- **Frontend:** plain HTML/CSS/JS in a `static/` folder (`index.html`, `style.css`, `app.js`), served by the server. No build step, no npm.
- **API** (keep it the same as the prototype):
  - `GET /` returns the page.
  - `POST /predict?mode=digits|letters|all` with a PNG data URL as the body.
  - It returns `{"top": [[char, prob], ...]}` (top 6), or `{"error": "..."}` for any `ValueError` (for example, `"Nothing drawn"`).
- **Load the models once** at server start, not per request.
- **Canvas:** draw dark ink on a light background, or the reverse. `preprocess()` handles both. Use a thick round brush, because thin strokes recognize badly after downscaling to 28x28. Support mouse and touch (pointer events).
- **Two canvases:** the visible canvas uses the chosen pen color. `app.js` draws every stroke a second time onto a hidden canvas in black, with the same width, and sends *that* to `/predict`. This keeps pale colors (yellow, light gray) from falling below `preprocess()`'s ink threshold. Keep the two in sync when changing drawing code, including Clear.
- **Pen cursor:** an inline SVG pencil as a CSS `cursor` data URL, hotspot at the tip (`2 30`), with the tip filled in the current color and `crosshair` as fallback.
- **Saved settings:** pen color and width are kept in `localStorage` (`penColor`, `penWidth`), wrapped in try/catch so the page still works when storage is blocked.

## Checking changes

- Run `.venv/bin/python predict.py --mode all samples/*.png` from the root. Filenames give the expected labels (`digit_N`, `cap_X`, `small_x`).
- Test the API without a browser:
  ```sh
  python3 -c "import base64;print('data:image/png;base64,'+base64.b64encode(open('samples/digit_3.png','rb').read()).decode())" \
    | curl -s -X POST --data-binary @- 'http://localhost:8000/predict?mode=digits'
  ```
