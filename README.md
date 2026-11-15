# VibeCoding

Projects built while working through the book *Build with Claude Code*. Each study lives in its own folder.

Live site: **https://aufisn.github.io/VibeCoding/**

| Study | What it is | Live link |
| --- | --- | --- |
| [Study-01](Study-01/) | Handwriting recognizer (Python, scikit-learn) | Runs locally only ([instructions](https://aufisn.github.io/VibeCoding/Study-01/)) |
| [Study-02](Study-02/) | "My To-Do" app (HTML, CSS, JavaScript) | [Mobile](https://aufisn.github.io/VibeCoding/Study-02/) · [Desktop](https://aufisn.github.io/VibeCoding/Study-02/web_version/) |
| [Study-03](Study-03/) | General knowledge quiz game (HTML, CSS, JavaScript) | [Open](https://aufisn.github.io/VibeCoding/Study-03/) |

The site is served by GitHub Pages straight from the `main` branch, so a push updates the live links within a minute or two.

## Not in the repository

- `Study-01/data/`: the EMNIST ByClass training data (193 MB; one file is over GitHub's 100 MB limit). It's only needed to retrain `char_model.joblib`. The trained models are included.
- `Study-01/.venv/`: recreate it with `python3 -m venv .venv` and `.venv/bin/pip install scikit-learn numpy pillow joblib`.
