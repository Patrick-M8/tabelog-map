from __future__ import annotations

import os
from pathlib import Path


def _parse_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values

    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def env_value(name: str, cwd: Path | None = None) -> str | None:
    if name in os.environ:
        return os.environ[name]

    search_root = cwd or Path.cwd()
    for directory in [search_root, *search_root.parents]:
        for filename in (".env.local", ".env"):
            candidate = directory / filename
            values = _parse_dotenv(candidate)
            if name in values:
                return values[name]
    return None


def google_api_key(cwd: Path | None = None, required: bool = False) -> str | None:
    for key_name in ("GOOGLE_MAPS_API_KEY", "GOOGLE_PLACES_API_KEY"):
        value = env_value(key_name, cwd=cwd)
        if value:
            return value

    if required:
        raise RuntimeError("Set GOOGLE_MAPS_API_KEY or GOOGLE_PLACES_API_KEY before running Google enrichment commands.")
    return None
