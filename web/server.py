from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse
from pathlib import Path
import subprocess
import threading
import json
import os
import sys
import time

WEB_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = WEB_DIR.parent
SCRIPT_PATH = PROJECT_ROOT / "drowsiness.py"
STATUS_FILE = WEB_DIR / "alert-status.json"

process_lock = threading.Lock()
detection_process = None
process_start_time = None


def get_status_data():
    try:
        return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {"alert": False, "timestamp": None}


def write_json_response(handler, data, status=200):
    body = json.dumps(data).encode('utf-8')
    handler.send_response(status)
    handler.send_header('Content-Type', 'application/json')
    handler.send_header('Content-Length', str(len(body)))
    handler.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
    handler.send_header('Pragma', 'no-cache')
    handler.end_headers()
    handler.wfile.write(body)


def start_detection():
    global detection_process, process_start_time
    with process_lock:
        if detection_process and detection_process.poll() is None:
            return {"running": True, "message": "Detection already running"}

        if not SCRIPT_PATH.exists():
            return {"running": False, "message": "drowsiness.py not found"}

        detection_process = subprocess.Popen(
            [sys.executable, str(SCRIPT_PATH)],
            cwd=str(PROJECT_ROOT),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0,
        )
        process_start_time = time.time()
        return {"running": True, "message": "Detection started"}


def stop_detection():
    global detection_process
    with process_lock:
        if not detection_process or detection_process.poll() is not None:
            detection_process = None
            return {"running": False, "message": "Detection already stopped"}

        detection_process.terminate()
        try:
            detection_process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            detection_process.kill()
            detection_process.wait(timeout=2)

        detection_process = None
        return {"running": False, "message": "Detection stopped"}


def process_state():
    with process_lock:
        running = detection_process is not None and detection_process.poll() is None
        return {"running": running, "started_at": process_start_time if running else None}


class AppHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/alert':
            write_json_response(self, get_status_data())
            return
        if parsed.path == '/api/process':
            write_json_response(self, process_state())
            return
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == '/api/start':
            write_json_response(self, start_detection())
            return
        if parsed.path == '/api/stop':
            write_json_response(self, stop_detection())
            return
        self.send_error(404, 'Not Found')


if __name__ == '__main__':
    port = 8000
    server_address = ('', port)
    httpd = ThreadingHTTPServer(server_address, AppHandler)
    print(f'Serving web content at http://localhost:{port}/')
    print('Press Ctrl+C to stop.')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nServer stopped.')
