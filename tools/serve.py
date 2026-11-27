#!/usr/bin/env python3
"""Local preview server for Pocket Pals v2 (used by start.command).

Like `python3 -m http.server`, but it tells the browser not to cache, so every refresh
loads the latest game files.   Usage: python3 tools/serve.py [port]
"""
import http.server, os, sys
from functools import partial

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, *args):        # keep the terminal quiet
        pass


class Server(http.server.ThreadingHTTPServer):
    # the default queue is only 5 connections; the Pokédex and shop load 150+ pictures at once
    request_queue_size = 256
    daemon_threads = True


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    Server(('127.0.0.1', port), partial(NoCache, directory=ROOT)).serve_forever()
