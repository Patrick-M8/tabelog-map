from __future__ import annotations

import unittest
from datetime import datetime

from scripts.pipeline.hours import build_hours_payload


class HoursPipelineTests(unittest.TestCase):
    def test_open_24_hours_is_normalized_to_all_day_window(self):
        payload = build_hours_payload(
            [{"title": "Mon", "dtl": "Open 24 hours"}],
            {},
            now=datetime(2026, 3, 16, 12, 0),
        )

        self.assertEqual(payload["hoursDisplay"]["today"], "Open 24 hours")
        self.assertEqual(len(payload["weeklyTimeline"]["mon"]), 1)
        self.assertTrue(payload["weeklyTimeline"]["mon"][0]["allDay"])
        self.assertEqual(payload["weeklyTimeline"]["mon"][0]["open"], "00:00")
        self.assertEqual(payload["weeklyTimeline"]["mon"][0]["close"], "24:00")

    def test_full_day_clock_range_is_treated_as_all_day(self):
        payload = build_hours_payload(
            [{"title": "Mon", "dtl": "00:00-24:00"}],
            {},
            now=datetime(2026, 3, 16, 12, 0),
        )

        window = payload["weeklyTimeline"]["mon"][0]
        self.assertTrue(window["allDay"])
        self.assertFalse(window["crossesMidnight"])
        self.assertEqual(payload["hoursDisplay"]["today"], "Open 24 hours")

    def test_split_service_special_days_and_last_orders_are_preserved(self):
        payload = build_hours_payload(
            [
                {"title": "Mon-Fri", "dtl": "11:30-14:00 LO 13:30 17:00-22:00 LO Food 21:00 LO Drinks 21:30"},
                {"title": "Public Holiday", "dtl": "12:00-20:00"},
                {"title": "Day Before Public Holiday", "dtl": "12:00-23:00"},
                {"title": "Day After Public Holiday", "dtl": "Closed"},
            ],
            {
                "business_hours": {"Seating": {"Counter": "8 seats"}},
                "closed_on": "Irregular holidays",
            },
            now=datetime(2026, 3, 16, 12, 15),
        )

        monday_windows = payload["weeklyTimeline"]["mon"]
        self.assertEqual(len(monday_windows), 2)
        self.assertEqual(monday_windows[0]["lastOrder"], "13:30")
        self.assertEqual(
            monday_windows[1]["lastOrderDetail"],
            {"food": "21:00", "drinks": "21:30"},
        )
        self.assertIn("Break 14:00-17:00", payload["hoursDisplay"]["today"])
        self.assertEqual(len(payload["hoursSpecialDays"]["publicHoliday"]), 1)
        self.assertEqual(len(payload["hoursSpecialDays"]["dayBeforePublicHoliday"]), 1)
        self.assertEqual(payload["hoursSpecialDays"]["dayAfterPublicHoliday"], [])
        self.assertIn("Seating: Counter 8 seats", payload["hoursPolicies"])
        self.assertIn("Irregular holidays", payload["hoursPolicies"])

    def test_overnight_hours_carry_into_next_day_open_state(self):
        payload = build_hours_payload(
            [{"title": "Mon", "dtl": "18:00-02:00"}],
            {},
            now=datetime(2026, 3, 17, 1, 0),
        )

        self.assertEqual(payload["openNowMeta"]["status"], "open")
        self.assertEqual(payload["openNowMeta"]["segment"]["start"], "18:00")
        self.assertEqual(payload["openNowMeta"]["segment"]["end"], "02:00")
        self.assertTrue(payload["openNowMeta"]["crosses_midnight"])


if __name__ == "__main__":
    unittest.main()
