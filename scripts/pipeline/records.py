from __future__ import annotations

import json
from pathlib import Path


LIST_CONTAINER_KEYS = ("restaurants", "items", "results", "data")


def iter_record_files(root: Path):
    return sorted(root.rglob("*.json"))


def load_record_container(path: Path) -> tuple[object, list[dict]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload, payload

    if isinstance(payload, dict):
        for key in LIST_CONTAINER_KEYS:
            maybe_records = payload.get(key)
            if isinstance(maybe_records, list):
                return payload, maybe_records

    raise ValueError(f"Unsupported JSON container shape in {path}")


def read_json_records(path: Path) -> list[dict]:
    _, records = load_record_container(path)
    return records


def write_record_container(path: Path, original_payload: object, records: list[dict]):
    if isinstance(original_payload, list):
        payload = records
    elif isinstance(original_payload, dict):
        payload = dict(original_payload)
        written = False
        for key in LIST_CONTAINER_KEYS:
            if isinstance(payload.get(key), list):
                payload[key] = records
                written = True
                break
        if not written:
            raise ValueError(f"Unsupported JSON container shape in {path}")
    else:
        raise ValueError(f"Unsupported JSON container shape in {path}")

    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
