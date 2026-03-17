from __future__ import annotations

import os
import shutil
import unittest
import uuid
from pathlib import Path

from scripts.pipeline.config import env_value


class ConfigPipelineTests(unittest.TestCase):
    def _make_temp_root(self):
        tmp_root = Path(".tmp") / "test-config"
        tmp_root.mkdir(parents=True, exist_ok=True)
        temp_dir = tmp_root / uuid.uuid4().hex
        temp_dir.mkdir()
        self.addCleanup(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
        return temp_dir

    def test_env_value_searches_parent_directories_for_dotenv_files(self):
        root = self._make_temp_root()
        nested = root / "restaurant_data"
        nested.mkdir()
        (root / ".env.local").write_text("GOOGLE_MAPS_API_KEY=test-key\n", encoding="utf-8")

        value = env_value("GOOGLE_MAPS_API_KEY", cwd=nested)

        self.assertEqual(value, "test-key")

    def test_env_value_prefers_process_environment(self):
        root = self._make_temp_root()
        (root / ".env.local").write_text("GOOGLE_MAPS_API_KEY=file-key\n", encoding="utf-8")
        original = os.environ.get("GOOGLE_MAPS_API_KEY")
        os.environ["GOOGLE_MAPS_API_KEY"] = "env-key"
        self.addCleanup(self._restore_env, "GOOGLE_MAPS_API_KEY", original)

        value = env_value("GOOGLE_MAPS_API_KEY", cwd=root)

        self.assertEqual(value, "env-key")

    def _restore_env(self, name: str, original: str | None):
        if original is None:
            os.environ.pop(name, None)
            return
        os.environ[name] = original


if __name__ == "__main__":
    unittest.main()
