"""Thin HTTP API and static-file server for the myCobot application."""

from __future__ import annotations

import atexit
import argparse
import json
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from mac_hw_sandbox.mycobot_safe import DEFAULT_BAUD, DEFAULT_SPEED, SAFE_HOME_DEGREES
from mycobot_app.mujoco_model import MujocoModel, NativeViewer
from mycobot_app.real_robot import RealRobotSession, list_serial_ports


STATIC_DIR = Path(__file__).resolve().parent / "static"


class ControlSession:
    def __init__(self) -> None:
        self.real = RealRobotSession()
        self.sim = MujocoModel()
        self.active_mode = "sim"

    def active(self) -> RealRobotSession | MujocoModel:
        return self.sim if self.active_mode == "sim" else self.real

    def status(self) -> dict[str, Any]:
        if self.active_mode == "sim" and self.sim.connected:
            return self.sim.read_angles()
        return self.active().status()

    def connect(self, mode: str, port: str | None, baud: int) -> dict[str, Any]:
        if mode == "sim":
            self.active_mode = "sim"
            return self.sim.connect()
        if mode == "real":
            if not port:
                raise ValueError("A serial port is required for real robot mode.")
            self.active_mode = "real"
            return self.real.connect(port, baud)
        raise ValueError("Mode must be sim or real.")

    def apply_gamepad(self, velocity: list[float], dt: float, speed: float) -> dict[str, Any]:
        if self.active_mode != "sim":
            raise RuntimeError("Browser gamepad control is limited to MuJoCo simulation mode.")
        return self.sim.apply_gamepad(velocity, dt, speed)


SESSION = ControlSession()
VIEWER = NativeViewer()
atexit.register(VIEWER.close)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(STATIC_DIR), **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        if self.path.startswith("/api/gamepad"):
            return
        print(f"[mycobot_app] {self.address_string()} - {format % args}")

    def do_GET(self) -> None:
        path = urlparse(self.path).path
        if path == "/api/ports":
            self.write_json({"ports": list_serial_ports()})
        elif path == "/api/status":
            self.write_json(SESSION.status())
        elif path == "/api/angles":
            self.call_json(SESSION.active().read_angles)
        elif path == "/api/viewer/status":
            self.write_json(VIEWER.status())
        else:
            super().do_GET()

    def do_POST(self) -> None:
        path = urlparse(self.path).path
        body = self.read_body()
        active = SESSION.active()
        routes = {
            "/api/connect": lambda: SESSION.connect(
                str(body.get("mode", "sim")),
                body.get("port"),
                int(body.get("baud", DEFAULT_BAUD)),
            ),
            "/api/disconnect": active.disconnect,
            "/api/send_angles": lambda: active.send_angles(
                list(body["angles"]), int(body.get("speed", DEFAULT_SPEED))
            ),
            "/api/jog": lambda: active.jog(
                int(body["joint"]), float(body["delta"]), int(body.get("speed", DEFAULT_SPEED))
            ),
            "/api/home": lambda: active.send_angles(
                SAFE_HOME_DEGREES, int(body.get("speed", DEFAULT_SPEED))
            ),
            "/api/gamepad": lambda: SESSION.apply_gamepad(
                list(body["velocity"]),
                float(body.get("dt", 0.04)),
                float(body.get("speed", DEFAULT_SPEED)),
            ),
            "/api/stop": active.stop,
            "/api/release_servos": active.release_servos,
            "/api/viewer/open": lambda: VIEWER.open(
                str(body.get("server_url", "http://127.0.0.1:8000"))
            ),
        }
        action = routes.get(path)
        if action is None:
            self.write_json({"error": "Not found"}, status=404)
            return
        self.call_json(action)

    def call_json(self, action: Any) -> None:
        try:
            self.write_json({"ok": True, "data": action()})
        except SystemExit as exc:
            self.write_json({"ok": False, "error": str(exc)}, status=400)
        except Exception as exc:
            self.write_json({"ok": False, "error": str(exc)}, status=400)

    def read_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        return json.loads(self.rfile.read(length).decode("utf-8")) if length else {}

    def write_json(self, payload: dict[str, Any], status: int = 200) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def main() -> None:
    parser = argparse.ArgumentParser(description="myCobot 280 local control application")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"myCobot control: http://{args.host}:{args.port}")
    print("Main entry: python run.py")
    server.serve_forever()


if __name__ == "__main__":
    main()
