import io
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from PIL import Image


class GalleryTests(unittest.TestCase):
    def setUp(self):
        import server
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        for key, name in (("RAW_DIR", "raw"), ("DATASET_DIR", "saved"), ("THUMBNAIL_DIR", "thumb")):
            folder = self.root / name
            folder.mkdir()
            p = patch.object(server, key, folder)
            p.start()
            self.addCleanup(p.stop)
        self.client = TestClient(server.app)
        self.addCleanup(self.client.close)
        buf = io.BytesIO()
        Image.new("RGB", (16, 12), "green").save(buf, format="PNG")
        self.img = buf.getvalue()

    def upload(self, name):
        return self.client.post("/api/upload", files={"files": (name, self.img, "image/png")})

    def test_caption_gallery_thumbnail_and_name_conflict(self):
        name = "猫 #1.PNG"
        self.assertEqual(self.upload(name).status_code, 200)
        listed = self.client.get("/api/raw-uploads").json()["images"][0]
        self.assertEqual(listed["filename"], name)
        preview = self.client.get("/api/thumbnail", params={"path": listed["path"]})
        self.assertEqual(preview.status_code, 200)
        self.assertTrue(preview.headers["content-type"].startswith("image/webp"))
        self.assertEqual(self.client.post("/api/update-caption", json={"filename": name, "caption": "猫"}).status_code, 200)
        self.assertEqual(self.client.get("/api/processed-images").json()["images"][0]["caption"], "猫")
        self.assertEqual(self.client.get("/api/raw-uploads").json()["images"], [])
        self.assertEqual(self.upload("猫 #1.jpg").status_code, 409)
        self.assertEqual((self.root / "saved" / "猫 #1.txt").read_text(encoding="utf-8"), "猫")

    def test_blank_caption_remains_editable(self):
        self.upload("cat.png").raise_for_status()
        self.client.post("/api/update-caption", json={"filename": "cat.png", "caption": ""}).raise_for_status()
        images = self.client.get("/api/processed-images").json()["images"]
        self.assertEqual([(i["filename"], i["caption"]) for i in images], [("cat.png", "")])
        self.client.post("/api/update-caption", json={"filename": "cat.png", "caption": "sks", "isProcessed": True}).raise_for_status()
        self.assertEqual((self.root / "saved" / "cat.txt").read_text(), "sks")
