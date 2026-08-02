#!/usr/bin/env python3
"""Verify the V3 one-cell/one-voice live-recording audio contract."""
from __future__ import annotations

from array import array
import hashlib
import json
import math
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPECTED_VOICES = 63
EXPECTED_SOURCE_RECORDINGS = 246
SAMPLE_RATE = 48_000


def decode_pcm(path: Path) -> bytes:
    return subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-nostdin",
            "-i",
            str(path),
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "s16le",
            "pipe:1",
        ],
        check=True,
        capture_output=True,
    ).stdout


def pcm_metrics(pcm: bytes) -> tuple[str, float, float, float]:
    samples = array("h")
    samples.frombytes(pcm)
    if sys.byteorder != "little":
        samples.byteswap()
    if not samples:
        raise RuntimeError("decoded audio contains no samples")
    peak = max(abs(sample) for sample in samples) / 32768.0
    rms = math.sqrt(sum(sample * sample for sample in samples) / len(samples)) / 32768.0
    duration = len(samples) / SAMPLE_RATE
    return hashlib.sha256(pcm).hexdigest(), duration, rms, peak


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def main() -> int:
    scene = json.loads((ROOT / "config/scene.json").read_text(encoding="utf-8"))
    source = json.loads((ROOT / "assets/audio-source/vcsl/manifest.json").read_text(encoding="utf-8"))
    groups = scene["audioGroups"]
    nodes = scene["nodes"]
    voices = source["voices"]

    require(len(groups) == EXPECTED_VOICES, f"expected {EXPECTED_VOICES} audio groups, got {len(groups)}")
    require(len(nodes) == EXPECTED_VOICES, f"expected {EXPECTED_VOICES} nodes, got {len(nodes)}")
    require(len(voices) == EXPECTED_VOICES, f"expected {EXPECTED_VOICES} source voices, got {len(voices)}")
    require(len({group['id'] for group in groups}) == EXPECTED_VOICES, "audio group IDs are not unique")
    require(len({node['audioGroup'] for node in nodes}) == EXPECTED_VOICES, "nodes reuse an audio group")
    require({node["audioGroup"] for node in nodes} == {group["id"] for group in groups}, "node/group mapping differs")
    require(len({voice['sourceDir'] for voice in voices}) == EXPECTED_VOICES, "source instrument/articulation directories are reused")
    source_count = sum(len(voice["samples"]) for voice in voices)
    require(source_count == EXPECTED_SOURCE_RECORDINGS, f"expected {EXPECTED_SOURCE_RECORDINGS} recordings, got {source_count}")

    configured_files = {group["file"] for group in groups}
    disk_files = {path.relative_to(ROOT).as_posix() for path in (ROOT / "assets/audio").glob("*.ogg")}
    require(configured_files == disk_files, "configured and shipped OGG file sets differ")

    decoded_hashes: set[str] = set()
    rms_values: list[float] = []
    peak_values: list[float] = []
    durations: list[float] = []
    for group in groups:
        path = ROOT / group["file"]
        require(path.is_file(), f"missing audio file: {group['file']}")
        digest, duration, rms, peak = pcm_metrics(decode_pcm(path))
        require(15.9 <= duration <= 16.1, f"unexpected duration {duration:.3f}s: {group['file']}")
        require(rms >= 0.015, f"silent or nearly silent audio (RMS {rms:.4f}): {group['file']}")
        require(peak <= 0.99, f"audio clips or exceeds headroom (peak {peak:.4f}): {group['file']}")
        require(digest not in decoded_hashes, f"duplicate decoded audio: {group['file']}")
        decoded_hashes.add(digest)
        durations.append(duration)
        rms_values.append(rms)
        peak_values.append(peak)

    print(
        "Live audio verification passed: "
        f"{len(groups)} one-use voices, {source_count} real source recordings, "
        f"{len(decoded_hashes)} unique decoded tracks; "
        f"duration {min(durations):.3f}-{max(durations):.3f}s, "
        f"RMS {min(rms_values):.4f}-{max(rms_values):.4f}, "
        f"peak {min(peak_values):.4f}-{max(peak_values):.4f}."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
