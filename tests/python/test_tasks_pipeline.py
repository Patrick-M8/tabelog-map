from __future__ import annotations

import json
import shutil
import unittest
import uuid
from pathlib import Path

from scripts.pipeline.tasks import backfill_google_records, refresh_tabelog_hours_records


class TasksPipelineTests(unittest.TestCase):
    def _make_temp_root(self):
        tmp_root = Path(".tmp") / "test-tasks"
        tmp_root.mkdir(parents=True, exist_ok=True)
        temp_dir = tmp_root / uuid.uuid4().hex
        temp_dir.mkdir()
        self.addCleanup(lambda: shutil.rmtree(temp_dir, ignore_errors=True))
        return temp_dir

    def test_backfill_google_dry_run_reports_dataset_scope_without_queue(self):
        root = self._make_temp_root()
        records = [
            {
                "url": "https://example.com/a",
                "place_id": "place-1",
                "lat": 35.0,
                "lng": 139.0,
                "google_maps_url": "https://maps.example/place-1",
                "google_rating": 4.2,
                "google_reviews": 12,
                "business_status": "",
            },
            {
                "url": "https://example.com/b",
                "place_id": "place-2",
                "lat": 35.1,
                "lng": 139.1,
                "google_maps_url": "https://maps.example/place-2",
                "google_rating": 4.4,
                "google_reviews": 22,
                "business_status": "OPERATIONAL",
            },
        ]
        (root / "records.json").write_text(json.dumps(records), encoding="utf-8")

        summary = backfill_google_records(
            root=root,
            status_only=True,
            dry_run=True,
        )

        self.assertEqual(summary["selectedUrlCount"], 1)
        self.assertEqual(summary["attemptedCount"], 1)

    def test_refresh_tabelog_hours_dry_run_reports_dataset_scope_without_queue(self):
        root = self._make_temp_root()
        records = [
            {
                "url": "https://example.com/a",
                "hours_raw": [],
                "hours_notes_structured": {},
            },
            {
                "url": "https://example.com/b",
                "hours_raw": [{"title": "Mon", "dtl": "18:00-23:00"}],
                "hours_notes_structured": {},
            },
        ]
        (root / "records.json").write_text(json.dumps(records), encoding="utf-8")

        summary = refresh_tabelog_hours_records(
            root=root,
            structural_only=True,
            dry_run=True,
        )

        self.assertEqual(summary["selectedUrlCount"], 1)
        self.assertEqual(summary["attemptedCount"], 1)


if __name__ == "__main__":
    unittest.main()
