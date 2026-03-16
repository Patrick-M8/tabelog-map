from __future__ import annotations

import unittest

from scripts.pipeline.google import missing_google_fields, resolve_google_place, should_backfill_google


class FakeGoogleClient:
    def __init__(self):
        self.queries = []
        self.geocoded_addresses = []
        self.detail_requests = []

    def search_text(self, text_query: str, *, language_code: str = "ja"):
        self.queries.append((text_query, language_code))
        return {"places": []}

    def place_details(self, resource_name: str):
        self.detail_requests.append(resource_name)
        return {
            "id": resource_name.rsplit("/", 1)[-1],
            "name": resource_name,
            "displayName": {"text": "Sample Bar"},
            "formattedAddress": "1-2-3 Example, Tokyo",
            "location": {"latitude": 35.123456, "longitude": 139.654321},
            "rating": 4.4,
            "userRatingCount": 321,
            "googleMapsUri": "https://www.google.com/maps/place/?q=place_id:abc123",
            "businessStatus": "OPERATIONAL",
        }

    def geocode(self, address: str):
        self.geocoded_addresses.append(address)
        return {
            "results": [
                {
                    "formatted_address": "1-2-3 Example, Tokyo",
                    "geometry": {"location": {"lat": 35.123456, "lng": 139.654321}},
                }
            ]
        }


class GooglePipelineTests(unittest.TestCase):
    def test_geocode_fallback_populates_google_fields_when_search_has_no_match(self):
        client = FakeGoogleClient()
        record = {
            "name": "Sample Bar",
            "name_en": "Sample Bar",
            "area": "Tokyo Shinjuku",
            "tabelog_address": "Tokyo-to Shinjuku-ku 1-2-3",
            "place_id": "",
            "g_name": "",
            "g_address": "",
            "google_maps_url": "",
            "google_rating": "",
            "google_reviews": "",
            "business_status": "",
        }

        enrichment = resolve_google_place(record, client)

        self.assertIsNotNone(enrichment)
        self.assertEqual(enrichment["google_match_method"], "geocode")
        self.assertEqual(enrichment["google_match_confidence"], "low")
        self.assertEqual(enrichment["g_address"], "1-2-3 Example, Tokyo")
        self.assertAlmostEqual(enrichment["lat"], 35.123456)
        self.assertAlmostEqual(enrichment["lng"], 139.654321)
        self.assertTrue(enrichment["google_last_updated_at"].endswith("Z"))
        self.assertEqual(client.geocoded_addresses, ["Tokyo-to Shinjuku-ku 1-2-3"])

    def test_standing_bar_with_missing_coordinates_is_marked_for_backfill(self):
        record = {
            "category_en": "Standing Bar",
            "place_id": "",
            "lat": None,
            "lng": None,
            "google_maps_url": "",
            "google_rating": "",
            "google_reviews": "",
            "business_status": "",
        }

        missing = missing_google_fields(record)

        self.assertTrue(missing["coordinates"])
        self.assertTrue(missing["place_id"])
        self.assertTrue(missing["google_rating"])
        self.assertTrue(missing["google_reviews"])
        self.assertTrue(should_backfill_google(record))

    def test_existing_place_id_uses_place_details_before_search_text(self):
        client = FakeGoogleClient()
        enrichment = resolve_google_place(
            {
                "place_id": "abc123",
                "google_maps_url": "",
                "name": "Sample Bar",
                "name_en": "Sample Bar",
                "g_name": "",
                "area": "Tokyo",
            },
            client,
        )

        self.assertIsNotNone(enrichment)
        self.assertEqual(client.detail_requests, ["places/abc123"])
        self.assertEqual(client.queries, [])
        self.assertEqual(enrichment["business_status"], "OPERATIONAL")
        self.assertEqual(enrichment["google_match_method"], "placeDetails:existingPlaceId")
        self.assertEqual(enrichment["google_match_confidence"], "high")

    def test_business_status_gap_is_tracked_separately_from_core_google_fields(self):
        record = {
            "place_id": "abc123",
            "lat": 35.0,
            "lng": 139.0,
            "google_maps_url": "https://maps.example/abc123",
            "google_rating": 4.3,
            "google_reviews": 128,
            "business_status": "",
        }

        missing = missing_google_fields(record)

        self.assertFalse(missing["coordinates"])
        self.assertTrue(missing["business_status"])
        self.assertTrue(should_backfill_google(record))
        self.assertFalse(should_backfill_google(record, include_business_status=False))


if __name__ == "__main__":
    unittest.main()
