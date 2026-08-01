#!/usr/bin/env python3
"""Build or verify the delivery manifest and SHA-256 checksum list."""
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_JSON = ROOT / "MANIFEST.json"
MANIFEST_SHA = ROOT / "MANIFEST.sha256"
EXCLUDED_PARTS = {".git", "node_modules", "__pycache__", ".pytest_cache", ".playwright"}
EXCLUDED_NAMES = {"MANIFEST.json", "MANIFEST.sha256", ".DS_Store"}
EXCLUDED_SUFFIXES = {".zip", ".pyc", ".pyo"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def project_files() -> list[Path]:
    files: list[Path] = []
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT)
        if any(part in EXCLUDED_PARTS for part in relative.parts):
            continue
        if path.name in EXCLUDED_NAMES or path.suffix in EXCLUDED_SUFFIXES:
            continue
        files.append(path)
    return sorted(files, key=lambda item: item.relative_to(ROOT).as_posix())


def build() -> dict:
    entries = []
    total_bytes = 0
    for path in project_files():
        relative = path.relative_to(ROOT).as_posix()
        size = path.stat().st_size
        total_bytes += size
        entries.append({"path": relative, "size": size, "sha256": sha256(path)})
    payload = {
        "schemaVersion": 1,
        "baseline": "ac76d30",
        "packageVersion": "3.0.0-v2",
        "fileCount": len(entries),
        "totalBytes": total_bytes,
        "files": entries,
    }
    MANIFEST_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    checksum_entries = [*entries, {"path": "MANIFEST.json", "sha256": sha256(MANIFEST_JSON)}]
    MANIFEST_SHA.write_text("".join(f"{entry['sha256']}  {entry['path']}\n" for entry in checksum_entries), encoding="utf-8")
    return payload


def verify() -> tuple[bool, list[str]]:
    if not MANIFEST_JSON.is_file() or not MANIFEST_SHA.is_file():
        return False, ["MANIFEST.json or MANIFEST.sha256 is missing"]
    expected: dict[str, str] = {}
    errors: list[str] = []
    for line_number, line in enumerate(MANIFEST_SHA.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        try:
            digest, relative = line.split("  ", 1)
        except ValueError:
            errors.append(f"invalid checksum line {line_number}")
            continue
        expected[relative] = digest
    for relative, digest in expected.items():
        path = ROOT / relative
        if not path.is_file():
            errors.append(f"missing: {relative}")
            continue
        actual = sha256(path)
        if actual != digest:
            errors.append(f"checksum mismatch: {relative}")
    manifest = json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))
    listed = {entry["path"] for entry in manifest.get("files", [])}
    current = {path.relative_to(ROOT).as_posix() for path in project_files()}
    if listed != current:
        for relative in sorted(listed - current):
            errors.append(f"manifest lists missing file: {relative}")
        for relative in sorted(current - listed):
            errors.append(f"unlisted file: {relative}")
    return not errors, errors


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.verify:
        ok, errors = verify()
        if ok:
            payload = json.loads(MANIFEST_JSON.read_text(encoding="utf-8"))
            print(f"Manifest verification passed: {payload['fileCount']} files, {payload['totalBytes']} bytes.")
            return 0
        print("Manifest verification failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1
    payload = build()
    print(f"Manifest written: {payload['fileCount']} files, {payload['totalBytes']} bytes.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
