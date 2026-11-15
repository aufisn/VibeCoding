"""Recognize a handwritten digit or letter in an image file.

Usage: python predict.py [--mode digits|letters|all] image.png [more.png ...]
  digits  - 0-9 only (MNIST model, most accurate for numbers)   [default]
  letters - A-Z and a-z only
  all     - digits, CAPITAL and small letters
Works with dark ink on light paper or light ink on dark background.
"""
import os
import sys

import joblib
import numpy as np
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
DIGITS = "0123456789"
MODES = ("digits", "letters", "all")


def preprocess(img: Image.Image, box: int = 20, center_of_mass: bool = True) -> np.ndarray:
    """Convert any image into a 28x28 white-on-black array like the training data.

    MNIST digits: fitted into 20x20, centered by center of mass.
    EMNIST chars: fitted into 24x24, centered by bounding box.
    """
    img = img.convert("L")
    arr = np.asarray(img, dtype=np.float32)
    if arr.mean() > 127:  # light background -> invert so the ink is white
        img = ImageOps.invert(img)
        arr = np.asarray(img, dtype=np.float32)

    mask = arr > 50
    if not mask.any():
        raise ValueError("Nothing drawn")
    ys, xs = np.where(mask)
    img = img.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))

    w, h = img.size
    s = box / max(w, h)
    img = img.resize((max(1, round(w * s)), max(1, round(h * s))), Image.LANCZOS)
    canvas = Image.new("L", (28, 28), 0)
    canvas.paste(img, ((28 - img.size[0]) // 2, (28 - img.size[1]) // 2))

    a = np.asarray(canvas, dtype=np.float32)
    if center_of_mass:
        total = a.sum()
        cy = (a.sum(axis=1) * np.arange(28)).sum() / total
        cx = (a.sum(axis=0) * np.arange(28)).sum() / total
        a = np.roll(a, (round(14 - cy), round(14 - cx)), axis=(0, 1))
    return (a / 255.0).reshape(1, -1)


class Recognizer:
    def __init__(self):
        self.digit_model = joblib.load(os.path.join(HERE, "digit_model.joblib"))
        path = os.path.join(HERE, "char_model.joblib")
        if os.path.exists(path):
            saved = joblib.load(path)
            self.char_model, self.classes = saved["model"], saved["classes"]
        else:
            self.char_model = None  # run train_chars.py to enable letters

    def predict(self, img: Image.Image, mode: str = "digits"):
        """Return a list of (character, probability), most likely first."""
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        if mode == "digits":
            probs = self.digit_model.predict_proba(preprocess(img))[0]
            labels = DIGITS
        else:
            if self.char_model is None:
                raise ValueError("Letter model not trained yet - run train_chars.py")
            probs = self.char_model.predict_proba(preprocess(img, box=24, center_of_mass=False))[0]
            labels = self.classes
            if mode == "letters":  # keep only letters and renormalize
                probs, labels = probs[10:], labels[10:]
                probs = probs / probs.sum()
        order = np.argsort(probs)[::-1]
        return [(labels[i], float(probs[i])) for i in order]


if __name__ == "__main__":
    args = sys.argv[1:]
    mode = "digits"
    if args[:1] == ["--mode"] and len(args) > 1:
        mode, args = args[1], args[2:]
    if not args:
        sys.exit(__doc__)
    rec = Recognizer()
    for path in args:
        top = rec.predict(Image.open(path), mode)
        alts = ", ".join(f"{c}: {p * 100:.1f}%" for c, p in top[:3])
        print(f"{path}: {top[0][0]}   ({alts})")
