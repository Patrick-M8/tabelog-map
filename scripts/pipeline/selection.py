from __future__ import annotations

import csv
from collections import Counter
from pathlib import Path

TRUE_VALUES = {"1", "true", "t", "yes", "y"}
FALSE_VALUES = {"0", "false", "f", "no", "n", ""}


def normalize_scalar(value):
    if value is None:
        return ""
    return str(value).strip()


def parse_where_clause(expression: str):
    if "=" not in expression:
        raise ValueError(f"Invalid filter expression '{expression}'. Expected column=value.")
    column, raw_value = expression.split("=", 1)
    column = column.strip()
    if not column:
        raise ValueError(f"Invalid filter expression '{expression}'. Missing column name.")
    return column, raw_value.strip()


def matches_expected_value(actual, expected: str):
    actual_value = normalize_scalar(actual)
    expected_value = normalize_scalar(expected)
    actual_lower = actual_value.lower()
    expected_lower = expected_value.lower()
    if expected_lower in TRUE_VALUES | FALSE_VALUES:
        if actual_lower in TRUE_VALUES | FALSE_VALUES:
            return (actual_lower in TRUE_VALUES) == (expected_lower in TRUE_VALUES)
    return actual_lower == expected_lower


def load_queue_rows(path: Path):
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        return [dict(row) for row in reader]


def _split_category_args(categories: list[str] | None):
    if not categories:
        return []
    values = []
    for item in categories:
        values.extend(part.strip() for part in item.split(",") if part.strip())
    return values


def select_queue_rows(
    *,
    queue_csv: Path,
    url_column: str = "url",
    category_column: str = "category",
    categories: list[str] | None = None,
    where: list[str] | None = None,
):
    rows = load_queue_rows(queue_csv)
    if not rows:
        return {
            "queueRowCount": 0,
            "selectedRowCount": 0,
            "selectedUrlCount": 0,
            "selectedRows": [],
            "selectedUrls": [],
            "selectedCategoryCounts": {},
        }

    required_columns = {url_column}
    if categories:
        required_columns.add(category_column)
    for column, _ in [parse_where_clause(expression) for expression in (where or [])]:
        required_columns.add(column)

    missing_columns = sorted(column for column in required_columns if column not in rows[0])
    if missing_columns:
        raise ValueError(f"Queue file {queue_csv} is missing required columns: {', '.join(missing_columns)}")

    normalized_categories = {value.lower() for value in _split_category_args(categories)}
    filters = [parse_where_clause(expression) for expression in (where or [])]

    selected_rows = []
    for row in rows:
        if normalized_categories:
            category_value = normalize_scalar(row.get(category_column)).lower()
            if category_value not in normalized_categories:
                continue
        if any(not matches_expected_value(row.get(column), expected) for column, expected in filters):
            continue
        selected_rows.append(row)

    selected_urls = []
    seen_urls = set()
    for row in selected_rows:
        url = normalize_scalar(row.get(url_column))
        if not url or url in seen_urls:
            continue
        selected_urls.append(url)
        seen_urls.add(url)

    selected_category_counts = Counter(
        normalize_scalar(row.get(category_column)) or "Unknown"
        for row in selected_rows
        if category_column in row
    )
    return {
        "queueRowCount": len(rows),
        "selectedRowCount": len(selected_rows),
        "selectedUrlCount": len(selected_urls),
        "selectedRows": selected_rows,
        "selectedUrls": selected_urls,
        "selectedCategoryCounts": dict(selected_category_counts),
    }


def ordered_queue_urls(selected_rows: list[dict], *, priority_categories: list[str] | None = None, url_column: str = "url", category_column: str = "category"):
    priority = [value.strip() for value in (priority_categories or []) if value and value.strip()]
    priority_index = {value.lower(): index for index, value in enumerate(priority)}
    ordered_rows = sorted(
        selected_rows,
        key=lambda row: (
            priority_index.get(normalize_scalar(row.get(category_column)).lower(), len(priority_index)),
            normalize_scalar(row.get(category_column)).lower(),
            normalize_scalar(row.get(url_column)).lower(),
        ),
    )
    urls = []
    seen_urls = set()
    for row in ordered_rows:
        url = normalize_scalar(row.get(url_column))
        if not url or url in seen_urls:
            continue
        urls.append(url)
        seen_urls.add(url)
    return urls
