"""Desktop version: draw a character in a window and see live predictions.

Usage (from the project root):
    .venv/bin/python desktop_version/main.py
"""
import os
import sys
import threading
import tkinter as tk
from tkinter import ttk

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # project root, for predict.py

from PIL import Image, ImageDraw  # noqa: E402

from predict import Recognizer  # noqa: E402

SIZE = 280            # canvas size in pixels
BRUSH = 18            # stroke width, about 1/15 of the canvas like the web version
TOP_N = 6
MODES = [("Digits 0-9", "digits"), ("Letters A-z", "letters"), ("All", "all")]


def kind(ch: str) -> str:
    if ch.isdigit():
        return "digit"
    return "CAPITAL letter" if ch.isupper() else "small letter"


class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.rec = None
        self.mode = tk.StringVar(value="digits")
        self.last = None      # last pointer position while drawing
        self.drawn = False
        self.pending = None   # after() id for the debounced live prediction

        root.title("Handwriting Recognizer")
        root.resizable(False, False)
        self._build_ui()
        self._reset_image()
        self._set_status("Loading models...")
        threading.Thread(target=self._load_models, daemon=True).start()

    # ---------- UI ----------
    def _build_ui(self):
        outer = ttk.Frame(self.root, padding=16)
        outer.grid()

        ttk.Label(outer, text="Handwriting Recognizer", font=("Helvetica", 18, "bold")).grid(
            row=0, column=0, columnspan=2)
        ttk.Label(outer, text="Draw one character in the box").grid(row=1, column=0, columnspan=2, pady=(0, 8))

        modes = ttk.Frame(outer)
        modes.grid(row=2, column=0, columnspan=2, pady=(0, 12))
        for text, value in MODES:
            ttk.Radiobutton(modes, text=text, value=value, variable=self.mode,
                            command=self.predict).pack(side="left", padx=6)

        left = ttk.Frame(outer)
        left.grid(row=3, column=0, sticky="n", padx=(0, 20))
        self.canvas = tk.Canvas(left, width=SIZE, height=SIZE, bg="white", cursor="crosshair",
                                highlightthickness=2, highlightbackground="#d4d4d8")
        self.canvas.pack()
        self.canvas.bind("<ButtonPress-1>", self._on_down)
        self.canvas.bind("<B1-Motion>", self._on_move)
        self.canvas.bind("<ButtonRelease-1>", self._on_up)

        buttons = ttk.Frame(left)
        buttons.pack(pady=(10, 0))
        ttk.Button(buttons, text="Clear", command=self.clear).pack(side="left", padx=4)
        ttk.Button(buttons, text="Recognize", command=self.predict).pack(side="left", padx=4)

        self.status = ttk.Label(left, foreground="#b91c1c")
        self.status.pack(pady=(8, 0))

        right = ttk.Frame(outer, width=230)
        right.grid(row=3, column=1, sticky="n")
        self.guess = ttk.Label(right, text="?", font=("Helvetica", 96, "bold"), anchor="center", width=3)
        self.guess.pack()
        self.kind = ttk.Label(right, text="", foreground="#71717a")
        self.kind.pack(pady=(0, 10))

        self.rows = []
        for _ in range(TOP_N):
            row = ttk.Frame(right)
            row.pack(fill="x", pady=2)
            ch = ttk.Label(row, text="", width=2, font=("Helvetica", 14, "bold"), anchor="center")
            ch.pack(side="left")
            bar = ttk.Progressbar(row, length=140, maximum=100)
            bar.pack(side="left", padx=6)
            pct = ttk.Label(row, text="", width=6, anchor="e")
            pct.pack(side="left")
            self.rows.append((ch, bar, pct))

    def _set_status(self, text: str):
        self.status.config(text=text)

    # ---------- models ----------
    def _load_models(self):
        try:
            rec = Recognizer()
        except Exception as e:  # missing/corrupt digit model: show it instead of crashing
            self.root.after(0, self._set_status, f"Could not load models: {e}")
            return
        self.root.after(0, self._models_ready, rec)

    def _models_ready(self, rec):
        self.rec = rec
        self._set_status("" if rec.char_model else "Letter model missing - only Digits works")
        if self.drawn:
            self.predict()

    # ---------- drawing ----------
    def _reset_image(self):
        # Off-screen copy of the drawing that is sent to the recognizer.
        self.image = Image.new("L", (SIZE, SIZE), 255)
        self.draw = ImageDraw.Draw(self.image)

    def _dot(self, x, y):
        r = BRUSH / 2
        self.canvas.create_oval(x - r, y - r, x + r, y + r, fill="black", outline="")
        self.draw.ellipse((x - r, y - r, x + r, y + r), fill=0)

    def _on_down(self, e):
        self.last = (e.x, e.y)
        self.drawn = True
        self._dot(e.x, e.y)

    def _on_move(self, e):
        if self.last is None:
            return
        x0, y0 = self.last
        self.canvas.create_line(x0, y0, e.x, e.y, fill="black", width=BRUSH,
                                capstyle="round", joinstyle="round")
        self.draw.line((x0, y0, e.x, e.y), fill=0, width=BRUSH)
        self._dot(e.x, e.y)  # round joints in the PIL image
        self.last = (e.x, e.y)
        if self.pending:
            self.root.after_cancel(self.pending)
        self.pending = self.root.after(120, self.predict)

    def _on_up(self, _e):
        self.last = None
        self.predict()

    def clear(self):
        if self.pending:
            self.root.after_cancel(self.pending)
            self.pending = None
        self.canvas.delete("all")
        self._reset_image()
        self.drawn = False
        self.guess.config(text="?")
        self.kind.config(text="")
        for ch, bar, pct in self.rows:
            ch.config(text="")
            bar["value"] = 0
            pct.config(text="")
        self._set_status("" if self.rec is None or self.rec.char_model else
                         "Letter model missing - only Digits works")

    # ---------- prediction ----------
    def predict(self):
        self.pending = None
        if self.rec is None:
            return  # still loading; _models_ready() predicts once loaded
        if not self.drawn:
            return
        try:
            top = self.rec.predict(self.image, self.mode.get())[:TOP_N]
        except ValueError as e:
            self._set_status(str(e))
            return
        self._set_status("")
        self.guess.config(text=top[0][0])
        self.kind.config(text=kind(top[0][0]))
        for (ch, bar, pct), (label, p) in zip(self.rows, top):
            ch.config(text=label)
            bar["value"] = p * 100
            pct.config(text=f"{p * 100:.1f}%")


def main():
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
