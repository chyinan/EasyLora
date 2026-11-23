"""CPU checks of the training boundary. The stand-in child does not train a model."""
import json

from pathlib import Path
import struct
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import Mock, patch

from EasyLora import config, train


def tiny_adapter(keys=("lora_unet_test.lora_down.weight", "lora_unet_test.lora_up.weight")):
    header = {k: {"dtype": "F32", "shape": [1, 1], "data_offsets": [4 * i, 4 * (i + 1)]}
              for i, k in enumerate(keys)}
    buf = json.dumps(header).encode()
    buf += b" " * (-len(buf) % 8)
    return struct.pack("<Q", len(buf)) + buf + b"\0" * (4 * len(header))


class TrainerTests(unittest.TestCase):
    def setUp(self):
        td = tempfile.TemporaryDirectory()
        self.addCleanup(td.cleanup)
        self.root = Path(td.name)
        self.out = self.root / "outputs"
        self.scripts = self.root / "sd-scripts"
        self.scripts.mkdir()
        self.dataset = self.root / "dataset"
        self.dataset.mkdir()
        self.image = self.dataset / "one.png"
        self.image.write_bytes(b"input image fixture")
        self.image.with_suffix(".txt").write_text("a red square, minimal image", encoding="utf-8")
        self.log = []
        self.progress = []
        self.callbacks = train.TrainCallbacks(self.log.append, lambda *p: self.progress.append(p))
        self.settings = {**config.get_settings(), "DEFAULT_OUTPUT_DIR": str(self.out),
                         "DEFAULT_KOHYA_SCRIPTS_DIR": str(self.scripts),
                         "DEFAULT_MODEL_512": "vendor/base-v1", "DEFAULT_MODEL_768": "vendor/base-v2",
                         "DEFAULT_MODEL_SDXL": "vendor/portrait", "OUTPUT_LORA_FILENAME": "{name}_{steps}.safetensors",
                         "COPY_TO_SD_WEBUI_ON_FINISH": True, "USE_XFORMERS": False, "USE_SDPA": True,
                         "MIXED_PRECISION": "fp16"}
        for owner in (train, config):
            ctx = patch.object(owner, "get_settings", return_value=self.settings)
            ctx.start()
            self.addCleanup(ctx.stop)
        gpu = Mock()
        gpu.cuda.is_available.return_value = True
        gpu.cuda.get_device_properties.return_value.total_memory = 16 * 1024**3
        ctx = patch.object(train, "require_cuda", return_value=gpu)
        ctx.start()
        self.addCleanup(ctx.stop)

    def launch(self, family="SD1.5", **kw):
        return train.train_lora(self.root, self.dataset, [self.image], 2048, self.root / "webui", self.callbacks,
                                model_name="demo", base_model=family, **{"override_steps": 10, **kw})

    def script(self, body, sdxl=False):
        runner = self.scripts / ("sdxl_train_network.py" if sdxl else "train_network.py")
        runner.write_text(
            "from pathlib import Path\nimport json,sys,time,os\n"
            "def opt(key): return sys.argv[sys.argv.index(key)+1]\n"
            "out=Path(opt('--output_dir')); name=opt('--output_name')\n"
            "final=out/(name+'.safetensors')\n" + body + "\n", encoding="utf-8",
        )

    def test_missing_kohya_fails_without_dummy(self):
        with self.assertRaisesRegex(RuntimeError, "train_network.py"):
            self.launch()
        self.assertFalse(self.out.exists())
        self.assertFalse(self.progress)

    def test_selects_sdxl_script_by_family_not_filename_and_publishes_final(self):
        self.script(f"assert '--no_half_vae' in sys.argv and '--sdpa' in sys.argv\n"
                    "assert '--sdxl' not in sys.argv and '--v2' not in sys.argv\n"
                    "assert opt('--pretrained_model_name_or_path') == 'vendor/portrait'\n"
                    "print('steps: 2/10',flush=True)\n"
                    f"final.write_bytes({tiny_adapter()!r})", sdxl=True)
        out = self.launch("SDXL")
        self.assertEqual(out, self.out / "demo_10.safetensors")
        self.assertEqual(out.read_bytes(), tiny_adapter())
        self.assertEqual((self.root / "webui" / out.name).read_bytes(), out.read_bytes())
        self.assertIn((0.2, 2, 10), [(p[0], p[2], p[3]) for p in self.progress])

    def test_sd1_and_sd2_use_distinct_command(self):
        for family, v2 in [("SD1.5", False), ("SD2.1", True)]:
            self.script(f"assert ('--v2' in sys.argv) == {v2}\n"
                        f"assert ('--v_parameterization' in sys.argv) == {v2}\n"
                        "assert '--no_half_vae' not in sys.argv and '--sdpa' in sys.argv\n"
                        f"final.write_bytes({tiny_adapter()!r})")
            self.assertTrue(self.launch(family).is_file())

    def test_checkpoint_only_or_placeholder_never_replaces_previous_final(self):
        self.out.mkdir()
        prior = self.out / "demo_10.safetensors"
        prior.write_bytes(b"old artifact")
        for code in ("(out/(name+'-step00000005.safetensors')).write_bytes(b'partial')",
                     f"final.write_bytes({tiny_adapter(('dummy',))!r})",
                     "final.write_bytes(b'truncated')",
                     "raise SystemExit(2)"):
            self.script(code)
            with self.assertRaises(RuntimeError):
                self.launch()
            self.assertEqual(prior.read_bytes(), b"old artifact")
            self.assertFalse((self.root / "webui" / prior.name).exists())

    def test_snapshot_excludes_unselected_pairs_and_honors_bucket_batch(self):
        (self.dataset / "unselected.png").write_bytes(b"other")
        self.settings["ENABLE_BUCKET"] = False
        self.settings["DEFAULT_BATCH_SIZE"] = 2
        self.script("import tomllib\n"
                    "cfg=tomllib.loads(Path(opt('--dataset_config')).read_text(encoding='utf-8')); "
                    "images=Path(cfg['datasets'][0]['subsets'][0]['image_dir'])\n"
                    "assert len(list(images.glob('*.png'))) == len(list(images.glob('*.txt'))) == 1\n"
                    "assert '--enable_bucket' not in sys.argv and opt('--train_batch_size') == '2'\n"
                    f"final.write_bytes({tiny_adapter()!r})")
        if sys.version_info < (3, 11):
            self.skipTest("fixture parses TOML using Python 3.11+ stdlib")
        self.launch()

    def test_resume_uses_complete_matching_run_not_changed_dataset_or_optimizer(self):
        state_writer = (
            "state=out/(name+'-step00000005-state'); state.mkdir()\n"
            "for file in ('model.safetensors','optimizer.bin','scheduler.bin','random_states_0.pkl'): (state/file).write_bytes(b'fixture')\n"
            "(state/'train_state.json').write_text(json.dumps({'current_step':5}))\n"
            "raise SystemExit(2)"
        )
        self.settings["DEFAULT_GRAD_ACCUM"] = 2
        self.script(state_writer)
        with self.assertRaises(RuntimeError):
            self.launch(override_save_every=5)
        self.script("assert Path(opt('--resume')).name == 'adapter-step00000005-state'\n"
                    "assert opt('--initial_step') == '0' and opt('--max_train_steps') == '15'\n" + state_writer)
        with self.assertRaises(RuntimeError):
            self.launch(override_steps=20, override_auto_resume=True)
        # Second resumed run counts the 5 steps completed before each interruption.
        self.script("assert opt('--max_train_steps') == '10'\n"
                    "print('steps: 2/10')\n" + f"final.write_bytes({tiny_adapter()!r})")
        self.launch(override_steps=20, override_auto_resume=True)
        self.assertIn((12, 20), [(p[2], p[3]) for p in self.progress])
        self.script("assert '--resume' not in sys.argv\n" + f"final.write_bytes({tiny_adapter()!r})")
        self.launch(override_auto_resume=True, optimizer_type="Lion")
        self.image.with_suffix(".txt").write_text("a different labeled drawing", encoding="utf-8")
        self.launch(override_auto_resume=True)
        state = next(self.out.rglob("adapter-step00000005-state"))
        with self.assertRaisesRegex(RuntimeError, "已完成"):
            train.find_resume_state(state.parent.parent, 5)
        for last_rng in state.parent.parent.rglob("random_states_0.pkl"):
            last_rng.unlink()
        with self.assertRaisesRegex(RuntimeError, "没有完整"):
            train.find_resume_state(state.parent.parent, 10)

    def test_resume_falls_back_from_interrupted_write_and_rejects_custom_horizon(self):
        history = self.root / "history"
        earlier = history / "run-a" / "adapter-step00000003-state"
        partial = history / "run-b" / "adapter-step00000004-state"
        for folder, step in ((earlier, 3), (partial, 4)):
            folder.mkdir(parents=True)
            (folder / "train_state.json").write_text(json.dumps({"current_step": step}))
        for f in ("model.safetensors", "optimizer.bin", "scheduler.bin", "random_states_0.pkl"):
            (earlier / f).write_bytes(b"fixture")
        self.assertEqual(train.find_resume_state(history, 10), (earlier, 3))
        builder = train.KohyaCommandBuilder(Mock(), {"EXTRA_ARGS": "--lr_scheduler cosine"})
        builder.add_save_settings(0, True, earlier)
        with self.assertRaisesRegex(ValueError, "恒定学习率"):
            builder.add_extra_args()

    def test_cancels_silent_subprocess_without_publishing(self):
        started = self.root / "started"
        self.script(f"Path({str(started)!r}).touch()\ntime.sleep(20)")
        stop = threading.Event()
        def cancel():
            deadline = time.monotonic() + 4
            while not started.exists() and time.monotonic() < deadline:
                time.sleep(0.02)
            stop.set()
        thread = threading.Thread(target=cancel)
        thread.start()
        t = time.monotonic()
        try:
            with self.assertRaisesRegex(RuntimeError, "已取消"):
                self.launch(stop_event=stop)
        finally:
            thread.join()
        self.assertTrue(started.exists())
        self.assertLess(time.monotonic() - t, 8)
        self.assertFalse((self.out / "demo_10.safetensors").exists())

    def test_export_copy_failure_preserves_valid_local_result(self):
        self.script(f"final.write_bytes({tiny_adapter()!r})")
        (self.root / "webui").write_bytes(b"not a directory")
        self.assertTrue(self.launch().is_file())
        self.assertTrue(any("复制到 WebUI 失败" in line for line in self.log))


if __name__ == "__main__":
    unittest.main()
