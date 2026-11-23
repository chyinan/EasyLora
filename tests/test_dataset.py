import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image

from EasyLora import config, data_utils as data


class DatasetTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.raw = self.root / "raw"
        self.gallery = self.root / "gallery"
        self.raw.mkdir()
        self.gallery.mkdir()
        self.addCleanup(patch.stopall)
        patch.object(data, "DEFAULT_WORKSPACE_DIR", self.root).start()
        patch.object(config, "_settings_cache", dict(config._DEFAULT_SETTINGS)).start()

    def image(self, directory, name, caption=None):
        path = directory / name
        Image.new("RGB", (31, 17), "red").save(path)
        if caption is not None:
            path.with_suffix(".txt").write_text(caption, encoding="utf-8")
        return path

    def test_raw_only_uses_original_filename_for_every_variant(self):
        self.image(self.raw, "red-fox.JPG")
        config._settings_cache["AUGMENT_FACTOR"] = 2
        with data.training_dataset(self.raw, self.gallery, "SD1.5") as (root, captions, images, avg):
            self.assertEqual(avg, 31)
            self.assertEqual(len(images), 2)
            for path in images:
                with Image.open(path) as img:
                    self.assertEqual(img.size, (512, 512))
                self.assertEqual((captions / (path.stem + ".txt")).read_text(), "red fox")
        self.assertFalse(root.exists())
        self.assertEqual(list(self.gallery.iterdir()), [])

    def test_augmentation_stable_for_resume(self):
        pic = Image.new("RGB", (32, 24))
        pic.putdata([(x * 6, y * 9, (x + y) * 4) for y in range(24) for x in range(32)])
        pic.save(self.raw / "photo.png")
        config._settings_cache["AUGMENT_FACTOR"] = 3
        snapshots = []
        for _ in range(2):
            with data.training_dataset(self.raw, self.gallery) as (_, _, images, _avg):
                snapshots.append([p.read_bytes() for p in images])
        self.assertEqual(snapshots[0], snapshots[1])
        self.assertEqual(len(set(snapshots[0])), 3)

    def test_short_caption_mixed_raw_and_manual_survive_two_runs(self):
        self.image(self.raw, "cat.png", "sks")
        self.image(self.gallery, "flower.jpg", "花")
        self.image(self.gallery, "blank.png", "")
        self.image(self.gallery, "old.png", "img_0032")
        before = sorted(p.name for p in self.gallery.iterdir())
        for _ in range(2):
            with data.training_dataset(self.raw, self.gallery) as (_, _, images, _avg):
                self.assertEqual(sorted(x.with_suffix(".txt").read_text() for x in images), ["sks", "花"])
        self.assertEqual(before, sorted(p.name for p in self.gallery.iterdir()))

    def test_report_bad_source_and_cleanup(self):
        (self.raw / "unreadable.jpg").write_bytes(b"not an image")
        with self.assertRaisesRegex(ValueError, "unreadable.jpg"):
            with data.training_dataset(self.raw, self.gallery):
                self.fail("unexpected successful snapshot")
        self.assertEqual(list((self.root / "temp").iterdir()), [])

    def test_missing_tags_returns_actionable_error(self):
        self.image(self.gallery, "old.jpg", "img_0001")
        with self.assertRaisesRegex(ValueError, "非空标签"):
            with data.training_dataset(self.raw, self.gallery):
                self.fail("should not start with no usable samples")

    def test_model_settings_are_live_and_family_does_not_depend_on_filename(self):
        config._settings_cache["DEFAULT_MODEL_512"] = "example/custom"
        self.assertEqual(config.auto_params_by_dataset(1, 512).model_id, "example/custom")
        self.assertEqual(config.auto_params_by_dataset(1, 768).model_family, "SD2.1")
        local = self.root / "plain.safetensors"
        local.touch()
        config._settings_cache["DEFAULT_MODEL_SDXL"] = str(local)
        self.assertEqual(config.auto_params_sdxl(1).model_family, "SDXL")
        self.assertEqual(config.auto_params_sdxl(1).model_id, str(local))
        config._settings_cache["DEFAULT_MODEL_512"] = str(self.root / "missing.safetensors")
        with self.assertRaisesRegex(ValueError, "missing.safetensors"):
            config.auto_params_by_dataset(1, 512)

    def test_portable_output_and_partial_settings(self):
        patch.object(config, "PROJECT_ROOT", self.root).start()
        patch.object(config, "USER_SETTINGS_PATH", self.root / "prefs.json").start()
        config.save_settings({"DEFAULT_OUTPUT_DIR": "my-output"})
        config.save_settings({"DEFAULT_MODEL_512": "another/model"})
        self.assertEqual(config.get_output_lora_path().parent, self.root / "my-output")
        self.assertEqual(config.format_output_filename(2), "model_2.safetensors")
        self.assertEqual(config.format_output_filename(2, "测试 LoRA"), "测试_LoRA_2.safetensors")
        self.assertIsNone(config.resolve_sd_webui_lora_dir(None))
