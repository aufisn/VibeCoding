# CLAUDE.md — desktop_version

This file guides Claude Code when working in `desktop_version/`. Read the root `../CLAUDE.md` first: it describes the shared recognizer, models and preprocessing.

## Purpose

A native desktop app (macOS first) for the handwriting recognizer. It opens a window with a drawing canvas, a mode selector (digits / letters / all) and the top predictions. It runs fully offline with no web server.

## Status

New and empty.

## Shared code: do not copy it

- Recognition lives in the root `predict.py` (`Recognizer`, `preprocess`). Import it; don't copy it in here. Both versions must give the same results for the same drawing.
- The model files (`digit_model.joblib`, `char_model.joblib`) stay in the project root. `Recognizer` finds them relative to `predict.py`.
- Add the root to the import path at the top of the entry point:
  ```python
  sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
  from predict import Recognizer, MODES
  ```
- If recognition needs to change, change `predict.py` and check that the web version still works.

## GUI toolkit

- **Default: tkinter**, from the standard library, so the project needs no new pip dependencies.
- The venv uses Homebrew Python 3.14, which needs `python-tk@3.14` for Tk. It is installed (Tk 9.1). If `import tkinter` ever fails with `No module named '_tkinter'` (for example after a Python upgrade), reinstall the matching version: `brew install python-tk@<version>`.
- Don't switch toolkits (PySide6, wxPython, etc.) without asking.

## Commands

Run from the project root, using the venv interpreter:

```sh
.venv/bin/python desktop_version/main.py
```

## Design

- **Load the `Recognizer` once** at startup. Loading is slow, so show the window first, or show a "Loading…" status while it loads.
- **Drawing:** a tkinter `Canvas` shows the strokes. Also draw every stroke onto an off-screen PIL `Image` of the same size (`ImageDraw.line` with a thick width and round joints). Pass that `Image` straight to `Recognizer.predict()`. Don't screenshot the canvas or save it as PostScript.
- **Brush:** use a thick round brush (18px on the 280px canvas, the same as the web version). Thin strokes recognize badly after downscaling to 28x28.
- **Predict** on mouse release, or with a "Recognize" button. A "Clear" button resets both the canvas and the PIL image.
- **Results:** show the top 6 `(char, prob)` pairs, for example as labels with progress bars.
- **Errors:** show a `ValueError` (like `"Nothing drawn"`, or "char model missing") as a status message, not a crash or traceback.
- **Threading:** keep the UI responsive. If prediction ever feels slow, run it off the main thread and post results back with `root.after`.

## Packaging (later)

- To make a double-clickable app, write a `.command` launcher like the root `Digit Recognizer.command`.
- For a real `.app` bundle, use PyInstaller. The bundle must include both `.joblib` model files and `predict.py`.
- Ask before adding packaging dependencies.

## Checking changes

- Run `.venv/bin/python predict.py --mode all samples/*.png` from the root. Filenames give the expected labels (`digit_N`, `cap_X`, `small_x`).
- For the GUI, start the app, draw a few digits and letters in each mode, and check that Clear works.
