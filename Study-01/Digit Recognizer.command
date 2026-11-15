#!/bin/zsh
# Double-click in Finder to launch the handwritten digit recognizer.
cd "$(dirname "$0")"
URL="http://localhost:8000"

if lsof -ti:8000 >/dev/null 2>&1; then
  echo "App is already running - opening $URL"
  open "$URL"
  exit 0
fi

( sleep 1.5; open "$URL" ) &
echo "Starting Digit Recognizer... (close this window or press Ctrl+C to stop)"
exec .venv/bin/python app.py
