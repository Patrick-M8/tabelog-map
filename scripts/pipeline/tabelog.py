from __future__ import annotations

import re
import time
from pathlib import Path
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup
from requests.adapters import HTTPAdapter, Retry

from .hours import build_hours_payload

FULLWIDTH_PAREN = re.compile(r"（[^）]*）")
BRACKETED_BLOCK = re.compile(r"【[^】]*】")


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


def clean_jp_official_name(raw: str):
    if not raw:
        return ""
    without_blocks = BRACKETED_BLOCK.sub("", raw)
    without_paren = FULLWIDTH_PAREN.split(without_blocks)[0].strip()
    return re.sub(r"\s+", " ", without_paren)


def scrape_business_hours_page(page_url: str, session: requests.Session):
    response = session.get(page_url, timeout=15)
    response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")

    results = []
    for item in soup.find_all("li", class_="rstinfo-table__business-item"):
        entry = {}
        entry["list_context"] = "other" if item.find_parent("div", class_="rstinfo-table__business-other") else "main"
        for child in item.find_all(class_=re.compile(r"^rstinfo-table__business-")):
            classes = child.get("class", [])
            if "rstinfo-table__business-item" in classes:
                continue
            item_class = next((class_name for class_name in classes if class_name.startswith("rstinfo-table__business-")), None)
            if not item_class:
                continue
            key = item_class.replace("rstinfo-table__business-", "").replace("-", "_")
            entry[key] = child.get_text(" ", strip=True)
        results.append(entry)

    notice_tag = soup.find("p", class_="rstinfo-table__open-closed-notice")
    notice = notice_tag.get_text(" ", strip=True) if notice_tag else None
    if notice:
        for row in results:
            row["open_closed_notice"] = notice

    other_section = None
    other_div = soup.find("div", class_="rstinfo-table__business-other")
    if other_div:
        item = other_div.select_one("ul.rstinfo-table__business-list > li.rstinfo-table__business-item")
        if item:
            raw = item.get_text(separator="\n")
            lines = [line.strip() for line in raw.split("\n") if line.strip()]
            other_section = {"business_hours": {}, "closed_on": None}
            current = None
            for line in lines:
                if re.fullmatch(r"\[.*?\]", line):
                    current = line.strip("[]")
                    other_section["business_hours"].setdefault(current, {})
                    continue
                if re.search(r"(■\s*)?Closed on", line, re.I):
                    current = "Closed on"
                    continue
                if current == "Closed on":
                    other_section["closed_on"] = re.sub(r"^\s*[•*]\s*", "", line)
                    continue
                match = re.match(r"\[(.*?)\]\s*(.*)", line)
                if match and current:
                    key, value = match.groups()
                    other_section["business_hours"][current][key] = value

    return {"business_items": results, "other_section": other_section or {"business_hours": {}, "closed_on": None}}


def extract_english_name(soup_en: BeautifulSoup):
    display_name = soup_en.select_one("h2.display-name span")
    if display_name:
        return display_name.get_text(strip=True)

    title = (soup_en.title.string or "").strip() if soup_en.title else ""
    if not title:
        return ""
    head = title.split(" - ", 1)[0].replace("Reservation", "").strip()
    return re.sub(r"\s+", " ", head)


def extract_subcategories(soup_en: BeautifulSoup):
    for section in soup_en.select("dl.rdheader-subinfo__item"):
        title_tag = section.select_one("dt.rdheader-subinfo__item-title")
        if title_tag and "Categories" in title_tag.text:
            return [tag.get_text(strip=True) for tag in section.select("span.linktree__parent-target-text")]
    return []


def extract_tabelog_address(soup: BeautifulSoup):
    selectors = [
        "p.rstinfo-table__address",
        ".rstinfo-table__address",
        "span.rdheader-subinfo__item-target",
    ]
    for selector in selectors:
        node = soup.select_one(selector)
        if node:
            return re.sub(r"\s+", " ", node.get_text(" ", strip=True))
    return ""


def refresh_restaurant_record(record: dict, session: requests.Session | None = None, *, sleep_seconds: float = 1.0):
    if not record.get("url"):
        raise ValueError("Record is missing a Tabelog URL")

    session = session or make_session()
    url = record["url"]
    english_url = urljoin("https://tabelog.com/en/", url.split("tabelog.com/")[1]) if "tabelog.com/" in url else url

    response_jp = session.get(url, timeout=15)
    response_jp.raise_for_status()
    soup_jp = BeautifulSoup(response_jp.text, "html.parser")

    response_en = session.get(english_url, timeout=15)
    response_en.raise_for_status()
    soup_en = BeautifulSoup(response_en.text, "html.parser")

    name_jp_tag = soup_jp.select_one("h2.display-name span")
    raw_jp = name_jp_tag.get_text(strip=True) if name_jp_tag else ""
    hours_data = scrape_business_hours_page(english_url, session)

    updated = dict(record)
    updated["name"] = clean_jp_official_name(raw_jp) or record.get("name")
    updated["name_en"] = extract_english_name(soup_en) or record.get("name_en")
    updated["sub_categories"] = ", ".join(extract_subcategories(soup_en)) or record.get("sub_categories", "")
    updated["hours_raw"] = hours_data["business_items"]
    updated["hours_notes_structured"] = hours_data["other_section"]
    updated["tabelog_address"] = extract_tabelog_address(soup_jp) or record.get("tabelog_address", "")

    time.sleep(sleep_seconds)
    return updated


def should_refresh_hours(record: dict):
    if not record.get("hours_raw"):
        return True
    hours_payload = build_hours_payload(record.get("hours_raw"), record.get("hours_notes_structured"))
    covered_days = sum(1 for windows in hours_payload["weeklyTimeline"].values() if windows)
    return covered_days == 0 or hours_payload["hoursConfidence"] == "low"


def summary_of_refresh_targets(records: list[dict]):
    return [record.get("url") or record.get("name") for record in records if should_refresh_hours(record)]
