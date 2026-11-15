"""Web version: draw a character in the browser and see live predictions.

Usage (from the project root):
    .venv/bin/python web_version/server.py [--port 8000]
then open http://localhost:8000
"""
import argparse
import base64
import binascii
import io
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))  # project root, for predict.py

from PIL import Image, UnidentifiedImageError  # noqa: E402

from predict import MODES, Recognizer  # noqa: E402

STATIC = os.path.join(HERE, "static")
TYPES = {".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript"}
MAX_BODY = 5 * 1024 * 1024

rec = None  # loaded once in main()


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlparse(self.path).path
        name = "index.html" if path == "/" else path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC, name))
        ext = os.path.splitext(full)[1]
        if not full.startswith(STATIC + os.sep) or ext not in TYPES or not os.path.isfile(full):
            return self._send(404, "text/plain", b"Not found")
        with open(full, "rb") as f:
            self._send(200, TYPES[ext], f.read())

    def do_POST(self):
        url = urlparse(self.path)
        if url.path != "/predict":
            return self._send(404, "text/plain", b"Not found")
        mode = parse_qs(url.query).get("mode", ["digits"])[0]
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= MAX_BODY:
                raise ValueError("Bad request size")
            data = self.rfile.read(length).decode()
            img = Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[-1])))
            body = {"top": rec.predict(img, mode)[:6]}
        except (binascii.Error, UnidentifiedImageError, UnicodeDecodeError):
            body = {"error": "Could not read the image"}
        except ValueError as e:
            body = {"error": str(e)}
        self._send(200, "application/json", json.dumps(body).encode())

    def _send(self, code, ctype, body):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def main():
    global rec
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--port", type=int, default=8000)
    port = ap.parse_args().port
    print("Loading models...")
    rec = Recognizer()
    if rec.char_model is None:
        print("Note: char_model.joblib missing - only 'digits' mode works (modes: %s)" % ", ".join(MODES))
    print(f"Open http://localhost:{port} and draw a character (Ctrl+C to stop)")
    try:
        ThreadingHTTPServer(("localhost", port), Handler).serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
