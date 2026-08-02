#!/usr/bin/env python3
"""Import a compact, curated CC0 subset from a local VCSL mirror checkout."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

from live_audio_catalog import LIVE_VOICES

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "assets" / "audio-source" / "vcsl"
NOTE_RE = re.compile(r"(?:^|[_-])([A-G])([#b]?)(-?\d)(?:[_-]|\.)", re.IGNORECASE)
PENTATONIC = {"C", "D", "E", "G", "A"}


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def note_key(path: Path) -> tuple[int, str] | None:
    match = NOTE_RE.search(path.name)
    if not match or match.group(2):
        return None
    note, octave = match.group(1).upper(), int(match.group(3))
    if note not in PENTATONIC:
        return None
    semitone = {"C": 0, "D": 2, "E": 4, "G": 7, "A": 9}[note]
    return (octave * 12 + semitone, path.name)


def preferred(path: Path) -> tuple[int, str]:
    name = path.name.lower()
    # Medium dynamics and first round-robins keep the ensemble coherent while
    # retaining the original player's attack and room tone.
    score = 0
    if any(token in name for token in ("_mf", "medium", "_vl2", "_v2")):
        score -= 4
    if any(token in name for token in ("rr1", "_01", "_1.")):
        score -= 2
    if any(token in name for token in ("release", "_rel", "noise")):
        score += 6
    return score, name


def spread(items: list[Path], limit: int = 4) -> list[Path]:
    if len(items) <= limit:
        return items
    indices = [round(index * (len(items) - 1) / (limit - 1)) for index in range(limit)]
    return [items[index] for index in indices]


def select_samples(directory: Path, role: str) -> list[Path]:
    candidates = sorted(directory.glob("*.ogg"), key=preferred)
    if not candidates:
        raise RuntimeError(f"no OGG recordings found in {directory}")
    if role in {"pluck", "sustain", "wind", "strike"}:
        pitched: dict[int, Path] = {}
        for path in candidates:
            key = note_key(path)
            if key is not None and key[0] not in pitched:
                pitched[key[0]] = path
        if len(pitched) >= 3:
            return spread([pitched[key] for key in sorted(pitched)])
    return spread(candidates)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-root", type=Path, required=True, help="local checkout's audio/vcsl directory")
    parser.add_argument("--output-root", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    source_root = args.source_root.resolve()
    output_root = args.output_root.resolve()
    if not source_root.is_dir():
        raise SystemExit(f"VCSL source directory not found: {source_root}")
    output_root.mkdir(parents=True, exist_ok=True)

    entries: list[dict[str, object]] = []
    for index, voice in enumerate(LIVE_VOICES):
        source_dir = source_root / str(voice["sourceDir"])
        selected = select_samples(source_dir, str(voice["role"]))
        local_files = []
        for sample_index, source in enumerate(selected):
            filename = f"{index:02d}-{voice['slug']}-{sample_index + 1:02d}.ogg"
            destination = output_root / filename
            shutil.copyfile(source, destination)
            local_files.append({
                "file": filename,
                "originalPath": source.relative_to(source_root).as_posix(),
                "bytes": destination.stat().st_size,
                "sha256": sha256(destination),
            })
        entries.append({
            **voice,
            "id": f"voice-{index:02d}-{voice['slug']}",
            "samples": local_files,
        })

    source_readme = source_root / "README.md"
    if source_readme.is_file():
        shutil.copyfile(source_readme, output_root / "VCSL-README.md")
    payload = {
        "schemaVersion": 1,
        "license": "CC0-1.0",
        "library": "Versilian Community Sample Library",
        "creator": "Versilian Studios LLC and VCSL contributors",
        "officialUrl": "https://versilian-studios.com/vcsl/",
        "upstream": "https://github.com/sgossner/VCSL",
        "compressedMirror": "https://github.com/danigb/samples/tree/main/audio/vcsl",
        "selectionPolicy": "63 different recorded instruments/articulations; up to four CC0 OGG samples per grid voice",
        "voices": entries,
    }
    (output_root / "manifest.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Imported {sum(len(entry['samples']) for entry in entries)} recordings for {len(entries)} unique voices into {output_root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
