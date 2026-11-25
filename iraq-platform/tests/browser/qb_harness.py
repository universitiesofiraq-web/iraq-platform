# يشغّل خادم qb_server.mjs بقاعدة جديدة لكل فحص ويوقفه بعده.
import os, subprocess, time, urllib.request, socket, contextlib
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
@contextlib.contextmanager
def server(port=None):
    if port is None:
        s = socket.socket(); s.bind(("127.0.0.1", 0)); port = s.getsockname()[1]; s.close()
    proc = subprocess.Popen(["node", "--no-warnings", "tests/browser/qb_server.mjs", str(port)], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f"http://localhost:{port}"
    for _ in range(100):
        try: urllib.request.urlopen(base + "/qbank.html", timeout=1); break
        except Exception: time.sleep(0.1)
    else:
        proc.kill(); raise RuntimeError("server did not start")
    try: yield base
    finally: proc.terminate(); proc.wait(timeout=5)
