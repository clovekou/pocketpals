#!/bin/bash
# Double-click (macOS) to preview Pocket Pals v2: starts a tiny local web server and opens
# the game and the admin dashboard. Keep this window open while you play; close it to stop.
cd "$(dirname "$0")" || exit 1
PORT=8642
if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 is needed (https://www.python.org/downloads/)."; read -r -p "Press Enter to close." _; exit 1
fi
python3 tools/serve.py "$PORT" >/dev/null 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for _ in 1 2 3 4 5 6 7 8 9 10; do curl -s -o /dev/null "http://127.0.0.1:$PORT/" && break; sleep 0.3; done
open "http://localhost:$PORT/index.html"
open "http://localhost:$PORT/admin.html"
echo "Pocket Pals v2 is running:"
echo "  game:  http://localhost:$PORT/index.html"
echo "  admin: http://localhost:$PORT/admin.html"
echo "Close this window (or press Ctrl+C) to stop."
wait $PID
