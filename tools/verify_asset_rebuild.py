#!/usr/bin/env python3
"""Non-destructively verify shipped generated assets against two clean rebuilds.

Contract:
- PNG: exact decoded RGBA pixel hash (encoder metadata/compression independent).
- JPEG: cross-platform semantic hash from block-averaged, 5-bit RGB pixels.
- WAV/JSON: byte SHA-256 must match shipped output and both rebuilds.
- Same platform: every generated file must also be byte-identical between rebuild A/B.
- The project worktree, Git status and MANIFEST files must remain unchanged.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_RESULT = Path(tempfile.gettempdir()) / "hanhuaxiang-asset-rebuild-results.json"
EXCLUDED_PARTS = {".git", "node_modules", "__pycache__", ".pytest_cache", ".playwright"}
EXCLUDED_SUFFIXES = {".pyc", ".pyo"}
STRICT_BYTE_SUFFIXES = {".wav", ".json"}


def byte_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def semantic_digest(path: Path) -> tuple[str, dict[str, object]]:
    suffix = path.suffix.lower()
    if suffix == ".png":
        with Image.open(path) as opened:
            image = opened.convert("RGBA")
            pixels = np.asarray(image, dtype=np.uint8)
        header = f"PNG-RGBA:{image.width}x{image.height}:".encode("ascii")
        return hashlib.sha256(header + pixels.tobytes()).hexdigest(), {
            "mode": "exact-decoded-rgba",
            "size": [image.width, image.height],
        }
    if suffix in {".jpg", ".jpeg"}:
        with Image.open(path) as opened:
            image = opened.convert("RGB")
            original_size = [image.width, image.height]
            # BOX averaging suppresses libjpeg's occasional +/-1 decoder differences.
            canonical = image.resize((128, 72), Image.Resampling.BOX)
            pixels = np.asarray(canonical, dtype=np.uint16)
        # 5-bit colour with nearest-level rounding. This is intentionally semantic,
        # not a promise that independent JPEG encoders produce identical bytes.
        quantized = np.clip((pixels + 4) // 8, 0, 31).astype(np.uint8)
        header = f"JPEG-RGB5-BLOCK:{original_size[0]}x{original_size[1]}:128x72:".encode("ascii")
        return hashlib.sha256(header + quantized.tobytes()).hexdigest(), {
            "mode": "block-averaged-5bit-rgb",
            "size": original_size,
            "canonicalSize": [128, 72],
        }
    return byte_digest(path), {"mode": "byte-sha256"}


def generated_relpaths(root: Path) -> list[Path]:
    required = [
        Path("assets/background/mural-texture.jpg"),
        Path("assets/source-highres/mural-crops/manifest.json"),
        Path("assets/sprites/manifest.json"),
        Path("config/scene.json"),
        Path("docs/screenshots/asset-contact-sheet.jpg"),
    ]
    patterns = [
        "assets/source-highres/mural-crops/*.png",
        "assets/sprites/variants/*.png",
        "assets/audio/*.wav",
    ]
    relpaths = set(required)
    for pattern in patterns:
        relpaths.update(path.relative_to(root) for path in root.glob(pattern) if path.is_file())
    missing = [relative.as_posix() for relative in required if not (root / relative).is_file()]
    if missing:
        raise RuntimeError(f"missing required generated outputs under {root}: {missing}")
    return sorted(relpaths, key=lambda value: value.as_posix())


def snapshot_outputs(root: Path, relpaths: list[Path]) -> dict[str, dict[str, object]]:
    snapshot: dict[str, dict[str, object]] = {}
    missing: list[str] = []
    for relative in relpaths:
        path = root / relative
        if not path.is_file():
            missing.append(relative.as_posix())
            continue
        semantic, semantic_meta = semantic_digest(path)
        snapshot[relative.as_posix()] = {
            "bytes": path.stat().st_size,
            "byteSha256": byte_digest(path),
            "semanticSha256": semantic,
            "semantic": semantic_meta,
        }
    if missing:
        raise RuntimeError(f"missing generated outputs under {root}: {missing}")
    return snapshot


def project_snapshot() -> dict[str, str]:
    snapshot: dict[str, str] = {}
    for path in ROOT.rglob("*"):
        if not path.is_file():
            continue
        relative = path.relative_to(ROOT)
        if any(part in EXCLUDED_PARTS for part in relative.parts) or path.suffix in EXCLUDED_SUFFIXES:
            continue
        snapshot[relative.as_posix()] = byte_digest(path)
    return snapshot


def git_status() -> str | None:
    if not (ROOT / ".git").exists():
        return None
    result = subprocess.run(
        ["git", "status", "--porcelain=v1", "--untracked-files=all"],
        cwd=ROOT,
        text=True,
        capture_output=True,
        check=True,
    )
    return result.stdout


def run_build(output_root: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            str(ROOT / "tools" / "build_assets.py"),
            "--all",
            "--output-root",
            str(output_root),
        ],
        cwd=ROOT,
        check=True,
    )


def verify_manifest() -> str:
    result = subprocess.run(
        [sys.executable, str(ROOT / "tools" / "build_manifest.py"), "--verify"],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"manifest verification failed after asset verification:\n{result.stdout}{result.stderr}")
    return result.stdout.strip()


def ensure_result_outside_worktree(result_path: Path) -> None:
    try:
        result_path.relative_to(ROOT)
    except ValueError:
        return
    raise RuntimeError("asset verification result must be outside the project worktree")


def compare_snapshots(
    relpaths: list[Path],
    shipped: dict[str, dict[str, object]],
    first: dict[str, dict[str, object]],
    second: dict[str, dict[str, object]],
) -> dict[str, list[str]]:
    semantic_mismatches: list[str] = []
    same_platform_byte_mismatches: list[str] = []
    strict_shipped_byte_mismatches: list[str] = []
    for relative_path in relpaths:
        relative = relative_path.as_posix()
        shipped_entry = shipped[relative]
        first_entry = first[relative]
        second_entry = second[relative]
        if not (
            shipped_entry["semanticSha256"]
            == first_entry["semanticSha256"]
            == second_entry["semanticSha256"]
        ):
            semantic_mismatches.append(relative)
        if first_entry["byteSha256"] != second_entry["byteSha256"]:
            same_platform_byte_mismatches.append(relative)
        if relative_path.suffix.lower() in STRICT_BYTE_SUFFIXES and not (
            shipped_entry["byteSha256"]
            == first_entry["byteSha256"]
            == second_entry["byteSha256"]
        ):
            strict_shipped_byte_mismatches.append(relative)
    return {
        "semanticMismatches": semantic_mismatches,
        "samePlatformRebuildByteMismatches": same_platform_byte_mismatches,
        "strictShippedByteMismatches": strict_shipped_byte_mismatches,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--result", type=Path, default=Path(os.environ.get("ASSET_VERIFY_RESULT", DEFAULT_RESULT)))
    args = parser.parse_args()
    result_path = args.result.resolve()
    started = time.monotonic()
    ensure_result_outside_worktree(result_path)

    tree_before = project_snapshot()
    git_before = git_status()
    manifest_before = {
        name: byte_digest(ROOT / name)
        for name in ("MANIFEST.json", "MANIFEST.sha256")
        if (ROOT / name).is_file()
    }
    shipped_relpaths = generated_relpaths(ROOT)
    shipped = snapshot_outputs(ROOT, shipped_relpaths)

    preferred_tmp = os.environ.get("ASSET_VERIFY_TMPDIR")
    temp_kwargs = {"dir": preferred_tmp} if preferred_tmp else {}
    with tempfile.TemporaryDirectory(prefix="han-assets-a-", **temp_kwargs) as first_dir, tempfile.TemporaryDirectory(prefix="han-assets-b-", **temp_kwargs) as second_dir:
        first_root = Path(first_dir)
        second_root = Path(second_dir)
        run_build(first_root)
        run_build(second_root)
        first_relpaths = generated_relpaths(first_root)
        second_relpaths = generated_relpaths(second_root)
        if shipped_relpaths != first_relpaths or shipped_relpaths != second_relpaths:
            raise RuntimeError(
                "generated output path sets differ: "
                f"shipped={len(shipped_relpaths)}, first={len(first_relpaths)}, second={len(second_relpaths)}"
            )
        first = snapshot_outputs(first_root, shipped_relpaths)
        second = snapshot_outputs(second_root, shipped_relpaths)

    mismatches = compare_snapshots(shipped_relpaths, shipped, first, second)
    manifest_result = verify_manifest()
    tree_after = project_snapshot()
    git_after = git_status()
    manifest_after = {
        name: byte_digest(ROOT / name)
        for name in ("MANIFEST.json", "MANIFEST.sha256")
        if (ROOT / name).is_file()
    }
    worktree_unchanged = tree_before == tree_after and git_before == git_after
    manifest_files_unchanged = manifest_before == manifest_after
    ok = (
        not mismatches["semanticMismatches"]
        and not mismatches["samePlatformRebuildByteMismatches"]
        and not mismatches["strictShippedByteMismatches"]
        and worktree_unchanged
        and manifest_files_unchanged
    )

    payload = {
        "ok": ok,
        "timestampUtc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "durationSeconds": round(time.monotonic() - started, 3),
        "python": sys.version,
        "numpy": importlib.metadata.version("numpy"),
        "pillow": importlib.metadata.version("Pillow"),
        "outputCount": len(shipped_relpaths),
        **mismatches,
        "worktreeUnchanged": worktree_unchanged,
        "manifestFilesUnchanged": manifest_files_unchanged,
        "gitStatusAvailable": git_before is not None,
        "manifestVerification": manifest_result,
        "contract": {
            "png": "exact decoded RGBA pixel hash across shipped output and both rebuilds",
            "jpeg": "cross-platform semantic hash from 128x72 block-averaged 5-bit decoded RGB",
            "wavAndJson": "byte SHA-256 across shipped output and both rebuilds",
            "samePlatform": "all generated outputs byte-identical between rebuild A and rebuild B",
            "nonDestructive": "project file hashes, Git status, MANIFEST.json and MANIFEST.sha256 unchanged",
        },
        "outputs": shipped,
    }
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if not ok:
        print(json.dumps(payload, ensure_ascii=False, indent=2), file=sys.stderr)
        return 1
    print(
        f"Asset verification passed non-destructively: {len(shipped_relpaths)} outputs; "
        "shipped pixels/semantics match two clean rebuilds, same-platform bytes match, manifest remains valid."
    )
    print(f"Result: {result_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
