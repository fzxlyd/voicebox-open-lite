from __future__ import annotations

import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

import uvicorn
import webview


def _resource_path(relative: str) -> Path:
    base = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent.parent))
    return (base / relative).resolve()


def _configure_runtime_paths() -> None:
    data_root = Path.home() / ".voxa-studio"
    output_dir = data_root / "outputs"
    output_dir.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("VOXA_OUTPUT_DIR", str(output_dir))

    if "VOXA_WEB_DIR" not in os.environ:
        bundled_web = _resource_path("web")
        os.environ["VOXA_WEB_DIR"] = str(bundled_web)

    if "VOXA_HISTORY_FILE" not in os.environ:
        os.environ["VOXA_HISTORY_FILE"] = str(output_dir / "history.json")


def _find_open_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        sock.listen(1)
        return int(sock.getsockname()[1])


def _wait_until_ready(url: str, timeout_sec: float = 12.0) -> None:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1.0) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
            time.sleep(0.2)

    raise RuntimeError("Desktop server failed to start in time")


def main() -> None:
    _configure_runtime_paths()

    from app.main import app

    port = _find_open_port()
    app_url = f"http://127.0.0.1:{port}"
    health_url = f"{app_url}/api/health"

    server = uvicorn.Server(
        uvicorn.Config(
            app=app,
            host="127.0.0.1",
            port=port,
            log_level="warning",
            access_log=False,
        )
    )

    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()

    try:
        _wait_until_ready(health_url)
    except Exception as exc:
        server.should_exit = True
        thread.join(timeout=3)
        raise RuntimeError(str(exc)) from exc

    window = webview.create_window(
        title="Voxa Studio",
        url=app_url,
        width=1360,
        height=900,
        min_size=(1024, 680),
        text_select=True,
    )

    try:
        webview.start(debug=False)
    finally:
        server.should_exit = True
        thread.join(timeout=5)


if __name__ == "__main__":
    main()
