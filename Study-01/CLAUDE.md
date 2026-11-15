# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

A handwriting recognizer for single characters (digits 0-9, A-Z, a-z), built on scikit-learn `MLPClassifier` models. Dependencies (installed in `.venv`): scikit-learn, numpy, pillow, joblib. There is no requirements file, test suite or linter. Version control is the parent `VibeCoding` git repo; `data/` and `.venv/` are git-ignored.

## Sub-projects

- `web_version/`: browser app. See `web_version/CLAUDE.md`.
- `desktop_version/`: native desktop app. See `desktop_version/CLAUDE.md`.

Both import `Recognizer` from the root `predict.py` and use the root model files. Don't copy them into the sub-projects.

## Commands

Always use the venv interpreter: `.venv/bin/python`.

```sh
.venv/bin/python app.py                                   # web UI at http://localhost:8000 (stdlib http.server)
.venv/bin/python predict.py samples/digit_3.png           # CLI prediction, default mode=digits
.venv/bin/python predict.py --mode all samples/*.png      # modes: digits | letters | all
.venv/bin/python train.py                                 # retrain digit_model.joblib (downloads MNIST via fetch_openml)
.venv/bin/python train_chars.py                           # retrain char_model.joblib (EMNIST ByClass from ./data, slow, uses a lot of RAM)
```

`Digit Recognizer.command` is a Finder double-click launcher. It runs `app.py` and opens the browser, or just opens the browser if port 8000 is already in use.

To check changes quickly, run `predict.py` over `samples/`. The filenames give the expected labels (`digit_N`, `cap_X`, `small_x`).

## Architecture

- **`predict.py` is the core.** `Recognizer` loads both models once. `preprocess()` turns any image into a 28x28 white-on-black array scaled to 0..1, flattened to (1, 784). `app.py` imports `Recognizer`, so the CLI and web UI share one prediction path.
- **The two models need different preprocessing, matching their training data:**
  - Digit model (MNIST): the character is fit into a 20px box and centered by center of mass (`box=20, center_of_mass=True`).
  - Char model (EMNIST): the character is fit into a 24px box and centered by bounding box (`box=24, center_of_mass=False`).
  If you change either training pipeline, update the matching `preprocess()` call too.
- **Modes:**
  - `digits` uses `digit_model.joblib`.
  - `letters` and `all` use `char_model.joblib`, a 62-class model whose classes are ordered `0-9A-Za-z`.
  - `letters` drops the first 10 (digit) classes and renormalizes. It relies on that class order.
- **Model files:**
  - `digit_model.joblib` holds the bare estimator.
  - `char_model.joblib` holds a dict `{"model", "classes"}`.
  If the char model file is missing, `Recognizer` still loads, but `letters` and `all` raise a `ValueError`.
- **Errors:** `preprocess` raises `ValueError("Nothing drawn")` for blank images. `app.py` returns any `ValueError` as JSON `{"error": ...}`.
- **EMNIST quirk:** the raw images are stored transposed. `train_chars.py` transposes them back on load. `train_chars.py` trains with `partial_fit` in chunks for memory reasons and keeps the best epoch by validation accuracy (early stop after 3 stale epochs).
- **Web UI:** `app.py` serves the whole page from the inline `PAGE` string (HTML/CSS/JS). The canvas POSTs a PNG data URL to `/predict?mode=...` and gets back the top 6 `(char, prob)` pairs.
