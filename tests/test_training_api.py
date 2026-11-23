"""Real ASGI/WebSocket lifecycle; the slow GPU worker is replaced, not simulated as training."""
import tempfile
import threading
import unittest
from contextlib import ExitStack
from pathlib import Path
from time import monotonic, sleep
from unittest.mock import patch

from fastapi.testclient import TestClient

import server
from EasyLora import config


class TrainingApiTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.root = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.stack.enter_context(patch.object(server, "RAW_DIR", self.root / "raw"))
        self.stack.enter_context(patch.object(server, "THUMBNAIL_DIR", self.root / "thumbnails"))
        self.stack.enter_context(patch.object(server, "ensure_dirs"))
        self.client = self.stack.enter_context(TestClient(server.app))

    def test_stop_is_scoped_and_busy_start_does_not_clear_it(self):
        release = threading.Event()
        def worker(params, stop, notify):
            notify({"type": "log", "data": "started"})
            if not stop.wait(4) or not release.wait(4):
                raise AssertionError("stop or release not received")
            raise RuntimeError("child terminated")

        with patch.object(server, "_run_training", worker):
            with self.client.websocket_connect("/ws/train?name=one") as ws:
                self.assertEqual(ws.receive_json()["data"], "started")
                self.assertEqual(self.client.post("/api/stop").status_code, 200)
                with self.client.websocket_connect("/ws/train?name=two") as duplicate:
                    self.assertEqual(duplicate.receive_json()["type"], "error")
                self.assertEqual(self.client.get("/api/training-status").json()["status"], "stopping")
                release.set()
                self.assertEqual(ws.receive_json()["type"], "cancelled")
        self.assertEqual(self.client.get("/api/training-status").json()["status"], "cancelled")
        self.assertEqual(self.client.post("/api/stop").status_code, 409)

    def test_disconnect_leaves_one_observable_job_with_download(self):
        release = threading.Event()
        output = self.root / "fixture.safetensors"
        def worker(params, stop, notify):
            self.assertEqual(params["base_model"], "SDXL")
            notify({"type": "progress", "p": .5, "eta": "00:01"})
            if not release.wait(4):
                raise AssertionError("worker timed out")
            self.assertFalse(stop.is_set())
            output.write_bytes(b"fixture, not model weights")
            return output
        with patch.object(server, "_run_training", worker):
            with self.client.websocket_connect("/ws/train?base_model=SDXL") as ws:
                self.assertEqual(ws.receive_json()["p"], .5)
            snapshot = self.client.get("/api/training-status").json()
            self.assertEqual((snapshot["status"], snapshot["progress"]["p"]), ("running", .5))
            self.assertIsNone(snapshot["download_url"])
            release.set()
            deadline = monotonic() + 4
            while monotonic() < deadline:
                snapshot = self.client.get("/api/training-status").json()
                if snapshot["status"] == "completed":
                    break
                sleep(.01)
        self.assertEqual(snapshot["status"], "completed")
        self.assertEqual(snapshot["path"], str(output))
        self.assertEqual(self.client.get(snapshot["download_url"]).content, output.read_bytes())

    def test_failed_job_has_no_download_and_can_be_retried(self):
        self.assertEqual(self.client.get("/api/training-status").json()["status"], "idle")
        absent = self.root / "absent"
        with patch.object(server, "_run_training", return_value=absent):
            with self.client.websocket_connect("/ws/train") as ws:
                self.assertEqual(ws.receive_json()["type"], "error")
        snapshot = self.client.get("/api/training-status").json()
        self.assertEqual(snapshot["status"], "failed")
        self.assertIsNone(snapshot["download_url"])
        output = self.root / "retry"
        output.write_bytes(b"retry")
        with patch.object(server, "_run_training", return_value=output):
            with self.client.websocket_connect("/ws/train") as ws:
                self.assertEqual(ws.receive_json()["type"], "done")
        self.assertEqual(self.client.get("/api/training-status").json()["status"], "completed")

    def test_shutdown_requests_stop_after_browser_disconnect(self):
        stopped = threading.Event()
        def worker(params, stop, notify):
            notify({"type": "log", "data": "started"})
            if stop.wait(4):
                stopped.set()
            raise RuntimeError("shutdown")
        with patch.object(server, "_run_training", worker):
            with self.client.websocket_connect("/ws/train") as ws:
                self.assertEqual(ws.receive_json()["data"], "started")
            self.stack.close()
        self.assertTrue(stopped.is_set())

    def test_partial_settings_keep_previous_values_across_reload(self):
        with patch.object(config, "USER_SETTINGS_PATH", self.root / "user_settings.json"), \
             patch.object(config, "_settings_cache", None):
            self.assertTrue(self.client.post("/api/settings", json={"DEFAULT_BATCH_SIZE": 9}).json()["ok"])
            self.assertTrue(self.client.post("/api/settings", json={"CAPTION_PREFIX": "xy"}).json()["ok"])
            config._settings_cache = None
            response = self.client.get("/api/settings").json()
            self.assertEqual((response["DEFAULT_BATCH_SIZE"], response["CAPTION_PREFIX"]), (9, "xy"))


if __name__ == "__main__":
    unittest.main()
