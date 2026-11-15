"""Train a handwritten-digit recognizer on MNIST (70,000 28x28 images)."""
import time

import joblib
import numpy as np
from sklearn.datasets import fetch_openml
from sklearn.metrics import accuracy_score, confusion_matrix
from sklearn.neural_network import MLPClassifier

print("Downloading MNIST (first run only, cached afterwards)...")
X, y = fetch_openml("mnist_784", version=1, return_X_y=True, as_frame=False, parser="liac-arff")
X = X.astype(np.float32) / 255.0  # scale pixels to 0..1
y = y.astype(int)

# Standard split: first 60k for training, last 10k for testing
X_train, X_test, y_train, y_test = X[:60000], X[60000:], y[:60000], y[60000:]

model = MLPClassifier(
    hidden_layer_sizes=(256, 128),
    activation="relu",
    solver="adam",
    batch_size=256,
    learning_rate_init=1e-3,
    max_iter=20,
    early_stopping=True,
    random_state=42,
    verbose=True,
)

print("Training neural network...")
t0 = time.time()
model.fit(X_train, y_train)
print(f"Training took {time.time() - t0:.1f}s")

pred = model.predict(X_test)
print(f"\nTest accuracy: {accuracy_score(y_test, pred) * 100:.2f}% on 10,000 unseen digits")
print("\nConfusion matrix (rows = true digit, cols = predicted):")
print(confusion_matrix(y_test, pred))

joblib.dump(model, "digit_model.joblib")
print("\nSaved model to digit_model.joblib")
