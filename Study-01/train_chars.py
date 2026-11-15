"""Train a handwritten character recognizer on EMNIST ByClass.

62 classes: digits 0-9, CAPITAL A-Z, small a-z (814,255 images, 28x28).
Data files are expected in ./data (official NIST release, gzip format).
"""
import copy
import gzip
import time

import joblib
import numpy as np
from sklearn.neural_network import MLPClassifier

CLASSES = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
EPOCHS = 25
CHUNK = 50_000  # images converted to float at a time (keeps RAM use low)


def load(split):
    with gzip.open(f"data/emnist-byclass-{split}-images-idx3-ubyte.gz") as f:
        X = np.frombuffer(f.read(), np.uint8, offset=16).reshape(-1, 28, 28)
    with gzip.open(f"data/emnist-byclass-{split}-labels-idx1-ubyte.gz") as f:
        y = np.frombuffer(f.read(), np.uint8, offset=8).astype(int)
    # EMNIST images are stored transposed; fix so they look like normal writing
    return np.ascontiguousarray(X.transpose(0, 2, 1)).reshape(-1, 784), y


def to_float(X):
    return X.astype(np.float32) / 255.0


def accuracy(model, X, y):
    correct = sum((model.predict(to_float(X[i:i + CHUNK])) == y[i:i + CHUNK]).sum()
                  for i in range(0, len(X), CHUNK))
    return correct / len(X)


print("Loading EMNIST ByClass...")
X_all, y_all = load("train")
X_test, y_test = load("test")
rng = np.random.default_rng(42)
perm = rng.permutation(len(X_all))
val_idx, train_idx = perm[:30_000], perm[30_000:]
X_val, y_val = X_all[val_idx], y_all[val_idx]
print(f"{len(train_idx):,} training / {len(val_idx):,} validation / {len(X_test):,} test images")

model = MLPClassifier(hidden_layer_sizes=(512, 256), activation="relu", solver="adam",
                      batch_size=256, learning_rate_init=1e-3, alpha=1e-4, random_state=42)

best, best_acc, stale = None, 0.0, 0
t0 = time.time()
for epoch in range(1, EPOCHS + 1):
    order = rng.permutation(train_idx)
    for i in range(0, len(order), CHUNK):
        idx = order[i:i + CHUNK]
        model.partial_fit(to_float(X_all[idx]), y_all[idx], classes=np.arange(62))
    acc = accuracy(model, X_val, y_val)
    print(f"epoch {epoch:2d}  validation accuracy {acc * 100:.2f}%  ({time.time() - t0:.0f}s)", flush=True)
    if acc > best_acc:
        best, best_acc, stale = copy.deepcopy(model), acc, 0
    else:
        stale += 1
        if stale >= 3:
            print("No improvement for 3 epochs, stopping.")
            break

model = best
pred = np.concatenate([model.predict(to_float(X_test[i:i + CHUNK])) for i in range(0, len(X_test), CHUNK)])
print(f"\nTest accuracy (all 62 classes): {(pred == y_test).mean() * 100:.2f}%")

# Case-insensitive accuracy: many letters look identical in both cases (c/C, o/O, s/S...)
fold = np.array([CLASSES.index(c.upper()) for c in CLASSES])
print(f"Test accuracy ignoring case:    {(fold[pred] == fold[y_test]).mean() * 100:.2f}%")

print("\nPer-character accuracy:")
row = []
for k, ch in enumerate(CLASSES):
    m = y_test == k
    row.append(f"{ch}:{(pred[m] == k).mean() * 100:3.0f}%")
    if len(row) == 10:
        print("  ".join(row)); row = []
print("  ".join(row))

joblib.dump({"model": model, "classes": CLASSES}, "char_model.joblib")
print("\nSaved model to char_model.joblib")
