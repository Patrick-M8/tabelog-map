from __future__ import annotations

import shutil
import unittest
import uuid
from pathlib import Path

from scripts.pipeline.selection import ordered_queue_urls, select_queue_rows


class SelectionPipelineTests(unittest.TestCase):
    def test_select_queue_rows_filters_by_bool_and_category(self):
        tmp_root = Path(".tmp") / "test-selection"
        tmp_root.mkdir(parents=True, exist_ok=True)
        temp_dir = tmp_root / uuid.uuid4().hex
        temp_dir.mkdir()
        self.addCleanup(lambda: shutil.rmtree(temp_dir, ignore_errors=True))

        queue_path = temp_dir / "queue.csv"
        queue_path.write_text(
            "\n".join(
                [
                    "url,category,missing_google_core,missing_hours_structural",
                    "https://example.com/a,Standing Bar,true,false",
                    "https://example.com/b,Chicken,true,true",
                    "https://example.com/c,Sushi,false,true",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

        selection = select_queue_rows(
            queue_csv=queue_path,
            categories=["Standing Bar,Chicken"],
            where=["missing_google_core=true"],
        )

        self.assertEqual(selection["queueRowCount"], 3)
        self.assertEqual(selection["selectedRowCount"], 2)
        self.assertEqual(
            selection["selectedUrls"],
            ["https://example.com/a", "https://example.com/b"],
        )

    def test_ordered_queue_urls_honors_priority_categories(self):
        rows = [
            {"url": "https://example.com/a", "category": "Sushi"},
            {"url": "https://example.com/b", "category": "Chicken"},
            {"url": "https://example.com/c", "category": "Standing Bar"},
        ]

        ordered = ordered_queue_urls(
            rows,
            priority_categories=["Standing Bar", "Chicken"],
        )

        self.assertEqual(
            ordered,
            ["https://example.com/c", "https://example.com/b", "https://example.com/a"],
        )


if __name__ == "__main__":
    unittest.main()
