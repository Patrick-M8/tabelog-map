from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path

import requests
from requests.adapters import HTTPAdapter, Retry

from .config import google_api_key

PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
PLACES_DETAILS_URL = "https://places.googleapis.com/v1/{resource_name}"
GEOCODING_URL = "https://maps.googleapis.com/maps/api/geocode/json"
SEARCH_FIELD_MASK = ",".join(
    [
        "places.id",
        "places.name",
        "places.displayName",
        "places.formattedAddress",
        "places.location",
        "places.rating",
        "places.userRatingCount",
        "places.googleMapsUri",
        "places.businessStatus",
    ]
)
DETAIL_FIELD_MASK = ",".join(
    [
        "id",
        "name",
        "displayName",
        "formattedAddress",
        "location",
        "rating",
        "userRatingCount",
        "googleMapsUri",
        "businessStatus",
    ]
)
NON_WORD_RE = re.compile(r"[^a-z0-9]+")
PLACE_ID_FROM_URL_RE = re.compile(r"place_id:([^&/?]+)")


def utc_timestamp():
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def make_session():
    session = requests.Session()
    retries = Retry(total=5, backoff_factor=0.6, status_forcelist=(429, 500, 502, 503, 504))
    session.mount("https://", HTTPAdapter(max_retries=retries))
    session.headers.update(
        {
            "User-Agent": (
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36"
            )
        }
    )
    return session


def normalize_name(value: str | None):
    if not value:
        return ""
    lowered = value.lower()
    lowered = NON_WORD_RE.sub(" ", lowered)
    return " ".join(part for part in lowered.split() if part)


def _blank(value):
    return value is None or (isinstance(value, str) and not value.strip())


def _float_or_none(value):
    try:
        return float(value) if value is not None and value != "" else None
    except (TypeError, ValueError):
        return None


def missing_google_fields(record: dict):
    return {
        "place_id": _blank(record.get("place_id")),
        "coordinates": _float_or_none(record.get("lat")) is None or _float_or_none(record.get("lng")) is None,
        "google_maps_url": _blank(record.get("google_maps_url")),
        "google_rating": _blank(record.get("google_rating")) and _blank(record.get("g_rating")),
        "google_reviews": _blank(record.get("google_reviews")) and _blank(record.get("g_reviews")),
        "business_status": _blank(record.get("business_status")),
    }


def place_id_from_details(payload: dict):
    value = payload.get("id")
    if value:
        return value
    resource_name = payload.get("name")
    if isinstance(resource_name, str) and "/" in resource_name:
        return resource_name.rsplit("/", 1)[-1]
    return None


def place_id_from_maps_url(url: str | None):
    if not url:
        return None
    match = PLACE_ID_FROM_URL_RE.search(url)
    if match:
        return match.group(1)
    return None


def google_maps_url(place_payload: dict):
    if place_payload.get("googleMapsUri"):
        return place_payload["googleMapsUri"]
    place_id = place_id_from_details(place_payload)
    if place_id:
        return f"https://www.google.com/maps/place/?q=place_id:{place_id}"
    return ""


class GooglePlacesClient:
    def __init__(self, *, api_key: str | None = None, cwd: Path | None = None, session: requests.Session | None = None):
        self.api_key = api_key or google_api_key(cwd=cwd, required=True)
        self.session = session or make_session()

    def _post_json(self, url: str, payload: dict, *, field_mask: str):
        response = self.session.post(
            url,
            json=payload,
            timeout=15,
            headers={
                "X-Goog-Api-Key": self.api_key,
                "X-Goog-FieldMask": field_mask,
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()
        return response.json()

    def _get_json(self, url: str, *, field_mask: str | None = None, params: dict | None = None):
        headers = {"X-Goog-Api-Key": self.api_key}
        if field_mask:
            headers["X-Goog-FieldMask"] = field_mask
        response = self.session.get(url, params=params, timeout=15, headers=headers)
        response.raise_for_status()
        return response.json()

    def search_text(self, text_query: str, *, language_code: str = "ja"):
        return self._post_json(
            PLACES_SEARCH_URL,
            {
                "textQuery": text_query,
                "languageCode": language_code,
                "maxResultCount": 5,
            },
            field_mask=SEARCH_FIELD_MASK,
        )

    def place_details(self, resource_name: str):
        return self._get_json(
            PLACES_DETAILS_URL.format(resource_name=resource_name),
            field_mask=DETAIL_FIELD_MASK,
        )

    def geocode(self, address: str):
        return self._get_json(
            GEOCODING_URL,
            params={"address": address, "key": self.api_key},
        )


def _query_variants(record: dict):
    name_variants = [
        record.get("name"),
        record.get("name_en"),
        record.get("g_name"),
    ]
    area = record.get("area")
    address = record.get("tabelog_address") or record.get("g_address")
    variants = []
    for name in name_variants:
        if not name:
            continue
        variants.append(" ".join(part for part in [name, area] if part))
        if address:
            variants.append(" ".join(part for part in [name, address] if part))
    return list(dict.fromkeys([variant for variant in variants if variant]))


def _candidate_score(record: dict, candidate: dict):
    place_name = normalize_name((candidate.get("displayName") or {}).get("text") or "")
    record_names = [normalize_name(record.get("name")), normalize_name(record.get("name_en")), normalize_name(record.get("g_name"))]
    record_names = [name for name in record_names if name]
    address_blob = normalize_name(candidate.get("formattedAddress") or "")
    area_blob = normalize_name(record.get("area") or "")

    score = 0
    for record_name in record_names:
        if record_name == place_name:
            score += 4
        elif record_name and record_name in place_name:
            score += 2
    if area_blob and area_blob in address_blob:
        score += 2
    if candidate.get("businessStatus") == "OPERATIONAL":
        score += 1
    if candidate.get("rating") is not None:
        score += 1
    return score


def is_valid_google_match(record: dict, candidate: dict, *, minimum_score: int = 4):
    return _candidate_score(record, candidate) >= minimum_score


def _normalize_place_payload(place_payload: dict):
    location = place_payload.get("location") or {}
    place_id = place_id_from_details(place_payload)
    return {
        "place_id": place_id or "",
        "g_name": (place_payload.get("displayName") or {}).get("text", ""),
        "g_address": place_payload.get("formattedAddress", ""),
        "lat": location.get("latitude"),
        "lng": location.get("longitude"),
        "g_rating": place_payload.get("rating"),
        "g_reviews": place_payload.get("userRatingCount", 0),
        "google_maps_url": google_maps_url(place_payload),
        "business_status": place_payload.get("businessStatus"),
        "google_last_updated_at": utc_timestamp(),
    }


def clear_google_match(record: dict, *, reason: str):
    return {
        "place_id": "",
        "g_name": record.get("g_name") or "",
        "g_address": record.get("g_address") or record.get("tabelog_address") or "",
        "lat": record.get("lat"),
        "lng": record.get("lng"),
        "g_rating": None,
        "g_reviews": 0,
        "google_maps_url": "",
        "business_status": None,
        "google_match_method": reason,
        "google_match_confidence": "low",
        "google_last_updated_at": utc_timestamp(),
    }


def resolve_google_place(
    record: dict,
    client: GooglePlacesClient,
    *,
    prefer_existing_place_id: bool = True,
    minimum_match_score: int = 4,
    clear_invalid_existing_place_id: bool = False,
):
    existing_place_id = record.get("place_id") or place_id_from_maps_url(record.get("google_maps_url"))
    invalid_existing_place_id = False
    if prefer_existing_place_id and existing_place_id:
        try:
            detailed = client.place_details(f"places/{existing_place_id}")
        except requests.HTTPError:
            detailed = None
        if detailed:
            if is_valid_google_match(record, detailed, minimum_score=minimum_match_score):
                normalized = _normalize_place_payload(detailed)
                normalized["google_match_method"] = "placeDetails:existingPlaceId"
                normalized["google_match_confidence"] = "high"
                return normalized
            invalid_existing_place_id = True

    best_candidate = None
    best_score = -1
    best_method = None

    for query in _query_variants(record):
        payload = client.search_text(query)
        for candidate in payload.get("places", []):
            score = _candidate_score(record, candidate)
            if score > best_score:
                best_score = score
                best_candidate = candidate
                best_method = f"searchText:{query}"

    if best_candidate and best_score >= minimum_match_score:
        resource_name = best_candidate.get("name")
        detailed = client.place_details(resource_name) if resource_name else best_candidate
        normalized = _normalize_place_payload(detailed)
        normalized["google_match_method"] = best_method
        normalized["google_match_confidence"] = "high" if best_score >= 6 else "medium"
        return normalized

    address = record.get("tabelog_address") or record.get("g_address")
    if address:
        geocoded = client.geocode(address)
        if geocoded.get("results"):
            top = geocoded["results"][0]
            location = (top.get("geometry") or {}).get("location") or {}
            fallback = {
                "place_id": record.get("place_id") or "",
                "g_name": record.get("g_name") or record.get("name_en") or record.get("name") or "",
                "g_address": top.get("formatted_address", ""),
                "lat": location.get("lat"),
                "lng": location.get("lng"),
                "g_rating": record.get("g_rating") or record.get("google_rating"),
                "g_reviews": record.get("g_reviews") or record.get("google_reviews") or 0,
                "google_maps_url": record.get("google_maps_url") or "",
                "business_status": record.get("business_status"),
                "google_match_method": "geocode",
                "google_match_confidence": "low",
                "google_last_updated_at": utc_timestamp(),
            }
            if invalid_existing_place_id and clear_invalid_existing_place_id:
                fallback["place_id"] = ""
                fallback["google_maps_url"] = ""
                fallback["g_rating"] = None
                fallback["g_reviews"] = 0
                fallback["business_status"] = None
                fallback["google_match_method"] = "repair:clearedInvalidExistingPlaceIdAfterGeocode"
            return fallback

    if invalid_existing_place_id and clear_invalid_existing_place_id:
        return clear_google_match(record, reason="repair:clearedInvalidExistingPlaceId")

    return None


def should_backfill_google(record: dict, *, include_business_status: bool = True):
    missing = missing_google_fields(record)
    hard_gaps = (
        missing["place_id"]
        or missing["coordinates"]
        or missing["google_maps_url"]
        or missing["google_rating"]
        or missing["google_reviews"]
    )
    return hard_gaps or (include_business_status and missing["business_status"])


def merge_google_fields(record: dict, enrichment: dict):
    merged = dict(record)
    merged.update(
        {
            "place_id": enrichment.get("place_id") or record.get("place_id", ""),
            "g_name": enrichment.get("g_name") or record.get("g_name", ""),
            "g_address": enrichment.get("g_address") or record.get("g_address", ""),
            "lat": enrichment.get("lat", record.get("lat")),
            "lng": enrichment.get("lng", record.get("lng")),
            "g_rating": enrichment.get("g_rating", record.get("g_rating")),
            "g_reviews": enrichment.get("g_reviews", record.get("g_reviews")),
            "google_rating": enrichment.get("g_rating", record.get("google_rating")),
            "google_reviews": enrichment.get("g_reviews", record.get("google_reviews")),
            "google_maps_url": enrichment.get("google_maps_url") or record.get("google_maps_url", ""),
            "business_status": enrichment.get("business_status") or record.get("business_status"),
            "google_match_method": enrichment.get("google_match_method") or record.get("google_match_method"),
            "google_match_confidence": enrichment.get("google_match_confidence") or record.get("google_match_confidence"),
            "google_last_updated_at": enrichment.get("google_last_updated_at") or record.get("google_last_updated_at"),
        }
    )
    return merged


def summarize_google_update(records_before: list[dict], records_after: list[dict]):
    updates = []
    for before, after in zip(records_before, records_after, strict=False):
        if json.dumps(before, ensure_ascii=False, sort_keys=True) == json.dumps(after, ensure_ascii=False, sort_keys=True):
            continue
        updates.append(after.get("url") or after.get("name"))
    return updates
