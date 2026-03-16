from __future__ import annotations

import unittest

from scripts.pipeline.builders import build_audit_report, derive_closure, google_core_missing


class BuildersPipelineTests(unittest.TestCase):
    def test_google_business_status_maps_to_explicit_closure_state(self):
        closure = derive_closure(
            {"business_status": "CLOSED_PERMANENTLY", "google_last_updated_at": "2026-03-15T08:00:00Z"},
            {"hoursPolicies": [], "advisories": []},
        )

        self.assertEqual(closure["state"], "permanentlyClosed")
        self.assertEqual(closure["source"], "google")
        self.assertEqual(closure["reason"], "closed permanently")
        self.assertEqual(closure["detectedAt"], "2026-03-15T08:00:00Z")

    def test_tabelog_policy_text_can_drive_temporary_closure_state(self):
        closure = derive_closure(
            {"business_status": "", "google_last_updated_at": None},
            {"hoursPolicies": ["temporarily closed for renovation"], "advisories": []},
        )

        self.assertEqual(closure["state"], "temporarilyClosed")
        self.assertEqual(closure["source"], "tabelog")
        self.assertEqual(closure["reason"], "temporarily closed")

    def test_google_core_missing_ignores_business_status_only_gaps(self):
        record = {
            "place_id": "place-1",
            "lat": 35.0,
            "lng": 139.0,
            "google_maps_url": "https://maps.example/place-1",
            "google_rating": 4.1,
            "google_reviews": 77,
            "business_status": "",
        }

        self.assertFalse(google_core_missing(record))

    def test_audit_report_splits_core_google_gaps_from_closure_status_gaps(self):
        records = [
            {
                "url": "https://example.com/active",
                "category_en": "Sushi",
                "place_id": "place-1",
                "lat": 35.0,
                "lng": 139.0,
                "google_maps_url": "https://maps.example/place-1",
                "google_rating": 4.1,
                "google_reviews": 77,
                "business_status": "",
                "hours_raw": [{"title": "Mon", "dtl": "Open 24 hours"}],
                "hours_notes_structured": {},
            },
            {
                "url": "https://example.com/standing-bar",
                "category_en": "Standing Bar",
                "place_id": "",
                "lat": None,
                "lng": None,
                "google_maps_url": "",
                "google_rating": "",
                "google_reviews": "",
                "business_status": "OPERATIONAL",
                "hours_raw": [{"title": "Tue", "dtl": "18:00-23:00"}],
                "hours_notes_structured": {},
            },
        ]

        audit = build_audit_report(records, entries=[])

        self.assertEqual(audit["allDayParseFailureCount"], 0)
        self.assertEqual(audit["unresolvedGoogleCoreCount"], 1)
        self.assertEqual(audit["missingBusinessStatusCount"], 1)
        self.assertEqual(audit["missingGoogleFieldCounts"]["coordinates"], 1)
        self.assertEqual(audit["missingGoogleFieldCounts"]["business_status"], 1)
        self.assertEqual(audit["missingCoordinatesByCategory"]["Standing Bar"], 1)


if __name__ == "__main__":
    unittest.main()
